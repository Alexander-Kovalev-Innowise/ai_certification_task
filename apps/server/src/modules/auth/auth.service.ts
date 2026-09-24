import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import type { Request, Response } from 'express';

import { JOB_TYPES } from '../../shared/jobs/job-types.const';
import { OutboxService } from '../../shared/jobs/outbox.service';
import { buildPasswordResetEmailPayload } from '../../shared/mail/templates/password-reset.template';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { UsersRepository } from '../users/users.repository';

import type { AuthSessionResponseDto, UserSummaryDto } from './dto/auth-session-response.dto';
import type { ChangePasswordDto } from './dto/change-password.dto';
import type { CompleteTrainerSetupDto } from './dto/complete-trainer-setup.dto';
import type { ForgotPasswordDto } from './dto/forgot-password.dto';
import type { LoginDto } from './dto/login.dto';
import type { ResetPasswordDto } from './dto/reset-password.dto';
import type { VerifyEmailDto } from './dto/verify-email.dto';
import { EmailVerificationTokenRepository } from './email-verification-token.repository';
import { generateOpaqueToken, hashOpaqueToken } from './opaque-token.util';
import { PasswordResetTokenRepository } from './password-reset-token.repository';
import { PasswordService } from './password.service';
import { RefreshTokenRepository } from './refresh-token.repository';
import {
  clearSessionCookies,
  CSRF_COOKIE,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_TTL_MS,
  setSessionCookies,
} from './session-cookies.util';
import { TenantClaimsResolver } from './tenant-claims.resolver';
import { TokenRotationService } from './token-rotation.service';
import { TokenService } from './token.service';

