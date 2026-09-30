import { Controller, Get, Post, Delete, Body, Query, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WhatsappOfficialService } from './whatsapp-official.service';
import {
  GetTemplatesDto,
  CreateTemplateDto,
  DeleteTemplateDto,
  SendTemplateMessageDto,
  TemplateResponseDto,
} from './dto/templates.dto';

@ApiTags('WhatsApp Templates')
@Controller('whatsapp-official/templates')
export class WhatsappTemplatesController {
  constructor(private readonly whatsappOfficialService: WhatsappOfficialService) {}

  @Get()
  @ApiOperation({ summary: 'List all message templates' })
  @ApiResponse({ status: 200, type: [TemplateResponseDto] })
  async getTemplates(@Query() query: GetTemplatesDto) {
    const result = await this.whatsappOfficialService.getMessageTemplates(query.storeId);

    if (!result.success) {
      throw new HttpException(result.error || 'Failed to get templates', HttpStatus.BAD_REQUEST);
    }

    return { success: true, templates: result.templates };
  }

  @Post()
  @ApiOperation({ summary: 'Create a new message template' })
  @ApiResponse({ status: 201, type: TemplateResponseDto })
  async createTemplate(@Body() body: CreateTemplateDto) {
    const result = await this.whatsappOfficialService.createMessageTemplate(body.storeId, {
      name: body.name,
      category: body.category,
      language: body.language,
      components: body.components,
    });

    if (!result.success) {
      throw new HttpException(result.error || 'Failed to create template', HttpStatus.BAD_REQUEST);
    }

    return { success: true, template: result.template };
  }

  @Delete()
  @ApiOperation({ summary: 'Delete a message template' })
  async deleteTemplate(@Query() query: DeleteTemplateDto) {
    const result = await this.whatsappOfficialService.deleteMessageTemplate(query.storeId, query.name);

    if (!result.success) {
      throw new HttpException(result.error || 'Failed to delete template', HttpStatus.BAD_REQUEST);
    }

    return { success: true };
  }

  @Post('send')
  @ApiOperation({ summary: 'Send a template message' })
  async sendTemplateMessage(@Body() body: SendTemplateMessageDto) {
    const result = await this.whatsappOfficialService.sendTemplateMessage(
      body.storeId,
      body.to,
      body.templateName,
      body.languageCode,
      body.components
    );

    if (!result.success) {
      throw new HttpException(result.error || 'Failed to send template message', HttpStatus.BAD_REQUEST);
    }

    return { success: true, messageId: result.messageId };
  }
}

