import { Injectable } from '@nestjs/common';
import type { Prisma, ShareLink, TrainerProfile } from '@prisma/client';

import type { KeysetCursor } from '../../shared/http/pagination.dto';
import { PrismaService } from '../../shared/prisma/prisma.service';

export type ShareLinkWithTrainer = ShareLink & { trainer: TrainerProfile };

export interface ListShareLinksParams {
  limit: number;
  cursor?: KeysetCursor;
}

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
   * (Tasks 4.6-4.10). Includes the owning `TrainerProfile` — Task 4.3's
   * preview response needs `trainerDisplayName`/`logoUrl`/`primaryColorHex`,
   * and every redemption branch already needs the trainer relation loaded
   * (association creation, coach-profile creation) — one join is cheaper
   * than a second round trip every caller would otherwise need.
   */
  async findByCode(code: string, tx?: Prisma.TransactionClient): Promise<ShareLinkWithTrainer | null> {
    const client = tx ?? this.prisma;
    return client.shareLink.findUnique({ where: { code }, include: { trainer: true } });
  }

  /** Task 4.5. Unscoped lookup by id — only ever called for a SUPER_ADMIN caller (ShareLinkService.revokeShareLink), who has no tenant of their own to scope by. */
  async findById(id: string): Promise<ShareLink | null> {
    return this.prisma.shareLink.findUnique({ where: { id } });
  }

  /** Task 4.5. Tenant-scoped lookup by id — `.extended` so a mismatched `trainerId` is a loud bug (arch §8 Layer 2), not a silent miss. */
  async findByIdForTrainer(id: string, trainerId: string): Promise<ShareLink | null> {
    return this.prisma.extended.shareLink.findFirst({ where: { id, trainerId } });
  }

  /**
   * Task 4.5 (api §4.4 "DELETE /share-links/:id"). Soft revoke only —
   * `status = REVOKED`, never a row delete, so usage history survives for
   * the Epic-06 analytics stub (arch §18). Base client, not `.extended`:
   * ownership is already verified by the caller
   * (ShareLinkService.revokeShareLink calls findByIdForTrainer/findById
   * first), matching TrainersRepository.update's identical division of
   * labor between the ownership check and the write.
   */
  async revoke(id: string, tx?: Prisma.TransactionClient): Promise<ShareLink> {
    const client = tx ?? this.prisma;
    return client.shareLink.update({ where: { id }, data: { status: 'REVOKED' } });
  }

  /**
   * Task 4.4 (api §4.4 "GET /trainers/:id/share-links", added — §8.9 gap).
   * Goes through `.extended` for the tenant-guard runtime net (arch §8 Layer
   * 2) — `where.trainerId` is always present (unlike `findByCode` above),
   * so a TRAINER-scoped caller who somehow reaches this with a mismatched
   * `trainerId` gets a loud `TenantScopeViolationError` rather than another
   * trainer's rows. `ShareLinkService.listShareLinks` calls
   * `assertOwnershipOrNotFound` first, which is what keeps a mismatched id
   * from ever reaching here in the first place (mirrors
   * TrainerService.getTrainer's own comment on the same ordering).
   *
   * Keyset pagination on `(createdAt, id)` DESC via the Prisma query builder
   * (an `OR` tuple-comparison, not raw SQL — no trigram/functional-index
   * concern here, unlike UsersRepository.findAllPaginated) — fetches
   * `limit + 1` rows for `buildPaginatedResponse`'s `hasMore` trick.
   */
  async listByTrainer(trainerId: string, params: ListShareLinksParams): Promise<ShareLink[]> {
    return this.prisma.extended.shareLink.findMany({
      where: {
        trainerId,
        ...(params.cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(params.cursor.createdAt) } },
                { createdAt: new Date(params.cursor.createdAt), id: { lt: params.cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: params.limit + 1,
    });
  }

  /**
   * Task 4.6. Plain (non-conditional) increment for the
   * ANONYMOUS_REGISTRATION branch's `PLAYER_STATIC` links — those have no
   * single-use constraint (`maxUses: null`, BR-006), so there is no race to
   * guard against the way Task 4.9's conditional `updateMany` (COACH_UNIQUE)
   * has to. Always called inside the redemption flow's own `$transaction`.
   */
  async incrementUseCount(id: string, tx: Prisma.TransactionClient): Promise<void> {
    await tx.shareLink.update({ where: { id }, data: { useCount: { increment: 1 } } });
  }
}
