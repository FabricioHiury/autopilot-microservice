import axios from 'axios';
import { EventDeliveryService, normalizeEvent } from './event-delivery.service';
import { fingerprint, matchesSecret } from './delivery.utils';
jest.mock('axios');
const input = {
  storeId: '2e18bdb9-512d-4415-99e5-daa9b446ab10',
  messageId: 'provider-1',
  externalContactId: 'customer',
  channel: 'whatsapp',
  timestamp: '2026-10-01T10:00:00Z',
  text: 'Hello',
  metadata: {
    name: 'Customer',
    externalAdId: 'ad-1',
    sourceDetails: { price: 100 },
  },
};
describe('Backend event contract', () => {
  it.each(['whatsapp', 'instagram', 'facebook', 'olx'])(
    'projects %s events without sending unsupported metadata',
    (channel) => {
      const event = normalizeEvent({ ...input, channel });
      expect(event).toMatchObject({
        externalMessageId: 'provider-1',
        externalContactId: 'customer',
        name: 'Customer',
        externalAdId: 'ad-1',
        channel,
        timestamp: '2026-10-01T10:00:00.000Z',
      });
      expect(event).not.toHaveProperty('metadata');
      expect(event).not.toHaveProperty('messageId');
    },
  );
  it('keeps synthetic lead IDs stable across object ordering and retries', () => {
    const lead = {
      storeId: input.storeId,
      email: 'buyer@example.com',
      createdAt: input.timestamp,
      listId: 'listing',
    };
    expect(normalizeEvent(lead, true).externalMessageId).toBe(
      normalizeEvent(
        {
          listId: 'listing',
          createdAt: input.timestamp,
          email: 'buyer@example.com',
          storeId: input.storeId,
        },
        true,
      ).externalMessageId,
    );
    expect(normalizeEvent(lead, true)).not.toHaveProperty('text');
  });
  it('projects contacts and zero coordinates into valid textual messages', () => {
    expect(
      normalizeEvent({
        ...input,
        text: undefined,
        location: { lat: 0, lng: 0 },
        contacts: [{ name: 'Sam', phone: '123' }],
      }).text,
    ).toContain('0,0');
  });
  it('rejects provider payloads without content or a stable message identifier', () => {
    expect(() => normalizeEvent({ ...input, text: undefined })).toThrow();
    expect(() => normalizeEvent({ ...input, messageId: undefined })).toThrow();
  });
  it('fingerprints optional nulls deterministically and compares secrets safely', () => {
    expect(fingerprint({ b: null, a: 1 })).toBe(fingerprint({ a: 1, b: null }));
    expect(matchesSecret(undefined, undefined)).toBe(false);
    expect(matchesSecret('secret', 'secret')).toBe(true);
  });
});
describe('Durable transport', () => {
  let handlers: Record<string, any>,
    queue: any,
    gateway: any,
    service: EventDeliveryService;
  beforeEach(() => {
    jest.clearAllMocks();
    handlers = {};
    queue = {
      register: jest.fn((q, kind, fn) => {
        handlers[kind] = fn;
      }),
      enqueue: jest.fn(),
    };
    gateway = { deliver: jest.fn().mockResolvedValue(false) };
    service = new EventDeliveryService(queue, gateway, {
      outboundMessage: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any);
    service.onModuleInit();
    process.env.AUTOPILOT_URL = 'http://crm.test';
    process.env.MICROSERVICE_TOKEN = 'secret';
  });
  it('uses a positive websocket acceptance without posting HTTP', async () => {
    gateway.deliver.mockResolvedValue(true);
    await handlers.message({ payload: normalizeEvent(input) });
    expect(axios.post).not.toHaveBeenCalled();
  });
  it('falls back to HTTP after rejected/unavailable socket with the same ID', async () => {
    const payload = normalizeEvent(input);
    (axios.post as jest.Mock).mockResolvedValue({
      status: 202,
      data: { data: { accepted: true, eventId: payload.eventId } },
    });
    await handlers.message({ payload });
    expect(axios.post).toHaveBeenCalledWith(
      'http://crm.test/chat/messages/incoming',
      payload,
      expect.objectContaining({ headers: { 'x-micro-token': 'secret' } }),
    );
  });
  it('does not complete a job on HTTP 200 or a mismatched event confirmation', async () => {
    (axios.post as jest.Mock).mockResolvedValue({
      status: 200,
      data: { data: { accepted: true } },
    });
    await expect(
      handlers.lead({ payload: normalizeEvent(input, true) }),
    ).rejects.toThrow('confirm');
  });
  it('holds an early provider ACK until its CRM UUID is known', async () => {
    await expect(
      handlers.ack({
        payload: {
          storeId: input.storeId,
          externalMessageId: 'early',
          channel: 'whatsapp',
          status: 'READ',
        },
      }),
    ).rejects.toThrow('correlation');
    expect(axios.post).not.toHaveBeenCalled();
  });
});
