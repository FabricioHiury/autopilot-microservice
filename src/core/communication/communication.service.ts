import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../base/service/prisma.service';
import { OlxService } from '../olx/olx.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { WhatsappOfficialService } from '../whatsapp-official/whatsapp-official.service';
import { InstagramService } from '../instagram/instagram.service';
import { FacebookService } from '../facebook/facebook.service';
import { SendMessageDto } from './dto/incoming-message.dto';
import { VerifyWhatsappNumberDto } from './dto/verify-number-wpp.dto';
import { fingerprint } from '../delivery/delivery.utils';

export function validateContent(message: SendMessageDto): void {
  if (message.type === 'reaction') {
    if (!message.quotedMessageId || typeof message.text !== 'string')
      throw new BadRequestException(
        'Reaction requires text and quotedMessageId',
      );
  } else if (
    message.type === 'location' ||
    message.latitude != null ||
    message.longitude != null
  ) {
    if (
      !Number.isFinite(message.latitude) ||
      !Number.isFinite(message.longitude) ||
      Math.abs(message.latitude) > 90 ||
      Math.abs(message.longitude) > 180
    )
      throw new BadRequestException(
        'Valid latitude and longitude are required',
      );
  } else if (
    !message.text?.trim() &&
    !message.attachmentUrl &&
    !message.contacts?.length
  ) {
    throw new BadRequestException('Message content is required');
  }
}
@Injectable()
export class CommunicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly olx: OlxService,
    private readonly whatsapp: WhatsappService,
    private readonly whatsappOfficial: WhatsappOfficialService,
    private readonly instagram: InstagramService,
    private readonly facebook: FacebookService,
  ) {}
  async forwardMessageToChannel(message: SendMessageDto) {
    validateContent(message);
    const provider =
      message.channel === 'whatsapp'
        ? message.wppApiType
          ? message.wppApiType === 'official'
            ? 'official'
            : 'evolution'
          : (await this.prisma.whatsAppOfficialAuthData.findUnique({
                where: { storeId: message.storeId },
              }))
            ? 'official'
            : 'evolution'
        : message.channel;
    const hash = fingerprint({
      ...message,
      wppApiType: message.channel === 'whatsapp' ? provider : null,
    });
    let outbound;
    try {
      outbound = await this.prisma.outboundMessage.create({
        data: {
          storeId: message.storeId,
          messageId: message.messageId,
          channel: message.channel,
          recipient: message.recipient,
          provider,
          fingerprint: hash,
        },
      });
    } catch (error: any) {
      if (error.code !== 'P2002') throw error;
      const existing = await this.prisma.outboundMessage.findUnique({
        where: {
          storeId_messageId: {
            storeId: message.storeId,
            messageId: message.messageId,
          },
        },
      });
      if (!existing || existing.fingerprint !== hash)
        throw new ConflictException(
          'messageId was already used with different content',
        );
      if (existing.status === 'sent') return existing.response;
      if (existing.status === 'failed')
        throw new BadRequestException(
          existing.lastError || 'Previous send failed',
        );
      throw new ConflictException(
        'Send is in progress or its result is indeterminate; automatic resend is disabled',
      );
    }
    try {
      let outgoing = { ...message };
      if (message.quotedMessageId && provider !== 'evolution') {
        const quoted = await this.prisma.outboundMessage.findFirst({
          where: {
            storeId: message.storeId,
            messageId: message.quotedMessageId,
            channel: message.channel,
          },
        });
        outgoing.quotedMessageId =
          quoted?.externalMessageId || message.quotedMessageId;
      }
      if (['instagram', 'facebook', 'olx'].includes(provider)) {
        if (message.latitude != null && message.longitude != null)
          outgoing = {
            ...outgoing,
            text: [
              message.locationName,
              message.locationAddress,
              `https://maps.google.com/?q=${message.latitude},${message.longitude}`,
            ]
              .filter(Boolean)
              .join('\n'),
          };
        if (message.contacts?.length)
          outgoing = {
            ...outgoing,
            text: message.contacts
              .map((contact) => `${contact.name}: ${contact.phone}`)
              .join('\n'),
          };
        if (message.type === 'reaction' && provider !== 'instagram')
          throw new BadRequestException(
            'Reactions are not supported for this channel',
          );
        if (provider === 'olx' && message.attachmentUrl)
          throw new BadRequestException('OLX attachments are not supported');
      }
      let result: any;
      switch (provider) {
        case 'evolution':
          result = await this.whatsapp.sendMessage(outgoing);
          break;
        case 'official':
          result = await this.whatsappOfficial.sendMessage(outgoing);
          break;
        case 'instagram':
          result = await this.instagram.sendMessage(outgoing);
          break;
        case 'facebook':
          result = await this.facebook.sendMessage(outgoing);
          break;
        case 'olx':
          result = await this.olx.sendMessage(outgoing);
          break;
        default:
          throw new BadRequestException('Unsupported channel');
      }
      const id =
        typeof result === 'string'
          ? result
          : result?.externalMessageId || result?.response;
      const response = { externalMessageId: id || null, response: id || null };
      await this.prisma.outboundMessage.update({
        where: { id: outbound.id },
        data: {
          status: 'sent',
          externalMessageId: id || null,
          response,
          ...(result?.key ? { providerKey: result.key } : {}),
        },
      });
      return response;
    } catch (error: any) {
      const status = error.response?.status ?? error.getStatus?.();
      // Only explicit client-side/provider rejection proves the message was not accepted.
      const rejected =
        status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
      await this.prisma.outboundMessage.update({
        where: { id: outbound.id },
        data: {
          status: rejected ? 'failed' : 'indeterminate',
          lastError: String(error.message || 'Send failed').slice(0, 1000),
        },
      });
      if (rejected) throw error;
      throw new ServiceUnavailableException(
        'Provider send result is indeterminate; automatic resend is disabled',
      );
    }
  }
  async reconcile(
    storeId: string,
    messageId: string,
    externalMessageId: string,
  ) {
    // This operation requires explicit provider evidence supplied by an authenticated operator.
    const response = { externalMessageId, response: externalMessageId };
    const changed = await this.prisma.outboundMessage.updateMany({
      where: {
        storeId,
        messageId,
        OR: [
          { status: 'indeterminate' },
          {
            status: 'sending',
            updatedAt: { lt: new Date(Date.now() - 180000) },
          },
        ],
      },
      data: { status: 'sent', externalMessageId, response, lastError: null },
    });
    if (!changed.count)
      throw new ConflictException(
        'Only indeterminate or abandoned sends can be reconciled',
      );
    return response;
  }
  async listUncertain(storeId?: string) {
    return this.prisma.outboundMessage.findMany({
      where: {
        ...(storeId ? { storeId } : {}),
        status: { in: ['indeterminate', 'sending', 'failed'] },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  }
  async verifyWhatsappNumber(body: VerifyWhatsappNumberDto) {
    return this.whatsapp.checkNumberExists(body.storeId, body.phone);
  }
}
