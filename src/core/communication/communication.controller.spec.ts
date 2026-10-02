import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request = require('supertest');
import { CommunicationController } from './communication.controller';
import { CommunicationService, validateContent } from './communication.service';
import { DurableQueueService } from '../delivery/durable-queue.service';
import { AppInterceptor } from '../../app.interceptor';
const payload = {
  storeId: '2e18bdb9-512d-4415-99e5-daa9b446ab10',
  messageId: '748ac386-857a-4889-9759-110b66a7c9e7',
  recipient: '123',
  channel: 'whatsapp',
  text: 'Hello',
  attachmentUrl: null,
  attachmentType: null,
  quotedMessageId: null,
};
describe('Internal HTTP contract', () => {
  let app: any;
  beforeAll(async () => {
    process.env.MICROSERVICE_TOKEN = 'secret';
    const module = await Test.createTestingModule({
      controllers: [CommunicationController],
      providers: [
        {
          provide: CommunicationService,
          useValue: {
            forwardMessageToChannel: jest.fn().mockResolvedValue({
              externalMessageId: 'external',
              response: 'external',
            }),
          },
        },
        { provide: DurableQueueService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalInterceptors(new AppInterceptor());
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it.each(['x-micro-token', 'x-api-key'])(
    'accepts %s and nullable backend fields',
    async (header) => {
      const response = await request(app.getHttpServer())
        .post('/communication/messages')
        .set(header, 'secret')
        .send({ ...payload, wppApiType: 'baileys' })
        .expect(200);
      expect(response.body.data).toEqual({
        externalMessageId: 'external',
        response: 'external',
      });
    },
  );
  it('rejects unauthenticated calls, non-UUID IDs and Portuguese fields', async () => {
    await request(app.getHttpServer())
      .post('/communication/messages')
      .send(payload)
      .expect(401);
    await request(app.getHttpServer())
      .post('/communication/messages')
      .set('x-micro-token', 'secret')
      .send({ ...payload, messageId: 'bad' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/communication/messages')
      .set('x-micro-token', 'secret')
      .send({ ...payload, mensagem: 'old' })
      .expect(400);
  });
  it('accepts zero coordinates and rejects partial locations', () => {
    expect(() =>
      validateContent({
        ...payload,
        text: null,
        latitude: 0,
        longitude: 0,
      } as any),
    ).not.toThrow();
    expect(() =>
      validateContent({ ...payload, text: null, latitude: 0 } as any),
    ).toThrow();
  });
});
