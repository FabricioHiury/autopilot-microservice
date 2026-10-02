import { CrmGateway } from './crm.gateway';
describe('CRM websocket gateway', () => {
  beforeEach(() => {
    process.env.MICROSERVICE_TOKEN = 'secret';
  });
  function socket(token: string) {
    const result: any = {
      id: 'one',
      connected: true,
      handshake: { auth: { token }, headers: {} },
      disconnect: jest.fn(),
      timeout: jest.fn(),
      emitWithAck: jest.fn(),
    };
    result.timeout.mockReturnValue(result);
    return result;
  }
  it('rejects unauthorized clients and permits a header token', async () => {
    const gateway = new CrmGateway(),
      bad = socket('wrong');
    gateway.handleConnection(bad);
    expect(bad.disconnect).toHaveBeenCalledWith(true);
    expect(await gateway.deliver('message:incoming', {})).toBe(false);
    const good = socket(undefined);
    good.handshake.headers['x-micro-token'] = 'secret';
    gateway.handleConnection(good);
    good.emitWithAck.mockResolvedValue({ accepted: true, eventId: 'one' });
    expect(await gateway.deliver('message:incoming', { eventId: 'one' })).toBe(
      true,
    );
  });
  it('requires matching IDs and returns false on five-second timeout/rejection', async () => {
    const gateway = new CrmGateway(),
      client = socket('secret');
    gateway.handleConnection(client);
    client.emitWithAck.mockResolvedValue({ accepted: true, eventId: 'other' });
    expect(await gateway.deliver('message:incoming', { eventId: 'one' })).toBe(
      false,
    );
    client.emitWithAck.mockRejectedValue(new Error('timeout'));
    expect(await gateway.deliver('message:incoming', { eventId: 'one' })).toBe(
      false,
    );
    expect(client.timeout).toHaveBeenCalledWith(5000);
    gateway.handleDisconnect(client);
    expect(await gateway.deliver('message:ack', {})).toBe(false);
  });
});
