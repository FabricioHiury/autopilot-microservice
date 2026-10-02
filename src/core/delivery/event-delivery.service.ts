import {
  BadRequestException,
  ConflictException,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import axios from 'axios';
import { PrismaService } from '../../base/service/prisma.service';
import { DurableQueueService } from './durable-queue.service';
import { CrmGateway } from './crm.gateway';
import { fingerprint } from './delivery.utils';

export interface IncomingMessageEvent {
  storeId: string;
  eventId: string;
  externalMessageId: string;
  externalContactId: string;
  channel: string;
  timestamp: string;
  text?: string;
  attachmentUrl?: string;
  attachmentType?: string;
  quotedMessageId?: string;
  name?: string;
  externalAdId?: string;
  sentByStore?: boolean;
}
export function normalizeEvent(
  message: any,
  lead = false,
): IncomingMessageEvent {
  const metadata = message.metadata || {};
  const synthetic = `lead:${message.externalId || fingerprint(message)}`;
  const externalMessageId =
    message.externalMessageId ||
    message.messageId ||
    (lead ? synthetic : undefined);
  let text = message.text ?? message.message;
  if (message.location)
    text = [
      text,
      message.location.name,
      message.location.address,
      `https://maps.google.com/?q=${message.location.lat},${message.location.lng}`,
    ]
      .filter(Boolean)
      .join('\n');
  if (message.contacts?.length)
    text = [text, ...message.contacts.map((c) => `${c.name}: ${c.phone}`)]
      .filter(Boolean)
      .join('\n');
  if (message.call)
    text = [
      text,
      `Call: ${message.call.status || 'received'} (${message.call.duration || 0}s)`,
    ]
      .filter(Boolean)
      .join('\n');
  const date = new Date(message.timestamp || message.createdAt);
  if (!Number.isFinite(date.getTime()))
    throw new BadRequestException('Invalid timestamp');
  const timestamp = date.toISOString();
  const result: IncomingMessageEvent = {
    storeId: message.storeId,
    eventId:
      message.eventId || `${message.channel || 'olx'}:${externalMessageId}`,
    externalMessageId,
    externalContactId:
      message.externalContactId || message.phone || message.email,
    channel: message.channel || 'olx',
    timestamp,
    sentByStore: Boolean(message.sentByStore),
    ...(text ? { text } : {}),
    ...(message.attachmentUrl ? { attachmentUrl: message.attachmentUrl } : {}),
    ...(message.attachmentType
      ? { attachmentType: message.attachmentType }
      : {}),
    ...(metadata.name || message.name
      ? { name: metadata.name || message.name }
      : {}),
    ...(metadata.externalAdId || message.listId || message.externalAdId
      ? {
          externalAdId: String(
            metadata.externalAdId || message.listId || message.externalAdId,
          ),
        }
      : {}),
  };
  for (const key of ['eventId', 'externalMessageId', 'externalContactId']) {
    if (
      typeof result[key] !== 'string' ||
      !result[key] ||
      result[key].length > 200
    )
      throw new BadRequestException(`Invalid ${key}`);
  }
  if (!lead && !result.text && !result.attachmentUrl)
    throw new BadRequestException('Message must contain text or an attachment');
  if (
    result.text?.length > 20000 ||
    result.name?.length > 200 ||
    result.attachmentUrl?.length > 2000
  )
    throw new BadRequestException('Incoming event exceeds backend limits');
  return result;
}
@Injectable()
export class EventDeliveryService implements OnModuleInit {
  constructor(
    private readonly queue: DurableQueueService,
    private readonly gateway: CrmGateway,
    private readonly prisma: PrismaService,
  ) {}
  onModuleInit() {
    for (const kind of ['message', 'lead', 'ack'])
      this.queue.register('outbox', kind, async (job) => {
        let payload: any = job.payload;
        if (kind === 'ack' && !payload.messageId) {
          const message = await this.prisma.outboundMessage.findFirst({
            where: {
              storeId: payload.storeId,
              channel: payload.channel,
              externalMessageId: payload.externalMessageId,
            },
          });
          if (!message)
            throw new ConflictException('ACK awaits outbound correlation');
          payload = {
            storeId: payload.storeId,
            messageId: message.messageId,
            externalMessageId: payload.externalMessageId,
            status: payload.status,
          };
        }
        if (
          await this.gateway.deliver(
            kind === 'ack' ? 'message:ack' : `${kind}:incoming`,
            payload,
          )
        )
          return;
        const path =
          kind === 'ack'
            ? '/chat/messages/ack'
            : kind === 'lead'
              ? '/leads/incoming'
              : '/chat/messages/incoming';
        const response = await axios.post(
          `${process.env.AUTOPILOT_URL}${path}`,
          payload,
          {
            headers: { 'x-micro-token': process.env.MICROSERVICE_TOKEN },
            timeout: kind === 'ack' ? 15000 : 30000,
          },
        );
        if (
          kind !== 'ack' &&
          !(
            response.status === 202 &&
            response.data?.data?.accepted === true &&
            response.data.data.eventId === payload.eventId
          )
        ) {
          throw new Error('Backend did not confirm durable acceptance');
        }
      });
  }
  @OnEvent('message.receive', { suppressErrors: false })
  async message(message: any) {
    return this.incoming(message, false);
  }
  @OnEvent('call.receive', { suppressErrors: false })
  async call(message: any) {
    return this.incoming(message, false);
  }
  @OnEvent('lead.receive', { suppressErrors: false })
  async lead(message: any) {
    return this.incoming(message, true);
  }
  private async incoming(message: any, lead: boolean) {
    const payload = normalizeEvent(message, lead);
    if (message.quotedMessageId) {
      const quoted = await this.prisma.outboundMessage.findFirst({
        where: {
          storeId: payload.storeId,
          channel: payload.channel,
          externalMessageId: message.quotedMessageId,
        },
      });
      if (quoted) payload.quotedMessageId = quoted.messageId;
    }
    return this.queue.enqueue('outbox', lead ? 'lead' : 'message', payload, {
      key: `${payload.storeId}:${lead ? 'lead' : 'message'}:${payload.eventId}`,
      storeId: payload.storeId,
      metadata: message.metadata || message.adsInfo || {},
    });
  }
  @OnEvent('message.status', { suppressErrors: false })
  async ack(event: any) {
    const status = String(event.status).toUpperCase();
    if (!['SENT', 'DELIVERED', 'READ', 'FAILED'].includes(status)) return;
    const externalMessageId = event.externalMessageId || event.messageId;
    const payload = {
      storeId: event.storeId,
      externalMessageId,
      channel: event.channel || 'whatsapp',
      status,
    };
    return this.queue.enqueue('outbox', 'ack', payload, {
      storeId: event.storeId,
      key: `${event.storeId}:ack:${payload.channel}:${externalMessageId}:${status}`,
    });
  }
}
