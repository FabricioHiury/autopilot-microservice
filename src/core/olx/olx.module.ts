import { Module } from '@nestjs/common';
import { OlxService } from './olx.service';
import { OlxController } from './olx.controller';

@Module({
  controllers: [
    OlxController
  ],
  providers: [
    OlxService
  ],
  exports: [
    OlxService
  ],
})
export class OlxModule { }
