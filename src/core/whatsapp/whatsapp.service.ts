import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Client, MessageMedia, Location, WAState, MessageAck } from 'whatsapp-web.js';
import * as fs from 'fs';
import { uuidv7 } from 'uuidv7';

import { ErrorResponse } from 'src/base/exceptions/error.response.handler';

import { PrismaService } from 'src/base/service/prisma.service';
import { RedisService } from 'src/base/service/redis.service';
import { WhatsappMessageReceiver } from './services/whatsapp-message.receiver';
import { WhatsappLocalAuth } from './auth/whatsapp-local.auth';
import { hashForLog, qrToBase64, normalizePhone, removeStaleChromiumLock, clearAllSessions, clearTempDirs, sleep, forceResetSession } from './whatsapp.utils';

import { WhatsAppStatusEnum } from './enum/status.enum';
import { IntegrationsStatusEnum } from 'src/core/integrations/enum/integrations-status.enum';
import { IntegrationsEnum } from 'src/core/integrations/enum/integrations.enum';

import { ChatIncomingMessageDto } from '../comunication/dto/incoming-message.dto';
import { ChatOutgoingMessageDto } from '../comunication/dto/outgoing-message.dto';
import { MessageTypeEnum } from 'src/core/integrations/enum/message-type.enum';
import { IntegrationStatusDto } from '../integrations/dto/integrations-status.dto';
import { MessageQueueService } from './services/message-queue.service';

