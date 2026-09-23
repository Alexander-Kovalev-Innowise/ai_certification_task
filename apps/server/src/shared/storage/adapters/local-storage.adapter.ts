import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Injectable } from '@nestjs/common';

import { StorageService, UploadFileOptions, UploadFileResult } from '../storage.service';

// Task 1.11. Dev/test adapter — writes to a local temp dir, returns a
// file:// URL. Default binding for StorageModule until a real provider is
// wired (STORAGE_PROVIDER defaults to 'local').
const UPLOAD_DIR = join(tmpdir(), 'practiceperfect-uploads');

@Injectable()
export class LocalStorageAdapter extends StorageService {
  async upload(options: UploadFileOptions): Promise<UploadFileResult> {
    await mkdir(UPLOAD_DIR, { recursive: true });
    const key = options.key || randomUUID();
    const filePath = join(UPLOAD_DIR, key);
    await writeFile(filePath, options.body);
    return { key, url: `file://${filePath}` };
  }

  async delete(key: string): Promise<void> {
    const filePath = join(UPLOAD_DIR, key);
    await rm(filePath, { force: true });
  }
}
