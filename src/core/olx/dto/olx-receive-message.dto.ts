import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';

export class OlxReceiveMessageDto {
  @IsOptional() @IsObject() adsInfo?: Record<string, unknown>;
  @IsString()
  @IsNotEmpty()
  chatId: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsString()
  @IsNotEmpty()
  senderType: 'account' | 'system';

  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsNotEmpty()
  messageTimestamp: string | number;

  @IsString()
  @IsNotEmpty()
  messageId: string;

  @IsString()
  @IsNotEmpty()
  origin: 'buyer' | 'seller';

  @IsString()
  @IsNotEmpty()
  listId: string;
}
