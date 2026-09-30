import { MessageTypeEnum } from "../integrations/enum/message-type.enum";
import * as QRCode from 'qrcode';
import * as fs from 'fs';
import { ErrorResponse } from "src/base/exceptions/error.response.handler";
import { Logger } from "@nestjs/common";
import { execSync } from "child_process";

const logger = new Logger('WhatsappUtils');

export function hashForLog(value: string): string {
    try {
        if (!value) return 'null';

        const crypto = require('crypto');
        return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
    } catch {
        return 'hash_err';
    }
}

export function mapWhatsAppTypeToUnified(type: string): MessageTypeEnum {
    switch (type) {
        case 'chat':
        case 'extendedTextMessage':
        case 'text':
            return MessageTypeEnum.TEXT;
        case 'image':
            return MessageTypeEnum.IMAGE;
        case 'video':
            return MessageTypeEnum.VIDEO;
        case 'ptt':
        case 'audio':
            return MessageTypeEnum.AUDIO;
        case 'voice':
            return MessageTypeEnum.VOICE;
        case 'document':
            return MessageTypeEnum.DOCUMENT;
        case 'sticker':
            return MessageTypeEnum.STICKER;
        case 'location':
            return MessageTypeEnum.LOCATION;
        case 'vcard':
        case 'contact_card':
            return MessageTypeEnum.CONTACT;
        case 'contacts_array':
            return MessageTypeEnum.CONTACT_MULTI;
        case 'list':
            return MessageTypeEnum.LIST;
        case 'list_response':
            return MessageTypeEnum.LIST_RESPONSE;
        case 'buttons_response':
            return MessageTypeEnum.BUTTONS_RESPONSE;
        case 'reaction':
            return MessageTypeEnum.REACTION;
        case 'payment':
            return MessageTypeEnum.PAYMENT;
        case 'order':
            return MessageTypeEnum.ORDER;
        case 'poll_creation':
        case 'poll':
            return MessageTypeEnum.POLL;
        case 'event_creation':
        case 'scheduled_event_creation':
            return MessageTypeEnum.EVENT;
        default:
            return MessageTypeEnum.UNKNOWN;
    }
}

export async function qrToBase64(qr: string): Promise<string> {
    try {
        return await QRCode.toDataURL(qr);
    } catch (err: any) {
        throw new ErrorResponse(`Erro ao converter QR Code para base64: ${err?.message}`, 500);
    }
}

export function normalizePhone(phoneNumber: string): string {
    return (phoneNumber || '').replace(/\D/g, '');
}

export function removeStaleChromiumLock(instanceId: string): void {
    const lockPaths = [
        `/tmp/chrome-user-data-${instanceId}/SingletonLock`,
        `/private/tmp/chrome-user-data-${instanceId}/SingletonLock`,
        `/app/.wwebjs_auth/session-${instanceId}/SingletonLock`,
        `${process.cwd()}/.wwebjs_auth/session-${instanceId}/SingletonLock`,
    ];

    for (const lockPath of lockPaths) {
        try {
            if (fs.existsSync(lockPath)) {
                fs.unlinkSync(lockPath);
                logger.log(`[cleanup] Removed SingletonLock: ${lockPath}`);
            }
        } catch (e: any) {
            logger.warn(`[cleanup] Failed to remove SingletonLock ${lockPath}: ${e?.message}`);
        }
    }
}

export async function clearLocalAuthSession(instanceId: string): Promise<void> {
    try {
        const sessionPaths = [
            `/app/.wwebjs_auth/session-${instanceId}`,
            `${process.cwd()}/.wwebjs_auth/session-${instanceId}`,
        ];

        for (const base of sessionPaths) {
            if (fs.existsSync(base)) {
                fs.rmSync(base, { recursive: true, force: true });
                logger.log(`[cleanup] Local session removed: ${base}`);
            }
        }
    } catch (e: any) {
        logger.warn(`[cleanup] Failed to clear local session for ${instanceId}: ${e?.message}`);
    }
}

