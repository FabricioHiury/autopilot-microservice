import { Injectable, Logger } from '@nestjs/common';
import { ErrorResponse } from 'src/base/exceptions/error.response.handler';
import { PrismaService } from 'src/base/service/prisma.service';
import { uuidv7 } from 'uuidv7';
import { IntegrationsEnum } from 'src/core/integrations/enum/integrations.enum';
import {
  FacebookUserDataResponse,
  FacebookGetTokenDto,
  FacebookGetTokenResponse,
  FacebookPageResponse,
  FacebookPayload,
  FacebookUserResponse,
} from './facebook.interfaces';
import axios, { AxiosError, isAxiosError } from 'axios';
import { addDays, addSeconds } from 'date-fns';
import { ConfigureWebhooksDto } from '../instagram/dto/configure-webhooks.dto';
import { stringify } from 'querystring';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomBytes } from 'crypto';
import { facebookUtils } from './facebook.utils';
import { ChatOutgoingMessageDto } from '../comunication/dto/outgoing-message.dto';
import { ChatIncomingMessageDto } from '../comunication/dto/incoming-message.dto';
import { IntegrationStatusDto } from '../integrations/dto/integrations-status.dto';
import {
  IntegrationsStatusEnum,
  IntegrationsStatusErrorMessageEnum,
} from 'src/core/integrations/enum/integrations-status.enum';
import { RateLimitService } from 'src/base/service/rate-limit.service';
import { FirebaseService } from 'src/base/service/firebase.service';
import { MessageTypeEnum } from 'src/core/integrations/enum/message-type.enum';

interface ApiUsage {
  call_count: number;
  total_cputime: number;
  total_time: number;
}

