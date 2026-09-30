import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SendMessageDto {
  @ApiProperty({ example: '5512345678910' })
  @IsString()
  @IsNotEmpty()
  recipient: string;

  @ApiProperty({ example: 'Message' })
  @IsString()
  @IsNotEmpty()
  content: string;
}
