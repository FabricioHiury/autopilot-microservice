import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { BullModule } from '@nestjs/bull';
import { RedisHealthService } from './redis-health.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'token-renewal',
    }),
  ],
  controllers: [
    HealthController
  ],
  providers: [
    RedisHealthService
  ],
})
export class HealthModule { }