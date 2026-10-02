import {
  BadRequestException,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../base/service/prisma.service';
import { RedisService } from '../../base/service/redis.service';
import { FirebaseService } from '../../base/service/firebase.service';
import { HealthCacheService } from '../../base/service/health-cache.service';
import { EvolutionApiService } from './services/evolution-api.service';
import { DurableQueueService } from '../delivery/durable-queue.service';
import { SendMessageDto } from '../communication/dto/incoming-message.dto';
import { IntegrationsEnum } from '../integrations/enum/integrations.enum';
import { IntegrationsStatusEnum } from '../integrations/enum/integrations-status.enum';

export function unwrapMessage(message: any): any {
  let content = message || {};
  for (let i = 0; i < 5; i++) {
    const wrapped =
      content.ephemeralMessage ||
      content.viewOnceMessage ||
      content.viewOnceMessageV2 ||
      content.documentWithCaptionMessage;
    if (!wrapped?.message) break;
    content = wrapped.message;
  }
  return content;
}
export function evolutionStatus(value: unknown): string | undefined {
  const statuses: Record<string, string> = {
    '0': 'FAILED',
    '1': 'SENT',
    '2': 'SENT',
    '3': 'DELIVERED',
    '4': 'READ',
    '5': 'READ',
    ERROR: 'FAILED',
    PENDING: 'SENT',
    SERVER_ACK: 'SENT',
    DELIVERY_ACK: 'DELIVERED',
    READ: 'READ',
    PLAYED: 'READ',
  };
  return statuses[String(value).toUpperCase()];
}
@Injectable()
export class WhatsappService implements OnModuleInit {
  constructor(
    private readonly evolution: EvolutionApiService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly firebase: FirebaseService,
    private readonly events: EventEmitter2,
    private readonly queue: DurableQueueService,
    private readonly healthCache: HealthCacheService,
  ) {}
  onModuleInit() {
    this.queue.register('inbox', 'evolution', async (job) => {
      await this.processWebhook((job.payload as any).body);
    });
  }
  async initializeClient(_instanceId: string, storeId: string) {
    return this.evolution.createInstance(storeId);
  }
  async getQrCodeByStoreId(storeId: string) {
    await this.evolution.createInstance(storeId);
    const connection = await this.evolution.getConnectionState(storeId);
    if (connection.instance?.state === 'open')
      return {
        qrCode: { base64: '' },
        message: 'WhatsApp connected',
        status: 'connected',
      };
    const cached = await this.redis.get(`whatsapp:qr:${storeId}`);
    const qr = cached
      ? { base64: cached }
      : await this.evolution.getQrCode(storeId);
    if (qr.base64)
      await this.redis.set(`whatsapp:qr:${storeId}`, qr.base64, 45);
    return {
      qrCode: { base64: qr.base64 || '' },
      message: qr.base64 ? 'Scan the QR code' : 'Waiting for QR code',
      status: qr.base64 ? 'qr_code_generated' : 'connecting',
    };
  }
  async healthCheck(storeId: string) {
    const auth = await this.prisma.whatsAppAuthData.findUnique({
      where: { storeId },
    });
    if (!auth)
      return {
        channel: IntegrationsEnum.WHATSAPP,
        status: IntegrationsStatusEnum.NOT_CONFIGURED,
        message: 'WhatsApp is not configured',
      };
    const response = await this.evolution.getConnectionState(storeId);
    return {
      channel: IntegrationsEnum.WHATSAPP,
      status:
        response.instance?.state === 'open'
          ? IntegrationsStatusEnum.OK
          : IntegrationsStatusEnum.ERROR,
      message: response.instance?.state || 'disconnected',
    };
  }
  async checkNumberExists(storeId: string, phone: string) {
    return this.evolution.request(
      'POST',
      `/chat/whatsappNumbers/${await this.evolution.instancePath(storeId)}`,
      { numbers: [phone] },
    );
  }
  async sendMessage(message: SendMessageDto) {
    const number = message.recipient;
    let quoted: any;
    if (message.quotedMessageId) {
      const record = await this.prisma.outboundMessage.findFirst({
        where: {
          storeId: message.storeId,
          channel: 'whatsapp',
          OR: [
            { messageId: message.quotedMessageId },
            { externalMessageId: message.quotedMessageId },
          ],
        },
      });
      const key =
        record?.providerKey ||
        (record?.externalMessageId
          ? {
              id: record.externalMessageId,
              remoteJid: `${number}@s.whatsapp.net`,
              fromMe: true,
            }
          : null);
      // Incoming provider IDs can be passed by the CRM. Full message can be fetched from Evolution.
      const externalId = record?.externalMessageId || message.quotedMessageId;
      const matches = await this.evolution.request(
        'POST',
        `/chat/findMessages/${await this.evolution.instancePath(message.storeId)}`,
        { where: { key: { id: externalId } }, limit: 1 },
      );
      const original = matches.messages?.records?.[0];
      if (original) quoted = { key: original.key, message: original.message };
      else if (message.type === 'reaction' && key) quoted = { key };
      else
        throw new BadRequestException('Quoted message could not be resolved');
    }
    let response: any;
    const instance = await this.evolution.instancePath(message.storeId);
    if (message.type === 'reaction')
      response = await this.evolution.request(
        'POST',
        `/message/sendReaction/${instance}`,
        { key: quoted.key, reaction: message.text },
      );
    else if (message.latitude != null && message.longitude != null)
      response = await this.evolution.request(
        'POST',
        `/message/sendLocation/${instance}`,
        {
          number,
          latitude: message.latitude,
          longitude: message.longitude,
          name: message.locationName || '',
          address: message.locationAddress || '',
        },
      );
    else if (message.contacts?.length)
      response = await this.evolution.request(
        'POST',
        `/message/sendContact/${instance}`,
        {
          number,
          contact: message.contacts.map((contact) => ({
            fullName: contact.name,
            phoneNumber: contact.phone,
            wuid: contact.phone.replace(/\D/g, ''),
          })),
        },
      );
    else if (message.attachmentUrl) {
      const mime = message.attachmentType || message.type || 'document';
      const type =
        ['image', 'video', 'audio'].find((type) => mime.startsWith(type)) ||
        'document';
      response = await this.evolution.sendMediaMessage(
        message.storeId,
        number,
        message.attachmentUrl,
        type,
        Boolean(message.isVoiceRecording),
        message.text,
        quoted,
      );
    } else
      response = await this.evolution.sendTextMessage(
        message.storeId,
        number,
        message.text,
        quoted,
      );
    if (!response.key?.id)
      throw new Error('Evolution did not return a message ID');
    return { externalMessageId: response.key.id, key: response.key };
  }
  async deleteIntegrationData(storeId: string) {
    const auth = await this.prisma.whatsAppAuthData.findUnique({
      where: { storeId },
    });
    if (!auth) return { ok: true };
    try {
      await this.evolution.logoutInstance(storeId);
    } catch (error: any) {
      if (error.response?.status !== 404) throw error;
    }
    try {
      await this.evolution.deleteInstance(storeId);
    } catch (error: any) {
      if (error.response?.status !== 404) throw error;
    }
    await this.prisma.whatsAppAuthData.deleteMany({ where: { storeId } });
    await this.redis.del(`whatsapp:qr:${storeId}`);
    await this.healthCache.clearIntegrationCache(
      IntegrationsEnum.WHATSAPP,
      storeId,
    );
    return { ok: true };
  }
  async acceptWebhook(body: any) {
    if (!body.instance)
      throw new BadRequestException('Evolution instance is required');
    const auth = await this.prisma.whatsAppAuthData.findUnique({
      where: { instanceName: body.instance },
    });
    if (!auth) throw new UnauthorizedException('Unknown Evolution instance');
    await this.queue.acceptWebhook('evolution', body, {
      storeId: auth.storeId,
    });
    return { accepted: true };
  }
  private async processWebhook(body: any) {
    const auth = await this.prisma.whatsAppAuthData.findUnique({
      where: { instanceName: body.instance },
    });
    if (!auth) return;
    const data = body.data;
    const event = String(body.event).replace(/\./g, '_').toUpperCase();
    if (event === 'CONNECTION_UPDATE') {
      const status =
        data.state === 'open'
          ? 'connected'
          : data.state === 'connecting'
            ? 'connecting'
            : 'disconnected';
      await this.prisma.whatsAppAuthData.update({
        where: { id: auth.id },
        data: {
          status,
          ...(data.phoneNumber ? { phoneNumber: data.phoneNumber } : {}),
        },
      });
      if (status === 'connected')
        await this.redis.del(`whatsapp:qr:${auth.storeId}`);
      await this.healthCache.clearIntegrationCache(
        IntegrationsEnum.WHATSAPP,
        auth.storeId,
      );
    } else if (event === 'QRCODE_UPDATED') {
      const qr = data.qrcode?.base64 || data.base64;
      if (qr) await this.redis.set(`whatsapp:qr:${auth.storeId}`, qr, 45);
    } else if (event === 'MESSAGES_UPDATE') {
      for (const update of Array.isArray(data) ? data : [data]) {
        const status = evolutionStatus(update.status ?? update.update?.status);
        const id = update.key?.id || update.messageId;
        if (id && status)
          await this.events.emitAsync('message.status', {
            storeId: auth.storeId,
            externalMessageId: id,
            channel: 'whatsapp',
            status,
          });
      }
    } else if (event === 'MESSAGES_UPSERT') {
      for (const message of Array.isArray(data) ? data : [data])
        await this.receive(auth.storeId, message);
    }
  }
  private async receive(storeId: string, data: any) {
    const jid = data.key?.remoteJid;
    if (!jid || jid.endsWith('@g.us') || jid.includes('@broadcast')) return;
    const content = unwrapMessage(data.message);
    const extended = content.extendedTextMessage;
    let text =
      content.conversation || extended?.text || content.reactionMessage?.text;
    const media =
      content.imageMessage ||
      content.videoMessage ||
      content.audioMessage ||
      content.documentMessage ||
      content.stickerMessage;
    let attachmentUrl: string | undefined;
    if (media) {
      const decrypted = await this.evolution.media(storeId, data);
      if (!decrypted.base64)
        throw new Error('Evolution did not return decrypted media');
      const buffer = Buffer.from(
        decrypted.base64.replace(/^data:[^,]+,/, ''),
        'base64',
      );
      const mime =
        decrypted.mimetype || media.mimetype || 'application/octet-stream';
      [, attachmentUrl] = await this.firebase.uploadBufferToPath(
        buffer,
        mime,
        `${storeId}/whatsapp/${data.key.id}`,
      );
      text = text || media.caption;
    }
    if (content.locationMessage)
      text = [
        content.locationMessage.name,
        content.locationMessage.address,
        `https://maps.google.com/?q=${content.locationMessage.degreesLatitude},${content.locationMessage.degreesLongitude}`,
      ]
        .filter(Boolean)
        .join('\n');
    if (content.contactMessage)
      text = content.contactMessage.vcard || content.contactMessage.displayName;
    if (content.contactsArrayMessage)
      text = content.contactsArrayMessage.contacts
        .map((contact) => contact.vcard || contact.displayName)
        .join('\n');
    if (!text && !attachmentUrl) return;
    const context = extended?.contextInfo || media?.contextInfo;
    const ad = context?.externalAdReply;
    const sender = data.key.remoteJidAlt || data.senderPn || jid;
    await this.events.emitAsync('message.receive', {
      storeId,
      messageId: data.key.id,
      externalContactId: sender.replace(/@(s.whatsapp.net|lid)$/, ''),
      channel: 'whatsapp',
      timestamp: new Date(
        Number(data.messageTimestamp?.low ?? data.messageTimestamp) * 1000,
      ),
      text,
      attachmentUrl,
      attachmentType: media?.mimetype,
      quotedMessageId: context?.stanzaId,
      sentByStore: Boolean(data.key.fromMe),
      metadata: {
        name: data.key.fromMe ? undefined : data.pushName,
        externalAdId: ad?.sourceType === 'ad' ? ad.sourceId : undefined,
        sourceDetails: ad,
      },
    });
  }
}
