import { Injectable, Logger } from '@nestjs/common';
import { ErrorResponse } from 'src/base/exceptions/error.response.handler';
import { FirebaseService } from './firebase.service';

interface FileRecord {
  file: Express.Multer.File;
  storeId: string;
  channel: string;
  externalClientId: string;
  fileCategory?: string;
  preferredFileName?: string;
  userId?: string;
  entity?: string;
  entityId?: string;
  name?: string;
  type?: string;
  url?: string;
  expirationDate?: Date;
}

interface SaveFileParams {
  file: Express.Multer.File;
  userId: string;
  entity: string;
  entityId: string;
}

interface GetFileParams {
  entity: string;
  entityId: string;
  userId: string;
}

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  private static readonly EXPIRATION_DAYS = 5;
  private static readonly SAFE_RENEWAL_DAYS = 1;

  private static readonly ALLOWED_MIME = new Set<string>([
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/png',
    'audio/midi',
    'audio/mpeg',
    'audio/webm',
    'audio/ogg',
    'audio/wav',
    'audio/mp4',
    'video/mp4',
    'video/quicktime',
    'video/ogg',
    'video/webm',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
  ]);

  constructor(
    private readonly firebaseService: FirebaseService,
  ) { }

  private addDays(base: Date, days: number): Date {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    return d;
  }

  private now(): Date {
    return new Date();
  }

  private shouldRenew(validUntil: Date): boolean {
    const threshold = this.addDays(this.now(), FileService.SAFE_RENEWAL_DAYS);
    return validUntil <= threshold;
  }

  private computeUrlExpiration(): Date {
    return this.addDays(this.now(), FileService.EXPIRATION_DAYS);
  }

  private normalizeMime(input?: string): string {
    return (input ?? '').split(';', 1)[0].trim();
  }

  private ensureAllowedMime(mime: string): void {
    if (!FileService.ALLOWED_MIME.has(mime)) {
      throw new ErrorResponse(`Invalid file type. Accepted: ${Array.from(FileService.ALLOWED_MIME).join(', ')}`, 400);
    }
  }

  private extensionFromName(name?: string): string {
    if (!name) return '';
    const idx = name.lastIndexOf('.');
    return idx >= 0 ? name.slice(idx + 1) : '';
  }

  private buildObjectKey(params: { userId: string; entity: string; entityId: string; extension?: string }): string {
    const { userId, entity, entityId, extension } = params;
    const ext = extension ? `.${extension.toLowerCase()}` : '';
    const rand = Math.random().toString(36).slice(2, 8);
    const stamp = Date.now();

    return `uploads/${entity}/${userId}/${entityId}/${stamp}-${rand}${ext}`;
  }

  private determineCategoryFromMime(mimetype: string): string {
    const mime = this.normalizeMime(mimetype);
    if (mime.startsWith('image/')) return 'Fotos';
    if (mime.startsWith('audio/')) return 'Audio';
    if (mime.startsWith('video/')) return 'Video';
    if (
      mime === 'application/pdf' ||
      mime.startsWith('application/msword') ||
      mime.startsWith('application/vnd.openxmlformats-officedocument') ||
      mime.startsWith('text/')
    ) {
      return 'Documentos';
    }
    return 'Documentos';
  }

  private createFileRecord(params: {
    userId: string;
    entity: string;
    entityId: string;
    name: string;
    type: string;
    url: string;
    expirationDate: Date;
  }): FileRecord {
    return {
      ...params,
      file: {} as Express.Multer.File,
      storeId: params.userId,
      channel: params.entity,
      externalClientId: params.entityId,
    };
  }

  async saveFileStructured(params: FileRecord): Promise<FileRecord> {
    const { file, storeId, channel, externalClientId, fileCategory, preferredFileName } = params;

    if (!file) throw new ErrorResponse('No file was uploaded.', 400);

    const mime = this.normalizeMime(file.mimetype);
    this.ensureAllowedMime(mime);

    const extension = this.extensionFromName(file.originalname);
    const category = fileCategory || this.determineCategoryFromMime(mime);
    const fileName = preferredFileName || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension ? '.' + extension : ''}`;
    const objectKey = `${storeId}/${channel}/${externalClientId}/${category}/${fileName}`;

    let uploadedUrl: string | null = null;
    try {
      const buffer = file.buffer;
      const [, url] = await this.firebaseService.uploadBufferToPath(buffer, mime, objectKey);
      uploadedUrl = url;

      const expirationDate = this.computeUrlExpiration();

      const record = this.createFileRecord({
        userId: storeId,
        entity: channel,
        entityId: externalClientId,
        name: objectKey,
        type: mime,
        url,
        expirationDate,
      });
      return record;
    } catch (err) {
      if (uploadedUrl) {
        try { await this.firebaseService.deleteFile(objectKey); } catch { }
      }
      if (err instanceof ErrorResponse) throw err;
      throw new ErrorResponse('Error saving file.', 500);
    }
  }

  private async uploadWithKey(file: Express.Multer.File, key: string): Promise<[string, string]> {
    return this.firebaseService.uploadFile(Object.assign({}, file, { originalname: key }));
  }

  async saveFile(params: SaveFileParams): Promise<FileRecord> {
    const { file, userId, entity, entityId } = params;

    if (!file) throw new ErrorResponse('No file was uploaded.', 400);

    const mime = this.normalizeMime(file.mimetype);
    this.ensureAllowedMime(mime);

    const extension = this.extensionFromName(file.originalname);
    const objectKey = this.buildObjectKey({ userId, entity, entityId, extension });

    let uploadedKey: string | null = null;
    let uploadedUrl: string | null = null;

    try {
      const [key, url] = await this.uploadWithKey(file, objectKey);
      uploadedKey = key;
      uploadedUrl = url;

      const expirationDate = this.computeUrlExpiration();

      const record = this.createFileRecord({
        userId,
        entity,
        entityId,
        name: key,
        type: mime,
        url,
        expirationDate,
      });

      return record;
    } catch (err) {
      if (uploadedKey) {
        try {
          await this.firebaseService.deleteFile(uploadedKey);
        } catch (cleanupErr) {
          this.logger.error(
            `Compensation failed: unable to delete uploaded object ${uploadedKey}`,
            cleanupErr instanceof Error ? cleanupErr.stack : undefined,
          );
        }
      }
      if (err instanceof ErrorResponse) throw err;
      throw new ErrorResponse('Error saving file.', 500);
    }
  }

  async getFile(params: GetFileParams): Promise<FileRecord | null> {
    return null;
  }

  async deleteFile(fileId: string): Promise<void> {
    const errors: string[] = [];

    try {
      await this.firebaseService.deleteFile(fileId);
    } catch (err) {
      errors.push('Storage delete failed');
      this.logger.error('Error deleting file from storage', err instanceof Error ? err.stack : undefined);
    }

    if (errors.length) {
      throw new ErrorResponse('Error deleting file.', 500);
    }
  }
}
