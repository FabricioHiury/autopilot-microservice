import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class ReconcileMessageDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() storeId: string;
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  externalMessageId: string;
}
