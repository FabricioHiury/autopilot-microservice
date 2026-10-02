import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { DeliveryJob, Prisma } from '@prisma/client';
import { PrismaService } from '../../base/service/prisma.service';
import { fingerprint, retryDelay } from './delivery.utils';

type Handler = (job: DeliveryJob) => Promise<void>;
@Injectable()
export class DurableQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(DurableQueueService.name);
  private readonly handlers = new Map<string, Handler>();
  private running = false;
  private stopping = false;
  constructor(private readonly prisma: PrismaService) {}
  register(queue: string, kind: string, handler: Handler) {
    this.handlers.set(`${queue}:${kind}`, handler);
  }
  async enqueue(
    queue: string,
    kind: string,
    payload: unknown,
    options: {
      key?: string;
      storeId?: string;
      provider?: string;
      metadata?: unknown;
    } = {},
  ) {
    const json = JSON.parse(JSON.stringify(payload));
    const key = options.key || `${kind}:${fingerprint(json)}`;
    return this.prisma.deliveryJob.upsert({
      where: { queue_key: { queue, key } },
      create: {
        queue,
        key,
        kind,
        payload: json,
        storeId: options.storeId,
        provider: options.provider,
        ...(options.metadata
          ? { metadata: JSON.parse(JSON.stringify(options.metadata)) }
          : {}),
      },
      update: {},
    });
  }
  async acceptWebhook(
    kind: string,
    payload: unknown,
    context: Record<string, unknown> = {},
  ) {
    return this.enqueue(
      'inbox',
      kind,
      { body: payload, ...context },
      { provider: kind, storeId: context.storeId as string | undefined },
    );
  }
  @Interval(5000)
  async tick(): Promise<void> {
    if (this.running || this.stopping || !this.handlers.size) return;
    this.running = true;
    try {
      // Claim one job at a time: no unstarted jobs can expire while another is processing.
      for (let i = 0; i < 20 && !this.stopping; i++) {
        const token = randomUUID();
        const jobs = await this.prisma.$queryRaw<DeliveryJob[]>`
          UPDATE delivery_jobs SET status = 'processing', lease_until = NOW() + INTERVAL '180 seconds',
            lease_token = ${token}, attempts = attempts + 1, updated_at = NOW()
          WHERE id = (SELECT id FROM delivery_jobs
            WHERE (queue || ':' || kind) IN (${Prisma.join([...this.handlers.keys()])})
              AND ((status = 'pending' AND available_at <= NOW()) OR (status = 'processing' AND lease_until < NOW()))
            ORDER BY available_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1)
          RETURNING id, queue, key, store_id AS "storeId", provider, kind, payload, metadata, status, attempts,
            available_at AS "availableAt", lease_until AS "leaseUntil", lease_token AS "leaseToken",
            last_error AS "lastError", created_at AS "createdAt", updated_at AS "updatedAt"`;
        const job = jobs[0];
        if (!job) break;
        const heartbeat = setInterval(() => {
          void this.prisma.deliveryJob
            .updateMany({
              where: { id: job.id, leaseToken: token },
              data: { leaseUntil: new Date(Date.now() + 180000) },
            })
            .catch((e) =>
              this.logger.error(`Lease renewal failed: ${e.message}`),
            );
        }, 30000);
        try {
          const handler = this.handlers.get(`${job.queue}:${job.kind}`);
          if (!handler)
            throw new Error(`No handler for ${job.queue}:${job.kind}`);
          await handler(job);
          await this.prisma.deliveryJob.updateMany({
            where: { id: job.id, leaseToken: token },
            data: {
              status: 'completed',
              leaseUntil: null,
              leaseToken: null,
              lastError: null,
            },
          });
        } catch (error: any) {
          const status = error.response?.status ?? error.getStatus?.();
          const permanent =
            status >= 400 &&
            status < 500 &&
            ![408, 409, 425, 429].includes(status);
          await this.prisma.deliveryJob.updateMany({
            where: { id: job.id, leaseToken: token },
            data: {
              status: permanent ? 'failed' : 'pending',
              availableAt: new Date(Date.now() + retryDelay(job.attempts)),
              leaseUntil: null,
              leaseToken: null,
              lastError: String(error.message || 'Delivery failed').slice(
                0,
                1000,
              ),
            },
          });
          this.logger.warn(
            `Job ${job.id} ${permanent ? 'failed' : 'rescheduled'}`,
          );
        } finally {
          clearInterval(heartbeat);
        }
      }
    } catch (error: any) {
      this.logger.error(`Queue worker failed: ${error.message}`);
    } finally {
      this.running = false;
    }
  }
  async list(storeId?: string) {
    return this.prisma.deliveryJob.findMany({
      where: {
        ...(storeId ? { storeId } : {}),
        status: { in: ['pending', 'failed', 'processing'] },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  }
  async retry(id: string) {
    const result = await this.prisma.deliveryJob.updateMany({
      where: { id, status: { in: ['failed', 'pending'] } },
      data: { status: 'pending', availableAt: new Date(), lastError: null },
    });
    return { requeued: result.count === 1 };
  }
  async onModuleDestroy() {
    this.stopping = true;
    while (this.running)
      await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
