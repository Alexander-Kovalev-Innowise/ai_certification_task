import { Injectable } from '@nestjs/common';
import type { CampConversion, Prisma, ShareLink, TrainerProfile } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

export type ShareLinkWithTrainerRow = ShareLink & { trainer: TrainerProfile };
export type CampConversionWithLink = CampConversion & { shareLink: ShareLinkWithTrainerRow };

// Public (unauthenticated) flow - deliberately not tenant-scoped, like ShareLinksRepository.findByCode: the
// conversion is addressed by an unguessable token, never by tenant id.
@Injectable()
export class CampConversionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findShareLinkByCode(code: string): Promise<ShareLinkWithTrainerRow | null> {
    return this.prisma.shareLink.findUnique({ where: { code }, include: { trainer: true } });
  }

  create(data: { tokenHash: string; shareLinkId: string; payload: Prisma.InputJsonValue; expiresAt: Date }): Promise<CampConversion> {
    return this.prisma.campConversion.create({ data });
  }

  findByTokenHash(tokenHash: string): Promise<CampConversionWithLink | null> {
    return this.prisma.campConversion.findUnique({
      where: { tokenHash },
      include: { shareLink: { include: { trainer: true } } },
    });
  }

  /** Conditional claim (never read-then-write): exactly one concurrent redeemer gets `count: 1`. */
  markUsed(id: string, tx: Prisma.TransactionClient): Promise<{ count: number }> {
    return tx.campConversion.updateMany({
      where: { id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
  }
}
