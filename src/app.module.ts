import { ConfigModule } from '@nestjs/config';
import { DeliveryModule } from './core/delivery/delivery.module';
import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { HealthModule } from './core/health-check/health.module';
import { BaseModule } from './base/base.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    DeliveryModule,
    ScheduleModule.forRoot(),
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        username: process.env.REDIS_USERNAME || undefined,
        connectTimeout: 10000,
        maxRetriesPerRequest: 5,
        enableAutoPipelining: false,
        enableOfflineQueue: true,
      },
      defaultJobOptions: {
        attempts: 3,
        removeOnComplete: true,
        removeOnFail: false,
      },
    }),
    HealthModule,
    BaseModule,
    CoreModule,
  ],
})
export class AppModule {}
