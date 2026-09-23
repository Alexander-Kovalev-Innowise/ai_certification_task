import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Role, User, UserStatus } from '@prisma/client';

import type { KeysetCursor } from '../../shared/http/pagination.dto';
import { PrismaService } from '../../shared/prisma/prisma.service';

export interface FindAllUsersParams {
  limit: number;
  cursor?: KeysetCursor;
  search?: string;
  role?: Role;
  status?: UserStatus;
}

// Directory-only column projection (api §3: "select is directory columns
// only, never passwordHash") — used verbatim by the raw SQL in
// findAllPaginated below.
const DIRECTORY_COLUMNS = `id, email, role, status, "firstName", "lastName", "createdAt", "lastLoginAt"`;

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

  /**
   * Task 3.2 (api §3 "GET /users/:id"). Explicit `withDeleted: true` opt-in
   * (arch §11.1 "historical/admin reads opt in explicitly") — the only
   * place in this repository that ever sees a soft-deleted/GDPR-deleted
   * row. `withDeleted` is an extension-only arg (soft-delete.extension.ts),
   * not part of Prisma's generated types, hence the cast — same pattern as
   * that extension's own spec.
   */
  async findByIdWithDeleted(id: string): Promise<User | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- withDeleted is an extension-only arg, not part of Prisma's generated types
    return (this.prisma.extended.user.findFirst as any)({ where: { id }, withDeleted: true });
  }

  /**
   * Whether `userId` is a CHILD login — i.e. it's the `childUserId` of some
   * PlayerProfile. Mirrors AuthService.resolveTenantClaims's own check
   * (Task 2.13); duplicated rather than shared because that method is
   * private to the auth/session-issuing flow, and this repository has no
   * dependency on the auth module. No Epic-01 flow before Phase 4
   * (ShareLink redemption) can actually produce a CHILD user yet, so this
   * always resolves false today — added now so UserDetailResponseDto's
   * `accountType` is correct once Phase 4 lands, not a later rework.
   */
  async isChildLogin(userId: string): Promise<boolean> {
    const child = await this.prisma.playerProfile.findUnique({ where: { childUserId: userId }, select: { id: true } });
    return child !== null;
  }

  /**
   * Task 3.1 (api §3 "GET /users"). Keyset pagination on `(createdAt, id)`
   * DESC — never `OFFSET` (NFR-002) — via a row-tuple comparison
   * `("createdAt", "id") < (cursor.createdAt, cursor.id)`, the standard
   * keyset technique for a composite DESC ordering.
   *
   * Raw SQL, not the Prisma query builder: `search` must hit the `pg_trgm`
   * GIN index from Task 1.2 (`user_email_trgm_idx` on `lower(email)`,
   * `user_name_trgm_idx` on `lower(firstName || ' ' || lastName)`). Prisma's
   * `contains`/`mode: 'insensitive'` compiles to a plain `ILIKE` on the raw
   * column, not `lower(...) LIKE lower(...)` — it would never match either
   * functional index. Matching the index's exact expression here is what
   * lets a query plan (`EXPLAIN`) actually name the index.
   *
   * Fetches `limit + 1` rows (the caller, `buildPaginatedResponse`, uses the
   * extra row to compute `hasMore` without a separate COUNT).
   */
  async findAllPaginated(params: FindAllUsersParams): Promise<User[]> {
    const conditions: Prisma.Sql[] = [Prisma.sql`"deletedAt" IS NULL`];

    if (params.role) {
      conditions.push(Prisma.sql`"role" = ${params.role}::"Role"`);
    }
    if (params.status) {
      conditions.push(Prisma.sql`"status" = ${params.status}::"UserStatus"`);
    }
    if (params.search) {
      const pattern = `%${params.search}%`;
      conditions.push(
        Prisma.sql`(lower("email") LIKE lower(${pattern}) OR lower("firstName" || ' ' || "lastName") LIKE lower(${pattern}))`,
      );
    }
    if (params.cursor) {
      conditions.push(
        Prisma.sql`("createdAt", "id") < (${new Date(params.cursor.createdAt)}::timestamp, ${params.cursor.id})`,
      );
    }

    const where = Prisma.join(conditions, ' AND ');

    return this.prisma.$queryRaw<User[]>`
      SELECT ${Prisma.raw(DIRECTORY_COLUMNS)} FROM "User"
      WHERE ${where}
      ORDER BY "createdAt" DESC, "id" DESC
      LIMIT ${params.limit + 1}
    `;
  }
}
