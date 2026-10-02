import { Global, Module } from '@nestjs/common';
import { CommunicationController } from './communication.controller';
import { OlxModule } from '../olx/olx.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { WhatsappOfficialModule } from '../whatsapp-official/whatsapp-official.module';
import { InstagramModule } from '../instagram/instagram.module';
import { FacebookModule } from '../facebook/facebook.module';
import { CommunicationService } from './communication.service';
import { PrismaService } from '../../base/service/prisma.service';

@Global()
@Module({
  controllers: [CommunicationController],
  providers: [CommunicationService],
  exports: [CommunicationService],
  imports: [
    OlxModule,
    WhatsappModule,
    WhatsappOfficialModule,
    InstagramModule,
    FacebookModule,
  ],
})
export class CommunicationModule {}
