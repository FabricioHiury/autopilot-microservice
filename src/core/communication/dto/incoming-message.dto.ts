import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { IntegrationsEnum } from '../../integrations/enum/integrations.enum';
import { ContactDto } from './outgoing-message.dto';

export class SendMessageDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() storeId: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() messageId: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) recipient: string;
  @ApiProperty({ enum: IntegrationsEnum })
  @IsEnum(IntegrationsEnum)
  channel: IntegrationsEnum;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  text?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  attachmentUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() attachmentType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() quotedMessageId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['official', 'baileys', 'evolution', 'unofficial'])
  wppApiType?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsIn([
    'text',
    'image',
    'audio',
    'video',
    'document',
    'sticker',
    'location',
    'reaction',
    'contacts',
    'contact',
  ])
  type?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContactDto)
  contacts?: ContactDto[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isVoiceRecording?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsNumber() latitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() longitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() locationName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() locationAddress?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() locationUrl?: string;
}
