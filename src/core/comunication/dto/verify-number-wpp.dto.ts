import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumberString, IsString } from 'class-validator';

export class VerifyWhatsappNumberDto {
  @ApiProperty({
    description: 'ID da loja',
    example: '11111111-1111-1111-1111-111111111111',
  })
  @IsString()
  @IsNotEmpty()
  storeId: string;

  @ApiProperty({
    description: 'Número de WhatsApp',
    example: '5511999999999',
  })
  @IsNotEmpty()
  @IsNumberString()
  numero: string;
}
