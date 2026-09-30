import { Injectable, Logger } from '@nestjs/common';
import { LocalAuth } from 'whatsapp-web.js';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class WhatsappLocalAuth {
  private readonly logger = new Logger(WhatsappLocalAuth.name);
  private readonly sessionPath: string;

  constructor() {
    this.sessionPath = process.env.WPP_SESSION_PATH || path.join(process.cwd(), '.wwebjs_auth');
    this.ensureDir(this.sessionPath);
    this.logger.log(`LocalAuth initialized with sessionPath=${this.sessionPath}`);
  }

  async createAuthStrategy(instanceId: string, _storeId: string): Promise<LocalAuth> {
    return this.createLocalAuth(instanceId);
  }

  async deleteRemoteSession(instanceId: string): Promise<void> {
    const sessionDir = path.join(this.sessionPath, `session-${instanceId}`);
    try {
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        this.logger.log(`Deleted session for instance ${instanceId}`);
      }
    } catch (err: any) {
      this.logger.error(`Failed to delete session ${instanceId}: ${err?.message}`);
    }
  }

  async cleanupOrphanSessions(): Promise<void> {
    try {
      if (!fs.existsSync(this.sessionPath)) {
        return;
      }

      const entries = fs.readdirSync(this.sessionPath);
      const sessionDirs = entries.filter(name => name.startsWith('session-'));
      
      this.logger.log(`Found ${sessionDirs.length} session directories`);
    } catch (err: any) {
      this.logger.error(`Error during orphan session cleanup: ${err?.message}`);
    }
  }

  getWebCacheOptions(): { webVersion?: string; webVersionCache?: any } {
    const remotePath = process.env.REMOTE_WEB_CACHE_URL;
    const strict = (process.env.WEB_VERSION_STRICT ?? 'false').toLowerCase() === 'true';
    const webVersion = process.env.WEB_VERSION;

    const opts: any = {};
    if (remotePath) opts.webVersionCache = { remotePath, strict };
    if (webVersion) opts.webVersion = webVersion;

    this.logger.log(`WebCache config: remotePath=${remotePath ?? 'none'} strict=${strict} version=${webVersion ?? 'none'}`);
    return opts;
  }

  private createLocalAuth(instanceId: string): LocalAuth {
    this.logger.log(`Creating LocalAuth for instance ${instanceId}`);
    
    const auth = new LocalAuth({
      clientId: instanceId,
      dataPath: this.sessionPath,
    });

    return auth;
  }

  private ensureDir(p: string) {
    try {
      if (!fs.existsSync(p)) {
        fs.mkdirSync(p, { recursive: true });
        this.logger.log(`Created directory ${p}`);
      }
    } catch (e: any) {
      this.logger.error(`Failed to create directory ${p}: ${e?.message}`);
    }
  }

  getSessionStats(): { path: string; sessions: string[] } {
    try {
      if (!fs.existsSync(this.sessionPath)) {
        return { path: this.sessionPath, sessions: [] };
      }

      const entries = fs.readdirSync(this.sessionPath);
      const sessionDirs = entries.filter(name => name.startsWith('session-'));
      
      return {
        path: this.sessionPath,
        sessions: sessionDirs,
      };
    } catch (err: any) {
      this.logger.error(`Error getting session stats: ${err?.message}`);
      return { path: this.sessionPath, sessions: [] };
    }
  }
}


