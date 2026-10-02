import {
  WhatsappService,
  unwrapMessage,
  evolutionStatus,
} from './whatsapp.service';
describe('Evolution normalization', () => {
  const storeId = '2e18bdb9-512d-4415-99e5-daa9b446ab10';
  let evolution: any, firebase: any, events: any, service: WhatsappService;
  beforeEach(() => {
    evolution = {
      media: jest.fn().mockResolvedValue({
        base64: Buffer.from('decrypted').toString('base64'),
        mimetype: 'image/jpeg',
      }),
    };
    firebase = {
      uploadBufferToPath: jest
        .fn()
        .mockResolvedValue(['path', 'https://storage.test/image']),
    };
    events = { emitAsync: jest.fn() };
    service = new WhatsappService(
      evolution,
      {} as any,
      {} as any,
      firebase,
      events,
      {} as any,
      {} as any,
    );
  });
  it('unwraps ephemeral content and maps provider delivery statuses', () => {
    expect(
      unwrapMessage({
        ephemeralMessage: { message: { conversation: 'Hello' } },
      }),
    ).toEqual({ conversation: 'Hello' });
    expect(evolutionStatus('DELIVERY_ACK')).toBe('DELIVERED');
    expect(evolutionStatus(4)).toBe('READ');
  });
  it('decrypts media and forwards the uploaded URL, never the encrypted provider URL', async () => {
    await (service as any).receive(storeId, {
      key: {
        id: 'message',
        remoteJid: '123@lid',
        remoteJidAlt: '555@s.whatsapp.net',
        fromMe: false,
      },
      messageTimestamp: 1790848800,
      message: {
        imageMessage: {
          url: 'https://encrypted.test',
          mimetype: 'image/jpeg',
          caption: 'Photo',
        },
      },
      pushName: 'Buyer',
    });
    expect(firebase.uploadBufferToPath).toHaveBeenCalledWith(
      Buffer.from('decrypted'),
      'image/jpeg',
      `${storeId}/whatsapp/message`,
    );
    expect(events.emitAsync).toHaveBeenCalledWith(
      'message.receive',
      expect.objectContaining({
        externalContactId: '555',
        attachmentUrl: 'https://storage.test/image',
        text: 'Photo',
      }),
    );
  });
  it('ignores group and broadcast messages', async () => {
    for (const jid of ['group@g.us', 'status@broadcast'])
      await (service as any).receive(storeId, {
        key: { remoteJid: jid },
        message: { conversation: 'Ignore' },
      });
    expect(events.emitAsync).not.toHaveBeenCalled();
  });
  it('does not swallow media failures', async () => {
    evolution.media.mockRejectedValue(new Error('Unavailable'));
    await expect(
      (service as any).receive(storeId, {
        key: { id: 'message', remoteJid: '555@s.whatsapp.net' },
        message: { imageMessage: {} },
      }),
    ).rejects.toThrow('Unavailable');
  });
});
