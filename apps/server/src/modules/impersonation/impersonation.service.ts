import { ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { User } from '@prisma/client';

import type { AuthContext } from '../../shared/security/auth-context.interface';
import { TenantClaimsResolver } from '../auth/tenant-claims.resolver';
import { TokenService } from '../auth/token.service';
import { UsersRepository } from '../users/users.repository';

import { ImpersonationStartResponseDto } from './dto/impersonation-start-response.dto';
import { StartImpersonationDto } from './dto/start-impersonation.dto';
import { ImpersonationRepository } from './impersonation.repository';

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
}