@Injectable()
export class FacebookService {
  private readonly logger = new Logger(FacebookService.name);
  private readonly redirectUri: string;
  private readonly facebookGraphUrl: string;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly rateLimit: RateLimitService,
    private readonly firebaseService: FirebaseService,
  ) {
    this.redirectUri = `${process.env.APP_BASE_URL}/facebook/webhooks/auth/access-code`;
    this.facebookGraphUrl = 'https://graph.facebook.com/v24.0';
  }

  /**
   * Upload profile avatar to Firebase under an instance-like path
   */
  private async uploadProfileAvatar(instancePrefix: string, senderId: string, url?: string): Promise<string | null> {
    if (!url) return null;

    try {
      const response = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 20000 });
      const contentType = response.headers['content-type'] || 'image/jpeg';
      const path = `${instancePrefix}/profile/${senderId}`;

      try {
        await this.firebaseService.deleteByPath(path);
      } catch (error) {
        this.logger.warn('Failed to delete Facebook avatar:', (error as any)?.message);
      }
      const [, signedUrl] = await this.firebaseService.uploadBufferToPath(Buffer.from(response.data), contentType, path);
      return signedUrl;
    } catch (error) {
      this.logger.warn('Failed to upload Facebook avatar:', (error as any)?.message);
      return url ?? null;
    }
  }

  /**
   * Configure webhooks for Facebook integration
   */
  configureWebhooks(query: ConfigureWebhooksDto): number {
    if (query['hub.verify_token'] !== process.env.FACEBOOK_WEBHOOK_TOKEN) {
      throw new ErrorResponse('No permission to configure webhooks', 401);
    }

    return parseInt(query['hub.challenge']);
  }

  /**
   * Format error message for better user understanding
   */
  private formatErrorMessage(message: string): string {
    if (message.includes('tempo permitido') || message.includes('time limit')) {
      return 'Time limit exceeded. You must respond to messages within 24 hours.';
    }

    if (
      message.includes('should represent a valid URL') ||
      message.includes('deve representar uma URL')
    ) {
      return 'Invalid attachment URL. Please verify the URL and try again.';
    }

    return message;
  }

  /**
   * Find store ID by Facebook user ID
   */
  private async findStoreIdByFacebookId(facebookUserId: string): Promise<string> {
    const store = await this.prismaService.facebookAuthData.findUnique({
      where: {
        facebookUserId: facebookUserId,
      },
    });

    if (!store) {
      throw new ErrorResponse('Store not found.', 404);
    }

    return store.storeId;
  }

  /**
   * Find authenticated store by ID
   */
  private async findAuthenticatedStoreById(storeId: string) {
    const store = await this.prismaService.facebookAuthData.findUnique({
      where: {
        storeId: storeId,
        userToken: {
          not: null,
        },
        pageToken: {
          not: null,
        },
        tokenExpiry: {
          gte: new Date(),
        },
      },
    });

    if (!store) {
      throw new ErrorResponse('Store not found. You need to integrate with Facebook before trying to send messages.', 404);
    }

    if (!store.userToken || !store.pageToken) {
      throw new ErrorResponse('Token not found, you need to authorize the Facebook integration before accessing this route.', 401);
    }

    return store;
  }

  /**
   * Find store auth data by page ID
   */
  private async findStoreAuthByPageId(pageId: string) {
    const storeAuth = await this.prismaService.facebookAuthData.findUnique({
      where: {
        pageId: pageId,
      },
    });

    if (!storeAuth) {
      throw new ErrorResponse('Store not found.', 404);
    }

    return storeAuth;
  }

  /**
   * Get page ID and page token from user token
   */
  private async getPageIdAndToken(token: string) {
    try {
      const { data } = await axios.get<FacebookPageResponse>(
        'https://graph.facebook.com/me/accounts',
        {
          params: {
            access_token: token,
          },
        },
      );

      const pages = data.data;

      if (!pages || pages.length === 0) {
        throw new ErrorResponse('No pages found for this user.', 404);
      }

      return {
        pageId: pages[0].id,
        pageToken: pages[0].access_token,
      };
    } catch (error) {
      this.logger.error(error);
      throw new ErrorResponse('Error fetching Facebook pages.', 500);
    }
  }

  /**
   * Get Facebook user ID from token
   */
  private async getFacebookUserId(userToken: string): Promise<string> {
    try {
      const { data } = await axios.get<FacebookUserResponse>(
        `${this.facebookGraphUrl}/me`,
        {
          params: {
            access_token: userToken,
          },
        },
      );

      return data.id;
    } catch (error) {
      this.logger.error(error);
      throw new ErrorResponse('Error fetching Facebook user ID.', 500);
    }
  }

  /**
   * Get and save tokens from access code
   */
  private async getAndSaveTokens(code: string, uniqueId: string) {
    const params: FacebookGetTokenDto = {
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      redirect_uri: this.redirectUri,
      code,
    };

    try {
      const { data: userData } = await axios.get<FacebookGetTokenResponse>(`${this.facebookGraphUrl}/oauth/access_token`, { params, headers: this.getHumanizedHeaders() });
      const { data: extData } = await axios.get<FacebookGetTokenResponse>(`${this.facebookGraphUrl}/oauth/access_token`, { params: { grant_type: 'fb_exchange_token', client_id: process.env.META_APP_ID, client_secret: process.env.META_APP_SECRET, fb_exchange_token: userData.access_token }, headers: this.getHumanizedHeaders() });

      const longLivedUserToken = extData.access_token;
      const userTokenExpiresAt = extData.expires_in ? addSeconds(new Date(), extData.expires_in) : addDays(new Date(), 50);

      const { data: pages } = await axios.get<FacebookPageResponse>(`${this.facebookGraphUrl}/me/accounts`, { params: { access_token: longLivedUserToken } });

      if (!pages.data.length) {
        throw new ErrorResponse('Nenhuma página encontrada para este usuário.', 404);
      }

      const page = pages.data[0];
      const currentAuth = await this.prismaService.facebookAuthData.findUnique({ where: { uniqueId } });

      if (!currentAuth?.storeId) {
        throw new ErrorResponse('Store not found to complete Facebook integration.', 404);
      }

      const existingByPage = await this.prismaService.facebookAuthData.findUnique({ where: { pageId: page.id } }).catch(() => null);
      if (existingByPage && existingByPage.storeId !== currentAuth.storeId) {
        throw new ErrorResponse('This Facebook page is already linked to another store. Disconnect it before continuing.', 400);
      }

      await this.prismaService.facebookAuthData.update({
        where: { uniqueId },
        data: {
          pageId: page.id,
          pageToken: page.access_token,
          userToken: longLivedUserToken,
          tokenExpiry: userTokenExpiresAt,
          lastTokenRenewal: new Date(),
          facebookUserId: await this.getFacebookUserId(longLivedUserToken),
        },
      });

      return { pageId: page.id, pageToken: page.access_token };
    } catch (error) {
      if (this.isRateLimitError(error)) {
        this.logger.warn('Rate limit atingido, implementando backoff exponencial');
        throw new ErrorResponse('Limite de requisições atingido. Tente novamente mais tarde.', 500);
      }

      this.logger.error(error);
      throw new ErrorResponse(`Erro ao trocar código de acesso por token: ${error?.message}`, 500);
    }
  }

  /**
   * Checks if the error is a rate limit error
   */
  private isRateLimitError(error: any): boolean {
    if (!error.response) return false;

    const { status, data } = error.response;
    return (status === 429 || (data && data.error && (data.error.code === 4 || data.error.code === 17 || data.error.message.includes('limit'))));
  }

  /**
   * Returns humanized headers for requests
   */
  private getHumanizedHeaders(): Record<string, string> {
    const userAgents = [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0',
    ];

    const languages = [
      'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'en-US,en;q=0.9',
      'pt-BR;q=0.9',
    ];

    return {
      'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
      'Accept-Language':
        languages[Math.floor(Math.random() * languages.length)],
      Referer: 'https://developers.facebook.com/',
      Accept: 'application/json, text/plain, */*',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    };
  }

  /**
   * Activate webhook for receiving messages
   */
  private async activateMessageReceivingWebhook(pageId: string, token: string): Promise<void> {
    const body = stringify({
      subscribed_fields: 'messages,messaging_postbacks',
      access_token: token,
    });

    try {
      await axios.post(`${this.facebookGraphUrl}/${pageId}/subscribed_apps`, body, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    } catch (error) {
      throw new ErrorResponse(`Error configuring message reception: ${error?.message}`, 500);
    }
  }

  /**
   * Get sender data from Facebook
   */
  private async getSenderData(senderPSID: string, storePageToken: string) {
    const params = {
      fields: 'first_name,last_name,profile_pic',
      access_token: storePageToken,
    };

    try {
      const { data } = await axios.get<FacebookUserDataResponse>(
        `${this.facebookGraphUrl}/${senderPSID}`,
        { params },
      );

      return data;
    } catch (error: any) {
      const status = error?.response?.status;
      const message = error?.message || 'unknown error';
      const errorData = error?.response?.data?.error;
      const errorCode = errorData?.code;
      const errorSubcode = errorData?.error_subcode;
      const errorMessage = errorData?.message;

      if (status === 400) {
        this.logger.warn(`[FACEBOOK] Failed to get sender data for ${senderPSID}:`, {
          message,
          errorCode,
          errorSubcode,
          errorMessage,
        });
        return { first_name: undefined, last_name: undefined, profile_pic: undefined };
      } else {
        this.logger.error(`[FACEBOOK] Error getting sender data for ${senderPSID}: ${message}`);
        throw new ErrorResponse(`Error getting Facebook message sender data: ${message}`, 500);
      }
    }
  }

  private async getPageData(pageId: string, storePageToken: string) {
    const params = {
      fields: 'name,picture{url}',
      access_token: storePageToken,
    };

    try {
      const { data } = await axios.get<any>(
        `${this.facebookGraphUrl}/${pageId}`,
        { params },
      );
      const name = data?.name || '';
      const profilePic = data?.picture?.data?.url as string | undefined;
      return { first_name: name, last_name: '', profile_pic: profilePic } as FacebookUserDataResponse;
    } catch (error: any) {
      const status = error?.response?.status;
      const message = error?.message || 'unknown error';
      if (status === 400) this.logger.warn('Error getting Facebook page data', message);
      else this.logger.error('Error getting Facebook page data', message);
      throw new ErrorResponse(`Error getting Facebook page data: ${message}`, 500);
    }
  }

  /**
   * Get authentication URL for Facebook
   */
  async getAuthenticationUrl(uniqueId: string): Promise<string> {
    const scope = 'pages_show_list,pages_manage_metadata,pages_messaging,pages_read_engagement,business_management';
    const state = uniqueId;
    const clientId = process.env.META_APP_ID;

    const store = await this.prismaService.facebookAuthData.findUnique({
      where: { uniqueId },
    });

    if (!store) {
      throw new ErrorResponse('Store not found', 404);
    }

    const url = new URL('https://www.facebook.com/v21.0/dialog/oauth');

    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', scope);
    url.searchParams.set('state', state);

    return url.toString();
  }

  async saveFacebookClient(storeId: string): Promise<string> {
    const store = await this.prismaService.store.findUnique({
      where: { id: storeId },
    });

    if (!store) {
      throw new ErrorResponse('Store not found', 404);
    }

    const uniqueId = uuidv7();

    try {
      await this.prismaService.facebookAuthData.upsert({
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
      throw new ErrorResponse(`Error saving Facebook client: ${error?.message}`, 500);
    }
  }

  async completeIntegration(code: string, uniqueId: string): Promise<string> {
    if (!code || !uniqueId) {
      throw new ErrorResponse(
        'Facebook integration not authorized by the store.',
        400
      );
    }

    const store = await this.prismaService.facebookAuthData.findUnique({
      where: { uniqueId },
    });

    if (!store) {
      throw new ErrorResponse('Store not found, you need to save Facebook integration data before accessing this route.', 404);
    }

    const { pageToken, pageId } = await this.getAndSaveTokens(code, uniqueId);

    await this.activateMessageReceivingWebhook(pageId, pageToken);

    this.eventEmitter.emit('integration.success', {
      storeId: store.storeId,
      plataforma: IntegrationsEnum.FACEBOOK,
    });

    return `Facebook integration successfully authorized. You can now send and receive messages!`;
  }

  async receiveMessage(payload: FacebookPayload, signature: string, body: Buffer): Promise<void> {
    facebookUtils.validatePayloadSignature(body, signature);

    if (!payload.entry || payload.entry.length === 0) {
      return;
    }

    for (const entry of payload.entry) {
      const storeAuth = await this.findStoreAuthByPageId(entry.id);

      for (const message of entry.messaging) {
        if (
          !message.message ||
          message.delivery ||
          message.read ||
          message.postback ||
          message.optin
        ) {
          continue;
        }

        const isEcho = !!message.message.is_echo;
        if (isEcho && message.message.text?.match(/^\*[^*]+\*:\n/)) {
          this.eventEmitter.emit('integration.success', {
            storeId: storeAuth.storeId,
            plataforma: IntegrationsEnum.FACEBOOK,
            idMensagemExterna: message.message.mid
          });
          continue;
        } else if (isEcho && !message.message.text?.match(/^\*[^*]+\*:\n/)) {
          continue;
        }

        let name = '';
        let profilePicUrl: string | null = null;
        const counterpartId = message.sender.id;
        try {
          const { first_name, last_name, profile_pic } = await this.getSenderData(counterpartId, storeAuth.pageToken);
          name = `${first_name} ${last_name}`.trim();
          profilePicUrl = profile_pic || null;
        } catch (e: any) {
          this.logger.warn('Proceeding without Facebook sender profile data');
        }

        const facebookMessage: ChatOutgoingMessageDto = {
          storeId: storeAuth.storeId,
          idMensagem: message.message.mid,
          idDestinatarioApiExterna: message.sender.id,
          mensagem: message.message.text ?? '',
          anexoMensagem: message.message.attachments?.[0]?.payload?.url || undefined,
          canal: IntegrationsEnum.FACEBOOK,
          timestamp: new Date(message.timestamp),
          metadados: {
            nome: name,
            urlAvatar: profilePicUrl ?? undefined,
          },
          enviadaLoja: false,
          tipo: (() => {
            const a = message.message.attachments?.[0];
            if (!a) return MessageTypeEnum.TEXT;
            const t = (a.type || '').toLowerCase();
            const url = String(a.payload?.url || '').toLowerCase();
            if (t === 'sticker') return MessageTypeEnum.STICKER;
            if (t === 'image') return /sticker|stickers/.test(url) || /\.webp(\?|$)/.test(url) || /\.gif(\?|$)/.test(url) ? MessageTypeEnum.STICKER : MessageTypeEnum.IMAGE;
            if (t === 'video') return MessageTypeEnum.VIDEO;
            if (t === 'audio') return MessageTypeEnum.AUDIO;
            return MessageTypeEnum.UNKNOWN;
          })(),
        };

        this.eventEmitter.emit('message.receive', facebookMessage);
      }
    }
  }

  async sendMessage({ storeId: storeId, destinatario: recipient, mensagem: messageText, anexoMensagem: messageAttachment, tipoAnexo }: ChatIncomingMessageDto): Promise<string> {
    await this.rateLimit.checkAppVolumeLimit();
    const store = await this.findAuthenticatedStoreById(storeId);

    if (!messageText && !messageAttachment) {
      throw new ErrorResponse(
        'Mensagem e anexo não fornecidos. Pelo menos um destes itens deve ser fornecido.',
        400
      );
    }

    const message = (() => {
      if (messageAttachment) {
        const lower = (tipoAnexo || '').toLowerCase();
        const isAudio = lower.startsWith('audio') || /\.(mp3|wav|m4a|aac|oga)(\?|$)/i.test(messageAttachment);
        const isVideo = lower.startsWith('video') || /\.(mp4|mov|mkv|webm)(\?|$)/i.test(messageAttachment);
        const isImage = lower.startsWith('image') || /\.(png|jpe?g|gif|webp|bmp|tiff?)(\?|$)/i.test(messageAttachment);
        const attachmentType = isAudio ? 'audio' : isVideo ? 'video' : isImage ? 'image' : 'file';
        return {
          attachment: {
            type: attachmentType,
            payload: {
              url: messageAttachment,
            },
          },
        } as any;
      }
      return { text: messageText } as any;
    })();

    try {
      const messaging_type = 'MESSAGE_TAG';

      const payload: any = {
        recipient: { id: recipient },
        messaging_type,
        message,
      };

      if (messaging_type === 'MESSAGE_TAG') {
        payload.tag = 'HUMAN_AGENT';
      }

      const response = await axios.post(`${this.facebookGraphUrl}/${store.pageId}/messages`,
        payload,
        {
          params: {
            access_token: store.pageToken,
          },
        },
      );

      if (response.status !== 200) {
        throw new ErrorResponse('Failed to send message.', 500);
      }

      return 'Message sent successfully!';
    } catch (error) {
      if (isAxiosError(error)) {
        const errorMessage =
          error.response?.data?.error?.message || error.message;
        throw new ErrorResponse(`Erro ao enviar mensagem: ${this.formatErrorMessage(errorMessage)}`, 500);
      }
      throw new ErrorResponse(`Erro ao enviar mensagem: ${error.message}`, 500);
    }
  }

  /**
   * Check Facebook integration health
   */
  async healthCheck(storeId: string): Promise<IntegrationStatusDto> {
    const store = await this.prismaService.facebookAuthData.findUnique({
      where: { storeId: storeId },
    });

    const healthCheckObject: IntegrationStatusDto = {
      channel: IntegrationsEnum.FACEBOOK,
      status: IntegrationsStatusEnum.NOT_CONFIGURED,
      message: IntegrationsStatusErrorMessageEnum.INTEGRATION_NOT_CONFIGURED,
    };

    if (!store?.userToken || !store?.pageToken) {
      return healthCheckObject;
    }

    try {
      const { data } = await axios.get<FacebookUserResponse>(
        `${this.facebookGraphUrl}/me`,
        {
          params: {
            access_token: store.pageToken,
          },
        },
      );

      if (!data?.id) {
        healthCheckObject.status = IntegrationsStatusEnum.ERROR;
        return healthCheckObject;
      }

      healthCheckObject.status = IntegrationsStatusEnum.OK;
      healthCheckObject.message = null;
      return healthCheckObject;
    } catch (error) {
      if (axios.isAxiosError(error) && [400, 401].includes(error.response?.status)) {
        this.logger.warn(`Facebook token inválido para loja ${storeId}`);
      } else {
        this.logger.error(`Erro no Facebook healthCheck:`, error.message);
      }
      healthCheckObject.status = IntegrationsStatusEnum.ERROR;
      return healthCheckObject;
    }
  }

  async removeStorePermissions(signedRequest: string): Promise<void> {
    const data = facebookUtils.parseSignedRequest(signedRequest);

    if (!data?.user_id) {
      throw new ErrorResponse('Error validating payload.', 401);
    }

    const storeId = await this.findStoreIdByFacebookId(data.user_id);

    if (!storeId) {
      throw new ErrorResponse('User data not found.', 404);
    }

    await this.prismaService.facebookAuthData.update({
      where: {
        storeId: storeId,
      },
      data: {
        pageId: null,
        facebookUserId: null,
        pageToken: null,
        userToken: null,
        tokenExpiry: null,
        lastTokenRenewal: null,
        scheduledRenewal: null,
        updatedAt: new Date(),
      },
    });

    this.eventEmitter.emit('integration.removed', {
      storeId,
      channel: IntegrationsEnum.FACEBOOK,
    });
  }

  async removeIntegration(storeId: string): Promise<void> {
    await this.prismaService.facebookAuthData.deleteMany({
      where: { storeId },
    });

    this.eventEmitter.emit('integration.removed', {
      storeId,
      channel: IntegrationsEnum.FACEBOOK,
    });
  }

  /**
   * Delete store data
   */
  async deleteStoreData(signedRequest: string) {
    const data = facebookUtils.parseSignedRequest(signedRequest);

    if (!data?.user_id) {
      throw new ErrorResponse('Error validating payload.', 401);
    }

    const storeId = await this.findStoreIdByFacebookId(data.user_id);

    if (!storeId) {
      throw new ErrorResponse('User data not found.', 404);
    }

    const confirmationCode = randomBytes(16).toString('hex');
    const statusUrl = `${process.env.APP_BASE_URL}/facebook/webhooks/deletar?codigo=${confirmationCode}`;

    await this.prismaService.$transaction(async (prisma) => {
      await prisma.facebookAuthData.delete({
        where: {
          storeId: storeId,
        },
      });

      await prisma.requestDeletionData.create({
        data: {
          code: confirmationCode,
          storeId: storeId,
          channel: IntegrationsEnum.FACEBOOK,
        },
      });
    });

    const responseData = {
      url: statusUrl,
      confirmation_code: confirmationCode,
    };

    return responseData;
  }

  /**
   * Check data deletion status
   */
  async checkDataDeletion(code: string): Promise<string> {
    const data = await this.prismaService.requestDeletionData.findUnique({
      where: {
        code: code,
        channel: IntegrationsEnum.FACEBOOK,
      },
    });

    if (!data) {
      return 'Data not found.';
    }

    return 'Your data has been successfully deleted!';
  }
  private apiUsageData = {
    lastCheck: new Date(),
    appUsage: { call_count: 0, total_cputime: 0, total_time: 0 } as ApiUsage,
    businessUsage: {
      call_count: 0,
      total_cputime: 0,
      total_time: 0,
    } as ApiUsage,
  };

  /**
   * Updates API usage information based on headers
   */
  private updateApiUsage(headers: any): void {
    try {
      const appUsageHeader = headers['x-app-usage'];
      const businessUsageHeader =
        headers['x-business-use-case-usage'] || headers['x-ad-account-usage'];

      if (appUsageHeader) {
        const appUsage =
          typeof appUsageHeader === 'string'
            ? JSON.parse(appUsageHeader)
            : appUsageHeader;

        this.apiUsageData.appUsage = appUsage;
        this.logger.log(`Uso da API atualizado: ${JSON.stringify(appUsage)}`);
      }

      if (businessUsageHeader) {
        const businessUsage =
          typeof businessUsageHeader === 'string'
            ? JSON.parse(businessUsageHeader)
            : businessUsageHeader;

        this.apiUsageData.businessUsage = businessUsage;
        this.logger.log(
          `Uso de negócios da API atualizado: ${JSON.stringify(businessUsage)}`,
        );
      }

      this.apiUsageData.lastCheck = new Date();
    } catch (error) {
      this.logger.error('Erro ao processar cabeçalhos de uso da API:', error);
    }
  }

  /**
   * Checks API limits and applies delay if necessary
   */
  private async checkApiLimits(): Promise<void> {
    const { appUsage, businessUsage } = this.apiUsageData;

    const isNearAppLimit =
      appUsage.call_count > 75 || appUsage.total_cputime > 75;
    const isNearBusinessLimit =
      businessUsage.call_count > 75 || businessUsage.total_cputime > 75;

    if (isNearAppLimit || isNearBusinessLimit) {
      this.logger.warn(
        `Próximo do limite de API: App Usage: ${appUsage.call_count}%, Business Usage: ${businessUsage.call_count}%`,
      );

      const delayFactor = Math.max(
        appUsage.call_count,
        businessUsage.call_count,
        appUsage.total_cputime,
        businessUsage.total_cputime,
      );

      const baseDelay = 1000;
      const maxDelay = 60000;

      const delayMs = Math.min(
        baseDelay * Math.pow(2, (delayFactor - 75) / 5),
        maxDelay,
      );

      this.logger.log(`Aplicando atraso de ${delayMs}ms devido a limites de API`);

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  /**
   * Method to refresh Facebook token
   */
  async refreshToken(storeId: string): Promise<void> {
    const store = await this.findAuthenticatedStoreById(storeId);

    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    if (
      store.lastTokenRenewal &&
      new Date(store.lastTokenRenewal) > oneDayAgo
    ) {
      this.logger.log(`Token para loja ID ${storeId} foi renovado recentemente. Pulando.`);
      return;
    }

    await this.checkApiLimits();

    try {
      const response = await axios.get(
        `${this.facebookGraphUrl}/oauth/access_token`,
        {
          params: {
            grant_type: 'fb_exchange_token',
            client_id: process.env.META_APP_ID,
            client_secret: process.env.META_APP_SECRET,
            fb_exchange_token: store.userToken,
          },
          headers: this.getHumanizedHeaders(),
        },
      );

      this.updateApiUsage(response.headers);

      const tokenExpiration = response.data.expires_in
        ? addSeconds(new Date(), response.data.expires_in)
        : addDays(new Date(), 50);

      await this.prismaService.facebookAuthData.update({
        where: { storeId: storeId },
        data: {
          userToken: response.data.access_token,
          tokenExpiry: tokenExpiration,
          lastTokenRenewal: new Date(),
        },
      });
    } catch (error) {
      if (error.response && error.response.headers) {
        this.updateApiUsage(error.response.headers);
      }

      throw new ErrorResponse(`Erro ao renovar token do Facebook: ${error?.message}`, 500);
    }
  }
}
