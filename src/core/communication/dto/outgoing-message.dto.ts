import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { IntegrationsEnum } from '../../integrations/enum/integrations.enum';
import { MessageTypeEnum } from '../../integrations/enum/message-type.enum';

export class MessageMetadataDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  username?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  avatarUrl?: string;

  @IsString()
  @IsOptional()
  externalAdId?: string;

  @IsString()
  @IsOptional()
  source?: string;

  @IsString()
  @IsOptional()
  sourceDetails?: string;

  @IsBoolean()
  @IsOptional()
  isContentReply?: boolean;

  @IsBoolean()
  @IsOptional()
  isFromReferral?: boolean;
}

export class ContactDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  phone: string;
}

export class LocationDto {
  @IsNumber()
  @IsNotEmpty()
  lat: number;

  @IsNumber()
  @IsNotEmpty()
  lng: number;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  address?: string;
}

export class CallDto {
  @IsString()
  @IsNotEmpty()
  callId: string;

  @IsNumber()
  @IsNotEmpty()
  duration: number;

  @IsString()
  @IsOptional()
  status?: string;

  @IsDateString()
  @IsNotEmpty()
  timestamp: Date | string;
}

export class ProviderMessageEvent {
  @IsString()
  @IsNotEmpty()
  storeId: string;

  @IsString()
  @IsOptional()
  text?: string;

  @IsString()
  @IsOptional()
  attachmentUrl?: string;

  @IsString()
  @IsOptional()
  attachmentType?: string;

  @IsString()
  @IsOptional()
  messageId?: string;

  @IsString()
  @IsOptional()
  quotedMessageId?: string;

  @IsEnum(IntegrationsEnum)
  @IsNotEmpty()
  channel: IntegrationsEnum;

  @IsBoolean()
  @IsOptional()
  sentByStore?: boolean;

  @IsString()
  @IsNotEmpty()
  externalContactId: string;

  @IsEnum(MessageTypeEnum)
  @IsOptional()
  type?: MessageTypeEnum;

  @IsDateString()
  @IsNotEmpty()
  timestamp: Date | string;

  @IsOptional()
  @Type(() => MessageMetadataDto)
  metadata?: MessageMetadataDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContactDto)
  @IsOptional()
  contacts?: ContactDto[];

  @ValidateNested()
  @Type(() => LocationDto)
  @IsOptional()
  location?: LocationDto;

  @ValidateNested()
  @Type(() => CallDto)
  @IsOptional()
  call?: CallDto;
}
