import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from 'src/base/service/prisma.service';
import { HealthCacheService, CircuitBreakerState } from 'src/base/service/health-cache.service';

import { FacebookService } from 'src/core/facebook/facebook.service';
import { InstagramService } from 'src/core/instagram/instagram.service';
import { OlxService } from 'src/core/olx/olx.service';
import { WhatsappService } from 'src/core/whatsapp/whatsapp.service';
import { WhatsappOfficialService } from 'src/core/whatsapp-official/whatsapp-official.service';

import { IntegrationsEnum } from 'src/core/integrations/enum/integrations.enum';
import { IntegrationStatusDto } from 'src/core/integrations/dto/integrations-status.dto';

import { WhatsappSaveIntegrationDto } from 'src/core/whatsapp/dto/save-integration.dto';
import { OlxSaveClientDto } from '../olx/dto/olx-save-client.dto';
import { SaveInstagramIntegrationDto } from '../instagram/dto/save-integration.dto';
import { SaveFacebookIntegrationDto } from '../facebook/dto/save-integration.dto';

import { ErrorResponse } from 'src/base/exceptions/error.response.handler';
import { IntegrationsStatusEnum } from './enum/integrations-status.enum';
import { WhatsAppStatusEnum } from '../whatsapp/enum/status.enum';

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly healthCache: HealthCacheService,
    private readonly olxService: OlxService,
    private readonly whatsappService: WhatsappService,
    private readonly whatsappOfficialService: WhatsappOfficialService,
    private readonly instagramService: InstagramService,
    private readonly facebookService: FacebookService,
  ) { }

  @OnEvent('integration.removed')
  async handleIntegrationRemoved(payload: { storeId: string; channel: IntegrationsEnum }) {
    this.logger.log(`Integration removed event received: ${payload.channel} for store ${payload.storeId}`);
    await this.healthCache.clearIntegrationCache(payload.channel, payload.storeId);
  }

  listAvailableIntegrations(): IntegrationsEnum[] {
    return Object.values(IntegrationsEnum);
  }

  async getIntegrationStatus(storeId: string): Promise<IntegrationStatusDto[]> {
    await this.ensureStoreExists(storeId);

    const whatsappApiType = await this.checkWhatsappApiType(storeId);

    const integrations = [];

    if (whatsappApiType === 'official') {
      integrations.push({ enum: IntegrationsEnum.WHATSAPP, service: this.whatsappOfficialService });
    } else {
      integrations.push({ enum: IntegrationsEnum.WHATSAPP, service: this.whatsappService });
    }
    integrations.push({ enum: IntegrationsEnum.OLX, service: this.olxService });
    integrations.push({ enum: IntegrationsEnum.INSTAGRAM, service: this.instagramService });
    integrations.push({ enum: IntegrationsEnum.FACEBOOK, service: this.facebookService });

    const results: IntegrationStatusDto[] = [];


    for (const { enum: integration, service } of integrations) {
      try {
        const cached = await this.healthCache.getCachedHealth(integration, storeId);
        if (cached) {
          results.push({
            channel: integration,
            status: cached.status,
            message: cached.message
          });
          continue;
        }

        this.logger.debug(`Cache MISS for ${integration}:${storeId} - performing health check`);

        const healthResult = await service.healthCheck(storeId);

        await this.healthCache.cacheHealth(
          integration,
          storeId,
          healthResult.status,
          healthResult.message
        );

        results.push(healthResult);

      } catch (error) {
        this.logger.warn(`healthCheck failed for ${integration}:${storeId}: ${(error as Error)?.message ?? error}`);

        await this.healthCache.cacheHealth(
          integration,
          storeId,
          IntegrationsStatusEnum.ERROR,
          'Failed to check integration status.'
        );

        results.push({
          channel: integration,
          status: IntegrationsStatusEnum.ERROR,
          message: 'Failed to check integration status.',
        });
      }
    }

    return results;
  }

  async clearIntegrationCache(integration: IntegrationsEnum, storeId: string): Promise<void> {
    await this.ensureStoreExists(storeId);
    await this.healthCache.clearIntegrationCache(integration, storeId);
    this.logger.log(`Integration cache cleared: ${integration} for store ${storeId}`);
  }

  async clearStoreCache(storeId: string): Promise<void> {
    await this.ensureStoreExists(storeId);
    await this.healthCache.clearStoreCache(storeId);
    this.logger.log(`All integration cache cleared for store ${storeId}`);
  }

  async forceRefreshIntegration(integration: IntegrationsEnum, storeId: string): Promise<IntegrationStatusDto> {
    await this.ensureStoreExists(storeId);

    await this.healthCache.forceHealthRefresh(integration, storeId);

    let service;
    switch (integration) {
      case IntegrationsEnum.WHATSAPP:
        service = this.whatsappService;
        break;
      case IntegrationsEnum.OLX:
        service = this.olxService;
        break;
      case IntegrationsEnum.INSTAGRAM:
        service = this.instagramService;
        break;
      case IntegrationsEnum.FACEBOOK:
        service = this.facebookService;
        break;
      default:
        throw new ErrorResponse('Integration not supported', 400);
    }

    try {
      const healthResult = await service.healthCheck(storeId);

      await this.healthCache.cacheHealth(
        integration,
        storeId,
        healthResult.status,
        healthResult.message
      );

      this.logger.log(`Integration refreshed: ${integration} for store ${storeId} - Status: ${healthResult.status}`);
      return healthResult;
    } catch (error) {
      this.logger.error(`Failed to refresh integration ${integration} for store ${storeId}:`, error);

      const errorResult: IntegrationStatusDto = {
        channel: integration,
        status: IntegrationsStatusEnum.ERROR,
        message: 'Failed to refresh integration status'
      };

      await this.healthCache.cacheHealth(integration, storeId, errorResult.status, errorResult.message);
      return errorResult;
    }
  }

  async removeIntegration(integration: IntegrationsEnum, storeId: string): Promise<void> {
    await this.ensureStoreExists(storeId);

    await this.healthCache.clearIntegrationCache(integration, storeId);

    try {
      switch (integration) {
        case IntegrationsEnum.WHATSAPP:
          const apiType = await this.checkWhatsappApiType(storeId);
          if (apiType === 'official') {
            await this.whatsappOfficialService.deleteIntegrationData(storeId);
            this.logger.log(`WhatsApp Official integration data removed from database for store ${storeId}`);
          } else {
            await this.whatsappService.deleteIntegrationData(storeId);
            this.logger.log(`WhatsApp Unofficial integration data removed from database for store ${storeId}`);
          }
          break;
        case IntegrationsEnum.OLX:
          await this.olxService.deactivateMessageReceivingWebhook(storeId);
          await this.prisma.olxAuthData.deleteMany({ where: { storeId } });
          this.logger.log(`OLX integration data removed from database for store ${storeId}`);
          break;
        case IntegrationsEnum.INSTAGRAM:
          await this.prisma.instagramAuthData.deleteMany({ where: { storeId } });
          this.logger.log(`Instagram integration data removed from database for store ${storeId}`);
          break;
        case IntegrationsEnum.FACEBOOK:
          await this.prisma.facebookAuthData.deleteMany({ where: { storeId } });
          this.logger.log(`Facebook integration data removed from database for store ${storeId}`);
          break;
        default:
          throw new ErrorResponse('Integration not supported', 400);
      }

      this.logger.log(`Integration removed: ${integration} for store ${storeId}`);
      await this.healthCache.clearIntegrationCache(integration, storeId);
    } catch (error) {
      this.logger.error(`Failed to remove integration ${integration} for store ${storeId}:`, error);
      await this.healthCache.clearIntegrationCache(integration, storeId);
      throw error;
    }
  }

  getCacheStats() {
    return this.healthCache.getCacheStats();
  }

  async saveStore(storeId: string): Promise<void> {
    await this.ensureStoreNotExists(storeId);

    try {
      await this.prisma.store.create({ data: { id: storeId } });
    } catch (e) {
      this.logger.error('Error creating store', e as any);
      throw new ErrorResponse('Failed to save store.', 500);
    }
  }

  async deleteStore(storeId: string): Promise<void> {
    await this.ensureStoreExists(storeId);

    try {
      await this.prisma.store.delete({ where: { id: storeId } });
    } catch (e) {
      this.logger.error('Error deleting store', e as any);
      throw new ErrorResponse('Failed to remove store. Check integrations and dependencies.', 409);
    }
  }

  async saveOlxIntegration(params: OlxSaveClientDto): Promise<string> {
    await this.ensureStoreExists(params.storeId);
    return this.olxService.saveOlxClient(params);
  }

  async removeOlxIntegration(storeId: string): Promise<string> {
    await this.ensureStoreExists(storeId);
    return this.olxService.deactivateMessageReceivingWebhook(storeId);
  }

  async saveWhatsappIntegration(params: WhatsappSaveIntegrationDto): Promise<{ status: 'success' }> {
    await this.ensureStoreExists(params.storeId);

    await this.whatsappService.initializeClient(
      params.instanceId,
      params.storeId
    );

    return { status: 'success' };
  }

  async getWhatsappQrCode(storeId: string): Promise<{ qrCode: { base64: string }; mensagem: any; status: WhatsAppStatusEnum }> {
    await this.ensureStoreExists(storeId);
    return this.whatsappService.getQrCodeByStoreId(storeId);
  }

  async saveWhatsappOfficialIntegration(params: any): Promise<{ success: boolean }> {
    await this.ensureStoreExists(params.storeId);
    return this.whatsappOfficialService.saveConfig(params);
  }

  async getWhatsappApiType(storeId: string): Promise<'official' | 'naooficial'> {
    await this.ensureStoreExists(storeId);
    
    const officialAuth = await this.prisma.whatsAppOfficialAuthData.findUnique({
      where: { storeId }
    });
    
    return officialAuth ? 'official' : 'naooficial';
  }

  private async checkWhatsappApiType(storeId: string): Promise<'official' | 'unofficial'> {
    try {
      const officialAuth = await this.prisma.whatsAppOfficialAuthData.findUnique({
        where: { storeId }
      });
      
      return officialAuth ? 'official' : 'unofficial';
    } catch (error) {
      return 'unofficial';
    }
  }

  async removeWhatsappOfficialIntegration(storeId: string): Promise<{ ok: boolean }> {
    await this.ensureStoreExists(storeId);
    return this.whatsappOfficialService.deleteIntegrationData(storeId);
  }

  async getWhatsappOfficialPhoneNumbers(wabaId: string, accessToken: string) {
    return this.whatsappOfficialService.getPhoneNumbers(wabaId, accessToken);
  }

  async saveInstagramIntegration(params: SaveInstagramIntegrationDto): Promise<string> {
    await this.ensureStoreExists(params.storeId);
    return this.instagramService.saveInstagramClient(params.storeId);
  }

  async saveFacebookIntegration(params: SaveFacebookIntegrationDto): Promise<string> {
    await this.ensureStoreExists(params.storeId);
    return this.facebookService.saveFacebookClient(params.storeId);
  }

  async removeFacebookIntegration(storeId: string): Promise<{ ok: boolean }> {
    await this.ensureStoreExists(storeId);
    await this.facebookService.removeIntegration(storeId);
    return { ok: true };
  }

  async removeInstagramIntegration(storeId: string): Promise<{ ok: boolean }> {
    await this.ensureStoreExists(storeId);
    await this.instagramService.removeIntegration(storeId);
    return { ok: true };
  }

  private storeExistsCache = new Map<string, { exists: boolean; timestamp: number }>();
  private static readonly STORE_CACHE_TTL = 5 * 60_000;

  private async ensureStoreExists(storeId: string): Promise<void> {
    const now = Date.now();

    const cached = this.storeExistsCache.get(storeId);
    if (cached && (now - cached.timestamp) < IntegrationsService.STORE_CACHE_TTL && cached.exists) {
      return;
    }

    const store = await this.prisma.store.findUnique({ where: { id: storeId } });

    if (!store) {
      await this.prisma.store.create({ data: { id: storeId } });
      this.storeExistsCache.set(storeId, { exists: true, timestamp: now });
      this.logger.debug(`Created and cached store: ${storeId}`);
    } else {
      this.storeExistsCache.set(storeId, { exists: true, timestamp: now });
    }

    if (this.storeExistsCache.size > 1000) {
      this.cleanupStoreCache();
    }
  }

  private cleanupStoreCache(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [storeId, data] of this.storeExistsCache.entries()) {
      if (now - data.timestamp > IntegrationsService.STORE_CACHE_TTL) {
        this.storeExistsCache.delete(storeId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} expired store cache entries`);
    }
  }

  private async ensureStoreNotExists(storeId: string): Promise<void> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (store) throw new ErrorResponse('This store has already been saved in the system.', 409);
  }

  async getPerformanceMetrics() {
    return {
      healthCache: this.healthCache.getCacheStats(),
      circuitBreakers: this.healthCache.getCircuitBreakerStats(),
      storeCache: {
        size: this.storeExistsCache.size,
        entries: Array.from(this.storeExistsCache.entries()).map(([storeId, data]) => ({
          storeId: storeId.slice(0, 8) + '...',
          age: Date.now() - data.timestamp,
          exists: data.exists
        }))
      },
      timestamp: new Date().toISOString()
    };
  }
}
