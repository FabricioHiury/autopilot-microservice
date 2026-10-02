import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { HealthCacheService } from './health-cache.service';
import { IntegrationsEnum } from '../../core/integrations/enum/integrations.enum';
import { IntegrationsStatusEnum } from '../../core/integrations/enum/integrations-status.enum';
(process.env.TEST_REDIS_URL ? describe : describe.skip)(
  'Shared Redis health cache',
  () => {
    it('shares health, failure counters and reset across independent replicas', async () => {
      const clientA = new Redis(process.env.TEST_REDIS_URL),
        clientB = new Redis(process.env.TEST_REDIS_URL);
      const wrap = (client) => ({
        getClient: () => client,
        del: (key) => client.del(key),
      });
      const a = new HealthCacheService(wrap(clientA) as any),
        b = new HealthCacheService(wrap(clientB) as any);
      const store = randomUUID(),
        channel = IntegrationsEnum.WHATSAPP;
      try {
        await a.cacheHealth(channel, store, IntegrationsStatusEnum.OK);
        expect((await b.getCachedHealth(channel, store)).status).toBe(
          IntegrationsStatusEnum.OK,
        );
        await Promise.all(
          Array.from({ length: 10 }, (_, n) =>
            (n % 2 ? a : b).cacheHealth(
              channel,
              store,
              IntegrationsStatusEnum.ERROR,
            ),
          ),
        );
        expect((await a.getCachedHealth(channel, store)).message).toContain(
          'Circuit breaker',
        );
        await b.clearStoreCache(store);
        expect(await a.getCachedHealth(channel, store)).toBeNull();
      } finally {
        await a.clearStoreCache(store);
        await Promise.all([clientA.quit(), clientB.quit()]);
      }
    });
  },
);
