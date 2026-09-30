import { Module } from '@nestjs/common';
import { InstagramService } from './instagram.service';
import { InstagramController } from './instagram.controller';
import { InstagramCronService } from './instagram-cron.service';
import { TokenRenewalService } from 'src/base/queues/token-renewal.queue';
import { BullModule } from '@nestjs/bull';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'token-renewal' })
  ],
  controllers: [
    InstagramController
  ],
  providers: [
    InstagramService,
    InstagramCronService,
    TokenRenewalService,
  ],
  exports: [
    InstagramService
  ],
})
export class InstagramModule { }
