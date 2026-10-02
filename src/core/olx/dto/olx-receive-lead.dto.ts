import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  IsObject,
} from 'class-validator';

export class OlxReceiveLeadDto {
  @IsString()
  @IsNotEmpty()
  source: string;

  @IsString()
  @IsOptional()
  adId?: string;

  @IsString()
  @IsNotEmpty()
  listId: string;

  @IsString()
  @IsNotEmpty()
  linkAd: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  message?: string;

  @IsNotEmpty()
  createdAt: string;

  @IsObject()
  @IsOptional()
  adsInfo?: Record<string, any>;

  @IsString()
  @IsOptional()
  externalId?: string;
}
