import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import axios from 'axios';

import { FileService } from 'src/base/service/file.service';
import { FirebaseService } from 'src/base/service/firebase.service';

import { IntegrationsEnum } from 'src/core/integrations/enum/integrations.enum';
import { MessageTypeEnum } from 'src/core/integrations/enum/message-type.enum';
import { ChatOutgoingMessageDto, ContatoDto, LocationDto } from 'src/core/comunication/dto/outgoing-message.dto';

import { hashForLog, mapWhatsAppTypeToUnified } from '../whatsapp.utils';

import type { Message } from 'whatsapp-web.js';

@Injectable()
export class WhatsappMessageReceiver {
    private readonly logger = new Logger(WhatsappMessageReceiver.name);

    private messageOrderBuffer = new Map<string, ChatOutgoingMessageDto[]>();
    private deliveredIds = new Map<string, Set<string>>();
    private messageProcessingTimers = new Map<string, NodeJS.Timeout>();
    private lastMessageTime = new Map<string, number>();

    private messageCountPerMinute = new Map<string, number>();
    private lastThrottleReset = new Map<string, number>();

    private static readonly MIN_ORDERING_DELAY_MS = 100;
    private static readonly MED_ORDERING_DELAY_MS = 300;
    private static readonly MAX_ORDERING_DELAY_MS = 800;
    private static readonly BURST_THRESHOLD_MS = 2000;
    private static readonly HISTORICAL_MESSAGE_THRESHOLD_MS = 2 * 60 * 1000;
    
    private static readonly MAX_MESSAGES_PER_MINUTE = 120;
    private static readonly THROTTLE_WINDOW_MS = 60_000;

    private static lastFirebaseUpload = 0;
    private static readonly FIREBASE_DELAY_MS = 200;

    private static readonly ALLOWED_MIME = new Set<string>([
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/webp',
        'audio/mpeg',
        'audio/ogg',
        'audio/mp4',
        'video/mp4',
        'video/quicktime',
        'video/ogg',
        'video/webm',
        'application/pdf',
        'image/webp',
    ]);

    constructor(
        private readonly events: EventEmitter2,
        private readonly fileService: FileService,
        private readonly firebase: FirebaseService,
    ) { }

    private async getContactFromBackend(numero: string, storeId: string): Promise<{ nome: string; avatar?: string } | null> {
        try {
            const backendUrl = process.env.BACKEND_URL || 'https://api.autopilot.com.br';
            const apiKey = process.env.API_KEY;

            const response = await axios.get(`${backendUrl}/chat/buscar-contato-por-numero`, {
                params: { numero, storeId },
                headers: { 'x-micro-token': apiKey },
                timeout: 5000,
            });

            return response.data || null;
        } catch (error: any) {
            this.logger.warn(`Erro ao consultar contato no backend: ${error?.message}`);
            return null;
        }
    }

    private async obterNomeContato(contact: any, numero: string, storeId: string): Promise<string> {
        const whatsappName = contact?.name || contact?.pushname;
        if (whatsappName) {
            this.logger.debug(`Nome obtido do WhatsApp: ${whatsappName} para ${numero}`);
            return whatsappName;
        }

        this.logger.debug(`Nome não encontrado no WhatsApp para ${numero}, consultando backend...`);
        const contactFromBackend = await this.getContactFromBackend(numero, storeId);
        if (contactFromBackend?.nome) {
            this.logger.log(`Nome obtido do backend: ${contactFromBackend.nome} para ${numero}`);
            return contactFromBackend.nome;
        }

        this.logger.debug(`Nome não encontrado no backend para ${numero}, usando fallback`);
        return `Contato ${numero}`;
    }

    async uploadContactAvatar(instanceId: string, contactId: string, avatarUrl?: string): Promise<string | null> {
        if (!avatarUrl) return null;

        try {
            const response = await axios.get<ArrayBuffer>(avatarUrl, { responseType: 'arraybuffer', timeout: 20_000 });
            const contentType = (response.headers['content-type'] as string) || 'image/jpeg';
            const buffer = Buffer.from(response.data as any);
            const path = `${instanceId}/profile/${contactId}`;
            try { await this.firebase.deleteByPath(path); } catch { }
            const [, url] = await this.firebase.uploadBufferToPath(buffer, contentType, path);
            return url;
        } catch (e: any) {
            this.logger.warn(`uploadContactAvatar fallback: ${e?.message}`);
            return avatarUrl ?? null;
        }
    }

