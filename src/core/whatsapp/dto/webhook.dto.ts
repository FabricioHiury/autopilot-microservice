import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class ReferencedMessage {
  @ApiProperty({ example: '3EB0D1C78ED4412663C92E' })
  @IsString()
  @IsNotEmpty()
  messageId: string;

  @ApiProperty({ example: true })
  @IsNotEmpty()
  fromMe: boolean;

  @ApiProperty({ example: '5515976078443' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({ example: null, nullable: true })
  @IsOptional()
  participant: string | null;
}

class Text {
  @ApiProperty({ example: 'Oi' })
  @IsString()
  @IsNotEmpty()
  message: string;
}

class Reaction {
  @ApiProperty({ example: '❤️' })
  @IsString()
  @IsNotEmpty()
  value: string;

  @ApiProperty({ example: 1731536151000 })
  @IsNumber()
  @IsNotEmpty()
  time: number;

  @ApiProperty({ example: '558189148488' })
  @IsString()
  @IsNotEmpty()
  reactionBy: string;

  @ApiProperty({ type: ReferencedMessage })
  @ValidateNested()
  @Type(() => ReferencedMessage)
  @IsNotEmpty()
  referencedMessage: ReferencedMessage;
}

class Image {
  @ApiProperty({
    example: '',
  })
  @IsString()
  @IsNotEmpty()
  imageUrl: string;

  @ApiProperty({
    example: '',
  })
  @IsString()
  @IsNotEmpty()
  thumbnailUrl: string;

  @ApiProperty({ example: 'Alô' })
  @IsString()
  @IsOptional()
  caption: string;

  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @ApiProperty({ example: false })
  @IsNotEmpty()
  viewOnce: boolean;

  @ApiProperty({ example: 870 })
  @IsNumber()
  @IsNotEmpty()
  width: number;

  @ApiProperty({ example: 481 })
  @IsNumber()
  @IsNotEmpty()
  height: number;
}

class Video {
  @ApiProperty({
    example: '',
  })
  @IsString()
  @IsNotEmpty()
  videoUrl: string;

  @ApiProperty({ example: '' })
  @IsString()
  @IsOptional()
  caption: string;

  @ApiProperty({ example: 'video/mp4' })
  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @ApiProperty({ example: 220 })
  @IsNumber()
  @IsNotEmpty()
  width: number;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @IsNotEmpty()
  seconds: number;

  @ApiProperty({ example: false })
  @IsNotEmpty()
  isGif: boolean;
}

class Contact {
  @ApiProperty({ example: 'Cláudio' })
  @IsString()
  @IsNotEmpty()
  displayName: string;

  @ApiProperty({
    example: 'BEGIN:VCARD\nVERSION:3.0\nN:Pináculo;',
  })
  @IsString()
  @IsNotEmpty()
  vCard: string;

  @ApiProperty({ example: ['558189148488'] })
  @IsArray()
  @IsNotEmpty()
  phones: string[];
}

class Audio {
  @ApiProperty({ example: true })
  @IsNotEmpty()
  ptt: boolean;

  @ApiProperty({ example: 3 })
  @IsNumber()
  @IsNotEmpty()
  seconds: number;

  @ApiProperty({ example: '' })
  @IsString()
  @IsNotEmpty()
  audioUrl: string;

  @ApiProperty({ example: 'audio/ogg; codecs=opus' })
  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @ApiProperty({ example: false })
  @IsNotEmpty()
  viewOnce: boolean;
}

class Sticker {
  @ApiProperty({
    example:
      'https://tempstorage.download/instances/3D8A6C32C9FF702A924F7E4D308AAA6F/1F2EFD4AD72301A4C24D945E610BFCA3.webp',
  })
  @IsString()
  @IsNotEmpty()
  stickerUrl: string;

  @ApiProperty({ example: 'image/webp' })
  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @ApiProperty({ example: 0 })
  @IsNumber()
  @IsNotEmpty()
  width: number;

  @ApiProperty({ example: 0 })
  @IsNumber()
  @IsNotEmpty()
  height: number;
}

class Document {
  @ApiProperty({ example: 'testeeee' })
  @IsString()
  @IsOptional()
  caption: string;

  @ApiProperty({
    example:
      'https://tempstorage.download/instances/3D8281DF5324303B053C8E8D925EEEA6/3EB014FE14BAD1BAF724A1.pdf',
  })
  @IsString()
  @IsNotEmpty()
  documentUrl: string;

  @ApiProperty({ example: 'application/pdf' })
  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @ApiProperty({ example: 'Roteiro Petronio G1.pdf' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 5 })
  @IsNumber()
  @IsNotEmpty()
  pageCount: number;

  @ApiProperty({ example: 'Roteiro Petronio G1.pdf' })
  @IsString()
  @IsNotEmpty()
  fileName: string;
}
export class WebhookDto {
  @IsString()
  @IsOptional()
  lastSeen?: string;

  @ApiProperty({ example: false })
  @IsOptional()
  isStatusReply: boolean;

  @ApiProperty({ example: '169518164889634@lid' })
  @IsString()
  @IsOptional()
  chatLid: string;

  @ApiProperty({ example: '5515976078443' })
  @IsString()
  @IsOptional()
  connectedPhone: string;

  @ApiProperty({ example: false })
  @IsOptional()
  waitingMessage: boolean;

  @ApiProperty({ example: false })
  @IsOptional()
  isEdit: boolean;

  @ApiProperty({ example: false })
  @IsOptional()
  isGroup: boolean;

  @ApiProperty({ example: false })
  @IsOptional()
  isNewsletter: boolean;

  @ApiProperty({ example: '3D8281DF5324303B053C8E8D925EEEA6' })
  @IsString()
  @IsOptional()
  instanceId: string;

  @ApiProperty({ example: '9AE2E06DD846FB0B1B49FAAC1B2A9073' })
  @IsString()
  @IsOptional()
  messageId: string;

  @ApiProperty({ example: '5521965731713' })
  @IsString()
  @IsOptional()
  phone: string;

  @ApiProperty({ example: false })
  @IsOptional()
  fromMe: boolean;

  @ApiProperty({ example: 1731527034792 })
  @IsNumber()
  @IsOptional()
  momment: number;

  @ApiProperty({ example: 'RECEIVED' })
  @IsString()
  @IsOptional()
  status: string;

  @ApiProperty({ example: 'Pablo Souza' })
  @IsString()
  @IsOptional()
  chatName: string;

  @ApiProperty({ example: null, nullable: true })
  @IsOptional()
  senderPhoto: string | null;

  @ApiProperty({ example: 'Pablo Souza' })
  @IsString()
  @IsOptional()
  senderName: string;

  @ApiProperty({
    example:
      'https://pps.whatsapp.net/v/t61.24694-24/394719431_1444332716428397_1890649170510503783_n.jpg?ccb=11-4&oh=01_Q5AaIIAixYaFhzmvK2WWgxj3aXU1thkpNSZ5mgSJsug0EcWE&oe=67422D7D&_nc_sid=5e03e0&_nc_cat=107',
  })
  @IsString()
  @IsOptional()
  photo: string;

  @ApiProperty({ example: false })
  @IsOptional()
  broadcast: boolean;

  @ApiProperty({ example: null, nullable: true })
  @IsOptional()
  participantLid: string | null;

  @ApiProperty({ example: false })
  @IsOptional()
  forwarded: boolean;

  @ApiProperty({ example: 'ReceivedCallback' })
  @IsString()
  @IsOptional()
  type: string;

  @ApiProperty({ example: false })
  @IsOptional()
  fromApi: boolean;

  @ApiProperty({ example: '3EB0D1C78ED4412663C92E' })
  @IsOptional()
  referenceMessageId: string;

  @ApiProperty({ example: 0 })
  @IsOptional()
  messageExpirationSeconds: string;

  @ApiProperty({ example: { message: 'Oi' } })
  @IsOptional()
  text: Text;

  @ApiProperty({ type: Reaction, nullable: true })
  @ValidateNested({ each: true })
  @Type(() => Reaction)
  @IsOptional()
  reaction: Reaction | null;

  @ApiProperty({ type: Image, nullable: true })
  @ValidateNested({ each: true })
  @Type(() => Image)
  @IsOptional()
  image: Image | null;

  @ApiProperty({ type: Document, nullable: true })
  @ValidateNested({ each: true })
  @Type(() => Document)
  @IsOptional()
  document: Document | null;

  @ApiProperty({ type: Sticker, nullable: true })
  @ValidateNested({ each: true })
  @Type(() => Sticker)
  @IsOptional()
  sticker: Sticker | null;

  @ApiProperty({ type: Audio, nullable: true })
  @ValidateNested({ each: true })
  @Type(() => Audio)
  @IsOptional()
  audio: Audio | null;

  @ApiProperty({ type: Contact, nullable: true })
  @ValidateNested({ each: true })
  @Type(() => Contact)
  @IsOptional()
  contact: Contact | null;

  @ApiProperty({ type: Video, nullable: true })
  @ValidateNested({ each: true })
  @Type(() => Video)
  @IsOptional()
  video: Video | null;
}

export class WppConnectMessageDto {
  @ApiProperty({ example: 'false_5521965731713@c.us_3EB0D1C78ED4412663C92E' })
  @IsString()
  @IsOptional()
  id?: string;

  @ApiProperty({ example: '5521965731713@c.us' })
  @IsString()
  @IsOptional()
  from?: string;

  @ApiProperty({ example: false })
  @IsBoolean()
  @IsOptional()
  fromMe?: boolean;

  @ApiProperty({ example: 1731527034 })
  @IsNumber()
  @IsOptional()
  timestamp?: number;

  @ApiProperty({ example: 'Olá, como vai?' })
  @IsString()
  @IsOptional()
  body?: string;

  @ApiProperty({ example: 'Descrição da imagem' })
  @IsString()
  @IsOptional()
  caption?: string;

  @ApiProperty({ example: 'chat' })
  @IsString()
  @IsOptional()
  type?: string;

  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  @IsOptional()
  mimetype?: string;

  @ApiProperty({ example: 'document.pdf' })
  @IsString()
  @IsOptional()
  filename?: string;

  @ApiProperty({ example: false })
  @IsBoolean()
  @IsOptional()
  isGroup?: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  @IsOptional()
  isForwarded?: boolean;

  @ApiProperty({ example: 'https://example.com/image.jpg' })
  @IsString()
  @IsOptional()
  fileUrl?: string;

  @ApiProperty({ example: { name: 'John Doe', id: '5521965731713@c.us' } })
  @IsObject()
  @IsOptional()
  sender?: Record<string, any>;
}

export class WppConnectQrCodeDto {
  @ApiProperty({ example: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...' })
  @IsString()
  @IsOptional()
  qrcode?: string;

  @ApiProperty({ example: 'NERDWHATS_AMERICA' })
  @IsString()
  @IsOptional()
  sessionName?: string;
}

export class WppConnectStatusDto {
  @ApiProperty({ example: 'CONNECTED' })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiProperty({ example: 'NERDWHATS_AMERICA' })
  @IsString()
  @IsOptional()
  session?: string;
}

export class WppConnectWebhookDto {
  @ApiProperty({ example: 'onmessage' })
  @IsString()
  @IsNotEmpty()
  event: string;

  @ApiProperty({ example: 'NERDWHATS_AMERICA' })
  @IsString()
  @IsOptional()
  session?: string;

  @ApiProperty({ example: '3D8281DF5324303B053C8E8D925EEEA6' })
  @IsString()
  @IsOptional()
  instanceId?: string;

  @ApiProperty({ type: WppConnectMessageDto })
  @ValidateNested()
  @Type(() => WppConnectMessageDto)
  @IsOptional()
  message?: WppConnectMessageDto;

  @ApiProperty({ type: WppConnectQrCodeDto })
  @ValidateNested()
  @Type(() => WppConnectQrCodeDto)
  @IsOptional()
  qrcode?: WppConnectQrCodeDto;

  @ApiProperty({ type: WppConnectStatusDto })
  @ValidateNested()
  @Type(() => WppConnectStatusDto)
  @IsOptional()
  status?: WppConnectStatusDto;

  @ApiProperty({ example: true })
  @IsBoolean()
  @IsOptional()
  connected?: boolean;
}