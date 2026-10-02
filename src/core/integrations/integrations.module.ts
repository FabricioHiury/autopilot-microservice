import { Module } from '@nestjs/common';
import { OlxModule } from '../olx/olx.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { WhatsappOfficialModule } from '../whatsapp-official/whatsapp-official.module';
import { InstagramModule } from '../instagram/instagram.module';
import { FacebookModule } from '../facebook/facebook.module';
import { IntegrationsService } from './integrations.service';
import { IntegrationsController } from './integrations.controller';

@Module({
  controllers: [IntegrationsController],
  providers: [IntegrationsService],
  imports: [
    OlxModule,
    WhatsappModule,
    WhatsappOfficialModule,
    InstagramModule,
    FacebookModule,
  ],
})
export class IntegrationsModule {}
