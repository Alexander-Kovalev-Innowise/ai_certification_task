import { Module } from '@nestjs/common';

import { env } from '../config/config.module';

import { LocalStorageAdapter } from './adapters/local-storage.adapter';
import { S3StorageAdapterStub } from './adapters/s3-storage.adapter.stub';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';

// Task 1.11. Binds StorageService (the port) to a concrete adapter via
// `useClass`, keyed off STORAGE_PROVIDER (shared/config) — INT-002's
// "pluggable provider" requirement, same pattern as MailModule (Task 1.10).
// Task 8.2 adds StorageController (POST /storage/logo, the branding
// pre-upload step) — StorageModule is already reachable from AppModule
// transitively via JobsModule's import, so no new top-level AppModule import
// is needed for Nest to register this controller's route.
@Module({
  controllers: [StorageController],
  providers: [
    {
      provide: StorageService,
      useClass: env.STORAGE_PROVIDER === 's3' ? S3StorageAdapterStub : LocalStorageAdapter,
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
