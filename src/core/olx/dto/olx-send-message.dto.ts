import { IsNotEmpty, IsString } from 'class-validator';

export class OlxSendMessageDto {
  @IsString()
  @IsNotEmpty()
  textMessage: string;

  @IsString()
  @IsNotEmpty()
  chatId: string;
}
