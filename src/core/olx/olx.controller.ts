import { DurableQueueService } from '../delivery/durable-queue.service';
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { OlxService } from './olx.service';
import { ApiKeyGuard } from '../../base/guard/api-key.guard';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Headers } from '@nestjs/common';
import { OlxReceiveMessageDto } from './dto/olx-receive-message.dto';
import { OlxReceiveLeadDto } from './dto/olx-receive-lead.dto';

@ApiTags('OLX')
@Controller('olx')
export class OlxController {
  constructor(
    private readonly olxService: OlxService,
    private readonly queue: DurableQueueService,
  ) {}
  onModuleInit() {
    this.queue.register('inbox', 'olx-message', async (job) => {
      const data = job.payload as any;
      await this.olxService.receiveMessage(data.uniqueId, data.body);
    });
    this.queue.register('inbox', 'olx-lead', async (job) => {
      const data = job.payload as any;
      await this.olxService.receiveLead(
        data.uniqueId,
        data.body,
        data.authorization,
      );
    });
  }

  @ApiOperation({
    summary: 'Get authentication webhook',
    description:
      'Route for a store to get the authentication webhook address of our application. It is necessary to send this address along with the other data in the initial email sent to OLX.',
  })
  @UseGuards(ApiKeyGuard)
  @Get('/auth/webhook-authentication')
  async getAuthenticationWebhook() {
    return await this.olxService.getAuthenticationWebhook();
  }

  @ApiExcludeEndpoint()
  @Get('/auth/access-key')
  async getAccessKey(
    @Query('code') code: string,
    @Query('state') uniqueId: string,
    @Res() res: Response,
  ) {
    await this.olxService.getAccessKeyAndActivateMessageWebhook(code, uniqueId);

    return res.redirect(
      `${process.env.FRONT_URL}/app/configuracoes/integracoes/acesso/olx?sucesso=true`,
    );
  }

  @ApiExcludeEndpoint()
  @Post('/message/receive/:uniqueId')
  async receiveMessage(
    @Param('uniqueId') uniqueId: string,
    @Body() message: OlxReceiveMessageDto,
  ) {
    await this.olxService.assertWebhookAccess(uniqueId);
    await this.queue.acceptWebhook('olx-message', message, { uniqueId });
    return { accepted: true };
  }

  @ApiExcludeEndpoint()
  @Post('/lead/receive/:uniqueId')
  async receiveLead(
    @Param('uniqueId') uniqueId: string,
    @Body() lead: OlxReceiveLeadDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.olxService.assertWebhookAccess(uniqueId, lead, authorization);
    await this.queue.acceptWebhook('olx-lead', lead, {
      uniqueId,
      authorization,
    });
    return { accepted: true };
  }
}
