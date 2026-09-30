import { IsString, IsNotEmpty, IsOptional, IsNumber, IsBoolean, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class WhatsAppOfficialConfigDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsString()
  @IsNotEmpty()
  storeId: string;

  @ApiProperty({ example: '1234567890123456' })
  @IsString()
  @IsNotEmpty()
  wabaId: string;

  @ApiProperty({ example: '9876543210987654' })
  @IsString()
  @IsNotEmpty()
  phoneNumberId: string;

  @ApiProperty({ example: 'EAAxxxxxx...' })
  @IsString()
  @IsNotEmpty()
  accessToken: string;

  @ApiProperty({ example: 'my_verify_token_123' })
  @IsString()
  @IsNotEmpty()
  verifyToken: string;

  @ApiProperty({ example: '5511999999999' })
  @IsString()
  @IsNotEmpty()
  businessPhone: string;
}

export class WhatsAppOfficialWebhookDto {
  @ApiProperty()
  @IsString()
  @IsOptional()
  object?: string;

  @ApiProperty()
  @IsArray()
  @IsOptional()
  entry?: any[];
}

export class WhatsAppOfficialMessageDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  to: string;

  @ApiProperty()
  @IsString()
  @IsOptional()
  type?: string;

  @ApiProperty()
  @IsOptional()
  text?: {
    body: string;
    preview_url?: boolean;
  };

  @ApiProperty()
  @IsOptional()
  image?: {
    link?: string;
    id?: string;
    caption?: string;
  };

  @ApiProperty()
  @IsOptional()
  audio?: {
    link?: string;
    id?: string;
    voice?: boolean;
  };

  @ApiProperty()
  @IsOptional()
  video?: {
    link?: string;
    id?: string;
    caption?: string;
  };

  @ApiProperty()
  @IsOptional()
  document?: {
    link?: string;
    id?: string;
    caption?: string;
    filename?: string;
  };

  @ApiProperty()
  @IsOptional()
  sticker?: {
    link?: string;
    id?: string;
  };

  @ApiProperty()
  @IsOptional()
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };

  @ApiProperty()
  @IsOptional()
  contacts?: Array<{
    name: {
      formatted_name: string;
      first_name?: string;
      last_name?: string;
    };
    phones: Array<{
      phone: string;
      type?: string;
    }>;
  }>;

  @ApiProperty()
  @IsOptional()
  reaction?: {
    message_id: string;
    emoji: string;
  };

  @ApiProperty()
  @IsOptional()
  template?: {
    name: string;
    language: {
      code: string;
    };
    components?: any[];
  };

  @ApiProperty()
  @IsOptional()
  context?: {
    message_id: string;
  };
}

export class WhatsAppOfficialStatusDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  status: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  timestamp: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  recipient_id: string;
}

export class WhatsAppMessageWindowDto {
  @ApiProperty()
  @IsBoolean()
  isWithinWindow: boolean;

  @ApiProperty()
  @IsNumber()
  @IsOptional()
  hoursRemaining?: number;

  @ApiProperty()
  @IsString()
  @IsOptional()
  lastCustomerMessageAt?: string;
}