export function clearTempDirs(instanceId: string): void {
    const dirs = [
        `/tmp/chrome-user-data-${instanceId}`,
        `/tmp/chrome-data-${instanceId}`,
        `/tmp/chrome-cache-${instanceId}`,
        `/private/tmp/chrome-user-data-${instanceId}`,
        `/private/tmp/chrome-data-${instanceId}`,
        `/private/tmp/chrome-cache-${instanceId}`,
    ];
    for (const d of dirs) {
        try { if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true }); } catch (e: any) {
            logger.warn(`[cleanup] Failed to remove temp dir ${d}: ${e?.message}`);
        }
    }
}

export function forceResetSession(instanceId: string): void {
    logger.log(`[force-reset] Starting complete session reset for ${instanceId}`);

    removeStaleChromiumLock(instanceId);

    const sessionPaths = [
        `/app/.wwebjs_auth/session-${instanceId}`,
        `${process.cwd()}/.wwebjs_auth/session-${instanceId}`,
        `/app/.wwebjs_auth/${instanceId}`,
        `${process.cwd()}/.wwebjs_auth/${instanceId}`,
        `/app/RemoteAuth-${instanceId}.zip`,
        `${process.cwd()}/RemoteAuth-${instanceId}.zip`
    ];

    for (const sessionPath of sessionPaths) {
        try {
            if (fs.existsSync(sessionPath)) {
                fs.rmSync(sessionPath, { recursive: true, force: true });
                logger.log(`[force-reset] Removed session: ${sessionPath}`);
            }
        } catch (e: any) {
            logger.warn(`[force-reset] Failed to remove session ${sessionPath}: ${e?.message}`);
        }
    }

    clearTempDirs(instanceId);

    try {
        const { execSync } = require('child_process');
        execSync(`pkill -f "chrome.*${instanceId}"`, { stdio: 'ignore' });
        execSync(`pkill -f "chromium.*${instanceId}"`, { stdio: 'ignore' });
        logger.log(`[force-reset] Killed Chrome/Chromium processes for ${instanceId}`);
    } catch (e) {
        // Silent fail
    }

    try {
        const potentialFiles = [
            `/tmp/puppeteer*${instanceId}*`,
            `/app/RemoteAuth-${instanceId}.zip`,
            `${process.cwd()}/RemoteAuth-${instanceId}.zip`,
        ];

        for (const pattern of potentialFiles) {
            try {
                execSync(`rm -rf ${pattern}`, { stdio: 'ignore' });
            } catch (e) {
            }
        }
    } catch (e) {
    }

    logger.log(`[force-reset] Complete session reset finished for ${instanceId}`);
}

export async function clearRemoteAuthSession(instanceId: string, storeId: string, redisService?: any): Promise<void> {
    if (!redisService) {
        logger.warn(`[cleanup] No Redis service provided, skipping remote session cleanup for ${instanceId}`);
        return;
    }

    try {
        const sessionKey = `whatsapp:session:store_${storeId}_${instanceId}`;
        await redisService.del(sessionKey);
        logger.log(`[cleanup] Remote session removed: ${sessionKey}`);
    } catch (e: any) {
        logger.warn(`[cleanup] Failed to clear remote session for ${instanceId}: ${e?.message}`);
    }
}

export async function clearAllSessions(instanceId: string, storeId: string, redisService?: any): Promise<void> {
    logger.log(`[cleanup] Starting complete session cleanup for ${instanceId}`);

    await clearLocalAuthSession(instanceId);

    if (redisService) {
        await clearRemoteAuthSession(instanceId, storeId, redisService);
    }

    removeStaleChromiumLock(instanceId);

    clearTempDirs(instanceId);

    logger.log(`[cleanup] Complete session cleanup finished for ${instanceId}`);
}

export function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}
