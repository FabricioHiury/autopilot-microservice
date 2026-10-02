import { IsOptional, IsString, IsUUID } from 'class-validator';
export class WhatsappSaveIntegrationDto {
  @IsOptional() @IsString() instanceId?: string;
  @IsUUID() storeId: string;
}
