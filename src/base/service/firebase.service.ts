import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { getFirebaseConfig } from 'src/base/config/firebase.config';
import { ErrorResponse } from 'src/base/exceptions/error.response.handler';
import { v4 as uuidv4 } from 'uuid';
import { Bucket } from '@google-cloud/storage';

@Injectable()
export class FirebaseService {
  private readonly logger = new Logger(FirebaseService.name);
  private firebaseApp: admin.app.App;
  private bucket: Bucket;
  private readonly EXPIRATION_DAYS = 5;

  constructor() {
    this.initializeFirebase();
  }

  private initializeFirebase() {
    try {
      const firebaseConfig = getFirebaseConfig();
      const privateKey = (firebaseConfig.private_key || '').replace(/\\n/g, '\n');

      const storageBucket = `${firebaseConfig.project_id}.firebasestorage.app`;
      
      if (admin.apps.length > 0) {
        this.firebaseApp = admin.apps[0] as admin.app.App;
        this.logger.log('Firebase already initialized, reusing existing app');
      } else {
        this.firebaseApp = admin.initializeApp({
          credential: admin.credential.cert({
            projectId: firebaseConfig.project_id,
            clientEmail: firebaseConfig.client_email,
            privateKey,
          }),
          storageBucket,
        });
        this.logger.log(`Firebase initialized with bucket: ${storageBucket}`);
      }

      this.bucket = this.firebaseApp.storage().bucket();
      this.logger.log(`Bucket initialized: ${this.bucket?.name || 'undefined'}`);
      
      if (!this.bucket) {
        this.logger.error('Failed to initialize bucket - bucket is undefined');
      }
    } catch (error) {
      this.logger.error('Error initializing Firebase:', error);
    }
  }


  /**
   * Determine the folder based on file MIME type
   * @param mimetype File MIME type
   * @returns Folder name
   */
  private getFolderByMimeType(mimetype: string): string {
    const mime = mimetype.split(';')[0].trim().toLowerCase();

    if (mime.startsWith('image/')) {
      return 'Fotos';
    }

    if (mime.startsWith('audio/')) {
      return 'Audio';
    }

    if (mime.startsWith('video/')) {
      return 'Video';
    }

    if (mime === 'application/pdf' ||
      mime.startsWith('application/msword') ||
      mime.startsWith('application/vnd.openxmlformats-officedocument') ||
      mime.startsWith('text/')) {
      return 'Documentos';
    }

    return 'Documentos';
  }

  /**
   * Upload a file to Firebase Storage with organized folders
   * @param file File to be uploaded
   * @returns Array with [filename, file URL]
   */
  async uploadFile(file: Express.Multer.File): Promise<[string, string]> {
    try {
      if (!this.bucket) {
        throw new ErrorResponse('Firebase Storage not initialized', 500);
      }

      if (!file) {
        throw new ErrorResponse('No file was provided.', 400);
      }

      const folder = this.getFolderByMimeType(file.mimetype);

      const fileName = `${folder}/${uuidv4()}_${file.originalname}`;
      const fileRef = this.bucket.file(fileName);

      await fileRef.save(file.buffer, {
        metadata: {
          contentType: file.mimetype,
        },
      });

      const url = await this.fileUrl(fileName);

      return [fileName, url];
    } catch (error) {
      this.logger.error('Error uploading file:', error);
      throw new ErrorResponse('Error uploading file to Firebase Storage', 500);
    }
  }

