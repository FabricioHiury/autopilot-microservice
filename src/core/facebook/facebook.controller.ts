import { DurableQueueService } from '../delivery/durable-queue.service';
import { verifyMetaSignature } from '../delivery/delivery.utils';
import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  RawBodyRequest,
  Req,
  Res,
} from '@nestjs/common';
import { FacebookService } from './facebook.service';
import { ConfigureWebhooksDto } from '../instagram/dto/configure-webhooks.dto';
import { Request, Response } from 'express';
import { FacebookPayload } from './facebook.interfaces';
import { ApiExcludeController } from '@nestjs/swagger';

@ApiExcludeController()
@Controller('facebook/webhooks')
export class FacebookController {
  constructor(
    private readonly facebookService: FacebookService,
    private readonly queue: DurableQueueService,
  ) {}
  onModuleInit() {
    this.queue.register('inbox', 'facebook', async (job) => {
      const data = job.payload as any;
      await this.facebookService.receiveMessage(
        data.body,
        data.signature,
        Buffer.from(data.rawBody, 'base64'),
      );
    });
  }

  @Get('/')
  configureWebhooks(@Query() query: ConfigureWebhooksDto) {
    return this.facebookService.configureWebhooks(query);
  }

  @Post('/')
  async receiveMessage(
    @Body() payload: FacebookPayload,
    @Headers('X-Hub-Signature-256') receivedSignature: string,
    @Res() res: Response,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const body = req.rawBody;

    if (payload?.object !== 'page') {
      return res.sendStatus(404);
    }

    verifyMetaSignature(body, receivedSignature, process.env.META_APP_SECRET);
    await this.queue.acceptWebhook('facebook', payload, {
      signature: receivedSignature,
      rawBody: body.toString('base64'),
    });

    res.sendStatus(200);
  }

  @Get('/auth/access-code')
  async getAccessCode(
    @Query('code') code: string,
    @Query('state') uniqueId: string,
    @Query('error') error: string,
    @Query('error_reason') errorReason: string,
    @Res() res: Response,
  ) {
    const baseUrl = `${process.env.FRONT_URL}/app/configuracoes/integracoes/acesso/facebook`;

    if (error || errorReason === 'user_denied') {
      return res.redirect(`${baseUrl}?erro=cancelado`);
    }

    try {
      await this.facebookService.completeIntegration(code, uniqueId);
      return res.redirect(`${baseUrl}?sucesso=true`);
    } catch {
      return res.redirect(`${baseUrl}?erro=falha`);
    }
  }

  @Post('/deauthenticate')
  async removePermissions(
    @Body() body: { signed_request: string },
    @Res() res: Response,
  ) {
    await this.facebookService.removeStorePermissions(body.signed_request);
    res.sendStatus(200);
  }

  @Post('/delete')
  async processDataDeletion(@Body() body: { signed_request: string }) {
    return await this.facebookService.deleteStoreData(body.signed_request);
  }

  @Get('/delete')
  async checkDataDeletion(@Query('code') code: string) {
    return await this.facebookService.checkDataDeletion(code);
  }
}
