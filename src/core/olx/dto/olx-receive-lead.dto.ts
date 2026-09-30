import { IsString, IsNotEmpty, IsOptional, IsEmail, IsObject } from 'class-validator';

export class OlxReceiveLeadDto {
  @IsString()
  @IsNotEmpty()
  source: string; // 'OLX' ou 'WhatsApp'

  @IsString()
  @IsOptional()
  adId?: string; // id do anúncio no integrador

  @IsString()
  @IsNotEmpty()
  listId: string; // id do anúncio na OLX

  @IsString()
  @IsNotEmpty()
  linkAd: string; // link do anúncio na OLX

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsOptional()
  phone?: string; // pode vir com/sem DDD

  @IsString()
  @IsOptional()
  message?: string; // pode ser vazio quando é apenas interesse

  @IsNotEmpty()
  createdAt: string; // ISO string

  @IsObject()
  @IsOptional()
  adsInfo?: Record<string, any>; // detalhes adicionais (Autos)

  @IsString()
  @IsOptional()
  externalId?: string; // identificador único do lead
}