const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour, arch §6.1
const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours, arch §6.1

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
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly passwordResetTokenRepository: PasswordResetTokenRepository,
    private readonly emailVerificationTokenRepository: EmailVerificationTokenRepository,
    private readonly outboxService: OutboxService,
    private readonly tenantClaimsResolver: TenantClaimsResolver,
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

  /**
   * Task 2.14. Cookie-only auth (no Bearer token — @Public() at the guard
   * level, arch §6.4): reads the presented refresh token from the
   * `refreshToken` cookie, requires the double-submit CSRF pair (`csrf`
   * cookie === `X-CSRF-Token` header), rotates via TokenRotationService,
   * and issues a fresh access token for whichever user the rotated row
   * belongs to.
   */
  async refresh(req: Request, res: Response): Promise<AuthSessionResponseDto> {
    this.assertCsrf(req);

    const presentedRawToken = (req.cookies as Record<string, string> | undefined)?.[REFRESH_TOKEN_COOKIE];
    if (!presentedRawToken) {
      throw new UnauthorizedException({ message: 'Missing refresh token', errorCode: 'UNAUTHORIZED' });
    }

    const newRawRefreshToken = generateOpaqueToken();
    const rotated = await this.tokenRotationService.rotate(
      hashOpaqueToken(presentedRawToken),
      hashOpaqueToken(newRawRefreshToken),
      new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    );

    // findFirst (soft-delete-respecting), not findUnique — a refresh
    // presented for a GDPR-deleted user's old row should behave like any
    // other "no such active user" case, not resurrect it.
    const user = await this.usersRepository.findById(rotated.userId);
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException({ message: 'Account is inactive', errorCode: 'ACCOUNT_INACTIVE' });
    }

    const { accessToken, expiresIn, summary } = await this.buildAccessToken(user);

    const newCsrfToken = generateOpaqueToken();
    setSessionCookies(res, newRawRefreshToken, newCsrfToken);

    return { accessToken, expiresIn, user: summary };
  }

  /**
   * Task 2.15. Same CSRF requirement as refresh (arch §6.4). `everywhere`
   * additionally revokes every RefreshToken row for the user AND bumps
   * `tokenVersion` — a password-reset-grade "logout everywhere", killing
   * any still-live access token too (arch §6.3), not just future refreshes.
   */
  async logout(req: Request, res: Response, userId: string, everywhere: boolean): Promise<void> {
    this.assertCsrf(req);

    const presentedRawToken = (req.cookies as Record<string, string> | undefined)?.[REFRESH_TOKEN_COOKIE];
    if (presentedRawToken) {
      const presented = await this.refreshTokenRepository.findByTokenHash(hashOpaqueToken(presentedRawToken));
      if (presented && !presented.revokedAt) {
        await this.refreshTokenRepository.revoke(presented.id);
      }
    }

    if (everywhere) {
      await this.refreshTokenRepository.revokeAllForUser(userId);
      await this.usersRepository.update(userId, { tokenVersion: { increment: 1 } });
    }

    clearSessionCookies(res);
  }

  /**
   * Task 2.16 (FR-002 anti-enumeration). Always returns the same generic
   * message regardless of whether the email exists — the not-found branch
   * still pays for a dummy argon2 hash so response timing doesn't leak
   * existence either. The token row + OutboxJob are written in the SAME
   * transaction (arch §13.2): a rolled-back write leaves neither.
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const GENERIC_RESPONSE = { message: 'If that email exists, a reset link has been sent.' };

    const user = await this.usersRepository.findByEmail(dto.email);
    if (!user) {
      await this.passwordService.dummyHash();
      return GENERIC_RESPONSE;
    }

    const rawToken = generateOpaqueToken();
    await this.prisma.$transaction(async (tx) => {
      await this.passwordResetTokenRepository.create(
        {
          userId: user.id,
          token: hashOpaqueToken(rawToken),
          purpose: 'PASSWORD_RESET',
          expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS),
        },
        tx,
      );
      await this.outboxService.enqueue(
        tx,
        JOB_TYPES.EMAIL_PASSWORD_RESET,
        // buildPasswordResetEmailPayload's return type is its own interface
        // (not indexed), so it doesn't structurally satisfy Prisma's
        // InputJsonValue on its own — the cast is the boundary between "a
        // typed template payload" and "an opaque JSON blob for the outbox".
        buildPasswordResetEmailPayload(user.email, {
          firstName: user.firstName,
          resetToken: rawToken,
        }) as unknown as Prisma.InputJsonValue,
      );
    });

    return GENERIC_RESPONSE;
  }

  /**
   * Task 2.17. Single-use, 1h expiry, purpose PASSWORD_RESET only. A
   * password reset is itself "logout everywhere" (arch §6.4): tokenVersion
   * bumps and every RefreshToken row for the user is revoked in the same
   * transaction as the password write and the token being marked used.
   */
  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const tokenRow = await this.passwordResetTokenRepository.findByToken(hashOpaqueToken(dto.token));

    // Generic 404 for "no such token" / already-used / wrong-purpose alike
    // — doesn't distinguish reasons, per api §1.
    if (!tokenRow || tokenRow.purpose !== 'PASSWORD_RESET' || tokenRow.usedAt) {
      throw new NotFoundException({ message: 'Invalid or expired token', errorCode: 'NOT_FOUND' });
    }

    if (tokenRow.expiresAt.getTime() < Date.now()) {
      throw new GoneException({ message: 'Invalid or expired token', errorCode: 'TOKEN_EXPIRED' });
    }

    const newPasswordHash = await this.passwordService.hash(dto.newPassword);

    await this.prisma.$transaction(async (tx) => {
      await this.usersRepository.update(
        tokenRow.userId,
        { passwordHash: newPasswordHash, tokenVersion: { increment: 1 }, mustChangePassword: false },
        tx,
      );
      await this.passwordResetTokenRepository.markUsed(tokenRow.id, tx);
      await this.refreshTokenRepository.revokeAllForUser(tokenRow.userId, tx);
    });

    return { message: 'Password has been reset.' };
  }

  /**
   * Task 2.18. Single-use, 24h expiry. Non-blocking (arch §6.5) — no guard
   * anywhere checks `emailVerifiedAt`; this only ever sets it.
   */
  async verifyEmail(dto: VerifyEmailDto): Promise<{ emailVerified: true }> {
    const tokenRow = await this.emailVerificationTokenRepository.findByToken(hashOpaqueToken(dto.token));

    if (!tokenRow || tokenRow.usedAt) {
      throw new NotFoundException({ message: 'Invalid or expired token', errorCode: 'NOT_FOUND' });
    }
    if (tokenRow.expiresAt.getTime() < Date.now()) {
      throw new GoneException({ message: 'Invalid or expired token', errorCode: 'TOKEN_EXPIRED' });
    }

    await this.prisma.$transaction(async (tx) => {
      await this.usersRepository.update(tokenRow.userId, { emailVerifiedAt: new Date() }, tx);
      await this.emailVerificationTokenRepository.markUsed(tokenRow.id, tx);
    });

    return { emailVerified: true };
  }

  /** Task 2.18. Authenticated — invalidates the previous token before issuing a fresh one. */
  async resendVerificationEmail(userId: string): Promise<{ message: string }> {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new UnauthorizedException({ message: 'Account is inactive', errorCode: 'ACCOUNT_INACTIVE' });
    }
    if (user.emailVerifiedAt) {
      throw new ConflictException({ message: 'Email is already verified', errorCode: 'CONFLICT' });
    }

    const rawToken = generateOpaqueToken();
    await this.prisma.$transaction(async (tx) => {
      await this.emailVerificationTokenRepository.invalidateActiveForUser(user.id, tx);
      await this.emailVerificationTokenRepository.create(
        { userId: user.id, token: hashOpaqueToken(rawToken), expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS) },
        tx,
      );
      await this.outboxService.enqueue(tx, JOB_TYPES.EMAIL_VERIFICATION, {
        to: user.email,
        subject: 'Verify your PracticePerfect email address',
        templateData: { firstName: user.firstName, verificationToken: rawToken },
      });
    });

    return { message: 'Verification email sent.' };
  }

  /**
   * Task 2.19. One of the three routes exempt from PASSWORD_CHANGE_REQUIRED
   * blocking (Task 2.6, arch §6.6). `currentPassword` is optional only on
   * the forced-first-change path (`mustChangePassword: true`); that check
   * is data-dependent, so it lives here rather than on the DTO. arch §6.3
   * lists "password reset/change" together as tokenVersion-incrementing
   * events — a voluntary change gets the exact same "logout everywhere"
   * treatment as reset-password (Task 2.17), since bumping tokenVersion
   * alone would still let a live, non-revoked refresh token mint fresh
   * access tokens at the new tokenVersion.
   */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<{ message: string }> {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new UnauthorizedException({ message: 'Account is inactive', errorCode: 'ACCOUNT_INACTIVE' });
    }

    if (!user.mustChangePassword) {
      if (!dto.currentPassword) {
        throw new BadRequestException({
          message: 'currentPassword is required',
          errorCode: 'VALIDATION_ERROR',
          details: [{ field: 'currentPassword', message: 'currentPassword is required' }],
        });
      }
      const currentMatches = await this.passwordService.verify(user.passwordHash, dto.currentPassword);
      if (!currentMatches) {
        throw new UnauthorizedException({ message: 'Current password is incorrect', errorCode: 'UNAUTHORIZED' });
      }
    }

    const newPasswordHash = await this.passwordService.hash(dto.newPassword);

    await this.prisma.$transaction(async (tx) => {
      await this.usersRepository.update(
        userId,
        { passwordHash: newPasswordHash, mustChangePassword: false, tokenVersion: { increment: 1 } },
        tx,
      );
      await this.refreshTokenRepository.revokeAllForUser(userId, tx);
    });

    return { message: 'Password changed.' };
  }

  /**
   * Task 2.20. Completes a Super-Admin-provisioned trainer's setup link
   * (Task 3.8, which doesn't exist yet — implemented/tested here against a
   * manually-seeded `PasswordResetToken(purpose: 'TRAINER_SETUP')` row per
   * the plan's own note, to be re-verified end-to-end once Task 3.8 lands).
   * Unlike reset-password (Task 2.17), this distinguishes 409 (already
   * consumed) from 404 (unknown token) rather than collapsing both into a
   * generic 404 — api §1 states this explicitly for /auth/register.
   */
  async completeTrainerSetup(dto: CompleteTrainerSetupDto, res: Response): Promise<AuthSessionResponseDto> {
    const tokenRow = await this.passwordResetTokenRepository.findByToken(hashOpaqueToken(dto.setupToken));

    if (!tokenRow || tokenRow.purpose !== 'TRAINER_SETUP') {
      throw new NotFoundException({ message: 'Invalid setup token', errorCode: 'NOT_FOUND' });
    }
    if (tokenRow.usedAt) {
      throw new ConflictException({ message: 'Setup token already used', errorCode: 'CONFLICT' });
    }
    if (tokenRow.expiresAt.getTime() < Date.now()) {
      throw new GoneException({ message: 'Setup token expired', errorCode: 'TOKEN_EXPIRED' });
    }

    const newPasswordHash = await this.passwordService.hash(dto.password);

    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await this.usersRepository.update(
        tokenRow.userId,
        { passwordHash: newPasswordHash, mustChangePassword: false },
        tx,
      );
      await this.passwordResetTokenRepository.markUsed(tokenRow.id, tx);
      return updated;
    });

    return this.issueSession(user, res);
  }

  /** Shared by login (Task 2.13) and, later, setup-completion (Task 2.20). */
  async issueSession(user: User, res: Response): Promise<AuthSessionResponseDto> {
    const { accessToken, expiresIn, summary } = await this.buildAccessToken(user);

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

    return { accessToken, expiresIn, user: summary };
  }

  private async buildAccessToken(
    user: User,
  ): Promise<{ accessToken: string; expiresIn: number; summary: UserSummaryDto }> {
    const tenantClaims = await this.tenantClaimsResolver.resolve(user);

    const { accessToken, expiresIn } = await this.tokenService.issueAccessToken({
      userId: user.id,
      role: user.role,
      accountType: tenantClaims.accountType,
      guardianUserId: tenantClaims.guardianUserId,
      trainerId: tenantClaims.trainerId,
      tokenVersion: user.tokenVersion,
    });

    return {
      accessToken,
      expiresIn,
      summary: {
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

  /** arch §6.4: the refresh cookie is the one ambient credential in this API. */
  private assertCsrf(req: Request): void {
    const csrfCookie = (req.cookies as Record<string, string> | undefined)?.[CSRF_COOKIE];
    const csrfHeader = req.headers['x-csrf-token'];

    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      throw new ForbiddenException({ message: 'Missing or mismatched CSRF token', errorCode: 'CSRF_MISMATCH' });
    }
  }

  private genericInvalidCredentials(): UnauthorizedException {
    // FR-001: byte-identical body/status for "no such user" and "wrong
    // password" — never distinguish the two to the client.
    return new UnauthorizedException({ message: 'Invalid email or password.', errorCode: 'UNAUTHORIZED' });
  }

}
