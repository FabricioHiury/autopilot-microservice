import { Test } from '@nestjs/testing';
import { io, Socket } from 'socket.io-client';
import { CrmGateway } from './crm.gateway';

describe('Real Socket.io CRM connection', () => {
  let app: any, gateway: CrmGateway, address: string;
  const sockets: Socket[] = [];
  beforeAll(async () => {
    process.env.MICROSERVICE_TOKEN = 'socket-secret';
    const module = await Test.createTestingModule({
      providers: [CrmGateway],
    }).compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    gateway = app.get(CrmGateway);
    address = `${await app.getUrl()}/crm`;
  });
  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    await app.close();
  });
  it('authenticates the backend connection and confirms persisted event IDs', async () => {
    const client = io(address, {
      transports: ['websocket'],
      auth: { token: 'socket-secret' },
      reconnection: false,
    });
    sockets.push(client);
    await new Promise<void>((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
    });
    client.on('message:incoming', (payload, ack) =>
      ack({ accepted: true, eventId: payload.eventId }),
    );
    expect(
      await gateway.deliver('message:incoming', { eventId: 'persisted-event' }),
    ).toBe(true);
  });
  it('disconnects clients with an invalid secret', async () => {
    const client = io(address, {
      transports: ['websocket'],
      auth: { token: 'wrong' },
      reconnection: false,
    });
    sockets.push(client);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Unauthorized client was not disconnected')),
        2000,
      );
      client.once('disconnect', () => {
        clearTimeout(timer);
        resolve();
      });
      client.once('connect_error', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    expect(client.connected).toBe(false);
  });
});
