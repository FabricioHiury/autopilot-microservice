import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiSecurity } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../base/guard/api-key.guard';
import { CommunicationService } from './communication.service';
import { ReconcileMessageDto } from './dto/reconcile-message.dto';
import { SendMessageDto } from './dto/incoming-message.dto';
import { VerifyWhatsappNumberDto } from './dto/verify-number-wpp.dto';
import { DurableQueueService } from '../delivery/durable-queue.service';
@ApiTags('Communication')
@ApiSecurity('api-key')
@UseGuards(ApiKeyGuard)
@Controller('communication')
export class CommunicationController {
  constructor(
    private readonly communication: CommunicationService,
    private readonly queue: DurableQueueService,
  ) {}
  @Post('messages')
  @HttpCode(200)
  send(@Body() message: SendMessageDto) {
    return this.communication.forwardMessageToChannel(message);
  }
  @Post('whatsapp/verify-number')
  @HttpCode(200)
  verify(@Body() body: VerifyWhatsappNumberDto) {
    return this.communication.verifyWhatsappNumber(body);
  }
  @Get('messages-with-error')
  list(@Query('storeId') storeId?: string) {
    return this.queue.list(storeId);
  }
  @Get('outbound-with-error')
  uncertain(@Query('storeId') storeId?: string) {
    return this.communication.listUncertain(storeId);
  }
  @Post('messages/:messageId/reconcile')
  @HttpCode(200)
  reconcile(
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() body: ReconcileMessageDto,
  ) {
    return this.communication.reconcile(
      body.storeId,
      messageId,
      body.externalMessageId,
    );
  }
  @Post('events/:id/retry')
  @HttpCode(200)
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.queue.retry(id);
  }
}