    async handleIncomingMessage(message: Message & any, instanceId: string, storeId: string) {
        try {
            if (this.shouldIgnoreMessage(message)) return;
            if (this.isHistoricalMessage(message)) return;

            if (this.shouldThrottleMessage(instanceId)) {
                this.logger.warn(`[throttle] Rate limit exceeded for ${instanceId}, message delayed`);
                await new Promise(resolve => setTimeout(resolve, 1000)); // Aguarda 1 segundo
            }

            if (message.hasQuotedMsg) {
                this.logger.log(`Processing reply message - ID: ${message.id?.id || message.id?._serialized} hasQuotedMsg: ${message.hasQuotedMsg}`);
            }

            const contact = await message.getContact();
            let profilePicUrl: string | null = null;
            try { profilePicUrl = await contact.getProfilePicUrl(); } catch { }

            let messageText: string | undefined;
            let contacts: ContatoDto[] | undefined;
            let locationData: LocationDto | undefined;
            let mediaUrl: string | undefined;
            let quotedMessageId: string | undefined;

            let dataNode: any = message;
            if (message._data?.ephemeralMessage?.message) {
                dataNode = message._data.ephemeralMessage.message;
            }

            if (message.hasQuotedMsg) {
                try {
                    const quotedMessage = await message.getQuotedMessage();
                    if (quotedMessage && quotedMessage.id) {
                        quotedMessageId = quotedMessage.id?.id ?? quotedMessage.id?._serialized;
                        this.logger.log(`Message is a reply to: ${quotedMessageId}`);
                    } else {
                        quotedMessageId = message._data?.quotedStanzaID;
                        if (quotedMessageId) {
                            this.logger.log(`Reply ID extracted from quotedStanzaID: ${quotedMessageId}`);
                        }
                    }
                } catch (error: any) {
                    this.logger.warn(`Failed to get quoted message: ${error?.message}`);
                    quotedMessageId = message._data?.quotedStanzaID;
                    if (quotedMessageId) {
                        this.logger.log(`Reply ID fallback from quotedStanzaID: ${quotedMessageId}`);
                    }
                }
            }

            const type = dataNode?.type || message.type;
            if (dataNode?.hasMedia || message.hasMedia || message._data?.ephemeralMessage || type === 'sticker') {
                try {
                    const messageAge = Date.now() - (message.timestamp * 1000);
                    const skipOldMedia = messageAge > (24 * 60 * 60 * 1000);
                    
                    if (skipOldMedia) {
                        this.logger.debug(`Skipping media download for old message (${Math.floor(messageAge / 3600000)}h old)`);
                    }

                    const media = skipOldMedia ? null : await message.downloadMedia();
                    if (media?.mimetype) {
                        const mime = String(media.mimetype).split(';')[0].trim();
                        if (WhatsappMessageReceiver.ALLOWED_MIME.has(mime)) {
                            const buffer = Buffer.from(media.data, 'base64');
                            const file: Express.Multer.File = {
                                buffer,
                                originalname: `whatsapp_${Date.now()}.${this.getExtensionFromMimetype(mime)}`,
                                mimetype: mime,
                                size: buffer.length,
                                fieldname: 'file',
                                stream: undefined as any,
                                destination: undefined as any,
                                encoding: '7bit',
                                filename: undefined as any,
                                path: undefined as any,
                            };

                            const attachment = await this.fileService.saveFile({
                                file,
                                userId: storeId,
                                entity: 'whatsapp_message',
                                entityId: (message.id?.id || '0').split('_')[0] || '0',
                            });
                            mediaUrl = attachment.url;
                        }
                    }
                } catch (err: any) {
                    this.logger.error(`download/upload media error: ${err?.message}`);
                }
            }

            switch (type) {
                case 'chat':
                    messageText = dataNode.conversation ?? message.body;
                    break;
                case 'extendedTextMessage':
                    messageText = dataNode.extendedTextMessage?.text ?? message.body;
                    break;
                case 'list_response': {
                    try {
                        const title =
                            dataNode?.listResponseMessage?.singleSelectReply?.selectedRowId ||
                            message?._data?.listResponse?.title ||
                            message?.body;
                        messageText = title ? `Selecionou: ${String(title)}` : message.body;
                    } catch {
                        messageText = message.body;
                    }
                    break;
                }
                case 'buttons_response': {
                    try {
                        const selected =
                            dataNode?.buttonsResponseMessage?.selectedButtonId ||
                            dataNode?.buttonsResponseMessage?.selectedDisplayText ||
                            message?._data?.selectedButtonId ||
                            message?.body;
                        messageText = selected ? `Clicou: ${String(selected)}` : message.body;
                    } catch {
                        messageText = message.body;
                    }
                    break;
                }
                case 'sticker': {
                    messageText = mediaUrl ? '' : 'Sticker';
                    break;
                }
                case 'vcard': {
                    contacts = Array.isArray(message.vCards)
                        ? message.vCards.map((vcard: string) => this.parseVCard(vcard))
                        : undefined;
                    break;
                }
                case 'location': {
                    const loc = message.location;
                    if (loc) {
                        locationData = { lat: loc.latitude, lng: loc.longitude, name: loc.name, address: loc.address };
                    }
                    break;
                }
                default:
                    messageText = message.body;

                    if (quotedMessageId && !messageText && !mediaUrl && !locationData && !contacts) {
                        messageText = '[Mensagem de resposta]';
                        this.logger.debug(`Empty reply message filled with placeholder text for ${quotedMessageId}`);
                    }
            }

            const idDestApi = message.fromMe ? String(message.to || '').split('@')[0] : String(message.from || '').split('@')[0];
            const nomeContato = await this.obterNomeContato(contact, idDestApi, storeId);

            const outgoing: ChatOutgoingMessageDto = {
                storeId: storeId,
                idMensagem: message.id?.id ?? message.id?._serialized ?? String(Date.now()),
                idDestinatarioApiExterna: idDestApi,
                mensagem: messageText,
                anexoMensagem: mediaUrl,
                mensagemReferencia: quotedMessageId,
                canal: IntegrationsEnum.WHATSAPP,
                tipo: mapWhatsAppTypeToUnified(type as string) as MessageTypeEnum,
                timestamp: new Date((message.timestamp ? message.timestamp * 1000 : Date.now())),
                enviadaLoja: !!message.fromMe,
                metadados: { nome: nomeContato, celular: idDestApi, urlAvatar: profilePicUrl || undefined },
                contatos: contacts,
                location: locationData,
            };

            const senderKey = `${storeId}-${idDestApi}`;

            if (quotedMessageId) {
                this.logger.log(`Reply message processed - Original: ${quotedMessageId} | New: ${outgoing.idMensagem} | Type: ${outgoing.tipo}`);
            }

            this.addMessageToOrderBuffer(senderKey, outgoing);
        } catch (error: any) {
            this.logger.error(`handleIncomingMessage error: ${error?.message}`);
        }
    }

