import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../base/service/prisma.service';
import { RedisService } from '../../base/service/redis.service';
import { FirebaseService } from '../../base/service/firebase.service';
import { ErrorResponse } from '../../base/exceptions/error.response.handler';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
const runFile = promisify(execFile);

import { SendMessageDto } from '../communication/dto/incoming-message.dto';
import { ProviderMessageEvent } from '../communication/dto/outgoing-message.dto';
import { IntegrationsEnum } from '../integrations/enum/integrations.enum';
import { IntegrationsStatusEnum } from '../integrations/enum/integrations-status.enum';
import { IntegrationStatusDto } from '../integrations/dto/integrations-status.dto';
import { MessageTypeEnum } from '../integrations/enum/message-type.enum';
import {
  WhatsAppOfficialConfigDto,
  WhatsAppOfficialMessageDto,
  WhatsAppMessageWindowDto,
} from './dto/whatsapp-official.dto';

@Injectable()
export class WhatsappOfficialService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappOfficialService.name);
  private readonly apiVersion = 'v24.0';
  private readonly apiUrl = `https://graph.facebook.com/${this.apiVersion}`;
  private readonly windowHours = 24;
  private messageWindowCache = new Map<
    string,
    { lastMessageAt: Date; expiresAt: Date }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly redisService: RedisService,
    private readonly firebaseService: FirebaseService,
  ) {}

  async onModuleInit() {
    await this.subscribeAllWabas();
  }

  private async subscribeAllWabas() {
    try {
      const allConfigs = await this.prisma.whatsAppOfficialAuthData.findMany();

      if (allConfigs.length === 0) {
        this.logger.log('No WhatsApp Official configurations found');
        return;
      }

      this.logger.log(
        `Found ${allConfigs.length} WhatsApp Official configurations`,
      );

      for (const config of allConfigs) {
        try {
          const decryptedToken = this.decryptToken(config.accessToken);

          const subscription = await this.checkWabaSubscription(
            config.wabaId,
            decryptedToken,
          );

          if (subscription.subscribed) {
            this.logger.log(
              `WABA ${config.wabaId} already subscribed for store ${config.storeId}`,
            );
            continue;
          }

          const result = await this.subscribeAppToWaba(
            config.wabaId,
            decryptedToken,
          );

          if (result.success) {
            this.logger.log(
              `Subscribed to WABA ${config.wabaId} for store ${config.storeId}`,
            );
          } else {
            this.logger.warn(
              `Failed to subscribe WABA ${config.wabaId}: ${result.error}`,
            );
          }
        } catch (error: any) {
          this.logger.error(
            `Error checking/subscribing WABA ${config.wabaId}: ${error?.message}`,
          );
        }
      }
    } catch (error: any) {
      this.logger.error(
        `Error loading WhatsApp Official configurations: ${error?.message}`,
      );
    }
  }

  private async getAuthData(storeId: string) {
    const auth = await this.prisma.whatsAppOfficialAuthData.findUnique({
      where: { storeId },
    });

    if (!auth) {
      throw new ErrorResponse(
        'WhatsApp Official integration not configured',
        404,
      );
    }

    return auth;
  }

  private createApiClient(accessToken: string): AxiosInstance {
    return axios.create({
      baseURL: this.apiUrl,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  async saveConfig(
    config: WhatsAppOfficialConfigDto,
  ): Promise<{ success: boolean; phoneInfo?: any }> {
    try {
      const testResult = await this.testApiConnection(
        config.phoneNumberId,
        config.accessToken,
      );

      if (!testResult.success) {
        throw new ErrorResponse(
          testResult.error || 'Failed to verify API credentials',
          400,
        );
      }

      const encryptedToken = this.encryptToken(config.accessToken);

      await this.prisma.whatsAppOfficialAuthData.upsert({
        where: { storeId: config.storeId },
        update: {
          wabaId: config.wabaId,
          phoneNumberId: config.phoneNumberId,
          accessToken: encryptedToken,
          verifyToken: config.verifyToken,
          businessPhone: this.normalizePhone(config.businessPhone),
        },
        create: {
          storeId: config.storeId,
          wabaId: config.wabaId,
          phoneNumberId: config.phoneNumberId,
          accessToken: encryptedToken,
          verifyToken: config.verifyToken,
          businessPhone: this.normalizePhone(config.businessPhone),
        },
      });

      const subscription = await this.checkWabaSubscription(
        config.wabaId,
        config.accessToken,
      );
      if (!subscription.subscribed) {
        const subscriptionResult = await this.subscribeAppToWaba(
          config.wabaId,
          config.accessToken,
        );
        if (!subscriptionResult.success) {
          this.logger.warn(
            `Failed to subscribe app to WABA: ${subscriptionResult.error}`,
          );
        }
      } else {
        this.logger.log(`WABA ${config.wabaId} already subscribed`);
      }

      this.logger.log(
        `WhatsApp Official config saved for store ${config.storeId}`,
      );
      return { success: true, phoneInfo: testResult.phoneInfo } as any;
    } catch (error: any) {
      this.logger.error(
        `Failed to save WhatsApp Official config: ${error?.message}`,
      );
      if (error instanceof ErrorResponse) {
        throw error;
      }
      throw new ErrorResponse('Failed to save configuration', 500);
    }
  }

  private async testApiConnection(
    phoneNumberId: string,
    accessToken: string,
  ): Promise<{ success: boolean; phoneInfo?: any; error?: string }> {
    try {
      const response = await axios.get(`${this.apiUrl}/${phoneNumberId}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        params: {
          fields:
            'verified_name,display_phone_number,quality_rating,platform_type,status',
        },
      });

      if (response.data && response.data.display_phone_number) {
        this.logger.log(
          `API connection test successful for phone: ${response.data.display_phone_number}`,
        );
        return {
          success: true,
          phoneInfo: {
            phoneNumber: response.data.display_phone_number,
            verifiedName: response.data.verified_name,
            qualityRating: response.data.quality_rating,
            status: response.data.status,
          },
        };
      }

      return { success: false, error: 'Invalid phone number data' };
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.error?.message || error.message;
      this.logger.error(`API connection test failed: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  private async subscribeAppToWaba(
    wabaId: string,
    accessToken: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await axios.post(
        `${this.apiUrl}/${wabaId}/subscribed_apps`,
        {},
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      if (response.data?.success) {
        this.logger.log(`Successfully subscribed app to WABA ${wabaId}`);
        return { success: true };
      }

      return {
        success: false,
        error: 'Subscription response was not successful',
      };
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.error?.message || error.message;
      this.logger.error(
        `Failed to subscribe app to WABA ${wabaId}: ${errorMessage}`,
      );
      return { success: false, error: errorMessage };
    }
  }

  async checkWabaSubscription(
    wabaId: string,
    accessToken: string,
  ): Promise<{ subscribed: boolean; apps?: any[] }> {
    try {
      const response = await axios.get(
        `${this.apiUrl}/${wabaId}/subscribed_apps`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      const apps = response.data?.data || [];
      this.logger.log(`WABA ${wabaId} has ${apps.length} subscribed apps`);
      return { subscribed: apps.length > 0, apps };
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.error?.message || error.message;
      this.logger.error(`Failed to check WABA subscription: ${errorMessage}`);
      return { subscribed: false };
    }
  }

  async getPhoneNumbers(
    wabaId: string,
    accessToken: string,
  ): Promise<{
    success: boolean;
    wabaInfo?: any;
    phoneNumbers?: any[];
    error?: string;
  }> {
    try {
      const wabaResponse = await axios.get(`${this.apiUrl}/${wabaId}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        params: {
          fields: 'id,name,currency,timezone_id,business_verification_status',
        },
      });

      const phoneResponse = await axios.get(
        `${this.apiUrl}/${wabaId}/phone_numbers`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          params: {
            fields:
              'id,display_phone_number,verified_name,quality_rating,platform_type,status,name_status,new_name_status',
          },
        },
      );

      const phoneNumbers = phoneResponse.data?.data || [];

      const formattedNumbers = phoneNumbers.map((phone: any) => ({
        id: phone.id,
        displayPhoneNumber: phone.display_phone_number,
        verifiedName: phone.verified_name,
        qualityRating: phone.quality_rating || 'UNKNOWN',
        status: phone.status,
        platformType: phone.platform_type,
        nameStatus: phone.name_status,
        newNameStatus: phone.new_name_status,
      }));

      this.logger.log(
        `Found ${formattedNumbers.length} phone numbers for WABA ${wabaId}`,
      );

      return {
        success: true,
        wabaInfo: {
          id: wabaResponse.data.id,
          name: wabaResponse.data.name,
          currency: wabaResponse.data.currency,
          timezoneId: wabaResponse.data.timezone_id,
          businessVerificationStatus:
            wabaResponse.data.business_verification_status,
        },
        phoneNumbers: formattedNumbers,
      };
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.error?.message || error.message;
      this.logger.error(
        `Failed to get phone numbers for WABA ${wabaId}: ${errorMessage}`,
      );
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  async sendMessage(
    data: SendMessageDto,
  ): Promise<{ status: 'success'; response: string }> {
    const {
      recipient,
      storeId,
      attachmentUrl,
      text,
      latitude,
      longitude,
      locationName,
      locationAddress,
      messageId,
      quotedMessageId,
      type,
      attachmentType,
      contacts,
      isVoiceRecording,
    } = data;

    try {
      const auth = await this.getAuthData(storeId);
      const api = this.createApiClient(this.decryptToken(auth.accessToken));
      const phone = this.normalizePhone(recipient);

      this.logger.log(
        `Sending message to ${recipient} -> normalized: ${phone}`,
      );

      const window = await this.checkMessageWindow(storeId, phone);

      if (!window.isWithinWindow && type !== 'reaction') {
        this.logger.warn(`Message to ${phone} blocked - outside 24h window`);
        throw new ErrorResponse(
          'Outside the 24-hour window. The customer must initiate the conversation.',
          400,
        );
      }

      const messageType = this.resolveMessageType(data);
      const messagePayload = await this.buildMessagePayload(
        phone,
        messageType,
        data,
      );

      const response = await api.post(`/${auth.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        ...messagePayload,
      });

      const messageId = response.data.messages?.[0]?.id;

      if (!messageId) {
        throw new ErrorResponse('WhatsApp API did not return message ID', 502);
      }

      this.logger.log(`Message sent via WhatsApp Official API: ${messageId}`);

      return { status: 'success', response: messageId };
    } catch (error: any) {
      this.logger.error(
        `Failed to send WhatsApp Official message: ${error?.message}`,
        error?.response?.data,
      );

      if (error?.response?.data?.error?.code === 131030) {
        throw new ErrorResponse(
          'Message failed: Outside 24-hour window. Customer needs to message first.',
          400,
        );
      }

      if (error instanceof ErrorResponse) throw error;
      throw new ErrorResponse(`Failed to send message: ${error?.message}`, 500);
    }
  }

  private resolveMessageType(data: SendMessageDto): string {
    const {
      type,
      attachmentUrl,
      attachmentType,
      latitude,
      longitude,
      contacts,
      text,
      quotedMessageId,
    } = data;

    if (type === 'reaction' && quotedMessageId && text) return 'reaction';
    if (latitude != null && longitude != null) return 'location';
    if (contacts && contacts.length > 0) return 'contacts';
    if (attachmentUrl)
      return this.getMediaTypeFromMimeOrUrl(attachmentType, attachmentUrl);
    if (text) return 'text';

    return 'text';
  }

  private async buildMessagePayload(
    phone: string,
    messageType: string,
    data: SendMessageDto,
  ): Promise<WhatsAppOfficialMessageDto> {
    const {
      storeId,
      attachmentUrl,
      text,
      latitude,
      longitude,
      locationName,
      locationAddress,
      quotedMessageId,
      type,
      attachmentType,
      contacts,
      isVoiceRecording,
    } = data;

    const payload: WhatsAppOfficialMessageDto = {
      to: phone,
      type: messageType,
    };

    if (quotedMessageId && messageType !== 'reaction') {
      payload.context = { message_id: quotedMessageId };
    }

    switch (messageType) {
      case 'text':
        payload.text = {
          body: text!,
          preview_url: true,
        };
        break;

      case 'reaction':
        payload.reaction = {
          message_id: quotedMessageId!,
          emoji: text!,
        };
        break;

      case 'location':
        payload.location = {
          latitude: latitude!,
          longitude: longitude!,
          name: locationName,
          address: locationAddress,
        };
        break;

      case 'contacts':
        payload.contacts = contacts!.map((c) => ({
          name: {
            formatted_name: c.name,
            first_name: c.name,
          },
          phones: [
            {
              phone: c.phone,
              type: 'CELL',
            },
          ],
        }));
        break;

      case 'image':
        payload.image = {
          link: attachmentUrl,
          caption: text,
        };
        break;

      case 'video':
        payload.video = {
          link: attachmentUrl,
          caption: text,
        };
        break;

      case 'document':
        payload.document = {
          link: attachmentUrl,
          filename: this.getFilenameFromUrl(attachmentUrl!),
          caption: text,
        };
        break;

      case 'sticker':
        payload.sticker = {
          link: attachmentUrl,
        };
        break;

      case 'audio':
        const audioPayload = await this.buildAudioPayload(
          attachmentUrl!,
          attachmentType,
          storeId,
          isVoiceRecording,
        );
        payload.audio = audioPayload;
        break;
    }

    return payload;
  }

  private async buildAudioPayload(
    audioUrl: string,
    attachmentType: string | undefined,
    storeId: string,
    isVoiceRecording?: boolean,
  ): Promise<{ link: string; voice?: boolean }> {
    let audioLink = audioUrl;
    let sendAsVoice = false;

    if (isVoiceRecording) {
      sendAsVoice = true;
      const isOpus = attachmentType?.includes('codecs=opus');

      if (!isOpus) {
        this.logger.log(
          `[AUDIO] Voice recording detected, converting to OGG/Opus...`,
        );
        const convertedUrl = await this.convertAudioToOpus(audioUrl, storeId);
        if (convertedUrl) {
          audioLink = convertedUrl;
          this.logger.log(`[AUDIO] Using converted audio URL`);
        } else {
          throw new ErrorResponse('Voice audio conversion failed', 502);
        }
      } else {
        this.logger.log(
          `[AUDIO] Voice recording already in Opus format, sending directly`,
        );
      }
    }

    return {
      link: audioLink,
      ...(sendAsVoice && { voice: true }),
    };
  }

  async markMessageAsRead(
    storeId: string,
    messageId: string,
  ): Promise<boolean> {
    try {
      const auth = await this.getAuthData(storeId);
      const api = this.createApiClient(this.decryptToken(auth.accessToken));

      await api.post(`/${auth.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      });

      return true;
    } catch (error: any) {
      this.logger.error(`Failed to mark message as read: ${error?.message}`);
      return false;
    }
  }

  async handleWebhook(body: any, headers: any): Promise<void> {
    try {
      this.logger.log(`Webhook received: ${JSON.stringify(body)}`);

      const { object, entry } = body;

      if (object !== 'whatsapp_business_account') {
        this.logger.warn(`Invalid webhook object type: ${object}`);
        return;
      }

      if (!entry || !Array.isArray(entry)) {
        this.logger.warn('No entry array in webhook payload');
        return;
      }

      for (const item of entry) {
        const changes = item.changes || [];
        this.logger.log(
          `Processing ${changes.length} changes for entry ${item.id}`,
        );

        for (const change of changes) {
          const value = change.value;
          const field = change.field;

          this.logger.log(`Processing change field: ${field}`);

          if (field === 'messages' && value.messages) {
            await this.processIncomingMessages(value);
          }

          if (value.statuses) {
            await this.processMessageStatuses(value);
          }
        }
      }
    } catch (error: any) {
      this.logger.error(
        `Webhook processing error: ${error?.message}`,
        error?.stack,
      );
      throw error;
    }
  }

  private async processIncomingMessages(value: any) {
    const { messages, contacts, metadata } = value;

    if (!messages || !Array.isArray(messages)) return;

    const storeId = await this.getStoreIdByPhoneNumber(
      metadata.phone_number_id,
    );
    if (!storeId) {
      this.logger.warn(
        `No store found for phone number ID: ${metadata.phone_number_id}`,
      );
      return;
    }

    for (const message of messages) {
      try {
        const contact = contacts?.find((c: any) => c.wa_id === message.from);

        await this.updateMessageWindow(
          storeId,
          message.from,
          new Date(Number(message.timestamp) * 1000),
        );

        let messageText: string | undefined;
        let mediaUrl: string | undefined;
        let messageType = MessageTypeEnum.TEXT;
        let replyToId: string | undefined;
        let locationData: any;
        let contactsData: any;

        if (message.context?.id) {
          replyToId = message.context.id;
        }

        switch (message.type) {
          case 'text':
            messageText = message.text?.body;
            break;

          case 'image':
            mediaUrl = await this.downloadAndUploadMedia(
              message.image?.id,
              storeId,
              message.image?.mime_type,
            );
            messageText = message.image?.caption;
            messageType = MessageTypeEnum.IMAGE;
            break;

          case 'audio':
            mediaUrl = await this.downloadAndUploadMedia(
              message.audio?.id,
              storeId,
              message.audio?.mime_type,
            );
            messageType = MessageTypeEnum.AUDIO;
            break;

          case 'video':
            mediaUrl = await this.downloadAndUploadMedia(
              message.video?.id,
              storeId,
              message.video?.mime_type,
            );
            messageText = message.video?.caption;
            messageType = MessageTypeEnum.VIDEO;
            break;

          case 'document':
            mediaUrl = await this.downloadAndUploadMedia(
              message.document?.id,
              storeId,
              message.document?.mime_type,
            );
            messageText =
              message.document?.caption || message.document?.filename;
            messageType = MessageTypeEnum.DOCUMENT;
            break;

          case 'sticker':
            mediaUrl = await this.downloadAndUploadMedia(
              message.sticker?.id,
              storeId,
              message.sticker?.mime_type,
            );
            messageType = MessageTypeEnum.STICKER;
            break;

          case 'location':
            locationData = {
              lat: message.location?.latitude,
              lng: message.location?.longitude,
              name: message.location?.name,
              address: message.location?.address,
            };
            messageType = MessageTypeEnum.LOCATION;
            break;

          case 'contacts':
            contactsData = message.contacts?.map((c: any) => ({
              name: c.name?.formatted_name || '',
              phone: c.phones?.[0]?.phone || '',
            }));
            messageType = MessageTypeEnum.CONTACT;
            break;

          case 'reaction':
            messageText = message.reaction?.emoji;
            replyToId = message.reaction?.message_id;
            messageType = MessageTypeEnum.REACTION;
            break;

          case 'button':
            messageText = message.button?.text || message.button?.payload;
            break;

          case 'interactive':
            if (message.interactive?.type === 'button_reply') {
              messageText = message.interactive.button_reply?.title;
            } else if (message.interactive?.type === 'list_reply') {
              messageText = message.interactive.list_reply?.title;
            }
            break;
        }

        const outgoing: ProviderMessageEvent = {
          storeId,
          messageId: message.id,
          externalContactId: message.from,
          text: messageText,
          attachmentUrl: mediaUrl,
          quotedMessageId: replyToId,
          channel: IntegrationsEnum.WHATSAPP,
          type: messageType,
          timestamp: new Date(parseInt(message.timestamp) * 1000),
          sentByStore: false,
          metadata: {
            name: contact?.profile?.name || '',
            phone: message.from,
            externalAdId:
              message.referral?.source_type === 'ad'
                ? message.referral.source_id
                : undefined,
            sourceDetails: JSON.stringify(message.referral || {}),
          },
          contacts: contactsData,
          location: locationData,
        };

        await this.events.emitAsync('message.receive', outgoing);
        this.logger.log(
          `Incoming message processed: ${message.id} from ${message.from}`,
        );
      } catch (error: any) {
        this.logger.error(
          `Failed to process incoming message: ${error?.message}`,
        );
        throw error;
      }
    }
  }

  private async processMessageStatuses(value: any) {
    const { statuses } = value;

    if (!statuses || !Array.isArray(statuses)) return;

    for (const status of statuses) {
      try {
        const storeId = await this.getStoreIdByPhoneNumber(
          value.metadata?.phone_number_id,
        );
        if (!storeId) continue;

        const statusMap: Record<string, string> = {
          sent: 'SENT',
          delivered: 'DELIVERED',
          read: 'READ',
          failed: 'FAILED',
        };

        await this.events.emitAsync('message.status', {
          storeId,
          channel: IntegrationsEnum.WHATSAPP,
          messageId: status.id,
          status: statusMap[status.status] || status.status.toUpperCase(),
          timestamp: new Date(parseInt(status.timestamp) * 1000),
        });

        this.logger.log(
          `Message status update: ${status.id} - ${status.status}`,
        );
      } catch (error: any) {
        this.logger.error(
          `Failed to process message status: ${error?.message}`,
        );
        throw error;
      }
    }
  }

  async verifyWebhook(query: any): Promise<string> {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    this.logger.log(
      `Webhook verification attempt - mode: ${mode}, token: ${token ? 'provided' : 'missing'}, challenge: ${challenge ? 'provided' : 'missing'}`,
    );
    this.logger.log(`Full query params: ${JSON.stringify(query)}`);

    if (mode === 'subscribe' && token && challenge) {
      const validToken = await this.verifyToken(token);

      if (validToken) {
        this.logger.log(
          `Webhook verified successfully. Returning challenge: ${challenge}`,
        );
        return challenge;
      } else {
        this.logger.warn(`Invalid webhook verification token: ${token}`);
        throw new ErrorResponse('Invalid verification token', 403);
      }
    }

    this.logger.warn(
      `Invalid webhook verification request - mode: ${mode}, has token: ${!!token}, has challenge: ${!!challenge}`,
    );
    throw new ErrorResponse('Invalid webhook verification request', 400);
  }

  private async verifyToken(token: string): Promise<boolean> {
    const authData = await this.prisma.whatsAppOfficialAuthData.findFirst({
      where: { verifyToken: token },
    });

    return !!authData;
  }

  async healthCheck(storeId: string): Promise<IntegrationStatusDto> {
    try {
      const auth = await this.prisma.whatsAppOfficialAuthData.findUnique({
        where: { storeId },
      });

      if (!auth) {
        return {
          channel: IntegrationsEnum.WHATSAPP,
          status: IntegrationsStatusEnum.NOT_CONFIGURED,
          message: 'WhatsApp Official not configured',
        };
      }

      const api = this.createApiClient(this.decryptToken(auth.accessToken));
      const response = await api.get(`/${auth.phoneNumberId}`);

      if (response.status === 200) {
        return {
          channel: IntegrationsEnum.WHATSAPP,
          status: IntegrationsStatusEnum.OK,
          message: null,
        };
      }

      return {
        channel: IntegrationsEnum.WHATSAPP,
        status: IntegrationsStatusEnum.ERROR,
        message: 'API connection failed',
      };
    } catch (error: any) {
      this.logger.error(`Health check failed: ${error?.message}`);
      return {
        channel: IntegrationsEnum.WHATSAPP,
        status: IntegrationsStatusEnum.ERROR,
        message: error?.message || 'Health check failed',
      };
    }
  }

  async deleteIntegrationData(storeId: string): Promise<{ ok: boolean }> {
    this.logger.log(
      `Attempting to delete WhatsApp Official integration for store: ${storeId}`,
    );

    try {
      const existing = await this.prisma.whatsAppOfficialAuthData.findUnique({
        where: { storeId },
      });

      if (!existing) {
        this.logger.warn(
          `No WhatsApp Official auth data found for store: ${storeId}`,
        );
        this.messageWindowCache.delete(storeId);
        return { ok: true };
      }

      await this.prisma.whatsAppOfficialAuthData.delete({
        where: { storeId },
      });

      this.messageWindowCache.delete(storeId);

      this.logger.log(
        `WhatsApp Official integration deleted for store: ${storeId}`,
      );
      return { ok: true };
    } catch (error: any) {
      this.logger.error(
        `Failed to delete WhatsApp Official integration: ${error?.message}`,
      );
      throw new ErrorResponse('Failed to delete integration', 500);
    }
  }

  async checkMessageWindow(
    storeId: string,
    phoneNumber: string,
  ): Promise<WhatsAppMessageWindowDto> {
    const cacheKey = this.getWindowCacheKey(storeId, phoneNumber);
    this.logger.log(
      `Checking message window for ${phoneNumber} (normalized key: ${cacheKey})`,
    );
    const cached = this.messageWindowCache.get(cacheKey);

    if (cached && cached.expiresAt > new Date()) {
      const hoursRemaining = Math.max(
        0,
        (cached.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60),
      );

      return {
        isWithinWindow: true,
        hoursRemaining,
        lastCustomerMessageAt: cached.lastMessageAt.toISOString(),
      };
    }

    const redisKey = `whatsapp:window:${cacheKey}`;
    let redisData = await this.redisService.get(redisKey);

    if (redisData) {
      const { lastMessageAt, expiresAt } = JSON.parse(redisData);
      const expires = new Date(expiresAt);

      if (expires > new Date()) {
        const hoursRemaining = Math.max(
          0,
          (expires.getTime() - Date.now()) / (1000 * 60 * 60),
        );

        return {
          isWithinWindow: true,
          hoursRemaining,
          lastCustomerMessageAt: lastMessageAt,
        };
      }
    }

    return {
      isWithinWindow: false,
      hoursRemaining: 0,
    };
  }

  private async updateMessageWindow(
    storeId: string,
    phoneNumber: string,
    receivedAt = new Date(),
  ) {
    const cacheKey = this.getWindowCacheKey(storeId, phoneNumber);
    const now = receivedAt;
    const expiresAt = new Date(
      now.getTime() + this.windowHours * 60 * 60 * 1000,
    );

    this.logger.log(
      `Updating message window for ${phoneNumber} (normalized key: ${cacheKey})`,
    );

    this.messageWindowCache.set(cacheKey, {
      lastMessageAt: now,
      expiresAt,
    });

    const redisKey = `whatsapp:window:${cacheKey}`;
    const redisData = JSON.stringify({
      lastMessageAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    await this.redisService.set(
      redisKey,
      redisData,
      Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
    );
  }

  private async downloadAndUploadMedia(
    mediaId: string,
    storeId: string,
    mimeType?: string,
  ): Promise<string | undefined> {
    if (!mediaId) return undefined;

    try {
      this.logger.log(`[MEDIA] Starting download for mediaId: ${mediaId}`);

      const auth = await this.getAuthData(storeId);
      const accessToken = this.decryptToken(auth.accessToken);
      const api = this.createApiClient(accessToken);

      this.logger.log(`[MEDIA] Fetching media URL from WhatsApp API...`);
      const response = await api.get(`/${mediaId}`);
      const mediaData = response.data;

      this.logger.log(
        `[MEDIA] WhatsApp API response: ${JSON.stringify(mediaData)}`,
      );

      if (!mediaData.url) {
        this.logger.warn(`[MEDIA] No URL returned for media ${mediaId}`);
        throw new Error('Meta did not return a downloadable media URL');
      }

      this.logger.log(
        `[MEDIA] Downloading file from: ${mediaData.url.substring(0, 100)}...`,
      );
      const mediaResponse = await axios.get(mediaData.url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': 'WhatsApp/2.0',
        },
        responseType: 'arraybuffer',
        timeout: 60000,
      });

      const buffer = Buffer.from(mediaResponse.data);
      this.logger.log(`[MEDIA] Downloaded buffer size: ${buffer.length} bytes`);

      const contentType =
        mediaResponse.headers['content-type'] ||
        mimeType ||
        mediaData.mime_type ||
        'application/octet-stream';
      const extension = this.getExtensionFromMimetype(contentType);
      const category = this.getCategoryFromMimetype(contentType);
      const filename = `${Date.now()}_${mediaId}.${extension}`;
      const path = `${storeId}/whatsapp_official/${category}/${filename}`;

      this.logger.log(
        `[MEDIA] Uploading to Firebase path: ${path}, contentType: ${contentType}`,
      );
      const [, url] = await this.firebaseService.uploadBufferToPath(
        buffer,
        contentType,
        path,
      );

      this.logger.log(`[MEDIA] Upload successful: ${url}`);
      return url;
    } catch (error: any) {
      this.logger.error(
        `[MEDIA] Failed to download/upload media ${mediaId}: ${error?.message}`,
      );
      this.logger.error(`[MEDIA] Error stack: ${error?.stack}`);
      if (error?.response?.data) {
        this.logger.error(
          `[MEDIA] Response data: ${JSON.stringify(error.response.data)}`,
        );
      }
      throw error;
    }
  }

  private getCategoryFromMimetype(mimetype: string): string {
    const mime = (mimetype || '').split(';')[0].trim().toLowerCase();
    if (mime.startsWith('image/')) return 'Fotos';
    if (mime.startsWith('audio/')) return 'Audio';
    if (mime.startsWith('video/')) return 'Video';
    return 'Documentos';
  }

  private getExtensionFromMimetype(mimetype: string): string {
    const map: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'audio/ogg': 'ogg',
      'audio/ogg; codecs=opus': 'ogg',
      'audio/mpeg': 'mp3',
      'audio/mp4': 'm4a',
      'audio/aac': 'aac',
      'audio/amr': 'amr',
      'video/mp4': 'mp4',
      'video/3gpp': '3gp',
      'video/quicktime': 'mov',
      'video/webm': 'webm',
      'application/pdf': 'pdf',
      'application/vnd.ms-excel': 'xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
        'xlsx',
      'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        'docx',
    };
    const baseMime = (mimetype || '').split(';')[0].trim();
    return map[baseMime] || map[mimetype] || 'bin';
  }

  private async convertAudioToOpus(
    audioUrl: string,
    storeId: string,
  ): Promise<string | null> {
    const tempDir = '/tmp';
    const timestamp = randomUUID();
    const urlPath = audioUrl.split('?')[0];
    const ext = urlPath.includes('.')
      ? urlPath.substring(urlPath.lastIndexOf('.'))
      : '.bin';
    const inputPath = path.join(tempDir, `audio_input_${timestamp}${ext}`);
    const outputPath = path.join(tempDir, `audio_output_${timestamp}.ogg`);

    try {
      this.logger.log(
        `[AUDIO] Downloading audio for conversion: ${audioUrl.substring(0, 80)}...`,
      );

      const response = await axios.get(audioUrl, {
        responseType: 'arraybuffer',
        timeout: 60000,
      });

      fs.writeFileSync(inputPath, new Uint8Array(response.data));
      this.logger.log(
        `[AUDIO] Audio downloaded, size: ${response.data.byteLength} bytes`,
      );

      await runFile(
        process.env.FFMPEG_PATH || 'ffmpeg',
        [
          '-i',
          inputPath,
          '-c:a',
          'libopus',
          '-b:a',
          '32k',
          '-vbr',
          'on',
          '-compression_level',
          '10',
          '-application',
          'voip',
          outputPath,
          '-y',
        ],
        { timeout: 30000, maxBuffer: 1024 * 1024 },
      );

      if (!fs.existsSync(outputPath)) {
        throw new Error('FFmpeg conversion failed - output file not created');
      }

      const convertedBuffer = fs.readFileSync(outputPath);
      this.logger.log(
        `[AUDIO] Conversion complete, size: ${convertedBuffer.length} bytes`,
      );

      const filename = `${timestamp}_voice.ogg`;
      const storagePath = `${storeId}/whatsapp_official/Audio/${filename}`;

      const [, url] = await this.firebaseService.uploadBufferToPath(
        convertedBuffer,
        'audio/ogg; codecs=opus',
        storagePath,
      );

      this.logger.log(
        `[AUDIO] Converted audio uploaded: ${url.substring(0, 80)}...`,
      );

      return url;
    } catch (error: any) {
      this.logger.error(`[AUDIO] Conversion failed: ${error?.message}`);
      throw error;
    } finally {
      try {
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      } catch (e) {}
    }
  }

  private async getStoreIdByPhoneNumber(
    phoneNumberId: string,
  ): Promise<string | null> {
    let auth = await this.prisma.whatsAppOfficialAuthData.findFirst({
      where: { phoneNumberId },
    });

    if (!auth) {
      auth = await this.prisma.whatsAppOfficialAuthData.findFirst({
        where: { businessPhone: phoneNumberId },
      });
    }

    if (!auth) {
      const normalizedPhone = phoneNumberId.replace(/\D/g, '');
      auth = await this.prisma.whatsAppOfficialAuthData.findFirst({
        where: {
          OR: [
            { phoneNumberId: normalizedPhone },
            { businessPhone: normalizedPhone },
            { businessPhone: { contains: normalizedPhone.slice(-10) } },
          ],
        },
      });
    }

    if (auth) {
      this.logger.log(
        `Found store ${auth.storeId} for phone number ID: ${phoneNumberId}`,
      );
    }

    return auth?.storeId || null;
  }

  private getMediaTypeFromMimeOrUrl(mimeType?: string, url?: string): string {
    if (mimeType) {
      const mime = mimeType.split(';')[0].trim().toLowerCase();
      if (mime.startsWith('image/webp')) return 'sticker';
      if (mime.startsWith('image/')) return 'image';
      if (mime.startsWith('audio/')) return 'audio';
      if (mime.startsWith('video/')) return 'video';
      return 'document';
    }

    if (url) {
      const extension = url.split('.').pop()?.toLowerCase()?.split('?')[0];
      const imageExtensions = ['jpg', 'jpeg', 'png', 'gif'];
      const audioExtensions = [
        'mp3',
        'ogg',
        'wav',
        'aac',
        'opus',
        'amr',
        'm4a',
      ];
      const videoExtensions = ['mp4', 'avi', 'mov', 'webm', '3gp'];
      const stickerExtensions = ['webp'];

      if (stickerExtensions.includes(extension || '')) return 'sticker';
      if (imageExtensions.includes(extension || '')) return 'image';
      if (audioExtensions.includes(extension || '')) return 'audio';
      if (videoExtensions.includes(extension || '')) return 'video';
    }

    return 'document';
  }

  private getFilenameFromUrl(url: string): string {
    const parts = url.split('/');
    const filename = parts[parts.length - 1]?.split('?')[0];
    return filename || 'document';
  }

  private normalizePhone(phone: string): string {
    return phone.replace(/\D/g, '');
  }

  private getWindowCacheKey(storeId: string, phoneNumber: string): string {
    const normalized = this.normalizePhone(phoneNumber);
    return `${storeId}:${normalized}`;
  }

  private encryptToken(token: string): string {
    const algorithm = 'aes-256-cbc';
    const keyBuffer = Buffer.from(process.env.ENCRYPTION_KEY || '', 'base64');
    if (keyBuffer.length !== 32)
      throw new ErrorResponse(
        'ENCRYPTION_KEY must contain 32 base64-encoded bytes',
        503,
      );
    const key = new Uint8Array(
      keyBuffer.buffer,
      keyBuffer.byteOffset,
      keyBuffer.byteLength,
    );
    const ivBuffer = crypto.randomBytes(16);
    const iv = new Uint8Array(
      ivBuffer.buffer,
      ivBuffer.byteOffset,
      ivBuffer.byteLength,
    );

    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(token, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return ivBuffer.toString('hex') + ':' + encrypted;
  }

  private decryptToken(encryptedToken: string): string {
    const algorithm = 'aes-256-cbc';
    const keyBuffer = Buffer.from(process.env.ENCRYPTION_KEY || '', 'base64');
    if (keyBuffer.length !== 32)
      throw new ErrorResponse(
        'ENCRYPTION_KEY must contain 32 base64-encoded bytes',
        503,
      );
    const key = new Uint8Array(
      keyBuffer.buffer,
      keyBuffer.byteOffset,
      keyBuffer.byteLength,
    );

    const parts = encryptedToken.split(':');
    const ivBuffer = Buffer.from(parts[0], 'hex');
    const iv = new Uint8Array(
      ivBuffer.buffer,
      ivBuffer.byteOffset,
      ivBuffer.byteLength,
    );
    const encrypted = parts[1];

    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  async getMessageTemplates(storeId: string): Promise<{
    success: boolean;
    templates?: any[];
    error?: string;
  }> {
    try {
      const auth = await this.getAuthData(storeId);
      const accessToken = this.decryptToken(auth.accessToken);

      const response = await axios.get(
        `${this.apiUrl}/${auth.wabaId}/message_templates`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          params: {
            fields: 'name,status,category,language,components,id',
            limit: 100,
          },
        },
      );

      const templates = response.data?.data || [];
      this.logger.log(
        `Found ${templates.length} templates for store ${storeId}`,
      );

      return {
        success: true,
        templates: templates.map((t: any) => ({
          id: t.id,
          name: t.name,
          status: t.status,
          category: t.category,
          language: t.language,
          components: t.components,
        })),
      };
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.error?.message || error.message;
      this.logger.error(`Failed to get templates: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  private transformComponentsForMeta(components: any[]): any[] {
    return components.map((component) => {
      const type = component.type?.toUpperCase();
      const result: any = { type };

      if (component.text) {
        result.text = component.text;
      }

      if (type === 'HEADER' && component.text) {
        result.format = 'TEXT';
      }

      if (component.examples && Object.keys(component.examples).length > 0) {
        const namedParams = Object.entries(component.examples).map(
          ([paramName, example]) => ({
            param_name: paramName,
            example: example as string,
          }),
        );

        if (type === 'BODY') {
          result.example = { body_text_named_params: namedParams };
        } else if (type === 'HEADER') {
          result.example = { header_text_named_params: namedParams };
        }
      }

      if (component.buttons) {
        result.buttons = component.buttons;
      }

      return result;
    });
  }

  private hasNamedVariables(components: any[]): boolean {
    return components.some((c) => {
      if (!c.text) return false;
      const matches = c.text.match(/\{\{([a-z_]+)\}\}/g);
      return matches && matches.length > 0;
    });
  }

  private validateExamples(components: any[]): {
    valid: boolean;
    error?: string;
  } {
    for (const component of components) {
      if (!component.text) continue;

      const matches = component.text.match(/\{\{([a-z_]+)\}\}/g);
      if (!matches || matches.length === 0) continue;

      const variableNames = matches.map((m: string) =>
        m.replace(/\{\{|\}\}/g, ''),
      );
      const uniqueVars = [...new Set(variableNames)] as string[];

      if (!component.examples) {
        return {
          valid: false,
          error: `Component ${component.type} has variables without examples`,
        };
      }

      for (const varName of uniqueVars) {
        const exampleValue = component.examples[varName];
        if (
          !exampleValue ||
          (typeof exampleValue === 'string' && !exampleValue.trim())
        ) {
          return {
            valid: false,
            error: `An example for variable {{${varName}}} is required`,
          };
        }
      }
    }
    return { valid: true };
  }

  async createMessageTemplate(
    storeId: string,
    data: {
      name: string;
      category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
      language: string;
      components: any[];
    },
  ): Promise<{ success: boolean; template?: any; error?: string }> {
    const normalizedName = data.name.toLowerCase().replace(/\s+/g, '_');

    if (!data.components || data.components.length === 0) {
      return { success: false, error: 'Components are required' };
    }

    const validTypes = ['HEADER', 'BODY', 'FOOTER', 'BUTTONS'];
    const invalidComponent = data.components.find(
      (c) => !c.type || !validTypes.includes(c.type.toUpperCase()),
    );
    if (invalidComponent) {
      return {
        success: false,
        error:
          'Each component must have a valid type (HEADER, BODY, FOOTER or BUTTONS)',
      };
    }

    const examplesValidation = this.validateExamples(data.components);
    if (!examplesValidation.valid) {
      return { success: false, error: examplesValidation.error };
    }

    const existing = await this.getMessageTemplates(storeId);
    if (
      existing.success &&
      existing.templates?.some((t) => t.name === normalizedName)
    ) {
      return {
        success: false,
        error: 'A template with this name already exists',
      };
    }

    try {
      const auth = await this.getAuthData(storeId);
      const accessToken = this.decryptToken(auth.accessToken);

      const transformedComponents = this.transformComponentsForMeta(
        data.components,
      );
      const useNamedParams = this.hasNamedVariables(data.components);

      const payload: any = {
        name: normalizedName,
        category: data.category,
        language: data.language,
        components: transformedComponents,
      };

      if (useNamedParams) {
        payload.parameter_format = 'named';
      }

      const response = await axios.post(
        `${this.apiUrl}/${auth.wabaId}/message_templates`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      this.logger.log(
        `Template created: ${response.data?.id} for store ${storeId}`,
      );

      return {
        success: true,
        template: {
          id: response.data?.id,
          name: normalizedName,
          status: response.data?.status || 'PENDING',
          category: payload.category,
          language: payload.language,
        },
      };
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.error?.message || error.message;
      this.logger.error(`Failed to create template: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  async deleteMessageTemplate(
    storeId: string,
    templateName: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const auth = await this.getAuthData(storeId);
      const accessToken = this.decryptToken(auth.accessToken);

      await axios.delete(`${this.apiUrl}/${auth.wabaId}/message_templates`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        params: {
          name: templateName,
        },
      });

      this.logger.log(`Template deleted: ${templateName} for store ${storeId}`);
      return { success: true };
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.error?.message || error.message;
      this.logger.error(`Failed to delete template: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  async sendTemplateMessage(
    storeId: string,
    to: string,
    templateName: string,
    languageCode: string,
    components?: any[],
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const auth = await this.getAuthData(storeId);
      const accessToken = this.decryptToken(auth.accessToken);
      const api = this.createApiClient(accessToken);

      const payload: any = {
        messaging_product: 'whatsapp',
        to: this.normalizePhone(to),
        type: 'template',
        template: {
          name: templateName,
          language: {
            code: languageCode,
          },
        },
      };

      if (components && components.length > 0) {
        payload.template.components = components;
      }

      const response = await api.post(
        `/${auth.phoneNumberId}/messages`,
        payload,
      );

      const messageId = response.data?.messages?.[0]?.id;
      this.logger.log(`Template message sent: ${messageId} to ${to}`);

      return { success: true, messageId };
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.error?.message || error.message;
      this.logger.error(`Failed to send template message: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }
}
