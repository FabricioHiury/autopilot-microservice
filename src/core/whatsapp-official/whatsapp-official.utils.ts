import { MessageTypeEnum } from '../integrations/enum/message-type.enum';

export function mapWhatsAppOfficialTypeToUnified(type: string): MessageTypeEnum {
  const typeMap: Record<string, MessageTypeEnum> = {
    'text': MessageTypeEnum.TEXT,
    'image': MessageTypeEnum.IMAGE,
    'audio': MessageTypeEnum.AUDIO,
    'video': MessageTypeEnum.VIDEO,
    'document': MessageTypeEnum.DOCUMENT,
    'sticker': MessageTypeEnum.STICKER,
    'location': MessageTypeEnum.LOCATION,
    'contacts': MessageTypeEnum.CONTACT,
    'reaction': MessageTypeEnum.REACTION,
    'button': MessageTypeEnum.TEXT,
    'interactive': MessageTypeEnum.TEXT,
    'template': MessageTypeEnum.TEXT,
  };

  return typeMap[type] || MessageTypeEnum.TEXT;
}

export function normalizePhoneNumber(phone: string): string {
  return phone.replace(/\D/g, '');
}

export function formatPhoneForDisplay(phone: string): string {
  const normalized = normalizePhoneNumber(phone);
  return `+${normalized}`;
}

export function isValidPhone(phone: string): boolean {
  const normalized = phone.replace(/\D/g, '');
  return normalized.length >= 10 && normalized.length <= 15;
}

export function generateVerifyToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = 'verify_';
  
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return token;
}

export function isMediaMessage(type: string): boolean {
  return ['image', 'audio', 'video', 'document', 'sticker'].includes(type);
}

export function getMessagePreview(message: any): string {
  if (!message) return '';
  
  switch (message.type) {
    case 'text':
      return message.text?.body || '';
    case 'image':
      return '📷 Imagem' + (message.image?.caption ? `: ${message.image.caption}` : '');
    case 'audio':
      return '🎵 Áudio';
    case 'video':
      return '📹 Vídeo' + (message.video?.caption ? `: ${message.video.caption}` : '');
    case 'document':
      return '📄 Documento' + (message.document?.caption ? `: ${message.document.caption}` : '');
    case 'sticker':
      return '🎨 Figurinha';
    case 'location':
      return '📍 Localização';
    case 'contacts':
      return '👤 Contato';
    case 'reaction':
      return message.reaction?.emoji || '👍';
    default:
      return 'Mensagem';
  }
}

export function calculateWindowExpiry(lastMessageAt: Date): Date {
  const windowHours = 24;
  return new Date(lastMessageAt.getTime() + windowHours * 60 * 60 * 1000);
}

export function isWithinMessageWindow(lastMessageAt: Date | null): boolean {
  if (!lastMessageAt) return false;
  
  const expiry = calculateWindowExpiry(lastMessageAt);
  return expiry > new Date();
}

export function getHoursUntilWindowExpiry(lastMessageAt: Date): number {
  const expiry = calculateWindowExpiry(lastMessageAt);
  const now = new Date();
  
  if (expiry <= now) return 0;
  
  const hoursRemaining = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60);
  return Math.max(0, hoursRemaining);
}
