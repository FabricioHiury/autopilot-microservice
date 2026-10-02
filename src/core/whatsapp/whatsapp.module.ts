import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { EvolutionApiService } from './services/evolution-api.service';
import { EvolutionWebhookController } from './evolution-webhook.controller';
@Module({
  controllers: [WhatsappController, EvolutionWebhookController],
  providers: [WhatsappService, EvolutionApiService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
