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
}
