import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class WhatsappSaveIntegrationDto {
  @ApiProperty({ example: 'wpp-1-uuid' })
  @IsString()
  @IsNotEmpty()
  instanceId: string;

  @ApiProperty({ example: 'uuid' })
  @IsString()
  @IsNotEmpty()
  storeId: string;
}
