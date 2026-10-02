import { Module } from '@nestjs/common';
import { OlxModule } from './olx/olx.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { WhatsappOfficialModule } from './whatsapp-official/whatsapp-official.module';
import { InstagramModule } from './instagram/instagram.module';
import { FacebookModule } from './facebook/facebook.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { CommunicationModule } from './communication/communication.module';

@Module({
  imports: [
    OlxModule,
    WhatsappModule,
    WhatsappOfficialModule,
    InstagramModule,
    FacebookModule,
    IntegrationsModule,
    CommunicationModule,
  ],
})
export class CoreModule {}
