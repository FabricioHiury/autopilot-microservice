import { Module } from '@nestjs/common';
import { OlxModule } from 'src/core/olx/olx.module';
import { WhatsappModule } from 'src/core/whatsapp/whatsapp.module';
import { WhatsappOfficialModule } from 'src/core/whatsapp-official/whatsapp-official.module';
import { InstagramModule } from 'src/core/instagram/instagram.module';
import { FacebookModule } from 'src/core/facebook/facebook.module';
import { IntegrationsService } from './integrations.service';
import { IntegrationsController } from './integrations.controller';

@Module({
  controllers: [
    IntegrationsController
  ],
  providers: [
    IntegrationsService
  ],
  imports: [
    OlxModule,
    WhatsappModule,
    WhatsappOfficialModule,
    InstagramModule,
    FacebookModule
  ],
})
export class IntegrationsModule { }
