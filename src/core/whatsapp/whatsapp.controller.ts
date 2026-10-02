import {
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController, ApiOperation } from '@nestjs/swagger';
import { WhatsappService } from './whatsapp.service';
import { ApiKeyGuard } from '../../base/guard/api-key.guard';

@ApiExcludeController()
@Controller('whatsapp')
@UseGuards(ApiKeyGuard)
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @ApiOperation({
    summary: 'Delete WhatsApp integration data',
    description:
      'Removes all WhatsApp connection data for a store from the microservice database',
  })
  @Delete('/integration/:storeId')
  async deleteIntegrationData(
    @Param('storeId', ParseUUIDPipe) storeId: string,
  ) {
    return await this.whatsappService.deleteIntegrationData(storeId);
  }
}
