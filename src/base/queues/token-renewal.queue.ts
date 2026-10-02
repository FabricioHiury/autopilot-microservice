import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue, Process, Processor } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../service/prisma.service';
import { IntegrationsEnum } from '../../core/integrations/enum/integrations.enum';
import { InstagramService } from '../../core/instagram/instagram.service';
import { FacebookService } from '../../core/facebook/facebook.service';

@Injectable()
export class TokenRenewalService {
  private readonly logger = new Logger(TokenRenewalService.name);
  constructor(
    @InjectQueue('token-renewal') private tokenRenewalQueue: Queue,
    private readonly prismaService: PrismaService,
  ) {}

  async scheduleTokenRenewal(
    storeId: string,
    platform: IntegrationsEnum,
    delayMs?: number,
  ) {
    const actualDelay =
      delayMs || Math.floor(Math.random() * 12 * 60 * 60 * 1000);

    await this.tokenRenewalQueue.add(
      'renew-token',
      { storeId, platform },
      {
        delay: actualDelay,
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 60000,
        },
        removeOnComplete: true,
      },
    );

    this.logger.log(
      `Token renewal scheduled for store ${storeId} (${platform}) at ${new Date(Date.now() + actualDelay).toLocaleString('pt-BR')}`,
    );

    if (platform === IntegrationsEnum.INSTAGRAM) {
      await this.prismaService.instagramAuthData.update({
        where: { storeId: storeId },
        data: {
          scheduledRenewal: new Date(Date.now() + actualDelay),
        },
      });
    } else if (platform === IntegrationsEnum.FACEBOOK) {
      await this.prismaService.facebookAuthData.update({
        where: { storeId: storeId },
        data: {
          scheduledRenewal: new Date(Date.now() + actualDelay),
        },
      });
    }
  }

  async scheduleBatchTokenRenewals(
    items: Array<{ storeId: string; platform: IntegrationsEnum }>,
  ) {
    this.logger.log(`Scheduling batch renewal for ${items.length} tokens`);

    const groupedByPlatform = items.reduce(
      (acc, item) => {
        const key = item.platform;
        if (!acc[key]) {
          acc[key] = [];
        }
        acc[key].push(item.storeId);
        return acc;
      },
      {} as Record<IntegrationsEnum, string[]>,
    );

    for (const [platform, storeIds] of Object.entries(groupedByPlatform)) {
      const platformEnum = platform as IntegrationsEnum;

      for (let i = 0; i < storeIds.length; i += 5) {
        const batch = storeIds.slice(i, i + 5);

        const batchDelay = Math.floor(Math.random() * 12 * 60 * 60 * 1000);

        await this.tokenRenewalQueue.add(
          'renew-token-batch',
          { storeIds: batch, platform: platformEnum },
          {
            delay: batchDelay,
            attempts: 5,
            backoff: {
              type: 'exponential',
              delay: 60000,
            },
            removeOnComplete: true,
          },
        );

        this.logger.log(
          `Batch of ${batch.length} tokens for ${platform} scheduled for ${new Date(Date.now() + batchDelay).toLocaleString('pt-BR')}`,
        );

        if (platformEnum === IntegrationsEnum.INSTAGRAM) {
          await this.prismaService.instagramAuthData.updateMany({
            where: { storeId: { in: batch } },
            data: {
              scheduledRenewal: new Date(Date.now() + batchDelay),
            },
          });
        } else if (platformEnum === IntegrationsEnum.FACEBOOK) {
          await this.prismaService.facebookAuthData.updateMany({
            where: { storeId: { in: batch } },
            data: {
              scheduledRenewal: new Date(Date.now() + batchDelay),
            },
          });
        }
      }
    }
  }
}

@Processor('token-renewal')
export class TokenRenewalProcessor {
  private readonly logger = new Logger(TokenRenewalProcessor.name);
  constructor(
    private readonly instagramService: InstagramService,
    private readonly facebookService: FacebookService,
    private readonly prismaService: PrismaService,
    private readonly tokenRenewalService: TokenRenewalService,
  ) {}

