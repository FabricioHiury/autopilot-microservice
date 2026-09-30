import { IsString, IsNotEmpty, IsNumberString, IsIn } from 'class-validator';

export class ConfigureWebhooksDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['subscribe'])
  'hub.mode': string;

  @IsString()
  @IsNotEmpty()
  'hub.verify_token': string;

  @IsNumberString()
  @IsNotEmpty()
  'hub.challenge': string;
}
