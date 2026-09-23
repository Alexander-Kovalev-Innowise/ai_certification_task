import { Injectable, Logger } from '@nestjs/common';

import { StorageService, UploadFileOptions, UploadFileResult } from '../storage.service';

// Task 1.11. Stub — not wired to the real AWS S3 SDK yet; flagged as a later
// infra task, out of Epic-01's functional scope. Same pattern as
// SesMailAdapterStub (Task 1.10).
@Injectable()
export class S3StorageAdapterStub extends StorageService {
  private readonly logger = new Logger(S3StorageAdapterStub.name);

  upload(_options: UploadFileOptions): Promise<UploadFileResult> {
    this.logger.error(
      'S3StorageAdapterStub.upload() called, but the S3 adapter is not implemented (out of Epic-01 scope). ' +
        "Set STORAGE_PROVIDER=local, or implement this adapter's real S3 SDK call before using STORAGE_PROVIDER=s3.",
    );
    return Promise.reject(new Error('S3StorageAdapterStub is not implemented'));
  }

  delete(_key: string): Promise<void> {
    return Promise.reject(new Error('S3StorageAdapterStub is not implemented'));
  }
}
