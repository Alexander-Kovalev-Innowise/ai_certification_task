import { Injectable } from '@nestjs/common';
import type { Prisma, ShareLink } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

// Task 4.2, extended in Task 4.4 (listByTrainer), Task 4.5 (revoke) and Task
// 4.9 (the conditional single-use `updateMany`). `create` uses the base
// (non-extended) client — same convention as TrainersRepository.create:
// `create`'s args have no `where` for the tenant-guard extension to even
// inspect, and this is always called either directly (POST /share-links,
// no ALS TenantScope concern for a straightforward own-tenant write) or
// inside a redemption `$transaction` (Tasks 4.6/4.9, always scope-free —
// those routes are `@Public()`, so TenantContextInterceptor never runs for
// them regardless of any Bearer token the caller presents).
@Injectable()
export class ShareLinksRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.ShareLinkCreateInput, tx?: Prisma.TransactionClient): Promise<ShareLink> {
    const client = tx ?? this.prisma;
    return client.shareLink.create({ data });
  }

  /**
   * Public lookup by code — `code` is globally unique by design (arch §9.1:
   * an enumerated code must leak nothing beyond public branding), so this is
   * deliberately NOT tenant-scoped and uses the base client, not `.extended`.
   * Backs both the public preview (Task 4.3) and every redemption branch
   * (Tasks 4.6-4.10).
   */
  async findByCode(code: string, tx?: Prisma.TransactionClient): Promise<ShareLink | null> {
    const client = tx ?? this.prisma;
    return client.shareLink.findUnique({ where: { code } });
  }
}
