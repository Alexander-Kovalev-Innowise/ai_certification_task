import { randomUUID } from 'node:crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { Response } from 'express';

import { PrismaService } from '../../shared/prisma/prisma.service';
import { UsersRepository } from '../users/users.repository';

import type { AuthSessionResponseDto } from './dto/auth-session-response.dto';
import type { LoginDto } from './dto/login.dto';
import { generateOpaqueToken, hashOpaqueToken } from './opaque-token.util';
import { PasswordService } from './password.service';
import { REFRESH_TOKEN_TTL_MS, setSessionCookies } from './session-cookies.util';
import { TokenRotationService } from './token-rotation.service';
import { TokenService } from './token.service';

interface TenantClaims {
  accountType: 'ADULT' | 'CHILD';
  trainerId: string | null;
  guardianUserId: string | null;
}

// Task 2.13. Owns session/token lifecycle (RefreshToken, and — from Task
// 2.16 onward — EmailVerificationToken/PasswordResetToken); never touches
// User *business* fields (name/phone/photo — that's UsersService, Task
// 2.22). Injects PrismaService directly for the one thing that IS this
// service's concern despite not being a "User business field": resolving
// the tenant/account-type claims (arch §6.2's `typ`/`tid`/`gid`) a fresh
// access token needs, which depends on TrainerProfile/CoachProfile/
// PlayerProfile rows Phase 3/4 own the repositories for. No Phase 2 login
// flow can actually produce a `typ: CHILD` token yet (child accounts only
// exist via ShareLink redemption, Phase 4) or a non-null `tid` without
// Phase 3's trainer-provisioning flow having run — this resolves correctly
// today via direct reads and needs no rework once those repositories land.
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersRepository: UsersRepository,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly tokenRotationService: TokenRotationService,
  ) {}

  async login(dto: LoginDto, res: Response): Promise<AuthSessionResponseDto> {
    const user = await this.usersRepository.findByEmail(dto.email);

    if (!user) {
      // FR-001/FR-002 anti-enumeration: a wrong-password branch below pays
      // for a real argon2id verify; without this, "no such email" would
      // resolve measurably faster and leak account existence via timing.
      await this.passwordService.dummyHash();
      throw this.genericInvalidCredentials();
    }

    const passwordMatches = await this.passwordService.verify(user.passwordHash, dto.password);
    if (!passwordMatches) {
      throw this.genericInvalidCredentials();
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException({ message: 'Invalid email or password.', errorCode: 'ACCOUNT_INACTIVE' });
    }

    return this.issueSession(user, res);
  }

  /** Shared by login (Task 2.13) and, later, refresh/setup-completion. */
  async issueSession(user: User, res: Response): Promise<AuthSessionResponseDto> {
    const tenantClaims = await this.resolveTenantClaims(user);

    const { accessToken, expiresIn } = await this.tokenService.issueAccessToken({
      userId: user.id,
      role: user.role,
      accountType: tenantClaims.accountType,
      guardianUserId: tenantClaims.guardianUserId,
      trainerId: tenantClaims.trainerId,
      tokenVersion: user.tokenVersion,
    });

    const rawRefreshToken = generateOpaqueToken();
    await this.tokenRotationService.issueNewFamily(
      user.id,
      hashOpaqueToken(rawRefreshToken),
      randomUUID(),
      new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    );

    const csrfToken = generateOpaqueToken();
    setSessionCookies(res, rawRefreshToken, csrfToken);

    await this.usersRepository.update(user.id, { lastLoginAt: new Date() });

    return {
      accessToken,
      expiresIn,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        accountType: tenantClaims.accountType,
        firstName: user.firstName,
        lastName: user.lastName,
        mustChangePassword: user.mustChangePassword,
      },
    };
  }

  private genericInvalidCredentials(): UnauthorizedException {
    // FR-001: byte-identical body/status for "no such user" and "wrong
    // password" — never distinguish the two to the client.
    return new UnauthorizedException({ message: 'Invalid email or password.', errorCode: 'UNAUTHORIZED' });
  }

  private async resolveTenantClaims(user: User): Promise<TenantClaims> {
    if (user.role === 'TRAINER') {
      const trainerProfile = await this.prisma.trainerProfile.findUnique({ where: { userId: user.id } });
      return { accountType: 'ADULT', trainerId: trainerProfile?.id ?? null, guardianUserId: null };
    }

    if (user.role === 'COACH') {
      const coachProfile = await this.prisma.coachProfile.findUnique({ where: { userId: user.id } });
      return { accountType: 'ADULT', trainerId: coachProfile?.trainerId ?? null, guardianUserId: null };
    }

    if (user.role === 'PLAYER_PARENT') {
      const childOf = await this.prisma.playerProfile.findUnique({
        where: { childUserId: user.id },
        select: { accountUserId: true },
      });
      if (childOf) {
        return { accountType: 'CHILD', trainerId: null, guardianUserId: childOf.accountUserId };
      }
      return { accountType: 'ADULT', trainerId: null, guardianUserId: null };
    }

    // SUPER_ADMIN
    return { accountType: 'ADULT', trainerId: null, guardianUserId: null };
  }
}
