import { IsEnum, IsString, IsOptional, IsNotEmpty } from 'class-validator';
import { IntegrationsStatusEnum } from '../enum/integrations-status.enum';
import { IntegrationsEnum } from '../enum/integrations.enum';

export class IntegrationStatusDto {
  @IsEnum(IntegrationsEnum)
  @IsNotEmpty()
  channel: IntegrationsEnum;

  @IsEnum(IntegrationsStatusEnum)
  @IsNotEmpty()
  status: IntegrationsStatusEnum;

  @IsString()
  @IsOptional()
  message: string;
}
