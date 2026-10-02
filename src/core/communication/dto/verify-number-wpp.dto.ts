import { IsNotEmpty, IsString, IsUUID } from 'class-validator';
export class VerifyWhatsappNumberDto {
  @IsUUID() storeId: string;
  @IsString() @IsNotEmpty() phone: string;
}
