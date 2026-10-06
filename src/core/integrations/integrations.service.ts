import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../base/service/prisma.service';
import {
  HealthCacheService,
  CircuitBreakerState,
} from '../../base/service/health-cache.service';

import { FacebookService } from '../facebook/facebook.service';
import { InstagramService } from '../instagram/instagram.service';
import { OlxService } from '../olx/olx.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { WhatsappOfficialService } from '../whatsapp-official/whatsapp-official.service';

import { IntegrationsEnum } from './enum/integrations.enum';
import { IntegrationStatusDto } from './dto/integrations-status.dto';

import { WhatsappSaveIntegrationDto } from '../whatsapp/dto/save-integration.dto';
import { OlxSaveClientDto } from '../olx/dto/olx-save-client.dto';
import { SaveInstagramIntegrationDto } from '../instagram/dto/save-integration.dto';
import { SaveFacebookIntegrationDto } from '../facebook/dto/save-integration.dto';

import { ErrorResponse } from '../../base/exceptions/error.response.handler';
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
  ) {}

  @OnEvent('integration.removed')
  async handleIntegrationRemoved(payload: {
    storeId: string;
    channel: IntegrationsEnum;
  }) {
    this.logger.log(
      `Integration removed event received: ${payload.channel} for store ${payload.storeId}`,
    );
    await this.healthCache.clearIntegrationCache(
      payload.channel,
      payload.storeId,
    );
  }

  listAvailableIntegrations(): IntegrationsEnum[] {
    return Object.values(IntegrationsEnum);
  }

  async getIntegrationStatus(storeId: string): Promise<IntegrationStatusDto[]> {
    await this.ensureStoreExists(storeId);

    const whatsappApiType = await this.checkWhatsappApiType(storeId);

    const integrations = [];

    if (whatsappApiType === 'official') {
      integrations.push({
        enum: IntegrationsEnum.WHATSAPP,
        service: this.whatsappOfficialService,
      });
    } else {
      integrations.push({
        enum: IntegrationsEnum.WHATSAPP,
        service: this.whatsappService,
      });
    }
    integrations.push({ enum: IntegrationsEnum.OLX, service: this.olxService });
    integrations.push({
      enum: IntegrationsEnum.INSTAGRAM,
      service: this.instagramService,
    });
    integrations.push({
      enum: IntegrationsEnum.FACEBOOK,
      service: this.facebookService,
    });

    const results: IntegrationStatusDto[] = [];

    for (const { enum: integration, service } of integrations) {
      try {
        const cached = await this.healthCache.getCachedHealth(
          integration,
          storeId,
        );
        if (cached) {
          results.push({
            channel: integration,
            status: cached.status,
            message: cached.message,
          });
          continue;
        }

        this.logger.debug(
          `Cache MISS for ${integration}:${storeId} - performing health check`,
        );

        const healthResult = await service.healthCheck(storeId);

        await this.healthCache.cacheHealth(
          integration,
          storeId,
          healthResult.status,
          healthResult.message,
        );

        results.push(healthResult);
      } catch (error) {
        this.logger.warn(
          `healthCheck failed for ${integration}:${storeId}: ${(error as Error)?.message ?? error}`,
        );

        await this.healthCache.cacheHealth(
          integration,
          storeId,
          IntegrationsStatusEnum.ERROR,
          'Failed to check integration status.',
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

  async clearIntegrationCache(
    integration: IntegrationsEnum,
    storeId: string,
  ): Promise<void> {
    await this.ensureStoreExists(storeId);
    await this.healthCache.clearIntegrationCache(integration, storeId);
    this.logger.log(
      `Integration cache cleared: ${integration} for store ${storeId}`,
    );
  }

  async clearStoreCache(storeId: string): Promise<void> {
    await this.ensureStoreExists(storeId);
    await this.healthCache.clearStoreCache(storeId);
    this.logger.log(`All integration cache cleared for store ${storeId}`);
  }

  async forceRefreshIntegration(
    integration: IntegrationsEnum,
    storeId: string,
  ): Promise<IntegrationStatusDto> {
    await this.ensureStoreExists(storeId);

    await this.healthCache.forceHealthRefresh(integration, storeId);

    let service;
    switch (integration) {
      case IntegrationsEnum.WHATSAPP:
        service =
          (await this.checkWhatsappApiType(storeId)) === 'official'
            ? this.whatsappOfficialService
            : this.whatsappService;
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
        healthResult.message,
      );

      this.logger.log(
        `Integration refreshed: ${integration} for store ${storeId} - Status: ${healthResult.status}`,
      );
      return healthResult;
    } catch (error) {
      this.logger.error(
        `Failed to refresh integration ${integration} for store ${storeId}:`,
        error,
      );

      const errorResult: IntegrationStatusDto = {
        channel: integration,
        status: IntegrationsStatusEnum.ERROR,
        message: 'Failed to refresh integration status',
      };

      await this.healthCache.cacheHealth(
        integration,
        storeId,
        errorResult.status,
        errorResult.message,
      );
      return errorResult;
    }
  }

  async removeIntegration(
    integration: IntegrationsEnum,
    storeId: string,
  ): Promise<void> {
    await this.ensureStoreExists(storeId);

    await this.healthCache.clearIntegrationCache(integration, storeId);

    try {
      switch (integration) {
        case IntegrationsEnum.WHATSAPP:
          const apiType = await this.checkWhatsappApiType(storeId);
          if (apiType === 'official') {
            await this.whatsappOfficialService.deleteIntegrationData(storeId);
            this.logger.log(
              `WhatsApp Official integration data removed from database for store ${storeId}`,
            );
          } else {
            await this.whatsappService.deleteIntegrationData(storeId);
            this.logger.log(
              `WhatsApp Unofficial integration data removed from database for store ${storeId}`,
            );
          }
          break;
        case IntegrationsEnum.OLX:
          await this.olxService.deactivateMessageReceivingWebhook(storeId);
          await this.prisma.olxAuthData.deleteMany({ where: { storeId } });
          this.logger.log(
            `OLX integration data removed from database for store ${storeId}`,
          );
          break;
        case IntegrationsEnum.INSTAGRAM:
          await this.prisma.instagramAuthData.deleteMany({
            where: { storeId },
          });
          this.logger.log(
            `Instagram integration data removed from database for store ${storeId}`,
          );
          break;
        case IntegrationsEnum.FACEBOOK:
          await this.prisma.facebookAuthData.deleteMany({ where: { storeId } });
          this.logger.log(
            `Facebook integration data removed from database for store ${storeId}`,
          );
          break;
        default:
          throw new ErrorResponse('Integration not supported', 400);
      }

      this.logger.log(
        `Integration removed: ${integration} for store ${storeId}`,
      );
      await this.healthCache.clearIntegrationCache(integration, storeId);
    } catch (error) {
      this.logger.error(
        `Failed to remove integration ${integration} for store ${storeId}:`,
        error,
      );
      await this.healthCache.clearIntegrationCache(integration, storeId);
      throw error;
    }
  }

  getCacheStats() {
    return this.healthCache.getCacheStats();
  }

  async saveStore(storeId: string): Promise<void> {
    try {
      await this.prisma.store.upsert({
        where: { id: storeId },
        create: { id: storeId },
        update: {},
      });
    } catch (e) {
      this.logger.error('Error creating store', e as any);
      throw new ErrorResponse('Failed to save store.', 500);
    }
  }

  async deleteStore(storeId: string): Promise<void> {
    await this.ensureStoreExists(storeId);

    try {
      // Remove external sessions before deleting local configuration.
      await this.whatsappService.deleteIntegrationData(storeId);
      await this.whatsappOfficialService.deleteIntegrationData(storeId);
      const olx = await this.prisma.olxAuthData.findUnique({
        where: { storeId },
      });
      if (olx?.accessToken && olx.receiveMessages)
        await this.olxService.deactivateMessageReceivingWebhook(storeId);
      await this.healthCache.clearStoreCache(storeId);
      await this.prisma.store.deleteMany({ where: { id: storeId } });
    } catch (e) {
      this.logger.error('Error deleting store', e as any);
      throw new ErrorResponse(
        'Failed to remove store. Check integrations and dependencies.',
        409,
      );
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

  async saveWhatsappIntegration(
    params: WhatsappSaveIntegrationDto,
  ): Promise<{ status: 'success' }> {
    await this.ensureStoreExists(params.storeId);

    await this.whatsappService.initializeClient(
      params.instanceId,
      params.storeId,
    );

    return { status: 'success' };
  }

  async getWhatsappQrCode(
    storeId: string,
  ): Promise<{ qrCode: { base64: string }; message: string; status: string }> {
    await this.ensureStoreExists(storeId);
    return this.whatsappService.getQrCodeByStoreId(storeId);
  }

  async saveWhatsappOfficialIntegration(
    params: any,
  ): Promise<{ success: boolean }> {
    await this.ensureStoreExists(params.storeId);
    return this.whatsappOfficialService.saveConfig(params);
  }

  async getWhatsappApiType(storeId: string): Promise<'official' | 'evolution'> {
    await this.ensureStoreExists(storeId);

    const officialAuth = await this.prisma.whatsAppOfficialAuthData.findUnique({
      where: { storeId },
    });

    return officialAuth ? 'official' : 'evolution';
  }

  private async checkWhatsappApiType(
    storeId: string,
  ): Promise<'official' | 'unofficial'> {
    try {
      const officialAuth =
        await this.prisma.whatsAppOfficialAuthData.findUnique({
          where: { storeId },
        });

      return officialAuth ? 'official' : 'unofficial';
    } catch (error) {
      return 'unofficial';
    }
  }

  async removeWhatsappOfficialIntegration(
    storeId: string,
  ): Promise<{ ok: boolean }> {
    await this.ensureStoreExists(storeId);
    return this.whatsappOfficialService.deleteIntegrationData(storeId);
  }

  async getWhatsappOfficialPhoneNumbers(wabaId: string, accessToken: string) {
    return this.whatsappOfficialService.getPhoneNumbers(wabaId, accessToken);
  }

  async saveInstagramIntegration(
    params: SaveInstagramIntegrationDto,
  ): Promise<string> {
    await this.ensureStoreExists(params.storeId);
    return this.instagramService.saveInstagramClient(params.storeId);
  }

  async saveFacebookIntegration(
    params: SaveFacebookIntegrationDto,
  ): Promise<string> {
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

  private async ensureStoreExists(storeId: string): Promise<void> {
    await this.prisma.store.upsert({
      where: { id: storeId },
      create: { id: storeId },
      update: {},
    });
  }

  async getPerformanceMetrics() {
    return {
      healthCache: await this.healthCache.getCacheStats(),
      circuitBreakers: await this.healthCache.getCircuitBreakerStats(),
      timestamp: new Date().toISOString(),
    };
  }
}
