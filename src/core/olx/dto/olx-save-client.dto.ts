import { IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class OlxSaveClientDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  @IsNotEmpty()
  storeId: string;

  @ApiProperty({ example: 'clientId' })
  @IsString()
  @IsNotEmpty()
  clientId: string;

  @ApiProperty({ example: 'clientSecret' })
  @IsString()
  @IsNotEmpty()
  clientSecret: string;
}
