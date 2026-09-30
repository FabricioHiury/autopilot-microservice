import { Controller, Get, Post, Body, Query, Headers, HttpCode, Res, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { WhatsappOfficialService } from './whatsapp-official.service';
import { Response } from 'express';

@ApiTags('WhatsApp Official')
@Controller('webhook/whatsapp-official')
export class WhatsappOfficialController {
  private readonly logger = new Logger(WhatsappOfficialController.name);
  
  constructor(private readonly whatsappOfficialService: WhatsappOfficialService) {}

  @Get()
  @ApiOperation({ summary: 'Verify WhatsApp webhook' })
  async verifyWebhook(@Query() query: any, @Res() res: Response) {
    try {
      const challenge = await this.whatsappOfficialService.verifyWebhook(query);
      res.type('text/plain');
      res.status(200).send(challenge);
    } catch (error) {
      res.type('text/plain');
      res.status(error.status || 400).send(error.message || 'Verification failed');
    }
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Receive WhatsApp webhook events' })
  async receiveWebhook(
    @Body() body: any,
    @Headers() headers: any,
    @Res() res: Response
  ) {
    this.logger.log('WhatsApp Official webhook POST received');
    try {
      await this.whatsappOfficialService.handleWebhook(body, headers);
      res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
      this.logger.error(`Webhook error: ${error}`);
      res.status(200).send('EVENT_RECEIVED');
    }
  }
}
