import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RedisService } from './redis.service';
import { IntegrationsStatusEnum } from 'src/core/integrations/enum/integrations-status.enum';
import { IntegrationsEnum } from 'src/core/integrations/enum/integrations.enum';

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
export class HealthCacheService implements OnModuleInit {
    private readonly logger = new Logger(HealthCacheService.name);

    private readonly healthCache = new Map<string, HealthStatus>();
    private readonly circuitBreakers = new Map<string, CircuitBreakerState>();

    private static readonly CACHE_TTL_MS = 120_000;
    private static readonly CIRCUIT_FAILURE_THRESHOLD = 10;
    private static readonly CIRCUIT_TIMEOUT_MS = 30_000;
    private static readonly MAX_CACHE_SIZE = 1000;
    private static readonly CLEANUP_INTERVAL_MS = 5 * 60_000;

    constructor(private readonly redis: RedisService) { }

    async onModuleInit(): Promise<void> {
        this.circuitBreakers.clear();
        this.healthCache.clear();

        setInterval(() => this.cleanupExpiredEntries(), HealthCacheService.CLEANUP_INTERVAL_MS);
    }

    async getCachedHealth(integration: IntegrationsEnum, storeId: string): Promise<HealthStatus | null> {
        const key = this.buildKey(integration, storeId);
        const now = Date.now();

        if (this.isCircuitOpen(key)) {
            const cached = this.healthCache.get(key);
            if (cached && cached.status === IntegrationsStatusEnum.OK) {
                this.logger.debug(`Circuit breaker OPEN but using last known good state for ${integration}:${storeId}`);
                return {
                    ...cached,
                    message: 'Using last known good state - service may be unstable',
                    timestamp: now
                };
            }

            this.logger.debug(`Circuit breaker OPEN for ${integration}:${storeId}`);
            return {
                status: IntegrationsStatusEnum.ERROR,
                message: 'Circuit breaker active - service temporarily unavailable',
                timestamp: now,
                checks: 0
            };
        }

        const cached = this.healthCache.get(key);
        if (!cached) {
            return null;
        }

        const age = now - cached.timestamp;

        if (age > HealthCacheService.CACHE_TTL_MS) {
            if (cached.status === IntegrationsStatusEnum.OK) {
                this.logger.debug(`Extended cache TTL for healthy service ${integration}:${storeId}`);
                return {
                    ...cached,
                    timestamp: now,
                    message: 'Using extended cache - service assumed stable'
                };
            }
            this.healthCache.delete(key);
            return null;
        }

        this.logger.debug(`Cache HIT for ${integration}:${storeId} (age: ${age}ms)`);
        return cached;
    }

    async cacheHealth(
        integration: IntegrationsEnum,
        storeId: string,
        status: IntegrationsStatusEnum,
        message?: string | null
    ): Promise<void> {
        const key = this.buildKey(integration, storeId);
        this.updateCircuitBreaker(key, status === IntegrationsStatusEnum.OK);

        if (this.healthCache.size >= HealthCacheService.MAX_CACHE_SIZE) {
            this.cleanupOldestEntries();
        }

        const healthStatus: HealthStatus = {
            status,
            message,
            timestamp: Date.now(),
            checks: (this.healthCache.get(key)?.checks || 0) + 1
        };

        this.healthCache.set(key, healthStatus);

        this.logger.debug(`Cache SET for ${integration}:${storeId} - Status: ${status}`);
    }

    private isCircuitOpen(key: string): boolean {
        const breaker = this.circuitBreakers.get(key);
        if (!breaker) return false;

        const now = Date.now();

        switch (breaker.state) {
            case 'OPEN':
                if (now >= breaker.nextAttempt) {
                    breaker.state = 'HALF_OPEN';
                    this.logger.debug(`Circuit breaker HALF_OPEN for ${key}`);
                    return false;
                }
                return true;

            case 'HALF_OPEN':
                return false;

            case 'CLOSED':
            default:
                return false;
        }
    }

    private updateCircuitBreaker(key: string, success: boolean): void {
        let breaker = this.circuitBreakers.get(key);
        if (!breaker) {
            breaker = {
                failures: 0,
                lastFailure: 0,
                state: 'CLOSED',
                nextAttempt: 0
            };
        }

        const now = Date.now();

        if (success) {
            if (breaker.state === 'HALF_OPEN') {
                breaker.state = 'CLOSED';
                breaker.failures = 0;
                this.logger.log(`Circuit breaker CLOSED for ${key} - Service recovered`);
            } else if (breaker.state === 'CLOSED') {
                breaker.failures = Math.max(0, breaker.failures - 2);
            }
        } else {
            const timeSinceLastFailure = now - breaker.lastFailure;

            if (timeSinceLastFailure > HealthCacheService.CIRCUIT_TIMEOUT_MS * 2) {
                breaker.failures = Math.max(0, breaker.failures - 1);
            }

            breaker.failures++;
            breaker.lastFailure = now;

            if (breaker.failures >= HealthCacheService.CIRCUIT_FAILURE_THRESHOLD) {
                if (breaker.state !== 'OPEN') {
                    breaker.state = 'OPEN';
                    const multiplier = Math.min(3, 1 + (breaker.failures - HealthCacheService.CIRCUIT_FAILURE_THRESHOLD) / 5);
                    breaker.nextAttempt = now + (HealthCacheService.CIRCUIT_TIMEOUT_MS * multiplier);
                    this.logger.warn(`Circuit breaker OPEN for ${key} - ${breaker.failures} failures - Timeout: ${multiplier}x`);
                }
            }
        }

        this.circuitBreakers.set(key, breaker);
    }

