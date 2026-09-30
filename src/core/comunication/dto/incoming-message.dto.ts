import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { IntegrationsEnum } from 'src/core/integrations/enum/integrations.enum';
import { ContatoDto } from './outgoing-message.dto';

export class ChatIncomingMessageDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsString()
  @IsNotEmpty()
  storeId: string;

  @ApiProperty({
    example: 'destinatario',
    description: 'Destinatário da mensagem, de acordo com o canal',
  })
  @IsString()
  @IsNotEmpty()
  destinatario: string;

  @ApiProperty({ example: 'mensagem' })
  @IsString()
  @IsOptional()
  mensagem?: string;

  @ApiProperty({
    example: 'anexoMensagem',
    description: 'URL do anexo da mensagem, se houver',
  })
  @IsString()
  @IsOptional()
  anexoMensagem?: string;

  @IsString()
  @IsOptional()
  tipoAnexo?: string;

  @ApiProperty({
    example: 'mensagemReferencia',
    description: 'Mensagem de referência, em caso de resposta',
  })
  @IsString()
  @IsOptional()
  mensagemReferencia?: string;

  @ApiProperty({ example: 'whatsapp', enum: IntegrationsEnum })
  @IsEnum(IntegrationsEnum)
  @IsNotEmpty()
  canal: IntegrationsEnum;

  @ApiProperty({ example: 'abc123', description: 'ID interno da mensagem (gerado antes do envio)' })
  @IsString()
  @IsOptional()
  idMensagem?: string;

  @ApiProperty({ example: -23.5505, description: 'Latitude da localização' })
  @IsNumber()
  @IsOptional()
  latitude?: number;

  @ApiProperty({ example: -46.6333, description: 'Longitude da localização' })
  @IsNumber()
  @IsOptional()
  longitude?: number;

  @ApiProperty({
    example: 'Shopping Center',
    description: 'Nome da localização',
  })
  @IsString()
  @IsOptional()
  locationName?: string;

  @ApiProperty({
    example: 'Rua das Flores, 123',
    description: 'Endereço da localização',
  })
  @IsString()
  @IsOptional()
  locationAddress?: string;

  @ApiProperty({
    example: 'https://maps.google.com/...',
    description: 'URL da localização',
  })
  @IsString()
  @IsOptional()
  locationUrl?: string;

  @ApiProperty({
    example: 'text',
    description: 'Tipo da mensagem: text, image, audio, video, reaction',
  })
  @IsString()
  @IsOptional()
  tipo?: string;

  @ApiProperty({
    example: 'official',
    description: 'WhatsApp API type: official or unofficial',
  })
  @IsString()
  @IsOptional()
  wppApiType?: string;

  @ApiProperty({
    description: 'Lista de contatos para envio',
  })
  @IsArray()
  @IsOptional()
  contatos?: ContatoDto[];

  @ApiProperty({
    example: true,
    description: 'Indica se o áudio é uma gravação de voz (true) ou um arquivo anexado (false)',
  })
  @IsBoolean()
  @IsOptional()
  isVoiceRecording?: boolean;
}
