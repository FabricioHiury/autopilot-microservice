import { deliverMetaStatuses } from '../delivery/meta-status.utils';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../base/service/prisma.service';
import { ErrorResponse } from '../../base/exceptions/error.response.handler';
import { uuidv7 } from 'uuidv7';
import {
  InstagramUserDataResponse,
  InstagramGetLongLivedTokenDto,
  InstagramLongLivedTokenResponse,
  InstagramShortLivedTokenResponse,
  InstagramPayload,
  InstagramRefreshLongLivedTokenDto,
  InstagramUserResponse,
} from './instagram.interfaces';
import axios from 'axios';
import { MessageTypeEnum } from '../integrations/enum/message-type.enum';
import { stringify } from 'querystring';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ProviderMessageEvent } from '../communication/dto/outgoing-message.dto';
import { IntegrationsEnum } from '../integrations/enum/integrations.enum';
import { SendMessageDto } from '../communication/dto/incoming-message.dto';
import { IntegrationStatusDto } from '../integrations/dto/integrations-status.dto';
import { instagramUtils } from './instagram.utils';
import { randomBytes, createHash } from 'crypto';
import { ConfigureWebhooksDto } from './dto/configure-webhooks.dto';
import {
  IntegrationsStatusEnum,
  IntegrationsStatusErrorMessageEnum,
} from '../integrations/enum/integrations-status.enum';
import { RateLimitService } from '../../base/service/rate-limit.service';
import { FirebaseService } from '../../base/service/firebase.service';
import { Logger } from '@nestjs/common';
import { InstagramMessageOriginUtil } from './utils/message-origin.util';
import {
  InstagramMessageOriginDetails,
  InstagramMessageOriginEnum,
} from './enum/instagram-message-origin.enum';

