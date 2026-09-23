import type { ShareLinkStatus, ShareLinkType } from '@prisma/client';
import { Exclude, Expose } from 'class-transformer';

// Task 4.2 (api §4.4 "POST /share-links" response shape), extended in Task
// 4.3 (GET /share-links/:code public preview) and Task 4.4 (GET
// /trainers/:id/share-links row) — one file per the trainers module's own
// convention of grouping a resource's related response DTOs together
// (trainer-response.dto.ts holds two shapes for the same reason).
@Exclude()
export class ShareLinkCreatedResponseDto {
  @Expose() id!: string;
  @Expose() code!: string;
  @Expose() type!: ShareLinkType;
  @Expose() joinUrl!: string;
  @Expose() expiresAt!: Date | null;
  @Expose() status!: ShareLinkStatus;
}
