// Task 1.11 (arch §13, INT-002). The port — an abstract class, not an
// interface, so it can be used both as a NestJS DI token and as a type.
// Bound to a concrete adapter by StorageModule's `useClass` factory, keyed
// off config (STORAGE_PROVIDER), same pattern as MailService (Task 1.10,
// INT-001). No module imports a storage SDK directly; only adapters/ may.
export interface UploadFileOptions {
  key: string;
  contentType: string;
  body: Buffer;
}

export interface UploadFileResult {
  key: string;
  url: string;
}

export abstract class StorageService {
  abstract upload(options: UploadFileOptions): Promise<UploadFileResult>;
  abstract delete(key: string): Promise<void>;
}
