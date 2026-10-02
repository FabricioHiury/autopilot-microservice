import { Global, Module } from '@nestjs/common';
import { PrismaService } from './service/prisma.service';
import { FirebaseService } from './service/firebase.service';
import { FileService } from './service/file.service';
import { RedisService } from './service/redis.service';
import { RateLimitService } from './service/rate-limit.service';
import { HealthCacheService } from './service/health-cache.service';

@Global()
@Module({
  providers: [
    PrismaService,
    FirebaseService,
    FileService,
    RedisService,
    RateLimitService,
    HealthCacheService,
  ],
  exports: [
    PrismaService,
    FirebaseService,
    FileService,
    RedisService,
    RateLimitService,
    HealthCacheService,
  ],
})
export class BaseModule {}
