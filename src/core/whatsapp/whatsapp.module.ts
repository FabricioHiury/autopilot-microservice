import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappMessageReceiver } from './services/whatsapp-message.receiver';
import { WhatsappLocalAuth } from './auth/whatsapp-local.auth';
import { MessageQueueService } from './services/message-queue.service';

@Module({
  imports: [],
  controllers: [
    WhatsappController
  ],
  providers: [
    WhatsappService,
    WhatsappMessageReceiver,
    WhatsappLocalAuth,
    MessageQueueService,
  ],
  exports: [
    WhatsappService
  ],
})
export class WhatsappModule { }
