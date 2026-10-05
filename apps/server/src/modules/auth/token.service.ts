import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@prisma/client';

import { DEFAULT_IMPERSONATION_TTL_SECONDS } from '../../shared/config/env.schema';
import type { AccessTokenClaims } from '../../shared/security/access-token-claims.interface';

import { IMPERSONATION_TTL_SECONDS } from './impersonation-ttl.token';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export interface IssueAccessTokenInput {
  userId: string;
  role: Role;
  accountType: 'ADULT' | 'CHILD';
  guardianUserId?: string | null;
  trainerId?: string | null;
  tokenVersion: number;
  impersonation?: { actorUserId: string; actorRole: Role; logId: string };
}

// Task 7.1 (arch §10 "Start", api §2 "act claim round trip"). `sub`/`role`/
// `tid`/`gid` are the TARGET's (effective identity) — caller resolves these
// the same way a normal login does (TenantClaimsResolver) — `act` is always
// present here (unlike IssueAccessTokenInput.impersonation, which is
// optional), since this method exists for exactly one purpose.
export interface IssueImpersonationTokenInput {
  userId: string;
  role: Role;
  accountType: 'ADULT' | 'CHILD';
  guardianUserId?: string | null;
  trainerId?: string | null;
  tokenVersion: number;
  actorUserId: string;
  actorRole: Role;
  logId: string;
}

export interface IssuedAccessToken {
  accessToken: string;
  expiresIn: number;
}

// Task 2.11 (arch §6.1/§6.2). Issues/decodes JWT access tokens with the
// exact claim shape access-token-claims.interface.ts defines. Uses the
// JwtService bound by SecurityModule (Task 2.4) — same JWT_SECRET,
// HS256 — so a token this service issues verifies via the same guard path
// JwtAuthGuard uses.
@Injectable()
export class TokenService {
  // Task 7.1 (arch §10, api §2). The impersonation TTL is a hard cap,
  // independent of the admin's own token exp — this is what makes the
  // 60-minute window (US-01.07) structurally unextendable (no refresh token is
  // ever issued alongside it, ADR-03). 3600s unless a non-production
  // IMPERSONATION_TTL_SECONDS override is provided (AuthModule).
  constructor(
    private readonly jwtService: JwtService,
    @Optional() @Inject(IMPERSONATION_TTL_SECONDS) private readonly impersonationTtlSeconds: number = DEFAULT_IMPERSONATION_TTL_SECONDS,
  ) {}

  async issueAccessToken(input: IssueAccessTokenInput): Promise<IssuedAccessToken> {
    const claims: Omit<AccessTokenClaims, 'iat' | 'exp'> = {
      sub: input.userId,
      role: input.role,
      typ: input.accountType,
      gid: input.guardianUserId ?? null,
      tid: input.trainerId ?? null,
      tv: input.tokenVersion,
      jti: randomUUID(),
      // `act` present only when impersonating — never an explicit
      // `act: undefined` key, which would still serialize into the JWT
      // payload as `"act":null`-shaped noise.
      ...(input.impersonation
        ? {
            act: {
              sub: input.impersonation.actorUserId,
              role: input.impersonation.actorRole,
              imp: input.impersonation.logId,
            },
          }
        : {}),
    };

    const accessToken = await this.jwtService.signAsync(claims, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });
    return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }

  // Task 7.1. A dedicated method rather than reusing issueAccessToken with
  // its `impersonation` param: the TTL differs (60m hard cap vs. the normal
  // 15m access-token lifetime) and `act` is mandatory here, never optional.
  async issueImpersonationToken(input: IssueImpersonationTokenInput): Promise<IssuedAccessToken> {
    const claims: Omit<AccessTokenClaims, 'iat' | 'exp'> = {
      sub: input.userId,
      role: input.role,
      typ: input.accountType,
      gid: input.guardianUserId ?? null,
      tid: input.trainerId ?? null,
      tv: input.tokenVersion,
      act: { sub: input.actorUserId, role: input.actorRole, imp: input.logId },
      jti: randomUUID(),
    };

    const accessToken = await this.jwtService.signAsync(claims, { expiresIn: this.impersonationTtlSeconds });
    return { accessToken, expiresIn: this.impersonationTtlSeconds };
  }

  async decode(token: string): Promise<AccessTokenClaims> {
    return this.jwtService.verifyAsync<AccessTokenClaims>(token);
  }
}
