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
import { InstagramService } from './instagram.service';
import { ConfigureWebhooksDto } from './dto/configure-webhooks.dto';
import { InstagramPayload } from './instagram.interfaces';
import { Request, Response } from 'express';
import { ApiExcludeController } from '@nestjs/swagger';

@ApiExcludeController()
@Controller('instagram/webhooks')
export class InstagramController {
  constructor(
    private readonly instagramService: InstagramService,
    private readonly queue: DurableQueueService,
  ) {}
  onModuleInit() {
    this.queue.register('inbox', 'instagram', async (job) => {
      const data = job.payload as any;
      await this.instagramService.receiveMessage(
        data.body,
        data.signature,
        Buffer.from(data.rawBody, 'base64'),
      );
    });
  }

  @Get('/')
  configureWebhooks(@Query() query: ConfigureWebhooksDto) {
    return this.instagramService.configureWebhooks(query);
  }

  @Post('/')
  async receiveMessage(
    @Body() payload: InstagramPayload,
    @Headers() headers: Record<string, string | string[]>,
    @Res() res: Response,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const body = (req as any).rawBody as Buffer | undefined;
    const h = headers || {};
    const signature =
      (h['x-hub-signature-256'] as string) ||
      (h['X-Hub-Signature-256'] as string) ||
      (h['x-hub-signature'] as string) ||
      (h['X-Hub-Signature'] as string);

    verifyMetaSignature(body, signature, process.env.INSTAGRAM_APP_SECRET);
    await this.queue.acceptWebhook('instagram', payload, {
      signature,
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
    const baseUrl = `${process.env.FRONT_URL}/app/configuracoes/integracoes/acesso/instagram`;

    if (error || errorReason === 'user_denied') {
      return res.redirect(`${baseUrl}?erro=cancelado`);
    }

    try {
      await this.instagramService.completeIntegration(code, uniqueId);
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
    await this.instagramService.removeStorePermissions(body.signed_request);
    res.sendStatus(200);
  }

  @Post('/delete')
  async processDataDeletion(
    @Body() body: { signed_request: string },
    @Res() res: Response,
  ) {
    return await this.instagramService.deleteStoreData(body.signed_request);
  }

  @Get('/delete')
  async checkDataDeletion(@Query('code') code: string) {
    return await this.instagramService.checkDataDeletion(code);
  }
}
