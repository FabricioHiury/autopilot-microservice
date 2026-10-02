import { DurableQueueService } from '../delivery/durable-queue.service';
import { verifyMetaSignature } from '../delivery/delivery.utils';
import { Req, RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Headers,
  HttpCode,
  Res,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { WhatsappOfficialService } from './whatsapp-official.service';
import { Response } from 'express';

@ApiTags('WhatsApp Official')
@Controller('webhook/whatsapp-official')
export class WhatsappOfficialController {
  private readonly logger = new Logger(WhatsappOfficialController.name);

  constructor(
    private readonly whatsappOfficialService: WhatsappOfficialService,
    private readonly queue: DurableQueueService,
  ) {}
  onModuleInit() {
    this.queue.register('inbox', 'whatsapp-official', async (job) => {
      const data = job.payload as any;
      await this.whatsappOfficialService.handleWebhook(data.body, {});
    });
  }

  @Get()
  @ApiOperation({ summary: 'Verify WhatsApp webhook' })
  async verifyWebhook(@Query() query: any, @Res() res: Response) {
    try {
      const challenge = await this.whatsappOfficialService.verifyWebhook(query);
      res.type('text/plain');
      res.status(200).send(challenge);
    } catch (error) {
      res.type('text/plain');
      res
        .status(error.status || 400)
        .send(error.message || 'Verification failed');
    }
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Receive WhatsApp webhook events' })
  async receiveWebhook(
    @Body() body: any,
    @Headers() headers: any,
    @Res() res: Response,
    @Req() req: RawBodyRequest<Request>,
  ) {
    verifyMetaSignature(
      req.rawBody,
      headers['x-hub-signature-256'],
      process.env.META_APP_SECRET,
    );
    await this.queue.acceptWebhook('whatsapp-official', body);
    res.status(200).send('EVENT_RECEIVED');
  }
}
