import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from 'src/base/service/redis.service';

interface PendingMessage {
    idMensagem: string;
    timestamp: number;
    tentativas: number;
}

@Injectable()
export class MessageQueueService {
    private readonly logger = new Logger(MessageQueueService.name);
    private static readonly MESSAGE_TTL = 60;
    private static readonly MAX_RETRIES = 3;

    constructor(private readonly redis: RedisService) { }

    private getMessageKey(instanceId: string, messageId: string): string {
        return `pending:${instanceId}:${messageId}`;
    }

    async addPendingMessage(instanceId: string, messageId: string): Promise<void> {
        const key = this.getMessageKey(instanceId, messageId);
        const message: PendingMessage = {
            idMensagem: messageId,
            timestamp: Date.now(),
            tentativas: 0
        };

        await this.redis.set(key, JSON.stringify(message), MessageQueueService.MESSAGE_TTL);
    }

    async getPendingMessage(instanceId: string, messageId: string): Promise<PendingMessage | null> {
        const key = this.getMessageKey(instanceId, messageId);
        const data = await this.redis.get(key);
        if (!data) return null;

        try {
            return JSON.parse(data) as PendingMessage;
        } catch (e) {
            this.logger.error(`Error parsing pending message: ${e.message}`);
            return null;
        }
    }

    async incrementRetry(instanceId: string, messageId: string): Promise<boolean> {
        const message = await this.getPendingMessage(instanceId, messageId);
        if (!message) return false;

        message.tentativas++;
        if (message.tentativas > MessageQueueService.MAX_RETRIES) {
            await this.removePendingMessage(instanceId, messageId);
            return false;
        }

        const key = this.getMessageKey(instanceId, messageId);
        await this.redis.set(key, JSON.stringify(message), MessageQueueService.MESSAGE_TTL);
        return true;
    }

    async removePendingMessage(instanceId: string, messageId: string): Promise<void> {
        const key = this.getMessageKey(instanceId, messageId);
        await this.redis.del(key);
    }

    async acquireLock(key: string, ttl: number = 10): Promise<boolean> {
        const lockKey = `lock:${key}`;
        try {
            await this.redis.getClient().set(lockKey, '1', 'EX', ttl, 'NX');
            return true;
        } catch (e) {
            return false;
        }
    }

    async releaseLock(key: string): Promise<void> {
        const lockKey = `lock:${key}`;
        await this.redis.del(lockKey);
    }
}
