import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AxiosError } from 'axios';
import { HealthCacheService } from 'src/base/service/health-cache.service';
import { PrismaService } from 'src/base/service/prisma.service';

import { OlxService } from 'src/core/olx/olx.service';
import { WhatsappService } from 'src/core/whatsapp/whatsapp.service';
import { WhatsappOfficialService } from 'src/core/whatsapp-official/whatsapp-official.service';
import { InstagramService } from 'src/core/instagram/instagram.service';
import { FacebookService } from 'src/core/facebook/facebook.service';

import { axiosAutoPilotRetry, axiosIntegracaoRetry } from './axios.config';

import { IntegrationsEnum } from 'src/core/integrations/enum/integrations.enum';
import { IntegrationsStatusEnum } from 'src/core/integrations/enum/integrations-status.enum';

import { ErrorResponse } from 'src/base/exceptions/error.response.handler';

import { ChatOutgoingMessageDto } from './dto/outgoing-message.dto';
import { ChatIncomingMessageDto } from './dto/incoming-message.dto';
import { ListMessagesQuery } from './dto/list-messages.dto';
import { VerifyWhatsappNumberDto } from './dto/verify-number-wpp.dto';

interface IntegrationSuccessPayload {
  storeId: string;
  plataforma: string;
  idMensagem?: string;
  idMensagemExterna?: string
}

