import { PrismaService } from '../../base/service/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
export async function deliverMetaStatuses(
  prisma: PrismaService,
  events: EventEmitter2,
  storeId: string,
  channel: string,
  event: any,
): Promise<void> {
  const receipt = event.delivery || event.read;
  if (!receipt) return;
  const status = event.read ? 'READ' : 'DELIVERED';
  let ids: string[] = receipt.mids || [];
  if (!ids.length && receipt.watermark) {
    const messages = await prisma.outboundMessage.findMany({
      where: {
        storeId,
        channel,
        recipient: event.sender.id,
        status: 'sent',
        externalMessageId: { not: null },
        createdAt: { lte: new Date(receipt.watermark) },
      },
      select: { externalMessageId: true },
    });
    ids = messages.map((message) => message.externalMessageId);
  }
  for (const externalMessageId of ids)
    await events.emitAsync('message.status', {
      storeId,
      channel,
      externalMessageId,
      status,
    });
}
