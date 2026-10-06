import { IntegrationsService } from './integrations.service';
import { IntegrationsStatusEnum } from './enum/integrations-status.enum';
import { IntegrationsEnum } from './enum/integrations.enum';
describe('integration health status', () => {
  it.each([false, true])('preserves not_configured with cache=%s', async (cached) => {
    const result = {channel:IntegrationsEnum.WHATSAPP,status:IntegrationsStatusEnum.NOT_CONFIGURED,message:'Not configured'};
    const cache = {getCachedHealth:jest.fn().mockResolvedValue(cached ? result : null),cacheHealth:jest.fn()};
    const provider = {healthCheck:jest.fn().mockResolvedValue(result)};
    const prisma = {store:{upsert:jest.fn()},whatsAppOfficialAuthData:{findUnique:jest.fn().mockResolvedValue(null)}};
    const service = new IntegrationsService(prisma as any,cache as any,provider as any,provider as any,provider as any,provider as any,provider as any);
    expect((await service.getIntegrationStatus('store')).every(item => item.status === IntegrationsStatusEnum.NOT_CONFIGURED)).toBe(true);
  });
});
