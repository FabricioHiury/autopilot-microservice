import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/base/service/prisma.service';
import { ErrorResponse } from 'src/base/exceptions/error.response.handler';
import axios, { AxiosError, AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import { stringify } from 'querystring';
import { IOlxAccessKey } from './olx.interfaces';
import { IntegrationsEnum } from 'src/core/integrations/enum/integrations.enum';
import { ChatIncomingMessageDto } from 'src/core/comunication/dto/incoming-message.dto';
import { ChatOutgoingMessageDto } from 'src/core/comunication/dto/outgoing-message.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomBytes, createHmac } from 'crypto';
import { OlxSaveClientDto } from './dto/olx-save-client.dto';
import { handleOlxAccessKeyErrors } from './olx.utils';
import { OlxReceiveMessageDto } from './dto/olx-receive-message.dto';
import { OlxSendMessageDto } from './dto/olx-send-message.dto';
import { IntegrationStatusDto } from 'src/core/integrations/dto/integrations-status.dto';
import { IntegrationsStatusEnum, IntegrationsStatusErrorMessageEnum } from 'src/core/integrations/enum/integrations-status.enum';
import { MessageTypeEnum } from '../integrations/enum/message-type.enum';
import { OlxReceiveLeadDto } from './dto/olx-receive-lead.dto';

@Injectable()
export class OlxService {
  private readonly logger = new Logger(OlxService.name);

  private readonly authBaseUrl: string;
  private readonly apiBaseUrl: string;
  private readonly redirectUri: string;

  private readonly http: AxiosInstance;

  private static readonly ROUTES = {
    approval: '/oauth',
    token: '/oauth/token',
    chatWebhook: '/autoservice/v1/chat',
    leadWebhook: '/autoservice/v1/lead',
    chatSend: '/autoservice/v1/chat/send',
    published: '/autoupload/published',
  } as const;

  private static readonly DEFAULT_TIMEOUT_MS = 10_000;
  private static readonly MAX_RETRIES = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {
    this.authBaseUrl = process.env.OLX_AUTH_URL ?? '';
    this.apiBaseUrl = process.env.OLX_APP_URL ?? '';
    this.redirectUri = `${process.env.APP_BASE_URL}/olx/auth/access-key`;

    this.assertEnv();

    this.http = axios.create({
      baseURL: this.apiBaseUrl,
      timeout: OlxService.DEFAULT_TIMEOUT_MS,
    });

    axiosRetry(this.http, {
      retries: OlxService.MAX_RETRIES,
      retryDelay: (retryCount) => {
        const base = Math.min(1000 * 2 ** retryCount, 10_000);
        return Math.floor(Math.random() * base);
      },
      retryCondition: (error) => {
        const status = error?.response?.status;
        return axiosRetry.isNetworkOrIdempotentRequestError(error) || status === 429;
      },
    });
  }

  async deactivateMessageReceivingWebhook(storeId: string): Promise<string> {
    const { accessToken } = await this.findOlxAuthOrThrowByStoreId(storeId);

    try {
      await this.http.delete(OlxService.ROUTES.chatWebhook, {
        headers: this.authHeader(accessToken),
      });

      await this.prisma.olxAuthData.update({
        where: { storeId: storeId },
        data: { receiveMessages: false },
      });

      return 'Webhook de recebimento de mensagens desativado com sucesso.';
    } catch (err) {
      const { message } = this.extractAxiosError(err);
      throw new ErrorResponse(`Falha ao desativar webhook de mensagens: ${message}`, 500);
    }
  }

  async getAuthenticationWebhook(): Promise<string> {
    return this.redirectUri;
  }

  async saveOlxClient(dto: OlxSaveClientDto): Promise<string> {
    const { storeId, clientId, clientSecret } = dto;

    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw new ErrorResponse('Store not found.', 404);

    const uniqueId = this.generateUniqueId();

    try {
      await this.prisma.olxAuthData.upsert({
        where: { storeId },
        update: { clientId, clientSecret, uniqueId },
        create: { storeId, clientId, clientSecret, uniqueId },
      });

      return this.buildAuthenticationUrl(uniqueId);
    } catch (err) {
      const { message } = this.extractAxiosError(err);
      throw new ErrorResponse(`Error saving OLX client data: ${message}`, 500);
    }
  }

  async getAccessKeyAndActivateMessageWebhook(code: string, uniqueId: string): Promise<string> {
    if (!code) throw new ErrorResponse('Authentication code missing.', 400);

    const auth = await this.prisma.olxAuthData.findUnique({ where: { uniqueId } });
    if (!auth?.clientId || !auth?.clientSecret || !auth?.storeId) {
      throw new ErrorResponse('OLX authentication credentials not found.', 404);
    }

    const tokenUrl = new URL(OlxService.ROUTES.token, this.authBaseUrl).toString();
    const body = stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
      client_id: auth.clientId,
      client_secret: auth.clientSecret,
    });

    this.logger.debug(`[getAccessKey] Token URL: ${tokenUrl}`);
    this.logger.debug(`[getAccessKey] Redirect URI: ${this.redirectUri}`);
    this.logger.debug(`[getAccessKey] Client ID: ${auth.clientId?.slice(0, 8)}...`);

    try {
      const { data } = await axios.post<IOlxAccessKey>(tokenUrl, body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: OlxService.DEFAULT_TIMEOUT_MS,
      });

      await this.prisma.olxAuthData.update({
        where: { uniqueId },
        data: { accessToken: data.access_token, code },
      });

      await this.activateMessageReceivingWebhook(auth.storeId, `${process.env.APP_BASE_URL}/olx/message/receive/${uniqueId}`);
      await this.activateLeadWebhook(auth.storeId, `${process.env.APP_BASE_URL}/olx/lead/receive/${uniqueId}`);

      this.events.emit('integration.success', {
        storeId: auth.storeId,
        plataforma: IntegrationsEnum.OLX,
      });

      return 'Integração OLX concluída com sucesso. Chat e Leads habilitados.';
    } catch (err) {
      const apiError = (err as AxiosError)?.response?.data as any;
      if (apiError?.error) handleOlxAccessKeyErrors(apiError.error);

      const { message } = this.extractAxiosError(err);
      throw new ErrorResponse(`Error getting access token: ${message}`, 500);
    }
  }

  async healthCheck(storeId: string): Promise<IntegrationStatusDto> {
    const auth = await this.prisma.olxAuthData.findUnique({ where: { storeId: storeId } });

    const status: IntegrationStatusDto = {
      channel: IntegrationsEnum.OLX,
      status: IntegrationsStatusEnum.NOT_CONFIGURED,
      message: IntegrationsStatusErrorMessageEnum.INTEGRATION_NOT_CONFIGURED,
    };

    if (!auth?.accessToken || auth?.receiveMessages === false) {
      return status;
    }

    try {
      await this.http.post(OlxService.ROUTES.published, { access_token: auth.accessToken });
      status.status = IntegrationsStatusEnum.OK;
      status.message = null;
      return status;
    } catch (err) {
      this.logger.warn(`healthCheck OLX failed: ${this.extractAxiosError(err).message}`);
      return status;
    }
  }

  async receiveMessage(uniqueId: string, payload: OlxReceiveMessageDto): Promise<void> {
    const auth = await this.prisma.olxAuthData.findUnique({ where: { uniqueId } });
    if (!auth) throw new ErrorResponse('Store not found for the uniqueId provided.', 404);

    let ts: Date;
    try {
      const raw = payload.messageTimestamp as any;
      if (typeof raw === 'number') {
        ts = new Date(raw > 1e12 ? raw : raw * 1000);
      } else {
        const parsed = Date.parse(String(raw));
        ts = isNaN(parsed) ? new Date() : new Date(parsed);
      }
    } catch {
      ts = new Date();
    }

    const outgoing: ChatOutgoingMessageDto = {
      storeId: auth.storeId,
      idDestinatarioApiExterna: payload.chatId,
      mensagem: payload.message,
      idMensagem: payload.messageId,
      canal: IntegrationsEnum.OLX,
      timestamp: ts,
      enviadaLoja: payload.origin === 'seller',
      tipo: MessageTypeEnum.TEXT,
      metadados: {
        nome: payload.name,
        email: payload.email,
        celular: payload.phone,
        idAnuncioExterno: payload.listId,
      },
    };

    this.events.emit('message.receive', outgoing);
  }

  async receiveLead(uniqueId: string, payload: OlxReceiveLeadDto, authorization?: string): Promise<void> {
    const auth = await this.prisma.olxAuthData.findUnique({ where: { uniqueId } });
    if (!auth) throw new ErrorResponse('Store not found for the uniqueId provided.', 404);

    if (auth.leadWebhookToken) {
      if (!authorization) {
        throw new ErrorResponse('Missing Authorization header.', 401);
      }

      const isValid = this.validateHmacSignature(payload, auth.leadWebhookToken, authorization);
      if (!isValid) {
        this.logger.warn(`[receiveLead] Invalid HMAC signature for storeId: ${auth.storeId}`);
        throw new ErrorResponse('Invalid webhook signature.', 401);
      }
    }

    let createdAt: Date;
    try {
      const parsed = Date.parse(String(payload.createdAt));
      createdAt = isNaN(parsed) ? new Date() : new Date(parsed);
    } catch {
      createdAt = new Date();
    }

    const leadEventPayload = {
      storeId: auth.storeId,
      source: payload.source,
      adId: payload.adId,
      listId: payload.listId,
      linkAd: payload.linkAd,
      name: payload.name,
      email: payload.email,
      phone: payload.phone,
      message: payload.message,
      createdAt,
      adsInfo: payload.adsInfo,
      externalId: payload.externalId,
    };

    this.events.emit('lead.receive', leadEventPayload);
  }

  async sendMessage({ destinatario, mensagem, storeId }: ChatIncomingMessageDto): Promise<string> {
    if (!mensagem?.trim()) {
      throw new ErrorResponse('Message not provided.', 400);
    }

    const accessToken = await this.getAccessTokenByStoreId(storeId);
    const body: OlxSendMessageDto = { chatId: destinatario, textMessage: mensagem };

    try {
      await this.http.post(OlxService.ROUTES.chatSend, body, {
        headers: this.authHeader(accessToken),
      });
      return 'Mensagem enviada com sucesso.';
    } catch (err) {
      const e = this.extractAxiosError(err);
      this.logger.error('Error sending message to OLX', {
        status: e.status,
        code: e.code,
        endpoint: OlxService.ROUTES.chatSend,
        method: 'POST',
        response: e.responseBodySnippet,
      } as any);

      throw new ErrorResponse(`Error sending message: ${e.message}`, 500);
    }
  }

  private assertEnv(): void {
    const missing: string[] = [];
    if (!this.authBaseUrl) missing.push('OLX_AUTH_URL');
    if (!this.apiBaseUrl) missing.push('OLX_APP_URL');
    if (!process.env.APP_BASE_URL) missing.push('APP_BASE_URL');
    if (!process.env.OLX_SCOPE) missing.push('OLX_SCOPE');

    if (missing.length) {
      throw new ErrorResponse(`Missing environment variables: ${missing.join(', ')}`, 500);
    }
  }

  private generateUniqueId(): string {
    return randomBytes(12).toString('hex');
  }

  private authHeader(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  private async getAccessTokenByStoreId(storeId: string): Promise<string> {
    const auth = await this.prisma.olxAuthData.findUnique({ where: { storeId: storeId } });
    const accessToken = auth?.accessToken;

    if (!accessToken) {
      throw new ErrorResponse(
        'Access token not found. It is necessary to authenticate the store with OLX.',
        400,
      );
    }
    return accessToken;
  }

  private async findOlxAuthOrThrowByStoreId(storeId: string) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw new ErrorResponse('Store not found.', 404);

    const auth = await this.prisma.olxAuthData.findUnique({ where: { storeId: storeId } });
    if (!auth?.accessToken) throw new ErrorResponse('Store is not integrated with OLX.', 400);

    return auth;
  }

  private async activateMessageReceivingWebhook(storeId: string, webhookUrl: string): Promise<string> {
    const accessToken = await this.getAccessTokenByStoreId(storeId);

    const fullUrl = `${this.apiBaseUrl}${OlxService.ROUTES.chatWebhook}`;
    this.logger.debug(`[activateWebhook] Full URL: ${fullUrl}`);
    this.logger.debug(`[activateWebhook] Webhook URL: ${webhookUrl}`);
    this.logger.debug(`[activateWebhook] Access Token: ${accessToken?.slice(0, 10)}...`);

    try {
      await this.http.post(OlxService.ROUTES.chatWebhook, { webhook: webhookUrl }, {
        headers: this.authHeader(accessToken),
      });

      await this.prisma.olxAuthData.update({
        where: { storeId: storeId },
        data: { receiveMessages: true },
      });

      return 'Webhook de recebimento de mensagens ativado com sucesso.';
    } catch (err) {
      const axiosError = this.extractAxiosError(err);
      this.logger.error(`[activateWebhook] Error details:`, {
        status: axiosError.status,
        message: axiosError.message,
        responseBody: axiosError.responseBodySnippet,
        url: fullUrl
      });
      throw new ErrorResponse(`Falha ao ativar webhook de mensagens: ${axiosError.message}`, 500);
    }
  }

  private async activateLeadWebhook(storeId: string, webhookUrl: string): Promise<string> {
    const accessToken = await this.getAccessTokenByStoreId(storeId);

    const fullUrl = `${this.apiBaseUrl}${OlxService.ROUTES.leadWebhook}`;
    this.logger.debug(`[activateLeadWebhook] Full URL: ${fullUrl}`);
    this.logger.debug(`[activateLeadWebhook] Webhook URL: ${webhookUrl}`);

    const token = await this.ensureLeadWebhookToken(storeId);

    try {
      await this.http.post(OlxService.ROUTES.leadWebhook, { url: webhookUrl, token }, {
        headers: this.authHeader(accessToken),
      });

      return 'Webhook de leads (interesse) ativado com sucesso.';
    } catch (err) {
      const axiosError = this.extractAxiosError(err);
      this.logger.error(`[activateLeadWebhook] Error details:`, {
        status: axiosError.status,
        message: axiosError.message,
        responseBody: axiosError.responseBodySnippet,
        url: fullUrl,
      } as any);
      throw new ErrorResponse(`Falha ao ativar webhook de leads: ${axiosError.message}`, 500);
    }
  }

  private async buildAuthenticationUrl(uniqueId: string): Promise<string> {
    const auth = await this.prisma.olxAuthData.findUnique({ where: { uniqueId } });

    if (!auth?.clientId) {
      throw new ErrorResponse('Loja não encontrada. Salve os dados de integração com a OLX antes de acessar esta rota.', 404);
    }

    const url = new URL(OlxService.ROUTES.approval, this.authBaseUrl);
    url.searchParams.set('client_id', auth.clientId);
    url.searchParams.set('state', uniqueId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('scope', process.env.OLX_SCOPE!);
    url.searchParams.set('response_type', 'code');

    return url.toString();
  }

  private extractAxiosError(err: unknown): { message: string; status?: number; code?: string; responseBodySnippet?: string; } {
    if (axios.isAxiosError(err)) {
      const ax = err as AxiosError<any>;
      const status = ax.response?.status;
      const code = ax.code;
      const msgFromApi =
        (ax.response?.data && (ax.response.data.message || ax.response.data.error_description || ax.response.data.error)) ||
        ax.message;

      const raw = ax.response?.data ? JSON.stringify(ax.response.data) : undefined;
      const snippet = raw && raw.length > 500 ? `${raw.slice(0, 500)}...` : raw;

      return {
        message: msgFromApi ?? 'Erro desconhecido ao chamar a API OLX.',
        status,
        code,
        responseBodySnippet: snippet,
      };
    }

    const message = (err as Error)?.message ?? 'Erro inesperado.';
    return { message };
  }


  private validateHmacSignature(payload: any, secret: string, receivedSignature: string): boolean {
    try {
      const payloadString = JSON.stringify(payload);
      
      const hmac = createHmac('sha256', secret);
      hmac.update(payloadString);
      const calculatedSignature = hmac.digest('hex');
      
      return this.timingSafeEqual(calculatedSignature, receivedSignature);
    } catch (err) {
      this.logger.error('[validateHmacSignature] Error validating signature', err);
      return false;
    }
  }

  private timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }

  private async ensureLeadWebhookToken(storeId: string): Promise<string> {
    const auth = await this.prisma.olxAuthData.findUnique({ where: { storeId } });
    if (!auth) throw new ErrorResponse('Store not found.', 404);
    if (auth.leadWebhookToken) return auth.leadWebhookToken;

    const token = randomBytes(16).toString('hex');
    await this.prisma.olxAuthData.update({ where: { storeId }, data: { leadWebhookToken: token } });
    return token;
  }
}
