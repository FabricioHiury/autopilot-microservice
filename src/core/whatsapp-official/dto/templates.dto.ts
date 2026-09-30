import { IsString, IsNotEmpty, IsOptional, IsArray, IsIn, ValidateNested, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class TemplateComponentDto {
  @ApiProperty({ example: 'BODY', enum: ['HEADER', 'BODY', 'FOOTER', 'BUTTONS'] })
  @IsString()
  @IsNotEmpty()
  @IsIn(['HEADER', 'BODY', 'FOOTER', 'BUTTONS'])
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';

  @ApiProperty({ example: 'Olá {{nome}}, aqui é {{vendedor}} da {{empresa}}', required: false })
  @IsString()
  @IsOptional()
  text?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  format?: string;

  @ApiProperty({ required: false })
  @IsArray()
  @IsOptional()
  buttons?: any[];

  @ApiProperty({ required: false })
  @IsOptional()
  example?: any;

  @ApiProperty({
    required: false,
    description: 'Exemplos para variáveis nomeadas no texto',
    example: { nome: 'João Silva', vendedor: 'Maria Santos', empresa: 'Radial Automóveis' }
  })
  @IsOptional()
  examples?: Record<string, string>;
}

export class GetTemplatesDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsString()
  @IsNotEmpty()
  storeId: string;
}

export class CreateTemplateDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsString()
  @IsNotEmpty()
  storeId: string;

  @ApiProperty({ example: 'confirmacao_pedido' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'UTILITY', enum: ['UTILITY', 'MARKETING', 'AUTHENTICATION'] })
  @IsString()
  @IsNotEmpty()
  @IsIn(['UTILITY', 'MARKETING', 'AUTHENTICATION'])
  category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';

  @ApiProperty({ example: 'pt_BR' })
  @IsString()
  @IsNotEmpty()
  language: string;

  @ApiProperty({
    type: [TemplateComponentDto],
    example: [{ type: 'BODY', text: 'Olá {{nome}}, aqui é {{vendedor}} da {{empresa}}', examples: { nome: 'João', vendedor: 'Maria', empresa: 'Radial' } }]
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Pelo menos um componente é obrigatório' })
  @ValidateNested({ each: true })
  @Type(() => TemplateComponentDto)
  components: TemplateComponentDto[];
}

export class DeleteTemplateDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsString()
  @IsNotEmpty()
  storeId: string;

  @ApiProperty({ example: 'confirmacao_pedido' })
  @IsString()
  @IsNotEmpty()
  name: string;
}

export class SendTemplateMessageDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsString()
  @IsNotEmpty()
  storeId: string;

  @ApiProperty({ example: '5511999999999' })
  @IsString()
  @IsNotEmpty()
  to: string;

  @ApiProperty({ example: 'confirmacao_pedido' })
  @IsString()
  @IsNotEmpty()
  templateName: string;

  @ApiProperty({ example: 'pt_BR' })
  @IsString()
  @IsNotEmpty()
  languageCode: string;

  @ApiProperty({
    required: false,
    example: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'João' }
        ]
      }
    ]
  })
  @IsArray()
  @IsOptional()
  components?: any[];
}

export class TemplateResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: ['APPROVED', 'PENDING', 'REJECTED', 'DISABLED'] })
  status: string;

  @ApiProperty({ enum: ['UTILITY', 'MARKETING', 'AUTHENTICATION'] })
  category: string;

  @ApiProperty()
  language: string;

  @ApiProperty()
  components?: any[];
}

