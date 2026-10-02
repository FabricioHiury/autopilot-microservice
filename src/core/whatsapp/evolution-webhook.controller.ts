import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { matchesSecret } from '../delivery/delivery.utils';
@Controller('whatsapp/webhook/evolution')
export class EvolutionWebhookController {
  constructor(private readonly whatsapp: WhatsappService) {}
  @Post()
  @HttpCode(200)
  accept(@Body() body: any, @Headers('x-evolution-token') token: string) {
    if (!matchesSecret(token, process.env.EVOLUTION_WEBHOOK_TOKEN))
      throw new UnauthorizedException('Invalid Evolution webhook token');
    return this.whatsapp.acceptWebhook(body);
  }
}