  @Process('renew-token')
  async handleTokenRenewal(job: {
    data: { storeId: string; platform: IntegrationsEnum };
  }) {
    const { storeId, platform } = job.data;

    try {
      this.logger.log(
        `Starting token renewal for store ${storeId} (${platform})`,
      );

      if (platform === IntegrationsEnum.INSTAGRAM) {
        await this.instagramService.refreshToken(storeId);
      } else if (platform === IntegrationsEnum.FACEBOOK) {
        await this.facebookService.refreshToken(storeId);
      }

      this.logger.log(
        `Token successfully renewed for store ${storeId} (${platform})`,
      );

      let nextRenewalDate: Date | null = null;

      if (platform === IntegrationsEnum.INSTAGRAM) {
        const storeData = await this.prismaService.instagramAuthData.findUnique(
          {
            where: { storeId: storeId },
          },
        );
        nextRenewalDate = storeData?.tokenExpiry;
      } else if (platform === IntegrationsEnum.FACEBOOK) {
        const storeData = await this.prismaService.facebookAuthData.findUnique({
          where: { storeId: storeId },
        });
        nextRenewalDate = storeData?.tokenExpiry;
      }

      if (nextRenewalDate) {
        const renewalDate = new Date(nextRenewalDate);
        renewalDate.setDate(renewalDate.getDate() - 7);

        const delayMs = renewalDate.getTime() - Date.now();

        if (delayMs > 0) {
          await this.tokenRenewalService.scheduleTokenRenewal(
            storeId,
            platform,
            delayMs,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to renew token for store ${storeId} (${platform}):`,
        error,
      );
      throw error;
    }
  }

  /**
   * Process batch token renewal
   */
  @Process('renew-token-batch')
  async handleBatchTokenRenewal(job: {
    data: { storeIds: string[]; platform: IntegrationsEnum };
  }) {
    const { storeIds, platform } = job.data;

    this.logger.log(
      `Starting batch renewal for ${storeIds.length} tokens (${platform})`,
    );

    for (const storeId of storeIds) {
      try {
        if (platform === IntegrationsEnum.INSTAGRAM) {
          await this.instagramService.refreshToken(storeId);
        } else if (platform === IntegrationsEnum.FACEBOOK) {
          await this.facebookService.refreshToken(storeId);
        }

        this.logger.log(
          `Token successfully renewed for store ${storeId} (${platform})`,
        );

        await new Promise((resolve) =>
          setTimeout(resolve, Math.floor(Math.random() * 2000) + 1000),
        );
      } catch (error) {
        this.logger.error(
          `Failed to renew token for store ${storeId} (${platform}):`,
          error,
        );
      }
    }

    for (const storeId of storeIds) {
      try {
        let nextRenewalDate: Date | null = null;

        if (platform === IntegrationsEnum.INSTAGRAM) {
          const storeData =
            await this.prismaService.instagramAuthData.findUnique({
              where: { storeId: storeId },
            });
          nextRenewalDate = storeData?.tokenExpiry;
        } else if (platform === IntegrationsEnum.FACEBOOK) {
          const storeData =
            await this.prismaService.facebookAuthData.findUnique({
              where: { storeId: storeId },
            });
          nextRenewalDate = storeData?.tokenExpiry;
        }

        if (nextRenewalDate) {
          const renewalDate = new Date(nextRenewalDate);
          renewalDate.setDate(renewalDate.getDate() - 7);

          const delayMs = renewalDate.getTime() - Date.now();

          if (delayMs > 0) {
            await this.tokenRenewalService.scheduleTokenRenewal(
              storeId,
              platform,
              delayMs,
            );
          }
        }
      } catch (error) {
        this.logger.error(
          `Failed to schedule next renewal for store ${storeId} (${platform}):`,
          error,
        );
      }
    }

    this.logger.log(`Batch processing completed for ${platform}`);
  }
}
