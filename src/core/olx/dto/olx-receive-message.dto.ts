import { IsString, IsNotEmpty } from 'class-validator';

export class OlxReceiveMessageDto {
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
