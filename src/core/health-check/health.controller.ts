import { Controller, Get } from '@nestjs/common';
import { RedisHealthService } from './redis-health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly redisHealthService: RedisHealthService) {}

  @Get('redis')
  async checkRedisHealth() {
    const isHealthy = await this.redisHealthService.checkHealth();
    
    return {
      service: 'redis',
      status: isHealthy ? 'up' : 'down',
      timestamp: new Date().toISOString(),
    };
  }
}