    async invalidateCache(integration: IntegrationsEnum, storeId: string): Promise<void> {
        const key = this.buildKey(integration, storeId);
        this.healthCache.delete(key);
        this.logger.debug(`Cache INVALIDATED for ${integration}:${storeId}`);
    }

    getCircuitBreakerStats(): Array<{ key: string; state: CircuitBreakerState }> {
        return Array.from(this.circuitBreakers.entries()).map(([key, state]) => ({
            key,
            state: { ...state }
        }));
    }

    private buildKey(integration: IntegrationsEnum, storeId: string): string {
        const sanitizedStoreId = String(storeId).replace(/[^a-zA-Z0-9-_]/g, '');
        return `health:${integration}:${sanitizedStoreId}`;
    }

    private cleanupExpiredEntries(): void {
        const now = Date.now();
        let removed = 0;

        for (const [key, health] of this.healthCache.entries()) {
            if (now - health.timestamp > HealthCacheService.CACHE_TTL_MS) {
                this.healthCache.delete(key);
                removed++;
            }
        }

        if (removed > 0) {
            this.logger.debug(`Cleaned up ${removed} expired cache entries`);
        }
    }

    private cleanupOldestEntries(): void {
        const entries = Array.from(this.healthCache.entries());
        entries.sort(([, a], [, b]) => a.timestamp - b.timestamp);

        const toRemove = Math.floor(entries.length * 0.1);
        for (let i = 0; i < toRemove; i++) {
            this.healthCache.delete(entries[i][0]);
        }

        this.logger.debug(`Cleaned up ${toRemove} oldest cache entries to prevent memory bloat`);
    }

    async clearIntegrationCache(integration: IntegrationsEnum, storeId: string): Promise<void> {
        const key = this.buildKey(integration, storeId);

        const hadCache = this.healthCache.has(key);
        this.healthCache.delete(key);

        if (this.circuitBreakers.has(key)) {
            this.circuitBreakers.delete(key);
        }

        try {
            const redisKey = `health_cache:${key}`;
            await this.redis.getClient().del(redisKey);
            this.logger.log(`Cache cleared for integration ${integration}:${storeId} - Memory: ${hadCache}, Redis: cleared`);
        } catch (error) {
            this.logger.warn(`Failed to clear Redis cache for ${integration}:${storeId}:`, error);
        }
    }

    async clearStoreCache(storeId: string): Promise<void> {
        let clearedCount = 0;
        const pattern = `*:${storeId}`;

        for (const [key] of this.healthCache) {
            if (key.endsWith(`:${storeId}`)) {
                this.healthCache.delete(key);
                this.circuitBreakers.delete(key);
                clearedCount++;
            }
        }

        try {
            const redisPattern = `health_cache:*:${storeId}`;
            const keys = await this.redis.getClient().keys(redisPattern);
            if (keys.length > 0) {
                await this.redis.getClient().del(...keys);
            }
            this.logger.log(`Store cache cleared for ${storeId} - Memory: ${clearedCount} entries, Redis: ${keys.length} keys`);
        } catch (error) {
            this.logger.warn(`Failed to clear Redis store cache for ${storeId}:`, error);
        }
    }

    async forceHealthRefresh(integration: IntegrationsEnum, storeId: string): Promise<void> {
        await this.clearIntegrationCache(integration, storeId);
        this.logger.log(`Forced health refresh for ${integration}:${storeId}`);
    }

    resetCircuitBreaker(integration: IntegrationsEnum, storeId: string): void {
        const key = this.buildKey(integration, storeId);
        if (this.circuitBreakers.has(key)) {
            this.circuitBreakers.delete(key);
            this.logger.log(`Circuit breaker reset for ${integration}:${storeId}`);
        }
    }

    async clearAllCache(): Promise<void> {
        const memoryCount = this.healthCache.size;

        this.healthCache.clear();
        this.circuitBreakers.clear();

        try {
            const keys = await this.redis.getClient().keys('health_cache:*');
            if (keys.length > 0) {
                await this.redis.getClient().del(...keys);
            }
            this.logger.warn(`ALL CACHE CLEARED - Memory: ${memoryCount} entries, Redis: ${keys.length} keys`);
        } catch (error) {
            this.logger.error('Failed to clear all Redis cache:', error);
        }
    }

    getCacheStats(): {
        memoryEntries: number;
        circuitBreakers: number;
        oldestEntry?: number;
        newestEntry?: number;
    } {
        const entries = Array.from(this.healthCache.values());
        const timestamps = entries.map(e => e.timestamp);

        return {
            memoryEntries: this.healthCache.size,
            circuitBreakers: this.circuitBreakers.size,
            oldestEntry: timestamps.length > 0 ? Math.min(...timestamps) : undefined,
            newestEntry: timestamps.length > 0 ? Math.max(...timestamps) : undefined,
        };
    }
}