@Injectable()
export class WhatsappService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappService.name);

  private static readonly INIT_TIMEOUT_MS = 300_000;
  private static readonly WPP_STATE_TIMEOUT_MS = 15_000;
  private static readonly HEALTH_CHECK_INTERVAL_MS = 5 * 60_000;
  private static readonly QUEUE_TICK_MS = 3_000;
  private static readonly REENQUEUE_DELAY_MS = 30_000;
  private static readonly CLEANUP_PAGE_TIMEOUT_MS = 3_000;
  private static readonly CLEANUP_DESTROY_TIMEOUT_MS = 5_000;
  private static readonly PENDING_OUTGOING_TTL_MS = 60_000;
  private static readonly CLIENT_HEALTH_CACHE_TTL = 30_000;

  private static readonly PUPPETEER_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,720',
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ];

  private clients = new Map<string, Client>();
  private currentQrCodes = new Map<string, string>();
  private pendingOutgoing = new Set<string>();
  private externalToInternalMessageId = new Map<string, string>();
  private recipientToPendingInternalIds = new Map<string, string[]>();

  private initializationQueue: Array<{ instanceId: string; storeId: string }> = [];
  private initializingInstances = new Set<string>();
  private initializationInFlight = 0;
  private readonly maxConcurrentClients = 3;

  private lightHealthTimers = new Map<string, NodeJS.Timeout>();
  private strongHealthTimers = new Map<string, NodeJS.Timeout>();
  private deletedInstances = new Set<string>();
  private clientHealthCache = new Map<string, { healthy: boolean; lastCheck: number }>(); 

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly receiver: WhatsappMessageReceiver,
    private readonly redisService: RedisService,
    private readonly authStrategyFactory: WhatsappLocalAuth,
    private readonly messageQueue: MessageQueueService,
  ) { }

  async onModuleInit(): Promise<void> {
    await this.enqueueExistingInstances();
    void this.processInitializationQueue();

    setInterval(() => this.receiver.cleanupOldTimestamps(), 60 * 60 * 1000);

    setInterval(async () => {
      try {
        await this.authStrategyFactory.cleanupOrphanSessions();
      } catch (error) {
        this.logger.error(`Error during orphan session cleanup: ${error.message}`);
      }
    }, 6 * 60 * 60 * 1000);

    setInterval(() => {
      if (this.deletedInstances.size > 100) {
        this.logger.log(`Cleaning up ${this.deletedInstances.size} deleted instances tracking`);
        this.deletedInstances.clear();
      }
    }, 24 * 60 * 60 * 1000);
  }

  private async enqueueExistingInstances(): Promise<void> {
    const authRows = await this.prisma.whatsAppAuthData.findMany();
    this.logger.log(`Found ${authRows.length} WhatsApp instances to initialize`);

    for (const a of authRows) {
      if (a.instanceId) {
        this.initializationQueue.push({ instanceId: a.instanceId, storeId: a.storeId });
      }
    }
  }

  private async processInitializationQueue(): Promise<void> {
    while (this.initializationQueue.length > 0 || this.initializationInFlight > 0) {
      if (
        this.initializationInFlight < this.maxConcurrentClients &&
        this.initializationQueue.length > 0
      ) {
        const next = this.initializationQueue.shift()!;

        if (this.deletedInstances.has(next.instanceId)) {
          this.logger.log(`Skipping deleted instance ${next.instanceId} from initialization queue`);
          continue;
        }

        if (this.initializingInstances.has(next.instanceId)) {
        } else {
          this.initializingInstances.add(next.instanceId);
          this.initializationInFlight++;
          this.startClientInternal(next.instanceId, next.storeId)
            .catch((err) => {
              this.logger.error(`Failed to initialize ${next.instanceId}: ${err?.message}`);
              if (!this.deletedInstances.has(next.instanceId)) {
                setTimeout(() => this.initializationQueue.push(next), WhatsappService.REENQUEUE_DELAY_MS);
              }
            })
            .finally(() => {
              this.initializationInFlight--;
              this.initializingInstances.delete(next.instanceId);
            });
        }
      }
      await sleep(WhatsappService.QUEUE_TICK_MS);
    }
    this.logger.log('Initialization queue fully processed');
  }

  async getQrCodeByStoreId(storeId: string): Promise<{ qrCode: { base64: string | null }; mensagem: any; status: WhatsAppStatusEnum }> {
    const auth = await this.getOrCreateAuth(storeId);
    let client = this.clients.get(auth.instanceId);

    if (client && this.deletedInstances.has(auth.instanceId)) {
      this.logger.log(`Instance ${auth.instanceId} was recently deleted, forcing cleanup`);
      await this.cleanupClient(auth.instanceId);
      client = null;
    }

    if (client) {
      const state = await this.safeGetState(client);
      const healthy = await this.checkClientHealth(client);

      if (state === WAState.CONNECTED && healthy) {
        this.logger.log(`WhatsApp already connected for ${auth.instanceId}`);
        return { qrCode: { base64: null }, mensagem: null, status: WhatsAppStatusEnum.CONNECTED };
      }

      if (!healthy || [WAState.CONFLICT, WAState.UNPAIRED, WAState.UNLAUNCHED].includes(state as any)) {
        const isUsableState = state === WAState.CONNECTED;
        this.logger.warn(`Client unhealthy or in bad state (state=${state}, usable=${isUsableState}), restarting for ${auth.instanceId}`);
        await this.cleanupClient(auth.instanceId);
        client = null;
      }
    }

    if (!client) {
      try {
        this.logger.log(`Creating new client for ${auth.instanceId}`);
        client = await this.getClientLazy(auth.instanceId, storeId);
      } catch (error: any) {
        this.logger.error(`Failed to create client: ${error?.message}`);
        return {
          qrCode: { base64: null },
          mensagem: 'Erro ao inicializar WhatsApp. Tente novamente.',
          status: WhatsAppStatusEnum.QR_CODE_GENERATED
        };
      }
    }

    const currentState = await this.safeGetState(client);

    if (currentState === WAState.CONNECTED) {
      const healthy = await this.checkClientHealth(client);
      if (healthy) {
        return { qrCode: { base64: null }, mensagem: null, status: WhatsAppStatusEnum.CONNECTED };
      }
    }

    const qr = this.currentQrCodes.get(auth.instanceId);
    if (qr) {
      const base64 = await qrToBase64(qr);
      return { qrCode: { base64 }, mensagem: null, status: WhatsAppStatusEnum.QR_CODE_GENERATED };
    }

    return {
      qrCode: { base64: null },
      mensagem: 'Aguardando QR Code...',
      status: WhatsAppStatusEnum.QR_CODE_GENERATED
    };
  }

  async sendMessage(data: ChatIncomingMessageDto): Promise<{ status: 'success'; response: string }> {
    const {
      destinatario,
      storeId,
      anexoMensagem,
      mensagem,
      latitude,
      longitude,
      locationName,
      locationAddress,
      locationUrl,
      idMensagem,
      mensagemReferencia,
    } = data;

    this.logger.log(`Received message - Reply to: ${mensagemReferencia || 'none'} | Message: ${mensagem?.substring(0, 50) || 'media'}`);

    const hasLocation = latitude != null && longitude != null;
    const hasText = typeof mensagem === 'string' && mensagem.trim().length > 0;
    const hasMedia = typeof anexoMensagem === 'string' && anexoMensagem.trim().length > 0;

    if (!hasText && !hasMedia && !hasLocation) {
      throw new ErrorResponse('Mensagem, anexo ou localização necessário.', 400);
    }

    if (!destinatario || !destinatario.trim()) {
      throw new ErrorResponse('Destinatário inválido.', 400);
    }

    const auth = await this.getOrCreateAuth(storeId);
    const client = await this.ensureClientReady(auth.instanceId, storeId);

    const phone = normalizePhone(destinatario);
    const jid = await this.resolveJid(client, phone);
    if (!jid) throw new ErrorResponse('Número inválido ou não registrado no WhatsApp', 400);

    const ttl = WhatsappService.PENDING_OUTGOING_TTL_MS;
    const enqueuePending = (jidKey: string, internalId?: string | null) => {
      if (!internalId) return;
      const queue = this.recipientToPendingInternalIds.get(jidKey) || [];
      if (!queue.includes(internalId)) {
        queue.push(internalId);
        this.recipientToPendingInternalIds.set(jidKey, queue);
      }
      setTimeout(() => {
        const q = this.recipientToPendingInternalIds.get(jidKey);
        if (!q) return;
        const idx = q.indexOf(internalId);
        if (idx >= 0) q.splice(idx, 1);
        if (q.length === 0) this.recipientToPendingInternalIds.delete(jidKey);
        else this.recipientToPendingInternalIds.set(jidKey, q);
      }, ttl);
    };

    const mapExternalToInternal = (externalId: string, internalId?: string | null) => {
      if (!internalId) return;
      this.externalToInternalMessageId.set(externalId, internalId);
      setTimeout(() => this.externalToInternalMessageId.delete(externalId), ttl);
    };

    enqueuePending(jid, idMensagem);

    try {
      let resp: any;

      const sendWithRetry = async (sendFn: () => Promise<any>, maxRetries: number = 2): Promise<any> => {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            return await Promise.race([
              sendFn(),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Send timeout')), 15000)
              )
            ]);
          } catch (error: any) {
            this.logger.warn(`Send attempt ${attempt}/${maxRetries} failed: ${error?.message}`);
            if (attempt === maxRetries) throw error;
            await sleep(1000 * attempt);
          }
        }
      };

      let originalMessage: any = null;
      if (mensagemReferencia && mensagemReferencia.trim()) {
        try {
          const messageId = mensagemReferencia.trim();
          this.logger.log(`Attempting to find original message with ID: ${messageId}`);
          
          const chat = await client.getChatById(jid);
          const messages = await chat.fetchMessages({ limit: 50 });
          
          originalMessage = messages.find(msg => 
            msg.id?.id === messageId || 
            msg.id?._serialized === messageId ||
            msg.id?._serialized?.includes(messageId)
          );
          
          if (originalMessage) {
            this.logger.log(`Found original message for reply: ${originalMessage.id?._serialized}`);
          } else {
            this.logger.warn(`Original message not found in recent messages for ID: ${messageId}`);
          }
        } catch (e: any) {
          this.logger.warn(`Failed to get original message for reply: ${e?.message}`);
        }
      }

      if (hasLocation) {
        const location = new Location(latitude!, longitude!, {
          name: locationName,
          address: locationAddress,
          url: locationUrl,
        });
        if (originalMessage) {
          resp = await sendWithRetry(() => originalMessage.reply(location));
        } else {
          resp = await sendWithRetry(() => client.sendMessage(jid, location));
        }
      } else if (hasMedia) {
        let media: MessageMedia;
        try {
          media = await MessageMedia.fromUrl(anexoMensagem!.trim(), {
            unsafeMime: true,
            reqOptions: { timeout: 60_000 },
          });
        } catch (e: any) {
          throw new ErrorResponse(`Falha ao obter mídia: ${e?.message || 'erro desconhecido'}`, 400);
        }

        const rawMime = (media.mimetype || '').split(';')[0].trim();
        const isAudio = rawMime.startsWith('audio/');
        const isMP4 = rawMime === 'video/mp4' || anexoMensagem!.toLowerCase().endsWith('.mp4');

        if (originalMessage) {
          resp = await sendWithRetry(() => originalMessage.reply(media, {
            caption: hasText ? mensagem!.trim() : '',
            sendAudioAsVoice: isAudio,
            sendMediaAsDocument: isMP4 && !isAudio,
          } as any));
        } else {
          resp = await sendWithRetry(() => client.sendMessage(jid, media, {
            caption: hasText ? mensagem!.trim() : '',
            sendAudioAsVoice: isAudio,
            sendMediaAsDocument: isMP4 && !isAudio,
          } as any));
        }
      } else {
        if (originalMessage) {
          resp = await sendWithRetry(() => originalMessage.reply(mensagem!.trim()));
        } else {
          resp = await sendWithRetry(() => client.sendMessage(jid, mensagem!.trim()));
        }
      }

      const externalId =
        resp?.id?._serialized ||
        resp?.id?.id ||
        (typeof resp === 'string' ? resp : null);

      if (!externalId) {
        throw new ErrorResponse('WhatsApp não retornou identificador da mensagem (idMensagemExterna).', 502);
      }

      this.markPendingOutgoing(externalId);
      mapExternalToInternal(externalId, idMensagem);

      await this.messageQueue.addPendingMessage(auth.instanceId, externalId);

      return { status: 'success', response: externalId };
    } catch (err: any) {
      if (idMensagem) {
        const q = this.recipientToPendingInternalIds.get(jid);
        if (q) {
          const idx = q.indexOf(idMensagem);
          if (idx >= 0) q.splice(idx, 1);
          if (q.length === 0) this.recipientToPendingInternalIds.delete(jid);
          else this.recipientToPendingInternalIds.set(jid, q);
        }
      }

      this.logger.error(`Erro ao enviar mensagem para ${hashForLog(jid)}: ${err?.stack || err?.message || String(err)}`);

      if (err instanceof ErrorResponse) throw err;
      throw new ErrorResponse(`Erro ao enviar mensagem: ${err?.message || 'falha desconhecida'}`, 500);
    }
  }

  async checkNumberExists(storeId: string, phoneNumber: string): Promise<{ exists: boolean }> {
    try {
      const normalizedPhone = normalizePhone(phoneNumber);
      const auth = await this.getOrCreateAuth(storeId);
      const client = await this.ensureClientReady(auth.instanceId, storeId);
      const numberId = await client.getNumberId(normalizedPhone);
      return { exists: !!numberId };
    } catch (e) {
      this.logger.warn(`checkNumberExists failed: ${String(e?.message || e)} - phone=${phoneNumber}`);
      return { exists: false };
    }
  }

  async healthCheck(storeId: string): Promise<IntegrationStatusDto> {
    const auth = await this.prisma.whatsAppAuthData.findFirst({ where: { storeId: storeId } });
    if (!auth?.instanceId)
      return { channel: IntegrationsEnum.WHATSAPP, status: IntegrationsStatusEnum.NOT_CONFIGURED, message: 'Not configured' };

    const client = this.clients.get(auth.instanceId);
    if (!client)
      return { channel: IntegrationsEnum.WHATSAPP, status: IntegrationsStatusEnum.ERROR, message: 'Client not initialized' };

    const state = await this.safeGetState(client);
    if (state === WAState.CONNECTED) return { channel: IntegrationsEnum.WHATSAPP, status: IntegrationsStatusEnum.OK, message: null };

    return { channel: IntegrationsEnum.WHATSAPP, status: IntegrationsStatusEnum.ERROR, message: `State: ${state}` };
  }

  async initializeClient(instanceId: string, storeId: string): Promise<Client> {
    await this.prisma.whatsAppAuthData.upsert({
      where: { instanceId },
      update: { storeId: storeId },
      create: { instanceId, storeId: storeId },
    });
    return this.startClientInternal(instanceId, storeId);
  }

  private async startClientInternal(instanceId: string, storeId: string): Promise<Client> {
    if (this.deletedInstances.has(instanceId)) {
      this.logger.log(`Instance ${instanceId} is marked as deleted, skipping initialization`);
      throw new ErrorResponse('Instance was deleted', 400);
    }

    removeStaleChromiumLock(instanceId);

    const existing = this.clients.get(instanceId);
    if (existing) {
      const state = await this.safeGetState(existing);
      const healthy = await this.checkClientHealth(existing);
      if (state === WAState.CONNECTED && healthy) {
        this.logger.log(`Reusing connected and healthy client ${instanceId}`);
        return existing;
      }
      this.logger.log(`Existing client not healthy, cleaning up ${instanceId}`);
      await this.cleanupClient(instanceId);
    }

    clearTempDirs(instanceId);

    const puppeteer: any = {
      headless: true,
      slowMo: 0,
      args: WhatsappService.PUPPETEER_ARGS,
      defaultViewport: null,
      timeout: WhatsappService.INIT_TIMEOUT_MS,
      protocolTimeout: 300000, 
    };

    if (process.env.CHROMIUM_PATH) {
      puppeteer.executablePath = process.env.CHROMIUM_PATH;
    } else if (fs.existsSync('/usr/bin/chromium')) {
      puppeteer.executablePath = '/usr/bin/chromium';
    }

    const authStrategy = await this.authStrategyFactory.createAuthStrategy(instanceId, storeId);
    const webCacheOpts = this.authStrategyFactory.getWebCacheOptions();

    const client = new Client({
      authStrategy,
      ...webCacheOpts,
      puppeteer,
      authTimeoutMs: 120000, 
      takeoverOnConflict: false,
      qrMaxRetries: 3,
      takeoverTimeoutMs: 60000,
    } as any);

    this.bindClientEvents(client, instanceId, storeId);

    try {
      this.logger.log(`Initializing WhatsApp client for ${instanceId}`);
      await client.initialize();

      if (this.deletedInstances.has(instanceId)) {
        this.logger.log(`Instance ${instanceId} was deleted during initialization, cleaning up`);
        await this.cleanupClient(instanceId);
        throw new ErrorResponse('Instance was deleted during initialization', 400);
      }

      this.clients.set(instanceId, client);
      this.ensureStrongHealthPolling(instanceId, storeId);
      this.logger.log(`Successfully initialized client for ${instanceId}`);
      return client;
    } catch (error: any) {
      this.logger.error(`initialize() failed for ${instanceId}: ${error?.message}`);

      try {
        await this.cleanupClient(instanceId);
      } catch (cleanupError: any) {
        this.logger.warn(`Failed to cleanup after initialization error: ${cleanupError?.message}`);
      }

      throw new ErrorResponse(`Erro ao inicializar cliente WhatsApp: ${error?.message}`, 500);
    }
  }

  private bindClientEvents(client: Client, instanceId: string, storeId: string): void {
    client.on('qr', (qr) => this.currentQrCodes.set(instanceId, qr));

    client.on('ready', () => {
      this.logger.log(`WhatsApp ready: ${instanceId}`);
      this.currentQrCodes.delete(instanceId);
      this.events.emit('integration.success', { storeId, plataforma: IntegrationsEnum.WHATSAPP });
      this.startLightHealth(instanceId);
    });

    client.on('auth_failure', async (msg) => {
      this.logger.warn(`Auth failure for ${instanceId}: ${msg}`);
      await this.cleanupClient(instanceId);

      try { await this.authStrategyFactory.deleteRemoteSession(instanceId); } catch (e: any) {
        this.logger.warn(`Failed to delete remote session (pg): ${e?.message}`);
      }

      await clearAllSessions(instanceId, storeId, this.redisService);
    });

    client.on('call', async (call) => {
      try {
        if (this.receiver.isHistoricalEvent(call, 'call')) return;

        const contact = await client.getContactById(call.from);
        let profilePicUrl: string | null = null;
        try { profilePicUrl = await (contact as any).getProfilePicUrl?.(); } catch { }
        const idDestApi = call.from.split('@')[0];

        const outgoing: ChatOutgoingMessageDto = {
          storeId,
          idMensagem: `call_${call.id || Date.now()}`,
          idDestinatarioApiExterna: idDestApi,
          mensagem: 'Chamada de voz recebida',
          canal: IntegrationsEnum.WHATSAPP,
          timestamp: new Date(),
          enviadaLoja: false,
          metadados: {
            nome: (contact as any).name || (contact as any).pushname || '',
            celular: idDestApi,
            urlAvatar: profilePicUrl || undefined,
          },
          call: { callId: call.id || `call_${Date.now()}`, duration: 0, status: 'recebida', timestamp: new Date() },
        };
        this.events.emit('call.receive', outgoing);
      } catch (err) {
        this.logger.error(`Error processing incoming call: ${String((err as any)?.message || err)}`);
      }
    });

    client.on('incoming_call' as any, async (call: any) => {
      try {
        if (this.receiver.isHistoricalEvent(call, 'incoming_call')) return;

        const contact = await client.getContactById(call.from);
        let profilePicUrl: string | null = null;
        try { profilePicUrl = await (contact as any).getProfilePicUrl?.(); } catch { }
        const idDestApi = String(call.from || '').split('@')[0];

        const outgoing: ChatOutgoingMessageDto = {
          storeId,
          idMensagem: `call_${call.id || Date.now()}`,
          idDestinatarioApiExterna: idDestApi,
          mensagem: 'Chamada recebida',
          canal: IntegrationsEnum.WHATSAPP,
          timestamp: new Date(),
          enviadaLoja: false,
          metadados: {
            nome: (contact as any).name || (contact as any).pushname || '',
            celular: idDestApi,
            urlAvatar: profilePicUrl || undefined,
          },
          call: { callId: call.id || `call_${Date.now()}`, duration: 0, status: 'recebida', timestamp: new Date() },
        };
        this.events.emit('call.receive', outgoing);
      } catch (err) {
        this.logger.error(`Error processing incoming_call: ${String((err as any)?.message || err)}`);
      }
    });

    client.on('message_reaction' as any, async (reaction: any) => {
      try {
        if (this.receiver.isHistoricalEvent(reaction, 'reaction')) return;

        const emoji: string = reaction?.text || reaction?.reaction || reaction?.emoji || '';
        const originalMsgId: string =
          reaction?.msgId?.id ||
          reaction?.msgId?._serialized ||
          reaction?.parentMsgKey?.id ||
          reaction?.parentMsgKey?._serialized ||
          reaction?.id?.id ||
          String(Date.now());

        const remoteJid: string =
          reaction?.id?.participant ||
          reaction?.id?.remote ||
          reaction?.msgId?.remote ||
          reaction?.from ||
          reaction?.to ||
          '';

        const idDestApi = String(remoteJid || '').split('@')[0];

        let contactName = '';
        let profilePicUrl: string | null = null;
        try {
          const contact = remoteJid ? await client.getContactById(remoteJid) : null;
          if (contact) {
            contactName = (contact as any).name || (contact as any).pushname || '';
            try { profilePicUrl = await (contact as any).getProfilePicUrl?.(); } catch { }
          }
        } catch { }

        const reactionDate = reaction?.timestamp ? new Date(reaction.timestamp * 1000) : new Date();

        const outgoing: ChatOutgoingMessageDto = {
          storeId,
          idMensagem: `reaction_${originalMsgId}`,
          idDestinatarioApiExterna: idDestApi,
          mensagem: emoji,
          mensagemReferencia: originalMsgId,
          canal: IntegrationsEnum.WHATSAPP,
          tipo: MessageTypeEnum.REACTION,
          timestamp: reactionDate,
          enviadaLoja: false,
          metadados: { nome: contactName, celular: idDestApi, urlAvatar: profilePicUrl || undefined },
        } as any;

        this.events.emit('message.receive', outgoing);
      } catch (e) {
        this.logger.warn(`message_reaction handler error: ${String((e as any)?.message || e)}`);
      }
    });

    client.on('message', (message) => {
      if (message.from === 'status@broadcast' || message.isStatus) return;
      if (message.from.endsWith('@g.us')) return;
      if (message.fromMe) return;

      this.logger.log(`[message] from: ${message.from} to: ${message.to} type: ${message.type} | content: ${message.body}`);
      this.receiver.handleIncomingMessage(message as any, instanceId, storeId);
    });

    client.on('message_create', async (message) => {
      const isDirect = !message.isStatus && !message.from.endsWith('@g.us') && message.fromMe && !message.to.endsWith('@g.us');
      if (!isDirect) return;

      try {
        const id = (message.id as any)?.id;
        const lockKey = `message:${instanceId}:${id}`;

        if (!await this.messageQueue.acquireLock(lockKey)) {
          this.logger.warn(`Failed to acquire lock for message ${id}`);
          return;
        }

        try {
          this.logger.log(`[message_create] Processing message id: ${id} to: ${message.to} type: ${message.type}`);

          const pendingMessage = await this.messageQueue.getPendingMessage(instanceId, id);

          if (pendingMessage) {
            let internalId = id ? this.externalToInternalMessageId.get(id) : undefined;
            if (!internalId) {
              const queue = this.recipientToPendingInternalIds.get(message.to);
              if (queue && queue.length > 0) {
                internalId = queue.shift();
                if (!queue.length) this.recipientToPendingInternalIds.delete(message.to);
                else this.recipientToPendingInternalIds.set(message.to, queue);
              }
            }

            this.events.emit('integration.success', {
              storeId,
              plataforma: IntegrationsEnum.WHATSAPP,
              idMensagemExterna: id,
              idMensagem: internalId ?? null,
            });

            await this.messageQueue.removePendingMessage(instanceId, id);
          } else {
            this.receiver.handleIncomingMessage(message as any, instanceId, storeId);
          }
        } finally {
          await this.messageQueue.releaseLock(lockKey);
        }
      } catch (e) {
        this.logger.warn(`message_create handler error: ${String((e as any)?.message || e)}`);
      }
    });

    client.on('message_ack', (msg, ack) => {
      const statusMap: Record<number, string> = {
        [MessageAck.ACK_ERROR]: 'ACK_ERROR',
        [MessageAck.ACK_PENDING]: 'ACK_PENDING',
        [MessageAck.ACK_SERVER]: 'ACK_SERVER',
        [MessageAck.ACK_DEVICE]: 'ACK_DEVICE',
        [MessageAck.ACK_READ]: 'ACK_READ',
        [MessageAck.ACK_PLAYED]: 'ACK_PLAYED'
      };
      const status = statusMap[ack] ?? `ACK_${ack}`;
      this.events.emit('mensagem.status', {
        storeId,
        canal: IntegrationsEnum.WHATSAPP,
        idMensagem: (msg && (msg as any).id && (((msg as any).id.id) || ((msg as any).id._serialized))) || null,
        status,
        timestamp: new Date(),
      });
    });

    client.on('disconnected', async (reason) => {
      this.logger.warn(`Client disconnected: ${instanceId}. reason=${reason}`);

      this.clients.delete(instanceId);
      this.currentQrCodes.delete(instanceId);
      this.clientHealthCache.delete(instanceId);
      this.externalToInternalMessageId.clear();
      this.recipientToPendingInternalIds.clear();
      this.pendingOutgoing.clear();
      
      if (global.gc) {
        global.gc();
      }

      if (this.deletedInstances.has(instanceId)) {
        this.logger.log(`Instance ${instanceId} was deleted, skipping reconnection`);
        return;
      }

      const shouldClearSession = [
        'LOGOUT',
        'Max qrcode retries reached',
        WAState.CONFLICT,
        WAState.UNPAIRED,
        WAState.UNLAUNCHED,
        'CONFLICT',
        'UNPAIRED',
        'UNLAUNCHED'
      ].includes(reason as any);

      if (shouldClearSession) {
        this.logger.log(`Clearing session for ${instanceId} due to: ${reason}`);

        try {
          await this.authStrategyFactory.deleteRemoteSession(instanceId);
        } catch (e: any) {
          this.logger.warn(`Failed to delete remote session (pg): ${e?.message}`);
        }

        await clearAllSessions(instanceId, storeId, this.redisService);
        forceResetSession(instanceId);
      }

      if (!this.deletedInstances.has(instanceId)) {
        const delay = shouldClearSession ? 10000 : 5000;
        this.logger.log(`Scheduling reconnection for ${instanceId} in ${delay}ms`);
        setTimeout(() => {
          if (!this.deletedInstances.has(instanceId)) {
            void this.startClientInternal(instanceId, storeId);
          }
        }, delay);
      }
    });
  }

  private startLightHealth(instanceId: string): void {
    this.stopLightHealth(instanceId);
    const t = setInterval(async () => {
      try {
        const c = this.clients.get(instanceId);
        if (!c) return;
        const state = await this.safeGetState(c);
        if (state !== WAState.CONNECTED) this.logger.warn(`[health] ${instanceId} degraded: ${state}`);
      } catch (e) {
        this.logger.warn(`[health] light probe error (${instanceId}): ${String((e as any)?.message || e)}`);
      }
    }, WhatsappService.HEALTH_CHECK_INTERVAL_MS);
    this.lightHealthTimers.set(instanceId, t);
  }

  private stopLightHealth(instanceId: string): void {
    const t = this.lightHealthTimers.get(instanceId);
    if (t) clearInterval(t);
    this.lightHealthTimers.delete(instanceId);
  }

  private stopStrongHealth(instanceId: string): void {
    const t = this.strongHealthTimers.get(instanceId);
    if (t) clearInterval(t);
    this.strongHealthTimers.delete(instanceId);
  }

  private ensureStrongHealthPolling(instanceId: string, storeId: string): void {
    const existing = this.strongHealthTimers.get(instanceId);
    if (existing) clearInterval(existing);

    const t = setInterval(async () => {
      try {
        if (this.deletedInstances.has(instanceId)) {
          this.logger.log(`[strong-health] stopping for deleted instance ${instanceId}`);
          this.stopStrongHealth(instanceId);
          return;
        }

        const client = this.clients.get(instanceId);
        if (!client) {
          await this.startClientInternal(instanceId, storeId);
          return;
        }
        const state = await this.safeGetState(client);
        const healthy = await this.checkClientHealth(client, false);
        const isUsableState = state === WAState.CONNECTED;

        if (!isUsableState || !healthy) {
          this.logger.warn(`[strong-health] degraded for ${instanceId} (state=${state}, healthy=${healthy}) — recycling client`);
          await this.cleanupClient(instanceId);
          await this.startClientInternal(instanceId, storeId);
        }
      } catch (e) {
        this.logger.error(`[strong-health] error: ${String((e as any)?.message || e)}`);
      }
    }, WhatsappService.HEALTH_CHECK_INTERVAL_MS);

    this.strongHealthTimers.set(instanceId, t);
  }

  private async ensureClientReady(instanceId: string, storeId: string): Promise<Client> {
    let client = this.clients.get(instanceId);
    if (!client) client = await this.getClientLazy(instanceId, storeId);

    const now = Date.now();
    const cached = this.clientHealthCache.get(instanceId);

    if (cached && (now - cached.lastCheck) < WhatsappService.CLIENT_HEALTH_CACHE_TTL && cached.healthy) {
      const state = await this.safeGetState(client);
      if (state === WAState.CONNECTED) {
        return client;
      }
    }

    const state = await this.safeGetState(client);

    const isUsableState = state === WAState.CONNECTED;

    if (isUsableState) {
      const basicHealthy = await this.checkClientHealth(client, false);

      if (basicHealthy) {
        this.clientHealthCache.set(instanceId, { healthy: true, lastCheck: now });
        return client;
      }

      this.logger.warn(`Client ${instanceId} CONNECTED but basic health failed. Waiting for objects to load...`);
      await sleep(5000);

      const retryHealthy = await this.checkClientHealth(client, false);
      if (retryHealthy) {
        this.clientHealthCache.set(instanceId, { healthy: true, lastCheck: now });
        return client;
      }

      this.logger.warn(`Client ${instanceId} CONNECTED but health checks failed. Attempting to use anyway...`);
      this.clientHealthCache.set(instanceId, { healthy: false, lastCheck: now });
      return client;
    }

    if (cached && (now - cached.lastCheck) < WhatsappService.CLIENT_HEALTH_CACHE_TTL && !cached.healthy) {
      this.logger.warn(`Client ${instanceId} recently unhealthy (cached). Attempting recovery...`);
      await this.cleanupClient(instanceId);
      client = await this.startClientInternal(instanceId, storeId);

      let attempts = 0;
      while (attempts < 5) { 
        const newState = await this.safeGetState(client);
        const newHealthy = await this.checkClientHealth(client, false);
        if (newState === WAState.CONNECTED && newHealthy) {
          this.clientHealthCache.set(instanceId, { healthy: true, lastCheck: now });
          return client;
        }
        await sleep(2000); 
        attempts++;
      }

      throw new ErrorResponse('Failed to establish WhatsApp connection after multiple attempts', 500);
    }

    this.logger.warn(`Client ${instanceId} not ready (state=${state}). Recycling...`);
    this.clientHealthCache.set(instanceId, { healthy: false, lastCheck: now });

    await this.cleanupClient(instanceId);
    client = await this.startClientInternal(instanceId, storeId);

    let attempts = 0;
    while (attempts < 5) { 
      const newState = await this.safeGetState(client);
      const newHealthy = await this.checkClientHealth(client, false);
      if (newState === 'CONNECTED' && newHealthy) {
        this.clientHealthCache.set(instanceId, { healthy: true, lastCheck: now });
        return client;
      }
      await sleep(2000);
      attempts++;
    }

    throw new ErrorResponse('Failed to establish WhatsApp connection after multiple attempts', 500);
  }

  private async getClientLazy(instanceId: string, storeId: string): Promise<Client> {
    const existing = this.clients.get(instanceId);
    if (existing) {
      try {
        const state = await this.safeGetState(existing);
        if (state === WAState.CONNECTED && (await this.checkClientHealth(existing))) return existing;
      } catch { }
      await this.cleanupClient(instanceId);
    }
    return this.startClientInternal(instanceId, storeId);
  }

  private async cleanupClient(instanceId: string): Promise<void> {
    this.logger.log(`Cleaning up client ${instanceId}`);
    const client = this.clients.get(instanceId);
    try {
      if (client) {
        try { client.removeAllListeners(); } catch { }

        try {
          if ((client as any).pupPage && !(client as any).pupPage.isClosed()) {

            await (client as any).pupPage.evaluate(() => {
              try {
                localStorage.clear();
                sessionStorage.clear();
                if (window.indexedDB) {
                  indexedDB.databases?.().then(databases => {
                    databases.forEach(db => {
                      if (db.name) indexedDB.deleteDatabase(db.name);
                    });
                  });
                }
              } catch (e) {
                console.warn('Cache cleanup error:', e);
              }
            }).catch(() => {});
            
            await Promise.race([
              (client as any).pupPage.close(), 
              sleep(WhatsappService.CLEANUP_PAGE_TIMEOUT_MS)
            ]);
          }
        } catch (e: any) {
          if (!String(e?.message).includes('Execution context was destroyed')) 
            this.logger.warn(`pupPage.close warning: ${e?.message}`);
        }

        try { 
          await Promise.race([
            client.destroy(), 
            sleep(WhatsappService.CLEANUP_DESTROY_TIMEOUT_MS)
          ]); 
        } catch (e: any) {
          if (!String(e?.message).includes('Execution context was destroyed')) 
            this.logger.warn(`client.destroy warning: ${e?.message}`);
        }

        try {
          if ((client as any).pupBrowser && (client as any).pupBrowser.isConnected()) {
            await Promise.race([
              (client as any).pupBrowser.close(), 
              sleep(WhatsappService.CLEANUP_PAGE_TIMEOUT_MS)
            ]);
          }
        } catch (e: any) {
          if (!String(e?.message).includes('Execution context was destroyed')) 
            this.logger.warn(`pupBrowser.close warning: ${e?.message}`);
        }
      }
    } finally {
      this.clients.delete(instanceId);
      this.currentQrCodes.delete(instanceId);
      this.clientHealthCache.delete(instanceId);
      this.stopLightHealth(instanceId);
      this.stopStrongHealth(instanceId);
      clearTempDirs(instanceId);
      
      if (global.gc) {
        global.gc();
      }
    }
  }

  private async resolveJid(client: Client, phone: string): Promise<string | null> {
    const numberId = await client.getNumberId(phone);
    return numberId?._serialized ?? null;
  }

  private async getOrCreateAuth(storeId: string) {
    const instance = await this.prisma.whatsAppAuthData.findFirst({ where: { storeId } });
    if (instance) {
      this.deletedInstances.delete(instance.instanceId);
      return instance;
    }

    const instanceId = `wpp-${storeId}-${uuidv7()}`;
    const created = await this.prisma.whatsAppAuthData.create({ data: { storeId, instanceId } });
    this.logger.log(`Created WhatsApp auth for store=${storeId}, instanceId=${created.instanceId}`);

    this.deletedInstances.delete(created.instanceId);
    return created;
  }

  private async safeGetState(client: Client): Promise<string> {
    try {
      return await Promise.race([
        client.getState(),
        new Promise<string>((resolve) => setTimeout(() => resolve('TIMEOUT'), WhatsappService.WPP_STATE_TIMEOUT_MS)),
      ]);
    } catch {
      return 'ERROR';
    }
  }

  private async checkClientHealth(client: Client, strict: boolean = false): Promise<boolean> {
    try {
      const page = (client as any).pupPage;
      const browser = (client as any).pupBrowser;

      if (!page || !browser) {
        this.logger.warn('checkClientHealth: Missing page or browser');
        return false;
      }

      try {
        if (page.isClosed()) {
          this.logger.warn('checkClientHealth: Page is closed');
          return false;
        }
      } catch {
        this.logger.warn('checkClientHealth: Cannot check if page is closed');
        return false;
      }

      try {
        if (!browser.isConnected()) {
          this.logger.warn('checkClientHealth: Browser is not connected');
          return false;
        }
      } catch {
        this.logger.warn('checkClientHealth: Cannot check browser connection');
        return false;
      }

      try {
        const timeout = strict ? 20_000 : 15_000;
        
        const ok = await Promise.race([
          page.evaluate((isStrict: boolean) => {
            try {
              const hasWWebJS = !!(window as any).WWebJS;
              const hasStore = !!(window as any).Store;

              if (!hasWWebJS || !hasStore) {
                return false;
              }

              if (!isStrict) {
                return true;
              }


              const hasStoreMsg = !!(window as any).Store.Msg;
              const hasStoreChat = !!(window as any).Store.Chat;
              
              let isLoggedIn = false;
              try {
                isLoggedIn = ((window as any).Store.Me && (window as any).Store.Me.attributes) ||
                           (window as any).Store?.State?.default?.state === 'CONNECTED' ||
                           (window as any).Store?.Conn?.isLoggedIn === true;
              } catch (e) {
                isLoggedIn = document.querySelector('[data-testid="chat"]') !== null;
              }

              return hasStoreMsg && hasStoreChat && isLoggedIn;
            } catch (error) {
              console.warn('Health check evaluation error:', error);
              return false;
            }
          }, strict),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeout))
        ]);

        if (!ok && strict) {
          this.logger.warn('checkClientHealth: WhatsApp Web objects not ready or not logged in');
        }

        return ok === true;
      } catch (e: any) {
        this.logger.warn(`checkClientHealth: Error evaluating page: ${e?.message}`);
        return false;
      }
    } catch (e: any) {
      this.logger.warn(`checkClientHealth error: ${e?.message}`);
      return false;
    }
  }

  private markPendingOutgoing(id: string): void {
    this.pendingOutgoing.add(id);
    setTimeout(() => this.pendingOutgoing.delete(id), WhatsappService.PENDING_OUTGOING_TTL_MS);
  }

  async forceReconnect(storeId: string): Promise<{ ok: boolean; message: string }> {
    this.logger.log(`Force reconnecting WhatsApp for store: ${storeId}`);

    try {
      const whatsappAuth = await this.prisma.whatsAppAuthData.findUnique({
        where: { storeId }
      });

      if (!whatsappAuth) {
        this.logger.warn(`No WhatsApp auth data found for store: ${storeId}`);
        return { ok: false, message: 'No WhatsApp integration found' };
      }

      const instanceId = whatsappAuth.instanceId;

      this.stopLightHealth(instanceId);
      this.stopStrongHealth(instanceId);

      if (this.clients.has(instanceId)) {
        this.logger.log(`Cleaning up existing client for force reconnect: ${instanceId}`);
        const client = this.clients.get(instanceId);
        if (client) {
          try {
            const state = await this.safeGetState(client);
            if (state === WAState.CONNECTED) {
              this.logger.log(`Disconnecting client for ${instanceId}`);
            }
          } catch { }
        }
        await this.cleanupClient(instanceId);
      }

      this.currentQrCodes.delete(instanceId);
      this.clientHealthCache.delete(instanceId);

      await sleep(2000);

      this.logger.log(`Starting fresh connection for ${instanceId}`);
      const newClient = await this.startClientInternal(instanceId, storeId);

      const state = await this.safeGetState(newClient);
      const healthy = await this.checkClientHealth(newClient);

      if (state === WAState.CONNECTED && healthy) {
        this.logger.log(`Successfully force reconnected ${instanceId}`);
        return { ok: true, message: 'Successfully reconnected' };
      } else {
        this.logger.warn(`Force reconnect completed but client not ready: state=${state}, healthy=${healthy}`);
        return { ok: true, message: `Reconnection initiated, awaiting QR code scan` };
      }

    } catch (error: any) {
      this.logger.error(`Error during force reconnect for store ${storeId}:`, error);
      return { ok: false, message: `Failed to reconnect: ${error?.message}` };
    }
  }

  async deleteIntegrationData(storeId: string): Promise<{ ok: boolean }> {
    this.logger.log(`Deleting WhatsApp integration data for store: ${storeId}`);

    try {
      const whatsappAuth = await this.prisma.whatsAppAuthData.findUnique({
        where: { storeId }
      });

      if (!whatsappAuth) {
        this.logger.warn(`No WhatsApp auth data found for store: ${storeId}`);
        return { ok: true };
      }

      const instanceId = whatsappAuth.instanceId;

      this.deletedInstances.add(instanceId);
      this.logger.log(`Marked instance ${instanceId} as deleted`);

      this.currentQrCodes.delete(instanceId);
      this.clientHealthCache.delete(instanceId);
      this.externalToInternalMessageId.clear();
      this.recipientToPendingInternalIds.clear();
      this.pendingOutgoing.clear();

      this.initializationQueue = this.initializationQueue.filter(item => item.instanceId !== instanceId);
      this.initializingInstances.delete(instanceId);

      this.stopLightHealth(instanceId);
      this.stopStrongHealth(instanceId);

      if (this.clients.has(instanceId)) {
        this.logger.log(`Cleaning up active client for instance: ${instanceId}`);
        const client = this.clients.get(instanceId);
        if (client) {
          try {
            const state = await this.safeGetState(client);
            if (state === WAState.CONNECTED) {
              this.logger.log(`Attempting graceful logout for ${instanceId}`);
              try {
                await client.logout();
                await sleep(2000);
              } catch (e: any) {
                this.logger.warn(`Graceful logout failed: ${e?.message}`);
              }
            }
          } catch { }
        }
        await this.cleanupClient(instanceId);
      }

      this.logger.log(`Clearing all session data for ${instanceId}`);
      await clearAllSessions(instanceId, storeId, this.redisService);

      try {
        await this.authStrategyFactory.deleteRemoteSession(instanceId);
      } catch (e: any) {
        this.logger.warn(`Failed to delete remote session: ${e?.message}`);
      }

      forceResetSession(instanceId);

      clearTempDirs(instanceId);

      await this.prisma.whatsAppAuthData.delete({
        where: { storeId }
      });

      setTimeout(() => {
        this.deletedInstances.delete(instanceId);
        this.logger.log(`Removed ${instanceId} from deleted instances tracking`);
      }, 30_000);

      this.logger.log(`Successfully deleted WhatsApp integration data for store: ${storeId}`);
      return { ok: true };

    } catch (error: any) {
      this.logger.error(`Error deleting WhatsApp integration data for store ${storeId}:`, error);
      throw new ErrorResponse(`Failed to delete WhatsApp integration data: ${error?.message}`, 500);
    }
  }
}
