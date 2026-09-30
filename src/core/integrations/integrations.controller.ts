import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import { OlxSaveClientDto } from 'src/core/olx/dto/olx-save-client.dto';
import { ApiKeyGuard } from 'src/base/guard/api-key.guard';
import { SaveInstagramIntegrationDto } from 'src/core/instagram/dto/save-integration.dto';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WhatsappSaveIntegrationDto } from 'src/core/whatsapp/dto/save-integration.dto';
import { SaveFacebookIntegrationDto } from '../facebook/dto/save-integration.dto';
import { SkipSerializer } from 'src/base/decorators/skip-serializer.decorator';

@ApiTags('Integrations')
@UseGuards(ApiKeyGuard)
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) { }

  @ApiOperation({
    summary: 'Lists all available integrations',
  })
  @Get()
  listAvailableIntegrations() {
    return this.integrationsService.listAvailableIntegrations();
  }

  @ApiOperation({
    summary: 'Returns WhatsApp QR code for authentication',
  })
  @Get('/whatsapp/qrcode/store/:storeId')
  async getWhatsappQrCode(@Param('storeId') storeId: string) {
    return await this.integrationsService.getWhatsappQrCode(storeId);
  }

  @ApiOperation({
    summary: 'Saves a store in the system',
  })
  @Post('/:storeId')
  async saveStore(@Param('storeId') storeId: string) {
    return await this.integrationsService.saveStore(storeId);
  }

  @ApiOperation({
    summary: 'Deletes a store and all its integrations',
  })
  @Delete('/:storeId')
  async deleteStore(@Param('storeId') storeId: string) {
    return await this.integrationsService.deleteStore(storeId);
  }

  @ApiOperation({
    summary: 'Gets the status of all integrations for a store',
  })
  @Get('/:storeId/status')
  async getIntegrationStatus(@Param('storeId') storeId: string) {
    return await this.integrationsService.getIntegrationStatus(storeId);
  }

  @ApiOperation({
    summary: 'Configures WhatsApp integration',
  })
  @Put('/whatsapp')
  async saveWhatsappIntegration(@Body() params: WhatsappSaveIntegrationDto) {
    return await this.integrationsService.saveWhatsappIntegration(params);
  }

  @ApiOperation({
    summary: 'Configures WhatsApp Official API integration',
  })
  @Put('/whatsapp/official')
  async saveWhatsappOfficialIntegration(@Body() params: any) {
    return await this.integrationsService.saveWhatsappOfficialIntegration(params);
  }

  @ApiOperation({
    summary: 'Get WhatsApp API type (official or unofficial)',
  })
  @Get('/whatsapp/:storeId/api-type')
  async getWhatsappApiType(@Param('storeId') storeId: string) {
    const apiType = await this.integrationsService.getWhatsappApiType(storeId);
    return { apiType };
  }

  @ApiOperation({
    summary: 'Get available phone numbers for WhatsApp Business Account',
  })
  @SkipSerializer()
  @Get('/whatsapp/official/phone-numbers')
  async getWhatsappOfficialPhoneNumbers(
    @Query('wabaId') wabaId: string,
    @Query('accessToken') accessToken: string,
  ) {
    if (!wabaId || !accessToken) {
      return { 
        success: false, 
        error: 'WABA ID and Access Token are required' 
      };
    }
    
    return await this.integrationsService.getWhatsappOfficialPhoneNumbers(wabaId, accessToken);
  }

  @ApiOperation({
    summary: 'Remove WhatsApp Official API integration',
  })
  @Delete('/whatsapp/official/:storeId')
  async removeWhatsappOfficialIntegration(@Param('storeId') storeId: string) {
    console.log(`[IntegrationsController] Received DELETE /whatsapp/official/${storeId}`);
    const result = await this.integrationsService.removeWhatsappOfficialIntegration(storeId);
    console.log(`[IntegrationsController] WhatsApp Official removal result:`, result);
    return result;
  }

  @ApiOperation({
    summary: 'Configures Instagram integration',
  })
  @Put('/instagram')
  async saveInstagramIntegration(@Body() params: SaveInstagramIntegrationDto) {
    return await this.integrationsService.saveInstagramIntegration(params);
  }

  @ApiOperation({
    summary: 'Configures Facebook integration',
  })
  @ApiExcludeEndpoint()
  @Put('/facebook')
  async saveFacebookIntegration(@Body() params: SaveFacebookIntegrationDto) {
    return await this.integrationsService.saveFacebookIntegration(params);
  }

  @ApiOperation({
    summary: 'Removes Facebook integration',
  })
  @Delete('/facebook/:storeId')
  async removeFacebookIntegration(@Param('storeId') storeId: string) {
    return await this.integrationsService.removeFacebookIntegration(storeId);
  }

  @ApiOperation({
    summary: 'Removes Instagram integration',
  })
  @Delete('/instagram/:storeId')
  async removeInstagramIntegration(@Param('storeId') storeId: string) {
    return await this.integrationsService.removeInstagramIntegration(storeId);
  }

  @ApiOperation({
    summary: 'Configures OLX integration',
  })
  @Put('/olx')
  async saveOlxIntegration(@Body() params: OlxSaveClientDto) {
    return await this.integrationsService.saveOlxIntegration(params);
  }

  @ApiOperation({
    summary: 'Deactivates OLX integration',
    description: 'Keeps data but disables webhook reception',
  })
  @Delete('/:storeId/olx/deactivate')
  async removeOlxIntegration(@Param('storeId') storeId: string) {
    return await this.integrationsService.removeOlxIntegration(storeId);
  }

  @ApiOperation({
    summary: 'Get optimization metrics',
    description: 'Returns performance metrics for health checks and caching',
  })
  @Get('/performance-metrics')
  async getPerformanceMetrics() {
    return await this.integrationsService.getPerformanceMetrics();
  }

  @ApiOperation({
    summary: 'Clear cache for specific integration',
    description: 'Clears cache and circuit breaker for a specific integration',
  })
  @Post('/:storeId/:channel/clear-cache')
  async clearIntegrationCache(
    @Param('storeId') storeId: string,
    @Param('channel') channel: string
  ) {
    await this.integrationsService.clearIntegrationCache(channel as any, storeId);
    return { success: true, message: `Cache cleared for ${channel}` };
  }

  @ApiOperation({
    summary: 'Clear all cache for store',
    description: 'Clears all integration cache for a specific store',
  })
  @Post('/:storeId/clear-cache')
  async clearStoreCache(@Param('storeId') storeId: string) {
    await this.integrationsService.clearStoreCache(storeId);
    return { success: true, message: 'All integration cache cleared' };
  }

  @ApiOperation({
    summary: 'Force refresh integration',
    description: 'Forces a fresh health check bypassing cache',
  })
  @Post('/:storeId/:channel/refresh')
  async forceRefreshIntegration(
    @Param('storeId') storeId: string,
    @Param('channel') channel: string
  ) {
    const result = await this.integrationsService.forceRefreshIntegration(channel as any, storeId);
    return { success: true, data: result };
  }

  @ApiOperation({
    summary: 'Remove integration',
    description: 'Removes a specific integration with cache cleanup',
  })
  @Delete('/:storeId/:channel/remove')
  async removeIntegration(
    @Param('storeId') storeId: string,
    @Param('channel') channel: string
  ) {
    await this.integrationsService.removeIntegration(channel as any, storeId);
    return { success: true, message: `Integration ${channel} removed` };
  }

  @ApiOperation({
    summary: 'Get cache statistics',
    description: 'Returns cache statistics for debugging',
  })
  @Get('/cache-stats')
  async getCacheStats() {
    return this.integrationsService.getCacheStats();
  }
}