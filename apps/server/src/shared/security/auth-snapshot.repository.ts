import { Injectable } from '@nestjs/common';
import type { Role, UserStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface AuthSnapshot {
  id: string;
  status: UserStatus;
  role: Role;
  tokenVersion: number;
  mustChangePassword: boolean;
}

export interface ImpersonationSessionSnapshot {
  endedAt: Date | null;
}

// Task 2.4 (arch §6.3). `shared/` infrastructure — the documented exception
// to "PrismaService is injected into repositories only": this is a guard's
// own data-access helper, not a module repository.
//
// Deliberately `findUnique`, never `findFirst`: the soft-delete extension
// (Task 1.5) merges `deletedAt: null` into `findFirst`/`findMany`/`count`/
// `aggregate`, which would make a deactivated/GDPR-deleted user's row
// invisible to the very guard whose job is to reject them with a precise
// `401 ACCOUNT_INACTIVE` instead of a confusing "not found". `findUnique` is
// deliberately left unfiltered by that extension for exactly this reason.
@Injectable()
export class AuthSnapshotRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findForAuth(userId: string): Promise<AuthSnapshot | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, role: true, tokenVersion: true, mustChangePassword: true },
    });
  }

  /**
   * The ImpersonationLog behind an impersonation token's `act.imp` claim.
   * JwtAuthGuard rejects the token once `endedAt` is set (explicit exit via
   * POST /impersonation/end, or the 60-minute cron sweep) — the token
   * itself is not revocable, so its log row is the revocation list.
   */
  async findImpersonationSession(logId: string): Promise<ImpersonationSessionSnapshot | null> {
    return this.prisma.impersonationLog.findUnique({ where: { id: logId }, select: { endedAt: true } });
  }
}
