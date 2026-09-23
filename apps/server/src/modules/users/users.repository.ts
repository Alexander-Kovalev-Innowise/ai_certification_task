import { Injectable } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

// Task 2.9. `PrismaService` injected directly — this IS a repository (the
// documented "shared/ only" exception doesn't apply here; this is exactly
// the layer the exception is carved out from).
//
// Read methods go through `prisma.extended` (Task 2.4's fix) so the
// soft-delete extension actually applies; `create`/`update` use the base
// client — the soft-delete extension only wraps find/count/aggregate (Task
// 1.5), so there's nothing extension-side for a write to opt into today.
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Looks up a user by email for auth flows (login, forgot-password).
   * Deliberately soft-delete-respecting (via `.extended`): a GDPR-deleted
   * user (deletedAt set) is indistinguishable from a nonexistent one, which
   * is the correct anti-enumeration behavior for a deleted account. A merely
   * deactivated user (`status: INACTIVE`, `deletedAt` still null) remains
   * visible, which is what lets AuthService.login produce the distinct
   * `401 ACCOUNT_INACTIVE` rather than the generic "no such user" response
   * (Task 2.13).
   */
  async findByEmail(email: string, tx?: Prisma.TransactionClient): Promise<User | null> {
    const client = tx ?? this.prisma.extended;
    return client.user.findFirst({ where: { email } });
  }

  /**
   * `findFirst`, never `findUnique` — per the soft-delete-exclusion
   * convention (Task 1.5's extension only filters findFirst/findMany/count/aggregate).
   * This is the general-purpose "load a user's own profile" lookup; it is
   * NOT what JwtAuthGuard uses (that's AuthSnapshotRepository.findForAuth,
   * Task 2.4, deliberately findUnique and deliberately unfiltered).
   */
  async findById(id: string, tx?: Prisma.TransactionClient): Promise<User | null> {
    const client = tx ?? this.prisma.extended;
    return client.user.findFirst({ where: { id } });
  }

  /**
   * Not called directly by any service other than
   * AccountProvisioningService (Task 2.10) — that service is documented as
   * the sole `User`-creation entry point in this codebase; this method is
   * the one place that actually issues `prisma.user.create`.
   */
  async create(data: Prisma.UserCreateInput, tx?: Prisma.TransactionClient): Promise<User> {
    const client = tx ?? this.prisma;
    return client.user.create({ data });
  }

  async update(id: string, data: Prisma.UserUpdateInput, tx?: Prisma.TransactionClient): Promise<User> {
    const client = tx ?? this.prisma;
    return client.user.update({ where: { id }, data });
  }
}
