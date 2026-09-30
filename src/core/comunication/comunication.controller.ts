import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ChatIncomingMessageDto } from './dto/incoming-message.dto';
import { ListMessagesQuery } from './dto/list-messages.dto';
import { ApiKeyGuard } from 'src/base/guard/api-key.guard';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { VerifyWhatsappNumberDto } from './dto/verify-number-wpp.dto';
import { CommunicationService } from './comunication.service';

@ApiTags('Communication')
@UseGuards(ApiKeyGuard)
@Controller('communication')
export class CommunicationController {
  constructor(private readonly communicationService: CommunicationService) { }

  @ApiOperation({
    summary: 'Send message to channel',
  })
  @Post('/message')
  async receiveMessage(@Body() mensagem: ChatIncomingMessageDto) {
    return await this.communicationService.forwardMessageToChannel(mensagem);
  }

  @ApiOperation({
    summary: 'List messages',
    description:
      'List messages that could not be forwarded to AutoPilot',
  })
  @Get('/messages-with-error')
  async listMessagesWithErrors(@Query() query: ListMessagesQuery) {
    return await this.communicationService.listMessagesWithErrors(query);
  }

  @ApiOperation({
    summary: 'Verify if number exists on WhatsApp',
  })
  @Post('/whatsapp/verify-number')
  async verifyWhatsappNumber(@Body() body: VerifyWhatsappNumberDto) {
    return await this.communicationService.verifyWhatsappNumber(body);
  }
}