    addMessageToOrderBuffer(senderKey: string, message: ChatOutgoingMessageDto) {
        if (!this.messageOrderBuffer.has(senderKey)) this.messageOrderBuffer.set(senderKey, []);

        const buffer = this.messageOrderBuffer.get(senderKey)!;
        buffer.push(message);

        const delay = this.calculateAdaptiveDelay(senderKey, buffer.length);

        const replyInfo = message.mensagemReferencia ? ` reply:${hashForLog(message.mensagemReferencia)}` : '';
        this.logger.log(`[orderBuffer] +1 message {sender:${hashForLog(senderKey)} size:${buffer.length} type:${message.tipo} delay:${delay}ms id:${hashForLog(message.idMensagem)}${replyInfo} }`);

        const existing = this.messageProcessingTimers.get(senderKey);
        if (existing) clearTimeout(existing);

        const t = setTimeout(() => this.processOrderedMessages(senderKey), delay);
        this.messageProcessingTimers.set(senderKey, t);
    }

    private calculateAdaptiveDelay(senderKey: string, bufferSize: number): number {
        const now = Date.now();
        const lastTime = this.lastMessageTime.get(senderKey) || 0;
        const timeSinceLast = now - lastTime;

        this.lastMessageTime.set(senderKey, now);

        if (bufferSize === 1 && timeSinceLast > WhatsappMessageReceiver.BURST_THRESHOLD_MS) {
            return WhatsappMessageReceiver.MIN_ORDERING_DELAY_MS;
        }

        if (timeSinceLast < 500 || bufferSize > 3) {
            return WhatsappMessageReceiver.MAX_ORDERING_DELAY_MS;
        }

        return WhatsappMessageReceiver.MED_ORDERING_DELAY_MS;
    }

    private processOrderedMessages(senderKey: string) {
        const buffer = this.messageOrderBuffer.get(senderKey);
        if (!buffer || buffer.length === 0) {
            this.messageProcessingTimers.delete(senderKey);
            this.messageOrderBuffer.delete(senderKey);
            return;
        }

        buffer.sort((a, b) => {
            const ta = a.timestamp.getTime();
            const tb = b.timestamp.getTime();
            if (ta !== tb) return ta - tb;
            const ia = String(a.idMensagem || '');
            const ib = String(b.idMensagem || '');
            return ia.localeCompare(ib);
        });

        const delivered = this.deliveredIds.get(senderKey) || new Set<string>();
        this.deliveredIds.set(senderKey, delivered);

        const toEmit: ChatOutgoingMessageDto[] = [];
        for (const m of buffer) {
            const key = String(m.idMensagem || `${m.timestamp.getTime()}-${Math.random()}`);
            if (!delivered.has(key)) {
                toEmit.push(m);
                delivered.add(key);
            }
        }

        if (toEmit.length > 0) {
            this.logger.log(`[orderBuffer] emitting message.receive x${toEmit.length} {sender:${hashForLog(senderKey)}}`);
            this.events.emit('message.receive', toEmit[0]);
            for (let i = 1; i < toEmit.length; i++) {
                setTimeout(() => this.events.emit('message.receive', toEmit[i]), i * 200);
            }
        }

        if (delivered.size > 1000) {
            const arr = Array.from(delivered).slice(-500);
            this.deliveredIds.set(senderKey, new Set(arr));
        }

        this.messageProcessingTimers.delete(senderKey);
        this.messageOrderBuffer.delete(senderKey);
    }

