import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InstagramService } from './instagram.service';
import { addDays } from 'date-fns';
import { PrismaService } from '../../base/service/prisma.service';
import { IntegrationsEnum } from '../integrations/enum/integrations.enum';
import { TokenRenewalService } from '../../base/queues/token-renewal.queue';

@Injectable()
export class InstagramCronService {
  private readonly logger = new Logger(InstagramCronService.name);
  constructor(
    private readonly prismaService: PrismaService,
    private readonly instagramService: InstagramService,
    private readonly tokenRenewalService: TokenRenewalService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_NOON)
  async scheduleTokenRenewals() {
    const routineStartedAt = new Date().getTime();
    this.logger.log(
      '[Instagram][scheduleTokenRenewals][Info] Instagram token renewal schedule started',
    );

    const tenDaysFromNow = addDays(new Date(), 10);
    const tokensToRenew = await this.prismaService.instagramAuthData.findMany({
      where: {
        tokenExpiry: {
          lte: tenDaysFromNow,
        },
        token: {
          not: null,
        },
        OR: [
          { lastTokenRenewal: null },
          {
            lastTokenRenewal: {
              lt: addDays(new Date(), -1),
            },
          },
        ],
      },
    });

    this.logger.log(
      `[Instagram][scheduleTokenRenewals][Info] Found ${tokensToRenew.length} Instagram tokens to schedule renewal`,
    );

    const batchItems = tokensToRenew.map((store) => ({
      storeId: store.storeId,
      platform: IntegrationsEnum.INSTAGRAM,
    }));

    if (batchItems.length > 0) {
      await this.tokenRenewalService.scheduleBatchTokenRenewals(batchItems);
    }

    const routineFinishedAt = new Date().getTime();
    this.logger.log(
      `[Instagram][scheduleTokenRenewals][Info] Instagram token renewal schedule completed. Duration: ${routineFinishedAt - routineStartedAt}ms`,
    );
  }
}
