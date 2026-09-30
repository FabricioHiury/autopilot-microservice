import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { IntegrationsEnum } from 'src/core/integrations/enum/integrations.enum';
import { MessageTypeEnum } from 'src/core/integrations/enum/message-type.enum';

class MetadadosMensagemDto {
  @IsString()
  @IsOptional()
  nome?: string;

  @IsString()
  @IsOptional()
  username?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  celular?: string;

  @IsString()
  @IsOptional()
  urlAvatar?: string;

  @IsString()
  @IsOptional()
  idAnuncioExterno?: string;

  @IsString()
  @IsOptional()
  origemMensagem?: string;

  @IsString()
  @IsOptional()
  detalhesOrigem?: string;

  @IsBoolean()
  @IsOptional()
  isContentReply?: boolean;

  @IsBoolean()
  @IsOptional()
  isFromReferral?: boolean;
}

export class ContatoDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  phone: string;
}

export class LocationDto {
  @IsNumber()
  @IsNotEmpty()
  lat: number;

  @IsNumber()
  @IsNotEmpty()
  lng: number;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  address?: string;
}

export class CallDto {
  @IsString()
  @IsNotEmpty()
  callId: string;

  @IsNumber()
  @IsNotEmpty()
  duration: number;

  @IsString()
  @IsOptional()
  status?: string;

  @IsDateString()
  @IsNotEmpty()
  timestamp: Date;
}

export class ChatOutgoingMessageDto {
  @IsNumber()
  @IsNotEmpty()
  storeId: string;

  @IsString()
  @IsOptional()
  mensagem?: string;

  @IsString()
  @IsOptional()
  anexoMensagem?: string;

  @IsString()
  @IsOptional()
  tipoAnexo?: string;

  @IsString()
  @IsOptional()
  idMensagem?: string;

  @IsString()
  @IsOptional()
  mensagemReferencia?: string;

  @IsEnum(IntegrationsEnum)
  @IsNotEmpty()
  canal: IntegrationsEnum;

  @IsBoolean()
  @IsOptional()
  enviadaLoja?: boolean;

  @IsString()
  @IsNotEmpty()
  idDestinatarioApiExterna: string;

  @IsEnum(MessageTypeEnum)
  @IsOptional()
  tipo?: MessageTypeEnum;

  @IsDateString()
  @IsNotEmpty()
  timestamp: Date;

  @IsOptional()
  @Type(() => MetadadosMensagemDto)
  metadados?: MetadadosMensagemDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContatoDto)
  @IsOptional()
  contatos?: ContatoDto[];

  @ValidateNested()
  @Type(() => LocationDto)
  @IsOptional()
  location?: LocationDto;

  @ValidateNested()
  @Type(() => CallDto)
  @IsOptional()
  call?: CallDto;
}
