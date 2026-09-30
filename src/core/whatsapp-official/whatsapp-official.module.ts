import { Module } from '@nestjs/common';
import { PrismaService } from 'src/base/service/prisma.service';
import { WhatsappOfficialService } from './whatsapp-official.service';
import { WhatsappOfficialController } from './whatsapp-official.controller';
import { WhatsappTemplatesController } from './whatsapp-templates.controller';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { RedisService } from 'src/base/service/redis.service';

@Module({
  imports: [EventEmitterModule],
  controllers: [WhatsappOfficialController, WhatsappTemplatesController],
  providers: [WhatsappOfficialService, PrismaService, RedisService],
  exports: [WhatsappOfficialService],
})
export class WhatsappOfficialModule {}
