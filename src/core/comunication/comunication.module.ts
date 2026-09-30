import { Global, Module } from '@nestjs/common';
import { CommunicationController } from './comunication.controller';
import { OlxModule } from 'src/core/olx/olx.module';
import { WhatsappModule } from 'src/core/whatsapp/whatsapp.module';
import { WhatsappOfficialModule } from 'src/core/whatsapp-official/whatsapp-official.module';
import { InstagramModule } from 'src/core/instagram/instagram.module';
import { FacebookModule } from 'src/core/facebook/facebook.module';
import { CommunicationService } from './comunication.service';
import { PrismaService } from 'src/base/service/prisma.service';

@Global()
@Module({
  controllers: [
    CommunicationController
  ],
  providers: [
    CommunicationService,
    PrismaService
  ],
  exports: [
    CommunicationService
  ],
  imports: [
    OlxModule,
    WhatsappModule,
    WhatsappOfficialModule,
    InstagramModule,
    FacebookModule
  ],
})
export class ComunicationModule { }