@Injectable()
export class CommunicationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CommunicationService.name);

  private readonly onMessageReceived = (msg: ChatOutgoingMessageDto) => this.forwardMessageToAutoPilot(msg).catch((e) => this.logger.error('forwardMessageToAutoPilot handler error', e?.stack || e?.message));
  private readonly onCallReceived = (msg: ChatOutgoingMessageDto) => this.forwardMessageToAutoPilot(msg).catch((e) => this.logger.error('forwardMessageToAutoPilot (call) handler error', e?.stack || e?.message));
  private readonly onIntegrationSuccess = (p: IntegrationSuccessPayload) => this.notifySuccessfulIntegration(p).catch((e) => this.logger.error('notifySuccessfulIntegration handler error', e?.stack || e?.message));
  private readonly onLeadReceived = (lead: any) => this.notifyLeadInterest(lead).catch((e) => this.logger.error('notifyLeadInterest handler error', e?.stack || e?.message));

  constructor(
    private readonly healthCache: HealthCacheService,
    private readonly prisma: PrismaService,
    private readonly olx: OlxService,
    private readonly whatsapp: WhatsappService,
    private readonly whatsappOfficial: WhatsappOfficialService,
    private readonly instagram: InstagramService,
    private readonly facebook: FacebookService,
    private readonly events: EventEmitter2,
  ) { }

  onModuleInit() {
    this.events.on('message.receive', this.onMessageReceived);
    this.events.on('call.receive', this.onCallReceived);
    this.events.on('integration.success', this.onIntegrationSuccess);
    this.events.on('lead.receive', this.onLeadReceived);
  }

  onModuleDestroy() {
    this.events.off('message.receive', this.onMessageReceived);
    this.events.off('call.receive', this.onCallReceived);
    this.events.off('integration.success', this.onIntegrationSuccess);
    this.events.off('lead.receive', this.onLeadReceived);
  }

  private hashForLog(value: unknown): string {
    try {
      const str = typeof value === 'string' ? value : JSON.stringify(value);
      const crypto = require('crypto');
      return crypto.createHash('sha256').update(str || '').digest('hex').slice(0, 12);
    } catch {
      return 'hash_err';
    }
  }

  private async checkMicroserviceHealth(): Promise<boolean> {
    try {
      await axiosAutoPilotRetry.get('/health', { timeout: 5_000 });
      return true;
    } catch (err) {
      const e = err as AxiosError;
      this.logger.warn('Communication microservice health check failed', {
        status: e.response?.status,
        code: e.code,
        message: e.message,
      } as any);
      return false;
    }
  }

  async forwardMessageToAutoPilot(message: ChatOutgoingMessageDto): Promise<void> {
    try {
      const messageToSend = {
        ...message,
        metadados: {
          nome: message.metadados?.nome || '',
          email: message.metadados?.email || '',
          celular: message.metadados?.celular || '',
          urlAvatar: message.metadados?.urlAvatar ?? null,
          ...message.metadados,
        },
      };

      await axiosAutoPilotRetry.post('/chat/mensagem/receber', messageToSend);
    } catch (error) {
      const axiosError = error as AxiosError;

      this.logger.error('Erro ao enviar mensagem para AutoPilot', {
        status: axiosError.response?.status,
        code: axiosError.code,
        message: axiosError.message,
        storeId: this.hashForLog(message.storeId),
        messageId: this.hashForLog(message.idMensagem),
      } as any);
    }
  }

  async forwardMessageToChannel(message: ChatIncomingMessageDto): Promise<{ status: 'success'; response: string | null }> {
    if (!message?.canal) {
      throw new ErrorResponse('Message channel (canal) is required.', 400);
    }
    if (!message?.storeId) {
      throw new ErrorResponse('storeId is required.', 400);
    }

    const ok = (response: string | null = null) => ({ status: 'success' as const, response });

    try {
      switch (message.canal) {
        case IntegrationsEnum.INSTAGRAM: {
          const cachedHealth = await this.healthCache.getCachedHealth(IntegrationsEnum.INSTAGRAM, message.storeId);
          if (cachedHealth && cachedHealth.status === IntegrationsStatusEnum.ERROR) {
            throw new ErrorResponse('Instagram integration is not properly configured or token is invalid (cached).', 400);
          }

          await this.instagram.sendMessage(message);

          if (!cachedHealth) {
            await this.healthCache.cacheHealth(IntegrationsEnum.INSTAGRAM, message.storeId, IntegrationsStatusEnum.OK);
          }

          return ok(null);
        }

        case IntegrationsEnum.OLX: {
          await this.olx.sendMessage(message);
          return ok(null);
        }

        case IntegrationsEnum.FACEBOOK: {
          await this.facebook.sendMessage(message);
          return ok(null);
        }

        case IntegrationsEnum.WHATSAPP: {
          const apiType = message.wppApiType || await this.getWhatsAppApiType(message.storeId);
          
          if (apiType === 'official') {
            const resp = await this.whatsappOfficial.sendMessage(message);
            return resp;
          }
          
          const resp = await this.whatsapp.sendMessage(message);
          return resp;
        }

        default:
          throw new ErrorResponse('Message channel not supported.', 400);
      }
    } catch (err: any) {
      const status = typeof err?.statusCode === 'number' ? err.statusCode : 500;
      const msg = err?.message || 'Unknown error';

      this.logger.error(`forwardMessageToChannel failed: canal=${String(message?.canal)} storeId=${String(message?.storeId)} -> ${msg}`,);

      if (err instanceof ErrorResponse) throw err;
      throw new ErrorResponse(`Failed to send message via ${String(message?.canal)}: ${msg}`, status);
    }
  }

  async listMessagesWithErrors(query: ListMessagesQuery) {
    this.logger.warn('listMessagesWithErrors called but message persistence is not available', { query });
    return [];
  }

  async verifyWhatsappNumber(body: VerifyWhatsappNumberDto) {
    const { storeId, numero } = body;
    return this.whatsapp.checkNumberExists(storeId, numero);
  }

  async notifySuccessfulIntegration(params: { storeId: string; plataforma: string; idMensagem?: string; idMensagemExterna?: string }): Promise<void> {
    try {
      await axiosIntegracaoRetry.post('/chat/mensagem/resposta', {
        storeId: params.storeId,
        plataforma: params.plataforma,
        idMensagem: params.idMensagem ?? null,
        idMensagemExterna: params.idMensagemExterna ?? null,
      });
    } catch (error: any) {
      this.logger.error('Error notifying integration success', error?.message);
    }
  }

  async notifyLeadInterest(lead: any): Promise<void> {
    try {
      await axiosAutoPilotRetry.post('/lead/receber', lead);
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error('Erro ao notificar interesse de lead ao AutoPilot', {
        status: axiosError.response?.status,
        code: axiosError.code,
        message: axiosError.message,
        storeId: this.hashForLog(lead?.storeId),
        listId: this.hashForLog(lead?.listId),
      } as any);
    }
  }

  private async getWhatsAppApiType(storeId: string): Promise<'official' | 'naooficial'> {
    try {
      const officialAuth = await this.prisma.whatsAppOfficialAuthData.findUnique({
        where: { storeId }
      });
      
      if (officialAuth) {
        const health = await this.whatsappOfficial.healthCheck(storeId);
        if (health.status === IntegrationsStatusEnum.OK) {
          return 'official';
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to check WhatsApp API type for store ${storeId}: ${error?.message}`);
    }
    
    return 'naooficial';
  }

  async getServicesHealthStatus(storeId?: string) {
    const apiType = storeId ? await this.getWhatsAppApiType(storeId) : 'naooficial';
    
    const healthStatus = {
      microservice: await this.checkMicroserviceHealth(),
      instagram: storeId ? await this.instagram.checkConnectionHealth(storeId) : null,
      facebook: storeId ? await this.facebook.healthCheck(storeId).then((r) => r.status === IntegrationsStatusEnum.OK).catch(() => false) : null,
      whatsapp: storeId ? (
        apiType === 'official' 
          ? await this.whatsappOfficial.healthCheck(storeId).then((r) => r.status === IntegrationsStatusEnum.OK).catch(() => false)
          : await this.whatsapp.healthCheck(storeId).then((r) => r.status === IntegrationsStatusEnum.OK).catch(() => false)
      ) : null,
      whatsappApiType: apiType,
      timestamp: new Date().toISOString(),
    } as const;

    const overall = (Object.values(healthStatus) as Array<boolean | null | string>)
      .filter((s) => typeof s === 'boolean')
      .every((s) => s === true);

    return { overall, services: healthStatus };
  }
}