    cleanupOldTimestamps() {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000;
        for (const [k, set] of this.deliveredIds.entries()) {
            if (set.size === 0) this.deliveredIds.delete(k);
        }
    }

    private parseVCard(vcard: string): ContatoDto {
        const lines = (vcard || '').split('\n');
        const fn = lines.find((l) => l.startsWith('FN:'))?.split(':')[1] ?? '';
        const telLine = lines.find((l) => l.startsWith('TEL')) || '';
        let phone = '';
        const m = telLine.match(/waid=([0-9]+)/);
        phone = m ? m[1] : telLine.replace(/\D/g, '');
        return { name: fn, phone };
    }

    private shouldIgnoreMessage(message: Message & any): boolean {
        const isStatusMessage = message.from === 'status@broadcast' || message.isStatus;
        const isGroupMessage = message.from?.endsWith('@g.us');
        const isEmpty = !message.body && !message.hasMedia && !message?._data?.ephemeralMessage;

        if (isStatusMessage || isGroupMessage) return true;
        if (isEmpty) {
            this.logger.debug('Ignoring empty historical sync message');
            return true;
        }

        return false;
    }

    private shouldThrottleMessage(instanceId: string): boolean {
        const now = Date.now();
        const lastReset = this.lastThrottleReset.get(instanceId) || 0;

        if (now - lastReset > WhatsappMessageReceiver.THROTTLE_WINDOW_MS) {
            this.messageCountPerMinute.set(instanceId, 0);
            this.lastThrottleReset.set(instanceId, now);
            return false;
        }

        const count = this.messageCountPerMinute.get(instanceId) || 0;
        this.messageCountPerMinute.set(instanceId, count + 1);

        if (count >= WhatsappMessageReceiver.MAX_MESSAGES_PER_MINUTE) {
            return true;
        }

        return false;
    }

    private isHistoricalMessage(message: Message & any): boolean {
        if (!message.timestamp) return false;

        const messageTime = this.getMessageTimestamp(message);
        const currentTime = Date.now();
        const messageAge = currentTime - messageTime;

        const isHistorical = messageAge > WhatsappMessageReceiver.HISTORICAL_MESSAGE_THRESHOLD_MS;

        if (isHistorical) {
            this.logger.debug(
                `Ignoring historical message from ${hashForLog(message.from)} ` +
                `(${Math.floor(messageAge / 1000)}s old)`
            );
        }

        return isHistorical;
    }

    isHistoricalEvent(event: any, eventType: string = 'event'): boolean {
        const timestamp = event?.timestamp;
        if (!timestamp) return false;

        const eventTime = timestamp * 1000;
        const currentTime = Date.now();
        const eventAge = currentTime - eventTime;

        const isHistorical = eventAge > WhatsappMessageReceiver.HISTORICAL_MESSAGE_THRESHOLD_MS;

        if (isHistorical) {
            this.logger.debug(
                `Ignoring historical ${eventType} ` +
                `(${Math.floor(eventAge / 1000)}s old)`
            );
        }

        return isHistorical;
    }

    private getMessageTimestamp(message: Message & any): number {
        return message.timestamp * 1000;
    }

    private getExtensionFromMimetype(mimetype: string): string {
        const map: Record<string, string> = {
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/png': 'png',
            'image/webp': 'webp',
            'image/gif': 'gif',
            'audio/ogg': 'ogg',
            'audio/mpeg': 'mp3',
            'audio/mp4': 'mp4',
            'audio/webm': 'webm',
            'audio/wav': 'wav',
            'audio/amr': 'amr',
            'audio/midi': 'midi',
            'video/mp4': 'mp4',
            'video/ogg': 'ogv',
            'video/quicktime': 'mov',
            'video/webm': 'webm',
            'application/pdf': 'pdf',
            'application/vnd.ms-excel': 'xls',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
            'application/msword': 'doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
        };
        return map[mimetype] || 'bin';
    }
}
