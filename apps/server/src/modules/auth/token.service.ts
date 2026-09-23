import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@prisma/client';

import type { AccessTokenClaims } from '../../shared/security/access-token-claims.interface';

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
  constructor(private readonly jwtService: JwtService) {}

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

  async decode(token: string): Promise<AccessTokenClaims> {
    return this.jwtService.verifyAsync<AccessTokenClaims>(token);
  }
}
