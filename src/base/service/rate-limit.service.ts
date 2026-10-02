import {
  Injectable,
  ServiceUnavailableException,
  OnModuleDestroy,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from './prisma.service';

type InstagramMsgType = 'text' | 'media' | 'reply';

@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private readonly redis: Redis;

  private static readonly APP_HOURLY_BASE = 200;
  private static readonly APP_HOURLY_TTL = 3600;
  private static readonly LEADS_DAILY_LIMIT = 4800;
  private static readonly LEADS_DAILY_TTL = 24 * 60 * 60;
  private static readonly IG_SECOND_TTL = 1;
  private static readonly IG_HOURLY_TTL = 3600;
  private static readonly FB_DAILY_TTL = 24 * 60 * 60;

  constructor(private readonly prisma: PrismaService) {
    const host = process.env.REDIS_HOST;
    const portStr = process.env.REDIS_PORT;
    const password = process.env.REDIS_PASSWORD;

    if (!host || !portStr) {
      throw new Error('REDIS_HOST and REDIS_PORT are required.');
    }
    const port = Number(portStr);
    if (Number.isNaN(port)) {
      throw new Error('Invalid REDIS_PORT.');
    }

    this.redis = new Redis({
      host,
      port,
      password,
      username: process.env.REDIS_USERNAME || undefined,
      lazyConnect: true,
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
    });

    this.redis.connect().catch((err) => {
      throw new ServiceUnavailableException(
        `Falha ao conectar no Redis: ${err?.message ?? err}`,
      );
    });
  }

  onModuleDestroy() {
    if (this.redis && this.redis.status !== 'end') {
      this.redis.quit().catch(() => this.redis.disconnect());
    }
  }

  private async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, ttlSeconds);
      }
      return count;
    } catch (err: any) {
      throw new ServiceUnavailableException(
        `Erro no Redis: ${err?.message ?? err}`,
      );
    }
  }

  async checkAppVolumeLimit(): Promise<void> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    let activeUsers = 0;
    try {
      activeUsers = await this.prisma.store.count();
    } catch (err: any) {
      throw new ServiceUnavailableException(
        `Failed to count active stores: ${err?.message ?? err}`,
      );
    }

    const maxCalls = Math.max(
      RateLimitService.APP_HOURLY_BASE * activeUsers,
      RateLimitService.APP_HOURLY_BASE,
    );
    const bucketHour = new Date().toISOString().slice(0, 13);
    const key = `rate:app:hour:${bucketHour}`;

    const calls = await this.incrWithTtl(key, RateLimitService.APP_HOURLY_TTL);
    if (calls > maxCalls) {
      throw new HttpException(
        `Application hourly limit exceeded: ${calls}/${maxCalls}`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async checkLeadsLimit(appId: string): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    const key = `rate:leads:${appId}:day:${day}`;

    const calls = await this.incrWithTtl(key, RateLimitService.LEADS_DAILY_TTL);
    if (calls > RateLimitService.LEADS_DAILY_LIMIT) {
      throw new HttpException(
        `Leads Gen excedido: ${calls}/${RateLimitService.LEADS_DAILY_LIMIT} em 24h`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async checkInstagramRateLimits(
    storeId: string,
    type: InstagramMsgType,
  ): Promise<void> {
    let perSecondLimit: number;
    let perHourLimit: number | null;

    switch (type) {
      case 'text':
        perSecondLimit = 100;
        perHourLimit = null;
        break;
      case 'media':
        perSecondLimit = 10;
        perHourLimit = null;
        break;
      case 'reply':
        perSecondLimit = 100;
        perHourLimit = 750;
        break;
      default:
        throw new ServiceUnavailableException(
          `Invalid Instagram message type: ${type}`,
        );
    }

    const secBucket = Math.floor(Date.now() / 1000);
    const secKey = `rate:ig:${type}:store:${storeId}:sec:${secBucket}`;
    const secCount = await this.incrWithTtl(
      secKey,
      RateLimitService.IG_SECOND_TTL,
    );
    if (secCount > perSecondLimit) {
      throw new HttpException(
        `Instagram ${type}: limite por segundo excedido`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (perHourLimit !== null) {
      const hourBucket = new Date().toISOString().slice(0, 13);
      const hrKey = `rate:ig:${type}:store:${storeId}:hour:${hourBucket}`;
      const hrCount = await this.incrWithTtl(
        hrKey,
        RateLimitService.IG_HOURLY_TTL,
      );
      if (hrCount > perHourLimit) {
        throw new HttpException(
          `Instagram ${type}: limite por hora excedido`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
  }
}
