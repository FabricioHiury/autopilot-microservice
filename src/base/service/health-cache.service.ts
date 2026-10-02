import { Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';
import { IntegrationsStatusEnum } from '../../core/integrations/enum/integrations-status.enum';
import { IntegrationsEnum } from '../../core/integrations/enum/integrations.enum';
interface HealthStatus {
  status: IntegrationsStatusEnum;
  message?: string | null;
  timestamp: number;
  checks: number;
}
export interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  nextAttempt: number;
}
@Injectable()
export class HealthCacheService {
  constructor(private readonly redis: RedisService) {}
  private key(integration: IntegrationsEnum, storeId: string) {
    return `${integration}:${storeId}`;
  }
  async getCachedHealth(
    integration: IntegrationsEnum,
    storeId: string,
  ): Promise<HealthStatus | null> {
    const key = this.key(integration, storeId);
    const [cached, breaker] = await this.redis
      .getClient()
      .mget(`health_cache:${key}`, `health_breaker:${key}`);
    if (breaker) {
      const state = JSON.parse(breaker) as CircuitBreakerState;
      if (state.state === 'OPEN' && state.nextAttempt > Date.now())
        return {
          status: IntegrationsStatusEnum.ERROR,
          message: 'Circuit breaker active - service temporarily unavailable',
          timestamp: Date.now(),
          checks: 0,
        };
    }
    return cached ? JSON.parse(cached) : null;
  }
  async cacheHealth(
    integration: IntegrationsEnum,
    storeId: string,
    status: IntegrationsStatusEnum,
    message?: string | null,
  ) {
    const key = this.key(integration, storeId);
    // Atomic updates keep failure counts and cache invalidation consistent across replicas.
    await this.redis.getClient().eval(
      `
      local health = cjson.decode(ARGV[1])
      local previous = redis.call('GET', KEYS[1])
      health.checks = previous and (cjson.decode(previous).checks + 1) or 1
      redis.call('SET', KEYS[1], cjson.encode(health), 'EX', 120)
      if ARGV[2] == '1' then
        redis.call('DEL', KEYS[2])
      else
        local current = redis.call('GET', KEYS[2])
        local breaker = current and cjson.decode(current) or {failures=0, state='CLOSED', nextAttempt=0}
        breaker.failures = breaker.failures + 1
        breaker.lastFailure = health.timestamp
        if breaker.failures >= 10 then breaker.state = 'OPEN'; breaker.nextAttempt = health.timestamp + 30000 end
        redis.call('SET', KEYS[2], cjson.encode(breaker), 'EX', 300)
      end
      return 1`,
      2,
      `health_cache:${key}`,
      `health_breaker:${key}`,
      JSON.stringify({ status, message, timestamp: Date.now(), checks: 0 }),
      status === IntegrationsStatusEnum.OK ? '1' : '0',
    );
  }
  async invalidateCache(integration: IntegrationsEnum, storeId: string) {
    await this.redis.del(`health_cache:${this.key(integration, storeId)}`);
  }
  async clearIntegrationCache(integration: IntegrationsEnum, storeId: string) {
    const key = this.key(integration, storeId);
    await this.redis
      .getClient()
      .del(`health_cache:${key}`, `health_breaker:${key}`);
  }
  private async scan(pattern: string) {
    let cursor = '0';
    const keys: string[] = [];
    do {
      const page = await this.redis
        .getClient()
        .scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = page[0];
      keys.push(...page[1]);
    } while (cursor !== '0');
    return [...new Set(keys)];
  }
  async clearStoreCache(storeId: string) {
    for (const channel of Object.values(IntegrationsEnum))
      await this.clearIntegrationCache(channel, storeId);
  }
  async forceHealthRefresh(integration: IntegrationsEnum, storeId: string) {
    await this.clearIntegrationCache(integration, storeId);
  }
  async resetCircuitBreaker(integration: IntegrationsEnum, storeId: string) {
    await this.redis.del(`health_breaker:${this.key(integration, storeId)}`);
  }
  async getCircuitBreakerStats() {
    const keys = await this.scan('health_breaker:*');
    if (!keys.length) return [];
    const values = await this.redis.getClient().mget(...keys);
    return values.flatMap((value, index) =>
      value
        ? [
            {
              key: keys[index],
              state: JSON.parse(value) as CircuitBreakerState,
            },
          ]
        : [],
    );
  }
  async getCacheStats() {
    const keys = await this.scan('health_cache:*');
    const values = keys.length
      ? await this.redis.getClient().mget(...keys)
      : [];
    const timestamps = values
      .filter(Boolean)
      .map((value) => JSON.parse(value).timestamp);
    return {
      memoryEntries: 0,
      redisEntries: keys.length,
      circuitBreakers: (await this.getCircuitBreakerStats()).length,
      oldestEntry: timestamps.length ? Math.min(...timestamps) : undefined,
      newestEntry: timestamps.length ? Math.max(...timestamps) : undefined,
    };
  }
}