@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name);
  private readonly instagramAuthUrl: string;
  private readonly redirectUri: string;
  private readonly instagramGraphUrl: string;
  private readonly facebookGraphUrl: string =
    'https://graph.facebook.com/v24.0';

  constructor(
    private readonly prismaService: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly rateLimit: RateLimitService,
    private readonly firebaseService: FirebaseService,
  ) {
    this.instagramAuthUrl = process.env.INSTAGRAM_AUTH_URL;
    this.redirectUri = `${process.env.APP_BASE_URL}/instagram/webhooks/auth/access-code`;
    this.instagramGraphUrl = process.env.INSTAGRAM_GRAPH_URL;
  }

  private async uploadProfileAvatar(
    instancePrefix: string,
    senderId: string,
    externalUrl?: string,
    lastSavedUrl?: string | null,
  ): Promise<string | null> {
    if (!externalUrl) return lastSavedUrl ?? null;
    try {
      const response = await axios.get<ArrayBuffer>(externalUrl, {
        responseType: 'arraybuffer',
        timeout: 20000,
      });
      const buffer = Buffer.from(response.data);
      const contentType = String(
        response.headers['content-type'] || 'image/jpeg',
      );
      const hash = createHash('sha256')
        .update(new Uint8Array(buffer))
        .digest('hex')
        .slice(0, 12);

      if (lastSavedUrl && lastSavedUrl.includes(`-${hash}`)) {
        return lastSavedUrl;
      }

      const path = `${instancePrefix}/profile/${senderId}-${hash}`;
      const [, signedUrl] = await this.firebaseService.uploadBufferToPath(
        buffer,
        contentType,
        path,
      );
      return signedUrl;
    } catch (error) {
      this.logger.warn(
        'Failed to upload Instagram avatar:',
        (error as any)?.message,
      );
      return lastSavedUrl ?? externalUrl ?? null;
    }
  }

  /**
   * Configure webhooks for Instagram integration
   */
  configureWebhooks(query: ConfigureWebhooksDto): number {
    if (query['hub.verify_token'] !== process.env.INSTAGRAM_WEBHOOK_TOKEN) {
      throw new ErrorResponse('No permission to configure webhooks', 401);
    }

    return parseInt(query['hub.challenge']);
  }

  /**
   * Find authenticated store by ID
   */
  private async findAuthenticatedStoreById(storeId: string) {
    const store = await this.prismaService.instagramAuthData.findUnique({
      where: {
        storeId: storeId,
        token: {
          not: null,
        },
      },
    });

    if (!store) {
      throw new ErrorResponse(
        'Store not found. You need to integrate with Instagram before trying to send messages.',
        404,
      );
    }

    if (!store.token) {
      throw new ErrorResponse(
        'Long-lived token not found, you need to authorize the Instagram integration before accessing this route.',
        401,
      );
    }

    return store;
  }

  /**
   * Find store auth data by Instagram ID
   */
  private async findStoreAuthByInstagramId(instagramGlobalStoreId: string) {
    const store = await this.prismaService.instagramAuthData.findUnique({
      where: {
        instagramGlobalId: instagramGlobalStoreId,
      },
    });

    if (!store) {
      throw new ErrorResponse('Store not found.', 404);
    }

    return store;
  }

  /**
   * Get short-lived token from access code
   */
  private async getShortLivedToken(
    code: string,
    uniqueId: string,
  ): Promise<string> {
    const body = stringify({
      client_id: process.env.INSTAGRAM_APP_ID,
      client_secret: process.env.INSTAGRAM_APP_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: this.redirectUri,
      code,
    });

    try {
      const { data } = await axios.post<InstagramShortLivedTokenResponse>(
        `${this.instagramAuthUrl}/access_token`,
        body,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      await this.prismaService.instagramAuthData.update({
        where: { uniqueId },
        data: {
          instagramAppId: String(data.user_id),
        },
      });

      return data.access_token;
    } catch (error) {
      throw new ErrorResponse(
        `Error exchanging access code for token: ${error?.message}`,
        500,
      );
    }
  }

  /**
   * Exchange short-lived token for long-lived token
   */
  private async getLongLivedToken(shortLivedToken: string) {
    const params: InstagramGetLongLivedTokenDto = {
      access_token: shortLivedToken,
      client_secret: process.env.INSTAGRAM_APP_SECRET,
      grant_type: 'ig_exchange_token',
    };

    try {
      const response = await axios.get<InstagramLongLivedTokenResponse>(
        `${this.instagramGraphUrl}/access_token`,
        { params },
      );

      return {
        longLivedToken: response.data.access_token,
        longLivedTokenExpiresAt: instagramUtils.setTokenExpiration(
          response.data.expires_in,
        ),
      };
    } catch (error) {
      this.logger.error('IG EXCHANGE PARAMS:', params);
      this.logger.error('IG EXCHANGE ERROR BODY:', error.response?.data);
      throw new ErrorResponse(
        `Error exchanging access token for long-lived token: ${error.response?.data?.error?.message || error.message}`,
        500,
      );
    }
  }

  /**
   * Get Instagram store ID from token
   */
  private async getInstagramStoreId(token: string): Promise<string> {
    try {
      const { data } = await axios.get<InstagramUserResponse>(
        `${this.instagramGraphUrl}/me`,
        {
          params: {
            fields: 'user_id',
            access_token: token,
          },
        },
      );

      if (!data?.user_id) {
        throw new ErrorResponse('External ID not found.', 404);
      }

      return String(data.user_id);
    } catch (error) {
      throw new ErrorResponse(
        `Error getting user's external ID: ${error?.message}`,
        500,
      );
    }
  }

  /**
   * Activate webhook for receiving messages
   */
  private async activateMessageReceivingWebhook(
    externalUserId: string,
    token: string,
  ): Promise<void> {
    const body = stringify({
      subscribed_fields: 'messages',
      access_token: token,
    });

    try {
      await axios.post(
        `${this.instagramGraphUrl}/${externalUserId}/subscribed_apps`,
        body,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );
    } catch (error) {
      throw new ErrorResponse(
        `Error configuring message reception: ${error?.message}`,
        500,
      );
    }
  }

  /**
   * Get sender data from Instagram
   * Note: Uses Facebook Graph API because Instagram Messaging API runs on it
   * The IGSID (Instagram-Scoped User ID) must be queried via graph.facebook.com
   */
  private async getSenderData(instagramSenderId: string, storeToken: string) {
    const params = {
      fields: 'name,profile_pic',
      access_token: storeToken,
    };

    try {
      const { data } = await axios.get<InstagramUserDataResponse>(
        `${this.facebookGraphUrl}/${instagramSenderId}`,
        { params },
      );

      if (!data.profile_pic && data.profile_picture_url) {
        data.profile_pic = data.profile_picture_url;
      }

      return data;
    } catch (error: any) {
      const status = error?.response?.status;
      const message = error?.message || 'unknown error';
      const errorData = error?.response?.data?.error;
      const errorCode = errorData?.code;
      const errorSubcode = errorData?.error_subcode;
      const errorMessage = errorData?.message;

      if (status === 400) {
        this.logger.warn(
          `[INSTAGRAM] Failed to get sender data for ${instagramSenderId}:`,
          {
            message,
            errorCode,
            errorSubcode,
            errorMessage,
          },
        );
        return { name: undefined, username: undefined, profile_pic: undefined };
      } else {
        this.logger.error(
          `[INSTAGRAM] Error getting sender data for ${instagramSenderId}: ${message}`,
        );
        throw new ErrorResponse(
          `Error getting Instagram message sender data: ${message}`,
          500,
        );
      }
    }
  }

  /**
   * Get media URL from Instagram post/reel
   */
  private async getMediaUrl(
    mediaId: string,
    storeToken: string,
  ): Promise<string | null> {
    const params = {
      fields: 'media_url,media_type,thumbnail_url',
      access_token: storeToken,
    };

    try {
      const { data } = await axios.get<{
        media_url?: string;
        media_type?: string;
        thumbnail_url?: string;
      }>(`${this.instagramGraphUrl}/${mediaId}`, { params, timeout: 10000 });

      // For videos, prefer media_url, but fallback to thumbnail if not available
      return data.media_url || data.thumbnail_url || null;
    } catch (error) {
      this.logger.warn(
        `Failed to fetch media URL for ${mediaId}:`,
        error?.message,
      );
      return null;
    }
  }

  /**
   * Get authentication URL for Instagram
   */
  async getAuthenticationUrl(uniqueId: string): Promise<string> {
    this.logger.debug(
      `[getAuthenticationUrl] Starting with uniqueId: ${uniqueId}`,
    );

    const scope = 'instagram_business_basic,instagram_business_manage_messages';
    const forceAuthentication = '1';
    const enableFbLogin = '0';
    const state = uniqueId;
    const clientId = process.env.INSTAGRAM_APP_ID;

    // Debug environment variables
    this.logger.debug(`[getAuthenticationUrl] Environment variables:`, {
      instagramAuthUrl: this.instagramAuthUrl,
      redirectUri: this.redirectUri,
      clientId: clientId ? '***' + clientId.slice(-4) : 'NOT_SET',
      appBaseUrl: process.env.APP_BASE_URL,
    });

    const store = await this.prismaService.instagramAuthData.findUnique({
      where: { uniqueId },
    });

    if (!store) {
      throw new ErrorResponse('Store not found', 404);
    }

    this.logger.debug(`[getAuthenticationUrl] Found store: ${store.storeId}`);

    const url = new URL(`${this.instagramAuthUrl}/authorize`);
    this.logger.debug(`[getAuthenticationUrl] Base URL: ${url.toString()}`);

    url.searchParams.set('enable_fb_login', enableFbLogin);
    url.searchParams.set('force_authentication', forceAuthentication);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', scope);
    url.searchParams.set('state', state);

    const finalUrl = url.toString();
    this.logger.debug(`[getAuthenticationUrl] Final URL: ${finalUrl}`);
    this.logger.debug(
      `[getAuthenticationUrl] redirect_uri param: ${this.redirectUri}`,
    );

    return finalUrl;
  }

  /**
   * Save Instagram client information
   */
  async saveInstagramClient(storeId: string): Promise<string> {
    const store = await this.prismaService.store.findUnique({
      where: { id: storeId },
    });

    if (!store) {
      throw new ErrorResponse('Store not found', 404);
    }

    const uniqueId = uuidv7();

    try {
      await this.prismaService.instagramAuthData.upsert({
        where: { storeId: storeId },
        update: {
          uniqueId,
        },
        create: {
          storeId: storeId,
          uniqueId,
        },
      });

      return this.getAuthenticationUrl(uniqueId);
    } catch (error) {
      throw new ErrorResponse(
        `Error saving Instagram client: ${error?.message}`,
        500,
      );
    }
  }

  /**
   * Complete Instagram integration
   */
  async completeIntegration(code: string, uniqueId: string): Promise<string> {
    if (!code || !uniqueId) {
      throw new ErrorResponse(
        'Instagram integration not authorized by the store.',
        400,
      );
    }

    const store = await this.prismaService.instagramAuthData.findUnique({
      where: { uniqueId },
    });

    if (!store) {
      throw new ErrorResponse(
        'Store not found, you need to save Instagram integration data before accessing this route.',
        404,
      );
    }

    const shortLivedToken = await this.getShortLivedToken(code, uniqueId);

    const { longLivedToken, longLivedTokenExpiresAt } =
      await this.getLongLivedToken(shortLivedToken);

    const instagramGlobalId = await this.getInstagramStoreId(longLivedToken);

    await this.prismaService.instagramAuthData.update({
      where: { uniqueId },
      data: {
        instagramGlobalId,
        token: longLivedToken,
        tokenExpiry: longLivedTokenExpiresAt,
      },
    });

    await this.activateMessageReceivingWebhook(
      instagramGlobalId,
      longLivedToken,
    );

    return `Instagram integration successfully authorized. You can now send and receive messages!`;
  }

  /**
   * Refresh Instagram token
   * Uses Instagram Graph API to refresh long-lived access tokens
   * Tokens can be refreshed if they are at least 24 hours old but have not expired
   * Refreshed tokens are valid for 60 days from the refresh date
   * @param storeId ID of the store to refresh token for
   */
  async refreshToken(storeId: string): Promise<void> {
    const store = await this.findAuthenticatedStoreById(storeId);

    const params: InstagramRefreshLongLivedTokenDto = {
      access_token: store.token,
      grant_type: 'ig_refresh_token',
    };

    try {
      const { data } = await axios.get<InstagramLongLivedTokenResponse>(
        `${this.instagramGraphUrl}/refresh_access_token`,
        { params },
      );

      await this.prismaService.instagramAuthData.update({
        where: { storeId: storeId },
        data: {
          token: data.access_token,
          tokenExpiry: instagramUtils.setTokenExpiration(data.expires_in),
        },
      });
    } catch (error) {
      throw new ErrorResponse(
        `Error refreshing long-lived token: ${error?.message}`,
        500,
      );
    }
  }

  /**
   * Receive message from Instagram
   */
  async receiveMessage(
    payload: InstagramPayload,
    signature: string,
    body: Buffer,
  ): Promise<void> {
    instagramUtils.validatePayloadSignature(body, signature);

    if (!payload.entry || payload.entry.length === 0) {
      return;
    }

    for (const entry of payload.entry) {
      const storeAuth = await this.findStoreAuthByInstagramId(entry.id);

      for (const message of entry.messaging) {
        await deliverMetaStatuses(
          this.prismaService,
          this.eventEmitter,
          storeAuth.storeId,
          'instagram',
          message,
        );
        if (!message.message) {
          continue;
        }

        const isEcho = Boolean(message.message.is_echo);
        const counterpartId = isEcho ? message.recipient.id : message.sender.id;

        let name: string | null = null;
        let username: string | null = null;
        let profile_pic: string | null = null;
        try {
          const senderData = await this.getSenderData(
            counterpartId,
            storeAuth.token,
          );
          name = senderData.name || null;
          username = senderData.username || null;
          profile_pic = senderData.profile_pic || null;
        } catch (error: any) {
          this.logger.warn(
            `[INSTAGRAM RECEIVE] Failed to get sender data for ${counterpartId}: ${error?.message}`,
          );
        }

        const firstAttachment = message.message.attachments?.[0];
        let attachmentUrl = firstAttachment?.payload?.url || undefined;
        let attachmentMimeType: string | undefined;

        let resolvedType: MessageTypeEnum = MessageTypeEnum.TEXT;
        const reportedType = firstAttachment?.type?.toLowerCase();
        const urlLower = (attachmentUrl || '').toLowerCase();

        const messageOrigin: InstagramMessageOriginDetails =
          InstagramMessageOriginUtil.identifyMessageOrigin(message.message);
        const originDescription =
          InstagramMessageOriginUtil.getOriginDescription(messageOrigin);

        if (firstAttachment) {
          switch (reportedType) {
            case 'image':
              resolvedType = MessageTypeEnum.IMAGE;
              attachmentMimeType = 'image/jpeg';
              break;
            case 'video':
              resolvedType =
                messageOrigin.origin === InstagramMessageOriginEnum.REEL_REPLY
                  ? MessageTypeEnum.REEL
                  : MessageTypeEnum.VIDEO;
              attachmentMimeType = 'video/mp4';
              break;
            case 'audio':
              resolvedType = MessageTypeEnum.AUDIO;
              attachmentMimeType = 'audio/mp4';
              break;
            case 'voice':
              resolvedType = MessageTypeEnum.VOICE;
              attachmentMimeType = 'audio/mp4';
              break;
            case 'file':
            case 'document':
              resolvedType = MessageTypeEnum.DOCUMENT;
              attachmentMimeType = 'application/octet-stream';
              break;
            case 'sticker':
              resolvedType = MessageTypeEnum.STICKER;
              attachmentMimeType = 'image/webp';
              break;
            case 'share':
            case 'story_mention':
              resolvedType = MessageTypeEnum.UNKNOWN;
              break;
            case 'ig_reel':
            case 'reel':
              resolvedType = MessageTypeEnum.REEL;
              attachmentMimeType = 'video/mp4';
              break;
            default:
              resolvedType = MessageTypeEnum.UNKNOWN;
          }

          if (
            resolvedType === MessageTypeEnum.UNKNOWN ||
            resolvedType === MessageTypeEnum.DOCUMENT ||
            resolvedType === MessageTypeEnum.IMAGE ||
            resolvedType === MessageTypeEnum.VIDEO
          ) {
            const beforeRefinement = resolvedType;
            if (
              /\.(gif)(\?|$)/i.test(urlLower) ||
              /giphy\.com/i.test(urlLower)
            ) {
              resolvedType = MessageTypeEnum.STICKER;
              attachmentMimeType = 'image/gif';
            } else if (/\.(mp3|wav|m4a|aac|oga)(\?|$)/i.test(urlLower)) {
              resolvedType = MessageTypeEnum.AUDIO;
              if (!attachmentMimeType) {
                if (/\.mp3(\?|$)/i.test(urlLower))
                  attachmentMimeType = 'audio/mpeg';
                else if (/\.m4a(\?|$)/i.test(urlLower))
                  attachmentMimeType = 'audio/m4a';
                else if (/\.aac(\?|$)/i.test(urlLower))
                  attachmentMimeType = 'audio/aac';
                else attachmentMimeType = 'audio/mp4';
              }
            } else if (/\.(mp4|mov|mkv|webm)(\?|$)/i.test(urlLower)) {
              if (
                messageOrigin.origin === InstagramMessageOriginEnum.REEL_REPLY
              ) {
                resolvedType = MessageTypeEnum.REEL;
                attachmentMimeType = 'video/mp4';
              } else {
                resolvedType = MessageTypeEnum.VIDEO;
                if (!attachmentMimeType) attachmentMimeType = 'video/mp4';
              }
            } else if (
              /\.(png|jpe?g|gif|webp|bmp|tiff?)(\?|$)/i.test(urlLower)
            ) {
              resolvedType =
                /sticker|stickers/.test(urlLower) ||
                /\.webp(\?|$)/i.test(urlLower)
                  ? MessageTypeEnum.STICKER
                  : MessageTypeEnum.IMAGE;
              if (!attachmentMimeType) {
                if (/\.png(\?|$)/i.test(urlLower))
                  attachmentMimeType = 'image/png';
                else if (/\.webp(\?|$)/i.test(urlLower))
                  attachmentMimeType = 'image/webp';
                else attachmentMimeType = 'image/jpeg';
              }
            }
          }
        }

        this.logger.log('[INSTAGRAM RECEIVE] Type Resolution:', {
          reportedType,
          resolvedType,
          attachmentMimeType,
          messageId: message.message.mid,
        });

        this.logger.log('[INSTAGRAM RECEIVE] Message Echo Status:', {
          messageId: message.message.mid,
          isEcho,
          counterpartId,
          hasText:
            message.message.text && message.message.text.trim().length > 0,
          hasAttachment: !!firstAttachment,
        });

        this.logger.log('[INSTAGRAM RECEIVE] Attachment Debug:', {
          hasAttachment: !!firstAttachment,
          reportedType,
          url: attachmentUrl,
          messageId: message.message.mid,
        });

        this.logger.log(
          '[INSTAGRAM RECEIVE] Final resolved type:',
          resolvedType,
        );

        if (!attachmentUrl) {
          const mediaSource = InstagramMessageOriginUtil.extractMediaSource(
            message.message,
            messageOrigin,
          );

          if (
            mediaSource.source === 'story' ||
            mediaSource.source === 'referral_ad'
          ) {
            attachmentUrl = mediaSource.url;
          } else if (
            mediaSource.source === 'api_fetch' &&
            mediaSource.mediaId
          ) {
            const mediaUrl = await this.getMediaUrl(
              mediaSource.mediaId,
              storeAuth.token,
            );
            if (mediaUrl) {
              attachmentUrl = mediaUrl;
            }
          }
        }

        let replyToMessageId: string | undefined;
        if (message.message.reply_to) {
          if ('mid' in message.message.reply_to) {
            replyToMessageId = message.message.reply_to.mid;
          } else if ('story' in message.message.reply_to) {
            replyToMessageId = message.message.reply_to.story.id;
          }
        }

        const hasText =
          message.message.text && message.message.text.trim().length > 0;
        const hasAttachment = attachmentUrl && attachmentUrl.trim().length > 0;

        if (hasText && hasAttachment) {
          const combinedMessage: ProviderMessageEvent = {
            storeId: storeAuth.storeId,
            messageId: message.message.mid,
            externalContactId: counterpartId,
            text: message.message.text,
            attachmentUrl: attachmentUrl,
            attachmentType: attachmentMimeType,
            quotedMessageId: replyToMessageId,
            channel: IntegrationsEnum.INSTAGRAM,
            timestamp: new Date(message.timestamp + 1),
            metadata: {
              name: name,
              externalAdId:
                message.message.referral?.ad_id ||
                (message as any).referral?.ad_id,
              username: username || undefined,
              avatarUrl: profile_pic || undefined,
              source: messageOrigin.origin,
              sourceDetails: JSON.stringify({
                description: originDescription,
                storyId: messageOrigin.storyId,
                storyUrl: messageOrigin.storyUrl,
                postId: messageOrigin.postId,
                reelId: messageOrigin.reelId,
                referralSource: messageOrigin.referralSource,
                referralRef: messageOrigin.referralRef,
                referralType: messageOrigin.referralType,
              }),
              isContentReply:
                InstagramMessageOriginUtil.isContentReply(messageOrigin),
              isFromReferral:
                InstagramMessageOriginUtil.isFromReferral(messageOrigin),
            },
            sentByStore: isEcho,
            type: resolvedType,
          };

          if (isEcho) {
          }

          await this.eventEmitter.emitAsync('message.receive', combinedMessage);
        } else {
          const instagramMessage: ProviderMessageEvent = {
            storeId: storeAuth.storeId,
            messageId: message.message.mid,
            externalContactId: counterpartId,
            text: message.message.text,
            attachmentUrl: attachmentUrl,
            attachmentType: attachmentMimeType,
            quotedMessageId: replyToMessageId,
            channel: IntegrationsEnum.INSTAGRAM,
            timestamp: new Date(message.timestamp),
            metadata: {
              name: name,
              externalAdId:
                message.message.referral?.ad_id ||
                (message as any).referral?.ad_id,
              username: username || undefined,
              avatarUrl: profile_pic || undefined,
              source: messageOrigin.origin,
              sourceDetails: JSON.stringify({
                description: originDescription,
                storyId: messageOrigin.storyId,
                storyUrl: messageOrigin.storyUrl,
                postId: messageOrigin.postId,
                reelId: messageOrigin.reelId,
                referralSource: messageOrigin.referralSource,
                referralRef: messageOrigin.referralRef,
                referralType: messageOrigin.referralType,
              }),
              isContentReply:
                InstagramMessageOriginUtil.isContentReply(messageOrigin),
              isFromReferral:
                InstagramMessageOriginUtil.isFromReferral(messageOrigin),
            },
            sentByStore: isEcho,
            type: resolvedType,
          };

          if (isEcho) {
          }

          await this.eventEmitter.emitAsync(
            'message.receive',
            instagramMessage,
          );
        }
      }
    }
  }

  /**
   * Send message to Instagram
   */
  async sendMessage({
    storeId: storeId,
    recipient: recipient,
    text: messageText,
    attachmentUrl: messageAttachment,
    attachmentType: requestedAttachmentType,
    type,
    quotedMessageId,
  }: SendMessageDto): Promise<string> {
    await this.rateLimit.checkAppVolumeLimit();

    const rateLimitType = messageAttachment ? 'media' : 'text';
    await this.rateLimit.checkInstagramRateLimits(storeId, rateLimitType);

    const store = await this.findAuthenticatedStoreById(storeId);

    try {
      const pageToken = store.token!;
      const igId = store.instagramGlobalId!;

      if (type === 'reaction' && quotedMessageId) {
        return await this.sendReaction(
          igId,
          pageToken,
          recipient,
          quotedMessageId,
          messageText,
        );
      }

      if (messageText && messageText.length > 1000) {
        throw new ErrorResponse(
          'Message text must be 1000 characters or less',
          400,
        );
      }

      let payload: any;
      if (messageAttachment) {
        const lower = (requestedAttachmentType || '').toLowerCase();
        const urlNoQuery = String(messageAttachment).split('?')[0];
        const ext = (
          urlNoQuery.includes('.')
            ? urlNoQuery.substring(urlNoQuery.lastIndexOf('.') + 1)
            : ''
        ).toLowerCase();

        const isAudioByMime = lower.startsWith('audio');
        const isVideoByMime = lower.startsWith('video');
        const isImageByMime = lower.startsWith('image');

        const isAudioByExt = /(m4a|aac|wav)/i.test(ext);
        const isVideoByExt = /(mov|avi|webm|ogg)/i.test(ext);
        const isImageByExt = /(png|jpeg|jpg|gif|webp)/i.test(ext);

        let attachmentType: string;
        if (isImageByMime || isImageByExt) {
          attachmentType = 'image';
        } else if (isAudioByMime) {
          attachmentType = 'audio';
        } else if (isAudioByExt) {
          attachmentType = 'audio';
        } else if (ext === 'mp4' && !isVideoByMime) {
          attachmentType = 'audio';
        } else if (isVideoByMime || isVideoByExt || ext === 'mp4') {
          attachmentType = 'video';
        } else {
          attachmentType = 'file';
        }

        this.logger.log('[INSTAGRAM SEND] Attachment Analysis:', {
          mimeType: attachmentType,
          extension: ext,
          url: messageAttachment,
          isAudioByMime,
          isAudioByExt,
          isVideoByMime,
          isVideoByExt,
          isImageByMime,
          isImageByExt,
          finalType: attachmentType,
        });

        payload = {
          attachment: {
            type: attachmentType,
            payload: { url: messageAttachment },
            is_reusable: true,
          },
        };
      } else {
        payload = { text: messageText };
      }

      const requestBody: any = {
        recipient: { id: recipient },
        message: payload,
      };

      const { data: response } = await axios.post<{
        message_id?: string;
        id?: string;
      }>(`${this.instagramGraphUrl}/${igId}/messages`, requestBody, {
        headers: { Authorization: `Bearer ${pageToken}` },
        timeout: 30000,
      });

      const externalMessageId = response.message_id || response.id || 'success';

      this.logger.log('[INSTAGRAM SEND] Message sent successfully:', {
        storeId,
        recipient,
        externalMessageId,
        hasAttachment: !!messageAttachment,
        messageType: type,
      });

      if (externalMessageId && externalMessageId !== 'success') {
      }

      return externalMessageId;
    } catch (error) {
      const axiosError = error as any;

      this.logger.error('Instagram send message error:', {
        storeId,
        recipient,
        messageText,
        error: {
          status: axiosError.response?.status,
          statusText: axiosError.response?.statusText,
          data: axiosError.response?.data,
          code: axiosError.code,
          message: axiosError.message,
        },
      });

      if (axiosError.response?.status === 400) {
        const errorData = axiosError.response.data;
        if (errorData?.error?.code === 10) {
          throw new ErrorResponse(
            'Instagram user not found or conversation not available',
            500,
          );
        }
        if (errorData?.error?.code === 200) {
          throw new ErrorResponse(
            'Instagram permissions error - token may be invalid',
            500,
          );
        }
        throw new ErrorResponse(
          `Instagram API error: ${errorData?.error?.message || 'Bad request'}`,
          500,
        );
      }

      if (axiosError.response?.status === 401) {
        throw new ErrorResponse(
          'Instagram token is invalid or expired. Please reconnect your Instagram account.',
          401,
        );
      }

      if (axiosError.response?.status === 403) {
        throw new ErrorResponse(
          'Instagram API access forbidden. Check your app permissions.',
          500,
        );
      }

      if (axiosError.response?.status >= 500) {
        throw new ErrorResponse(
          `Instagram service temporarily unavailable (${axiosError.response.status}). Please try again later.`,
          500,
        );
      }

      if (axiosError.code === 'ECONNRESET' || axiosError.code === 'ETIMEDOUT') {
        throw new ErrorResponse(
          'Connection timeout while sending Instagram message. Please try again.',
          500,
        );
      }

      throw new ErrorResponse(
        `Error sending Instagram message: ${axiosError.message}`,
        500,
      );
    }
  }

  async sendPrivateReply(
    storeId: string,
    commentId: string,
    message: string,
  ): Promise<string> {
    await this.rateLimit.checkAppVolumeLimit();
    await this.rateLimit.checkInstagramRateLimits(storeId, 'reply');

    const store = await this.findAuthenticatedStoreById(storeId);

    try {
      await axios.post(
        `${this.instagramGraphUrl}/${commentId}/private_replies`,
        { message: { text: message } },
        { headers: { Authorization: `Bearer ${store.token}` } },
      );

      return 'Private reply sent successfully!';
    } catch (error) {
      throw new ErrorResponse(
        `Error sending private reply: ${error?.message}`,
        500,
      );
    }
  }

  /**
   * Check Instagram integration health
   */
  async healthCheck(storeId: string): Promise<IntegrationStatusDto> {
    const store = await this.prismaService.instagramAuthData.findUnique({
      where: { storeId: storeId },
    });

    const healthCheckObject: IntegrationStatusDto = {
      channel: IntegrationsEnum.INSTAGRAM,
      status: IntegrationsStatusEnum.NOT_CONFIGURED,
      message: IntegrationsStatusErrorMessageEnum.INTEGRATION_NOT_CONFIGURED,
    };

    if (!store?.token) {
      return healthCheckObject;
    }

    try {
      const { data } = await axios.get<InstagramUserResponse>(
        `${this.instagramGraphUrl}/me`,
        { params: { fields: 'user_id', access_token: store.token } },
      );

      if (!data?.user_id || data?.user_id !== store.instagramGlobalId) {
        healthCheckObject.status = IntegrationsStatusEnum.ERROR;
        return healthCheckObject;
      }

      healthCheckObject.status = IntegrationsStatusEnum.OK;
      healthCheckObject.message = null;
      return healthCheckObject;
    } catch (error) {
      healthCheckObject.status = IntegrationsStatusEnum.ERROR;
      return healthCheckObject;
    }
  }

  async removeStorePermissions(signedRequest: string): Promise<void> {
    const data = instagramUtils.parseSignedRequest(signedRequest);

    if (!data?.user_id) {
      throw new ErrorResponse('Error validating payload.', 401);
    }

    const storeAuth = await this.findStoreAuthByInstagramId(data.user_id);

    await this.prismaService.instagramAuthData.update({
      where: {
        storeId: storeAuth.storeId,
      },
      data: {
        instagramGlobalId: null,
        instagramAppId: null,
        token: null,
        tokenExpiry: null,
        updatedAt: new Date(),
      },
    });

    this.eventEmitter.emit('integration.removed', {
      storeId: storeAuth.storeId,
      channel: IntegrationsEnum.INSTAGRAM,
    });
  }

  async removeIntegration(storeId: string): Promise<void> {
    await this.prismaService.instagramAuthData.deleteMany({
      where: { storeId },
    });

    this.eventEmitter.emit('integration.removed', {
      storeId,
      channel: IntegrationsEnum.INSTAGRAM,
    });
  }

  /**
   * Delete store data
   */
  async deleteStoreData(signedRequest: string) {
    const data = instagramUtils.parseSignedRequest(signedRequest);

    const confirmationCode = randomBytes(16).toString('hex');
    const statusUrl = `${process.env.APP_BASE_URL}/instagram/webhooks/delete?code=${confirmationCode}`;

    if (!data?.user_id) {
      throw new ErrorResponse('Error validating payload.', 401);
    }

    const store = await this.prismaService.instagramAuthData.findUnique({
      where: { instagramGlobalId: data.user_id },
    });
    if (!store) {
      const alreadyDeletedData =
        await this.prismaService.requestDeletionData.findFirst({
          where: { externalUserId: data.user_id },
        });

      if (alreadyDeletedData) {
        return {
          url: statusUrl,
          confirmation_code: alreadyDeletedData.code,
        };
      }

      throw new ErrorResponse('User data not found.', 404);
    }

    await this.prismaService.$transaction(async (prisma) => {
      await prisma.instagramAuthData.delete({
        where: {
          storeId: store.storeId,
        },
      });

      await prisma.requestDeletionData.create({
        data: {
          code: confirmationCode,
          storeId: store.storeId,
          channel: IntegrationsEnum.INSTAGRAM,
          externalUserId: data.user_id,
        },
      });
    });

    return {
      url: statusUrl,
      confirmation_code: confirmationCode,
    };
  }

  /**
   * Check data deletion status
   */
  async checkDataDeletion(code: string): Promise<string> {
    const data = await this.prismaService.requestDeletionData.findUnique({
      where: {
        code: code,
        channel: IntegrationsEnum.INSTAGRAM,
      },
    });

    if (!data) {
      return 'Data not found.';
    }

    return 'Your data has been successfully deleted!';
  }

  /**
   * Check Instagram connection health
   * @param storeId Store ID to check
   * @returns True if connection is healthy, false otherwise
   */
  async checkConnectionHealth(storeId: string): Promise<boolean> {
    try {
      const store = await this.prismaService.instagramAuthData.findUnique({
        where: { storeId: storeId },
      });

      if (!store?.token || !store.instagramGlobalId) {
        this.logger.error(
          `Instagram integration not configured for store ${storeId}`,
        );
        return false;
      }

      if (store.tokenExpiry && new Date() > new Date(store.tokenExpiry)) {
        try {
          await this.refreshToken(storeId);
          return true;
        } catch (error) {
          this.logger.error(
            `Failed to refresh Instagram token for store ${storeId}:`,
            error.message,
          );
          return false;
        }
      }

      try {
        await axios.get(`${this.instagramGraphUrl}/me`, {
          params: {
            fields: 'id,username',
            access_token: store.token,
          },
          timeout: 10000,
        });
        return true;
      } catch (error) {
        const axiosError = error as any;
        this.logger.error(
          `Instagram connection test failed for store ${storeId}:`,
          {
            status: axiosError.response?.status,
            message: axiosError.message,
          },
        );

        if (
          axiosError.response?.status === 401 ||
          axiosError.response?.status === 400
        ) {
          try {
            await this.refreshToken(storeId);
            return true;
          } catch (refreshError) {
            this.logger.error(
              `Failed to refresh Instagram token for store ${storeId}:`,
              refreshError.message,
            );
            return false;
          }
        }

        return false;
      }
    } catch (error) {
      this.logger.error(
        `Error checking Instagram connection health for store ${storeId}:`,
        error.message,
      );
      return false;
    }
  }

  private async sendReaction(
    igId: string,
    pageToken: string,
    recipient: string,
    messageId: string,
    reaction?: string,
  ): Promise<string> {
    try {
      let cleanReaction = reaction || 'love';

      if (cleanReaction.includes(':')) {
        const parts = cleanReaction.split(':');
        cleanReaction = parts[parts.length - 1].trim();
      }

      cleanReaction = cleanReaction.replace(/\n/g, '').trim();

      this.logger.log('[INSTAGRAM REACTION] Sending reaction:', {
        recipient,
        messageId,
        originalReaction: reaction,
        cleanReaction,
      });

      const requestBody: any = {
        recipient: { id: recipient },
        sender_action: 'react',
        payload: {
          message_id: messageId,
          reaction: cleanReaction,
        },
      };

      const { data: response } = await axios.post<{
        recipient_id?: string;
      }>(`${this.instagramGraphUrl}/${igId}/messages`, requestBody, {
        headers: { Authorization: `Bearer ${pageToken}` },
        timeout: 30000,
      });

      this.logger.log('[INSTAGRAM REACTION] Reaction sent successfully:', {
        recipient,
        messageId,
        reaction: cleanReaction,
        recipientId: response.recipient_id,
      });

      return null;
    } catch (error) {
      const axiosError = error as any;

      this.logger.error('[INSTAGRAM REACTION] Error:', {
        recipient,
        messageId,
        reaction,
        error: {
          status: axiosError.response?.status,
          statusText: axiosError.response?.statusText,
          data: axiosError.response?.data,
          code: axiosError.code,
          message: axiosError.message,
        },
      });

      const errorMessage =
        axiosError.response?.data?.error?.message ||
        axiosError.message ||
        'Failed to send reaction';
      throw new ErrorResponse(errorMessage, axiosError.response?.status || 500);
    }
  }

  /**
   * Remove reaction from a message on Instagram
   */
  async removeReaction(
    storeId: string,
    recipient: string,
    messageId: string,
  ): Promise<string> {
    const store = await this.findAuthenticatedStoreById(storeId);

    try {
      const pageToken = store.token!;
      const igId = store.instagramGlobalId!;

      const requestBody: any = {
        recipient: { id: recipient },
        sender_action: 'unreact',
        payload: {
          message_id: messageId,
        },
      };

      await axios.post(
        `${this.instagramGraphUrl}/${igId}/messages`,
        requestBody,
        {
          headers: { Authorization: `Bearer ${pageToken}` },
          timeout: 30000,
        },
      );
      return null;
    } catch (error) {
      const axiosError = error as any;
      this.logger.error(
        'Instagram remove reaction error:',
        axiosError.response?.data,
      );
      const errorMessage =
        axiosError.response?.data?.error?.message ||
        axiosError.message ||
        'Failed to remove reaction';
      throw new ErrorResponse(errorMessage, axiosError.response?.status || 500);
    }
  }
}
