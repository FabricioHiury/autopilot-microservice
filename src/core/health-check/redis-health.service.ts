import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisHealthService implements OnModuleInit {
  private readonly logger = new Logger(RedisHealthService.name);
  private redisClient: Redis;

  constructor() {
    this.redisClient = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      connectTimeout: 10000,
      maxRetriesPerRequest: 5,
      retryStrategy: (times) => {
        return Math.min(times * 2000, 20000);
      },
    });
  }

  async onModuleInit() {
    try {
      if (!this.redisClient.status || this.redisClient.status !== 'ready') {
        this.logger.error('Redis connection is not ready!');
        return;
      }

      const pingResult = await this.redisClient.ping();

      if (pingResult === 'PONG') {
        this.logger.log('Redis connection verified successfully!');

        const info = await this.redisClient.info();
        this.logger.log(`Redis version: ${info.split('\n').find((line) => line.startsWith('redis_version'))}`);

        const memory = await this.redisClient.info('memory');
        this.logger.log(`Redis memory: ${memory.split('\n').find((line) => line.startsWith('used_memory_human'))}`);
      } else {
        this.logger.error('Failed to verify Redis connection!');
      }
    } catch (error) {
      this.logger.error(`Error checking Redis connection: ${error.message}`, error.stack);
    }
  }

  async checkHealth(): Promise<boolean> {
    try {
      this.logger.log({
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT || '6379'),
        username: process.env.REDIS_USERNAME,
        password: process.env.REDIS_PASSWORD,
      });
      const pingResult = await this.redisClient.ping();
      return pingResult === 'PONG';
    } catch (error) {
      this.logger.error(`Error checking Redis health: ${error.message}`);
      return false;
    }
  }
}
