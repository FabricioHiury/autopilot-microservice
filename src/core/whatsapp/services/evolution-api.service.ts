import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../../base/service/prisma.service';

@Injectable()
export class EvolutionApiService {
  constructor(private readonly prisma: PrismaService) {}
  async request(method: string, path: string, data?: unknown): Promise<any> {
    if (!process.env.EVOLUTION_API_URL || !process.env.EVOLUTION_API_KEY)
      throw new ServiceUnavailableException('Evolution is not configured');
    const response = await axios.request({
      method,
      url: `${process.env.EVOLUTION_API_URL}${path}`,
      data,
      headers: { apikey: process.env.EVOLUTION_API_KEY },
      timeout: 8000,
      maxContentLength: 30 * 1024 * 1024,
    });
    return response.data;
  }
  async createInstance(storeId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${storeId}))`;
        await tx.store.upsert({
          where: { id: storeId },
          create: { id: storeId },
          update: {},
        });
        const existing = await tx.whatsAppAuthData.findUnique({
          where: { storeId },
        });
        if (existing) return existing;
        const instanceName = storeId;
        const token =
          existing?.instanceToken || randomBytes(32).toString('hex');
        const instances = await this.request(
          'GET',
          `/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`,
        ).catch((error) => {
          if (error.response?.status === 404) return [];
          throw error;
        });
        if (!Array.isArray(instances))
          throw new Error('Invalid Evolution instance list');
        if (
          !instances.some(
            (instance) =>
              (instance.name || instance.instance?.instanceName) ===
              instanceName,
          )
        ) {
          await this.request('POST', '/instance/create', {
            instanceName,
            token,
            qrcode: true,
            integration: 'WHATSAPP-BAILEYS',
            groupsIgnore: true,
            webhook: this.webhookConfig(),
            syncFullHistory: false,
          });
        } else {
          await this.request(
            'POST',
            `/webhook/set/${encodeURIComponent(instanceName)}`,
            { webhook: this.webhookConfig() },
          );
        }
        return tx.whatsAppAuthData.upsert({
          where: { storeId },
          create: {
            storeId,
            instanceName,
            instanceToken: token,
            status: 'connecting',
          },
          update: {},
        });
      },
      { timeout: 30000, maxWait: 5000 },
    );
  }
  private webhookConfig() {
    if (
      !process.env.EVOLUTION_WEBHOOK_TOKEN ||
      !(process.env.EVOLUTION_WEBHOOK_URL || process.env.APP_BASE_URL)
    )
      throw new ServiceUnavailableException(
        'Evolution webhook is not configured',
      );
    return {
      enabled: true,
      url:
        process.env.EVOLUTION_WEBHOOK_URL ||
        `${process.env.APP_BASE_URL}/whatsapp/webhook/evolution`,
      byEvents: false,
      base64: false,
      headers: { 'x-evolution-token': process.env.EVOLUTION_WEBHOOK_TOKEN },
      events: [
        'MESSAGES_UPSERT',
        'MESSAGES_UPDATE',
        'CONNECTION_UPDATE',
        'QRCODE_UPDATED',
      ],
    };
  }
  async instancePath(storeId: string): Promise<string> {
    const auth = await this.prisma.whatsAppAuthData.findUnique({
      where: { storeId },
    });
    if (!auth)
      throw new ServiceUnavailableException(
        'WhatsApp integration is not configured',
      );
    return encodeURIComponent(auth.instanceName);
  }
  async getQrCode(storeId: string) {
    return this.request(
      'GET',
      `/instance/connect/${await this.instancePath(storeId)}`,
    );
  }
  async getConnectionState(storeId: string) {
    return this.request(
      'GET',
      `/instance/connectionState/${await this.instancePath(storeId)}`,
    );
  }
  async sendTextMessage(
    storeId: string,
    phone: string,
    text: string,
    quoted?: any,
  ) {
    return this.request(
      'POST',
      `/message/sendText/${await this.instancePath(storeId)}`,
      { number: phone, text, ...(quoted ? { quoted } : {}) },
    );
  }
  async sendMediaMessage(
    storeId: string,
    phone: string,
    media: string,
    type: string,
    isVoice = false,
    caption?: string,
    quoted?: any,
  ) {
    return this.request(
      'POST',
      `/message/${isVoice ? 'sendWhatsAppAudio' : 'sendMedia'}/${await this.instancePath(storeId)}`,
      {
        number: phone,
        ...(isVoice
          ? { audio: media, encoding: true }
          : { media, mediatype: type, caption }),
        ...(quoted ? { quoted } : {}),
      },
    );
  }
  async logoutInstance(storeId: string) {
    return this.request(
      'DELETE',
      `/instance/logout/${await this.instancePath(storeId)}`,
    );
  }
  async deleteInstance(storeId: string) {
    return this.request(
      'DELETE',
      `/instance/delete/${await this.instancePath(storeId)}`,
    );
  }
  async media(storeId: string, message: any) {
    return this.request(
      'POST',
      `/chat/getBase64FromMediaMessage/${await this.instancePath(storeId)}`,
      { message: { key: message.key }, convertToMp4: false },
    );
  }
}
