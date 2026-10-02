import { EvolutionApiService } from './evolution-api.service';
describe('Evolution v2.3.7 instance provisioning', () => {
  it('treats a missing-instance 404 as empty and creates the configured webhook', async () => {
    process.env.EVOLUTION_WEBHOOK_TOKEN = 'webhook-secret';
    process.env.APP_BASE_URL = 'http://gateway';
    const tx: any = {
      $executeRaw: jest.fn(),
      store: { upsert: jest.fn() },
      whatsAppAuthData: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest
          .fn()
          .mockResolvedValue({ storeId: 'store', instanceName: 'store' }),
      },
    };
    const service = new EvolutionApiService({
      $transaction: (fn) => fn(tx),
    } as any);
    const request = jest
      .spyOn(service, 'request')
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockResolvedValueOnce({});
    await service.createInstance('store');
    expect(request).toHaveBeenLastCalledWith(
      'POST',
      '/instance/create',
      expect.objectContaining({
        instanceName: 'store',
        integration: 'WHATSAPP-BAILEYS',
        webhook: expect.objectContaining({
          headers: { 'x-evolution-token': 'webhook-secret' },
          events: expect.arrayContaining(['MESSAGES_UPDATE']),
        }),
      }),
    );
  });
});
