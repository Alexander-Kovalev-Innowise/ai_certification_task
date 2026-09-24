import { ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { User } from '@prisma/client';

import { buildPaginatedResponse, decodeCursor, type PaginatedResponseDto } from '../../shared/http/pagination.dto';
import type { AuthContext } from '../../shared/security/auth-context.interface';
import type { UserSummaryDto } from '../auth/dto/auth-session-response.dto';
import { TenantClaimsResolver } from '../auth/tenant-claims.resolver';
import { TokenService } from '../auth/token.service';
import { UsersRepository } from '../users/users.repository';

import { ImpersonationLogResponseDto } from './dto/impersonation-log-response.dto';
import { ImpersonationStartResponseDto } from './dto/impersonation-start-response.dto';
import { ListImpersonationHistoryQueryDto } from './dto/list-impersonation-history-query.dto';
import { StartImpersonationDto } from './dto/start-impersonation.dto';
import { ImpersonationRepository, ImpersonationLogWithUsers } from './impersonation.repository';

// Task 7.1 (api §2, arch §10), extended in Task 7.2 (`end`) and Task 7.3
// (`getHistory`).
@Injectable()
export class ImpersonationService {
  constructor(
    private readonly impersonationRepository: ImpersonationRepository,
    private readonly usersRepository: UsersRepository,
    private readonly tenantClaimsResolver: TenantClaimsResolver,
    private readonly tokenService: TokenService,
  ) {}

  /**
   * Task 7.1 (api §2 "POST /impersonation/start", arch §10 "Start"). Check
   * order matches the plan's own "Do" line exactly: target existence, then
   * `assertNotTargetingSuperAdmin` (422 — FR-015/BR-010, a validation error
   * not an authz one), then the blast-radius "already impersonating" check
   * (403 IMPERSONATION_NOT_ALLOWED) — this last check is ALSO enforced by
   * CapabilitiesGuard from Task 7.5 onward (defense-in-depth, same two-layer
   * pattern arch §8 uses for tenancy), but must live here regardless since
   * this task lands before that guard wiring exists.
   */
  async start(ctx: AuthContext, dto: StartImpersonationDto): Promise<ImpersonationStartResponseDto> {
    const target = await this.usersRepository.findById(dto.targetUserId);
    if (!target) {
      throw new NotFoundException({ message: 'Target user not found', errorCode: 'NOT_FOUND' });
    }

    this.assertNotTargetingSuperAdmin(target);
    this.assertNotAlreadyImpersonating(ctx);

    const log = await this.impersonationRepository.create({ adminUserId: ctx.userId, targetUserId: target.id });

    // Same claim-derivation AuthService uses for a normal login (arch §6.2)
    // — `sub`/`role`/`tid`/`gid` on the issued token are the TARGET's
    // effective identity, so every guard downstream sees "this role acting
    // on this tenant" with zero impersonation-aware branching anywhere in
    // feature code (arch §10).
    const tenantClaims = await this.tenantClaimsResolver.resolve(target);

    const { accessToken, expiresIn } = await this.tokenService.issueImpersonationToken({
      userId: target.id,
      role: target.role,
      accountType: tenantClaims.accountType,
      guardianUserId: tenantClaims.guardianUserId,
      trainerId: tenantClaims.trainerId,
      tokenVersion: target.tokenVersion,
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      logId: log.id,
    });

    return {
      accessToken,
      expiresIn,
      impersonationLogId: log.id,
      target: {
        id: target.id,
        email: target.email,
        role: target.role,
        accountType: tenantClaims.accountType,
        firstName: target.firstName,
        lastName: target.lastName,
        mustChangePassword: target.mustChangePassword,
      },
    };
  }

  private assertNotTargetingSuperAdmin(target: User): void {
    if (target.role === 'SUPER_ADMIN') {
      throw new UnprocessableEntityException({
        message: 'Cannot impersonate a Super Admin',
        errorCode: 'IMPERSONATION_TARGET_INVALID',
      });
    }
  }

  private assertNotAlreadyImpersonating(ctx: AuthContext): void {
    if (ctx.impersonation) {
      throw new ForbiddenException({
        message: 'Cannot start a new impersonation session while already impersonating',
        errorCode: 'IMPERSONATION_NOT_ALLOWED',
      });
    }
  }

  /**
   * Task 7.2 (api §2 "POST /impersonation/end"). Called WITH the
   * impersonation access token itself — reachable only while
   * `AuthContext.impersonation` is set, enforced here (the guard has no
   * "must be impersonating" primitive, api §2 footnote). Stamps
   * `endedAt`/`durationSeconds`; the token isn't itself revocable (it's
   * already exp-capped, arch §10) but this records the explicit exit for
   * the audit trail the same way Task 7.4's sweep records an implicit one.
   */
  async end(ctx: AuthContext): Promise<void> {
    if (!ctx.impersonation) {
      throw new ForbiddenException({
        message: 'This endpoint is only reachable from inside an impersonation session',
        errorCode: 'IMPERSONATION_NOT_ALLOWED',
      });
    }

    const log = await this.impersonationRepository.findById(ctx.impersonation.logId);
    if (!log) {
      // Defensive — shouldn't happen (api §2's own status-code table flags
      // this as defensive-only), since the token's `imp` claim is only ever
      // set to a log id this same service just created.
      throw new NotFoundException({ message: 'Impersonation log not found', errorCode: 'NOT_FOUND' });
    }

    const endedAt = new Date();
    const durationSeconds = Math.max(0, Math.floor((endedAt.getTime() - log.startedAt.getTime()) / 1000));
    await this.impersonationRepository.markEnded(log.id, endedAt, durationSeconds);
  }

  /**
   * Task 7.3 (api §2 "GET /impersonation/history"). Super Admin only
   * (enforced by the controller's `@Roles`/`@RequiresCapability`, not
   * repeated here — this service has no ownership/tenancy filtering of its
   * own to add beyond the query params, unlike e.g. `AvailabilityService`).
   */
  async getHistory(query: ListImpersonationHistoryQueryDto): Promise<PaginatedResponseDto<ImpersonationLogResponseDto>> {
    const limit = query.limit ?? 50;
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;

    const rows = await this.impersonationRepository.listHistory({
      limit,
      cursor,
      adminUserId: query.adminUserId,
      targetUserId: query.targetUserId,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
    });

    const page = buildPaginatedResponse(rows, limit, (row) => ({ createdAt: row.startedAt.toISOString(), id: row.id }));

    const items = await Promise.all(page.items.map((row) => this.toHistoryRow(row)));
    return { ...page, items };
  }

  private async toHistoryRow(row: ImpersonationLogWithUsers): Promise<ImpersonationLogResponseDto> {
    const [admin, target] = await Promise.all([this.toUserSummary(row.admin), this.toUserSummary(row.target)]);
    return {
      id: row.id,
      admin,
      target,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      durationSeconds: row.durationSeconds,
    };
  }

  /**
   * `adminUserId` is always a SUPER_ADMIN (the only role `/impersonation/
   * start` ever writes there), which can never be a CHILD login — so this
   * only issues the extra `isChildLogin` lookup for a `PLAYER_PARENT`
   * target, the one role that can be (same short-circuit
   * `TenantClaimsResolver.resolve` uses for the same reason).
   */
  private async toUserSummary(user: User): Promise<UserSummaryDto> {
    const accountType = user.role === 'PLAYER_PARENT' && (await this.usersRepository.isChildLogin(user.id)) ? 'CHILD' : 'ADULT';
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      accountType,
      firstName: user.firstName,
      lastName: user.lastName,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
