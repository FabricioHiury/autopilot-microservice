import { PrismaService } from '../../base/service/prisma.service';
import { DurableQueueService } from './durable-queue.service';
import { CommunicationService } from '../communication/communication.service';
import { randomUUID } from 'crypto';
import { EventDeliveryService } from './event-delivery.service';
import axios from 'axios';
jest.mock('axios');
const databaseDescribe = process.env.TEST_DATABASE_URL
  ? describe
  : describe.skip;
databaseDescribe('PostgreSQL durability and multi-process coordination', () => {
  let prisma: PrismaService,
    workerA: DurableQueueService,
    workerB: DurableQueueService;
  const runId = randomUUID();
  const kind = `test:${runId}`;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
    workerA = new DurableQueueService(prisma);
    workerB = new DurableQueueService(prisma);
  });
  afterAll(async () => {
    await prisma.deliveryJob.deleteMany({
      where: { OR: [{ kind }, { key: { contains: runId } }] },
    });
    await prisma.outboundMessage.deleteMany({ where: { recipient: runId } });
    await prisma.$disconnect();
  });
  it('claims 25 jobs once across two independent workers and deduplicates retries', async () => {
    const seen: string[] = [];
    const handler = async (job) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(job.id);
    };
    workerA.register('test', kind, handler);
    workerB.register('test', kind, handler);
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        workerA.enqueue('test', kind, { n: i }),
      ),
    );
    await workerA.enqueue('test', kind, { n: 1 });
    await Promise.all([workerA.tick(), workerB.tick()]);
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
  });
  it('recovers an expired processing lease with the same persisted payload', async () => {
    const job = await workerA.enqueue('test', kind, { restart: true });
    await prisma.deliveryJob.update({
      where: { id: job.id },
      data: {
        status: 'processing',
        leaseUntil: new Date(0),
        leaseToken: 'dead-process',
      },
    });
    const recovered: any[] = [];
    const restarted = new DurableQueueService(prisma);
    restarted.register('test', kind, async (job) => {
      recovered.push(job.payload);
    });
    await restarted.tick();
    expect(recovered).toContainEqual({ restart: true });
    expect(
      (await prisma.deliveryJob.findUnique({ where: { id: job.id } })).status,
    ).toBe('completed');
  });
  it('serializes simultaneous outbound retries and returns the stored provider ID', async () => {
    let complete: (value: any) => void;
    const provider = {
      sendMessage: jest.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      ),
    };
    const service = new CommunicationService(
      prisma,
      {} as any,
      provider as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const input: any = {
      storeId: randomUUID(),
      messageId: randomUUID(),
      recipient: runId,
      channel: 'whatsapp',
      wppApiType: 'baileys',
      text: 'Hello',
    };
    const first = service.forwardMessageToChannel(input);
    while (!complete) await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(service.forwardMessageToChannel(input)).rejects.toThrow(
      'progress',
    );
    complete({ externalMessageId: `external:${input.messageId}` });
    const result = await first;
    expect(
      await service.forwardMessageToChannel({
        ...input,
        wppApiType: 'evolution',
      }),
    ).toEqual(result);
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    await expect(
      service.forwardMessageToChannel({ ...input, text: 'Changed' }),
    ).rejects.toThrow('different content');
  });
  it('blocks automatic resend after uncertain provider acceptance and restart', async () => {
    const provider = {
      sendMessage: jest
        .fn()
        .mockRejectedValue(new Error('Socket closed after send')),
    };
    const input: any = {
      storeId: randomUUID(),
      messageId: randomUUID(),
      recipient: runId,
      channel: 'whatsapp',
      wppApiType: 'unofficial',
      text: 'Hello',
    };
    await expect(
      new CommunicationService(
        prisma,
        {} as any,
        provider as any,
        {} as any,
        {} as any,
        {} as any,
      ).forwardMessageToChannel(input),
    ).rejects.toThrow('indeterminate');
    await expect(
      new CommunicationService(
        prisma,
        {} as any,
        provider as any,
        {} as any,
        {} as any,
        {} as any,
      ).forwardMessageToChannel(input),
    ).rejects.toThrow('indeterminate');
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    const service = new CommunicationService(
      prisma,
      {} as any,
      provider as any,
      {} as any,
      {} as any,
      {} as any,
    );
    await service.reconcile(
      input.storeId,
      input.messageId,
      `confirmed:${input.messageId}`,
    );
    expect(await service.forwardMessageToChannel(input)).toEqual({
      externalMessageId: `confirmed:${input.messageId}`,
      response: `confirmed:${input.messageId}`,
    });
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
  });
  it('retains early ACKs durably and strips internal correlation fields before delivery', async () => {
    const events = new EventDeliveryService(
      workerA,
      { deliver: jest.fn().mockResolvedValue(false) } as any,
      prisma,
    );
    events.onModuleInit();
    const storeId = randomUUID(),
      externalMessageId = runId,
      messageId = randomUUID();
    process.env.AUTOPILOT_URL = 'http://crm.test';
    await events.ack({
      storeId,
      externalMessageId,
      channel: 'whatsapp',
      status: 'READ',
    });
    await workerA.tick();
    let job = await prisma.deliveryJob.findFirst({
      where: { key: { contains: runId }, kind: 'ack' },
    });
    expect(job.status).toBe('pending');
    expect(axios.post).not.toHaveBeenCalled();
    await prisma.outboundMessage.create({
      data: {
        storeId,
        messageId,
        recipient: runId,
        externalMessageId,
        channel: 'whatsapp',
        provider: 'evolution',
        fingerprint: 'test',
        status: 'sent',
      },
    });
    await prisma.deliveryJob.update({
      where: { id: job.id },
      data: { availableAt: new Date(0) },
    });
    (axios.post as jest.Mock).mockResolvedValue({ status: 200 });
    await workerA.tick();
    expect(axios.post).toHaveBeenCalledWith(
      'http://crm.test/chat/messages/ack',
      { storeId, messageId, externalMessageId, status: 'READ' },
      expect.any(Object),
    );
    job = await prisma.deliveryJob.findUnique({ where: { id: job.id } });
    expect(job.status).toBe('completed');
  });
});