  /**
   * Upload a raw buffer to an exact path in Firebase Storage
   * @param buffer File contents
   * @param contentType MIME type
   * @param path Exact storage path (e.g., "{instanceId}/profile/avatar.jpg")
   * @returns [key, url]
   */
  async uploadBufferToPath(buffer: Buffer, contentType: string, path: string): Promise<[string, string]> {
    try {
      this.logger.log(`[UPLOAD] Starting upload - path: ${path}, contentType: ${contentType}, bufferSize: ${buffer?.length || 0}`);
      
      if (!this.bucket) {
        this.logger.error('[UPLOAD] Bucket is not initialized');
        throw new ErrorResponse('Firebase Storage not initialized', 500);
      }

      if (!buffer || !path) {
        this.logger.error(`[UPLOAD] Invalid params - buffer: ${!!buffer}, path: ${path}`);
        throw new ErrorResponse('Invalid upload parameters.', 400);
      }

      this.logger.log(`[UPLOAD] Creating file reference...`);
      const fileRef = this.bucket.file(path);
      
      this.logger.log(`[UPLOAD] Saving file to bucket...`);
      await fileRef.save(buffer, {
        metadata: { contentType },
      });

      this.logger.log(`[UPLOAD] File saved, generating URL...`);
      const url = await this.fileUrl(path);
      
      this.logger.log(`[UPLOAD] Upload complete: ${url.substring(0, 100)}...`);
      return [path, url];
    } catch (error: any) {
      this.logger.error(`[UPLOAD] Error uploading buffer to path: ${error?.message}`);
      this.logger.error(`[UPLOAD] Error details:`, error);
      throw new ErrorResponse('Error uploading file to Firebase Storage', 500);
    }
  }

  /**
   * Delete a file by its storage path
   */
  async deleteByPath(path: string): Promise<void> {
    try {
      if (!this.bucket) {
        throw new ErrorResponse('Firebase Storage not initialized', 500);
      }

      const fileRef = this.bucket.file(path);
      await fileRef.delete({ ignoreNotFound: true } as any);
    } catch (error) {
      this.logger.error('Error deleting file by path:', error);
      throw new ErrorResponse('Error deleting file from Firebase Storage', 500);
    }
  }

  /**
   * Generate a signed URL for file access
   * @param fileName Name of the file in Firebase Storage
   * @returns Signed URL for file access
   */
  async fileUrl(fileName: string): Promise<string> {
    try {
      if (!this.bucket) {
        throw new ErrorResponse('Firebase Storage not initialized', 500);
      }

      const file = this.bucket.file(fileName);

      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + this.EXPIRATION_DAYS);

      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: expirationDate,
      });

      return url;
    } catch (error) {
      this.logger.error('Error generating file URL:', error);
      throw new ErrorResponse('Error generating file URL in Firebase Storage', 500);
    }
  }

  /**
   * Delete a file from Firebase Storage
   * @param fileName Name of the file to be deleted
   * @returns Object with the deleted file key
   */
  async deleteFile(fileName: string): Promise<{ key: string }> {
    try {
      if (!this.bucket) {
        throw new ErrorResponse('Firebase Storage not initialized', 500);
      }

      const file = this.bucket.file(fileName);
      await file.delete();
      return { key: fileName };
    } catch (error) {
      this.logger.error('Error deleting file:', error);
      throw new ErrorResponse('Error deleting file from Firebase Storage', 500);
    }
  }

  /**
   * Get file content as buffer
   * @param fileName Name of the file in Firebase Storage
   * @returns Buffer with file content
   */
  async getFileBuffer(fileName: string): Promise<Buffer> {
    try {
      if (!this.bucket) {
        throw new ErrorResponse('Firebase Storage not initialized', 500);
      }

      const file = this.bucket.file(fileName);
      const [buffer] = await file.download();
      return buffer;
    } catch (error) {
      this.logger.error('Error downloading file:', error);
      throw new ErrorResponse('Error downloading file from Firebase Storage', 500);
    }
  }

  /**
   * Get a signed URL for file upload
   * @param fileName Name of the file to be uploaded
   * @returns Signed URL for file upload
   */
  async getUploadFileUrl(fileName: string): Promise<string> {
    try {
      if (!this.bucket) {
        throw new ErrorResponse('Firebase Storage not initialized', 500);
      }

      const file = this.bucket.file(fileName);

      const [url] = await file.getSignedUrl({
        action: 'write',
        expires: Date.now() + 5 * 1000,
        contentType: 'application/octet-stream',
      });

      return url;
    } catch (error) {
      this.logger.error('Error generating upload URL:', error);
      throw new ErrorResponse('Error generating upload URL in Firebase Storage', 500);
    }
  }
}
