import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../base/service/prisma.service';
import { RedisService } from '../../base/service/redis.service';
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}
  @Get() live() {
    return { status: 'ok' };
  }
  @Get('ready') async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      if (!(await this.redis.isHealthy())) throw new Error('Redis unavailable');
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException('Database or Redis unavailable');
    }
  }
  @Get('redis') async redisHealth() {
    return {
      service: 'redis',
      status: (await this.redis.isHealthy()) ? 'up' : 'down',
    };
  }
}
