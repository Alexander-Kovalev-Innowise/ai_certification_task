import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { Injectable } from '@nestjs/common';

import { env } from '../../config/config.module';
import { StorageService, UploadFileOptions, UploadFileResult } from '../storage.service';

// Keys are flat file names (no "/", no "..") — enforced so a caller-supplied
// key can never escape the uploads directory.
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const UPLOADS_URL_PREFIX = '/uploads/';

// Task 1.11. Local-disk adapter (STORAGE_PROVIDER=local, the default).
// Files live under UPLOADS_DIR and are served back by UploadsController at
// `<PUBLIC_API_URL>/uploads/<key>`, so the URLs returned here are absolute
// http(s) URLs a browser can load. The two fields are public (not readonly)
// so tests can point an instance at a temp dir.
@Injectable()
export class LocalStorageAdapter extends StorageService {
  uploadsDir = resolve(process.cwd(), env.UPLOADS_DIR);
  publicBaseUrl = env.PUBLIC_API_URL;

  async upload(options: UploadFileOptions): Promise<UploadFileResult> {
    const key = options.key || randomUUID();
    const filePath = this.pathFor(key);
    await mkdir(this.uploadsDir, { recursive: true });
    await writeFile(filePath, options.body);
    return { key, url: `${this.publicBaseUrl}${UPLOADS_URL_PREFIX}${key}` };
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  keyFromUrl(url: string): string | null {
    const prefix = `${this.publicBaseUrl}${UPLOADS_URL_PREFIX}`;
    if (!url.startsWith(prefix)) {
      return null;
    }
    const key = url.slice(prefix.length).split(/[?#]/)[0] ?? '';
    return SAFE_KEY.test(key) ? key : null;
  }

  private pathFor(key: string): string {
    if (!SAFE_KEY.test(key)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return join(this.uploadsDir, key);
  }
}
