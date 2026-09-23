import { randomBytes } from 'node:crypto';

import { BadRequestException, Injectable } from '@nestjs/common';
import type { ShareLink } from '@prisma/client';
import { plainToInstance } from 'class-transformer';

import type { AuthContext } from '../../shared/security/auth-context.interface';

import type { CreateShareLinkDto } from './dto/create-share-link.dto';
import {
  ShareLinkCreatedResponseDto,
  ShareLinkPreviewInvalidReason,
  ShareLinkPreviewResponseDto,
} from './dto/share-link-response.dto';
import { ShareLinksRepository, ShareLinkWithTrainer } from './share-links.repository';

// api §4.4 "POST /share-links" — COACH_UNIQUE links expire 7 days after
// creation; single-use is enforced at redemption time (Task 4.9's
// conditional `updateMany`), not here.
const COACH_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Opaque, URL-safe code — 12 random bytes (96 bits) base64url-encoded, same
 * "opaque random, not sequential/guessable" posture as the auth module's
 * `generateOpaqueToken` (opaque-token.util.ts), sized down from that
 * function's 256 bits because a ShareLink code is meant to be short enough
 * to appear in a join URL, not stored hashed-at-rest like a password-reset
 * token.
 */
function generateShareLinkCode(): string {
  return randomBytes(12).toString('base64url');
}

/**
 * Task 4.3 (api §4.4 "GET /share-links/:code"). Shared with the redemption
 * flows (Task 4.6 onward) so "why is this link unusable" is computed exactly
 * once: `null` means valid. Checked in this order — an explicit `REVOKED`/
 * `EXPIRED` status always wins over a stale `expiresAt` comparison, and a
 * still-`ACTIVE` row whose `expiresAt` has simply passed (the 15-minute
 * maintenance-sweep lag, Task 4.14) is reported `EXPIRED` too, not `valid`.
 */
export function resolveShareLinkInvalidReason(
  link: Pick<ShareLink, 'status' | 'expiresAt' | 'maxUses' | 'useCount'>,
): ShareLinkPreviewInvalidReason | null {
  if (link.status === 'REVOKED') {
    return 'REVOKED';
  }
  if (link.status === 'EXPIRED') {
    return 'EXPIRED';
  }
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
    return 'EXPIRED';
  }
  if (link.maxUses !== null && link.useCount >= link.maxUses) {
    return 'EXHAUSTED';
  }
  return null;
}

// Task 4.2, extended in Task 4.4 (listByTrainer), Task 4.5 (revoke).
@Injectable()
export class ShareLinkService {
  constructor(private readonly shareLinksRepository: ShareLinksRepository) {}

  /** Task 4.2 (api §4.4 "POST /share-links", FR-023). Dispatches to generatePlayerLink/generateCoachLink by `dto.type`. */
  async createShareLink(ctx: AuthContext, dto: CreateShareLinkDto): Promise<ShareLinkCreatedResponseDto> {
    if (dto.type === 'COACH_UNIQUE') {
      if (!dto.targetEmail) {
        // Belt-and-suspenders: CreateShareLinkDto's @ValidateIf/@IsEmail
        // pairing already rejects this at the ValidationPipe layer before a
        // request ever reaches the service — this mirrors that same 400
        // VALIDATION_ERROR shape defensively, for any caller that
        // constructs the DTO directly (e.g. Task 4.11's CoachService).
        throw new BadRequestException({
          message: 'targetEmail is required for a COACH_UNIQUE link',
          errorCode: 'VALIDATION_ERROR',
          details: [{ field: 'targetEmail', message: 'targetEmail is required for a COACH_UNIQUE link' }],
        });
      }
      return this.generateCoachLink(ctx, dto.targetEmail);
    }
    return this.generatePlayerLink(ctx);
  }

  /** Task 4.2 (BR-006). `expiresAt`/`maxUses` left at their schema defaults (null) — reusable by any number of families, never expires on its own. */
  async generatePlayerLink(ctx: AuthContext): Promise<ShareLinkCreatedResponseDto> {
    const link = await this.shareLinksRepository.create({
      code: generateShareLinkCode(),
      type: 'PLAYER_STATIC',
      trainer: { connect: { id: this.requireTrainerId(ctx) } },
      createdBy: { connect: { id: ctx.userId } },
    });
    return this.toResponse(link);
  }

  /**
   * Task 4.3 (api §4.4 "GET /share-links/:code"). `@Public()` — never 404s
   * (arch §9.1: an unknown code returns `200 {valid:false,
   * reason:'NOT_FOUND'}` too, so probing codes can't distinguish "wrong
   * code" from "expired code" by status alone).
   */
  async previewShareLink(code: string): Promise<ShareLinkPreviewResponseDto> {
    const link = await this.shareLinksRepository.findByCode(code);
    if (!link) {
      return this.toPreviewResponse(null, 'NOT_FOUND');
    }

    return this.toPreviewResponse(link, resolveShareLinkInvalidReason(link));
  }

  /** Task 4.2/Task 4.11 (BR-006). Expires in 7 days; single-use enforced at redemption (Task 4.9), not at creation. */
  async generateCoachLink(ctx: AuthContext, targetEmail: string): Promise<ShareLinkCreatedResponseDto> {
    const link = await this.shareLinksRepository.create({
      code: generateShareLinkCode(),
      type: 'COACH_UNIQUE',
      targetEmail,
      expiresAt: new Date(Date.now() + COACH_LINK_TTL_MS),
      trainer: { connect: { id: this.requireTrainerId(ctx) } },
      createdBy: { connect: { id: ctx.userId } },
    });
    return this.toResponse(link);
  }

  /**
   * `ctx.trainerId` (the `tid` claim) is only ever populated for TRAINER/COACH
   * (access-token-claims.interface.ts) — a SUPER_ADMIN caller has none, so
   * despite api §4.4's prose also naming "or Super Admin" for this endpoint,
   * the DTO (reproduced verbatim from the spec) carries no trainerId for a
   * Super Admin to bind the link to. Flagged here rather than silently
   * guessed at; the controller restricts @Roles to TRAINER only for the same
   * reason, so this branch is currently unreachable in practice and exists
   * as an explicit guard rather than a silent `!` non-null assertion.
   */
  private requireTrainerId(ctx: AuthContext): string {
    if (!ctx.trainerId) {
      throw new BadRequestException({
        message: 'Caller has no tenant to generate a ShareLink for',
        errorCode: 'VALIDATION_ERROR',
      });
    }
    return ctx.trainerId;
  }

  private toResponse(link: ShareLink): ShareLinkCreatedResponseDto {
    return plainToInstance(
      ShareLinkCreatedResponseDto,
      {
        id: link.id,
        code: link.code,
        type: link.type,
        joinUrl: `/join/${link.code}`,
        expiresAt: link.expiresAt,
        status: link.status,
      },
      { excludeExtraneousValues: true },
    );
  }

  private toPreviewResponse(
    link: ShareLinkWithTrainer | null,
    reason: ShareLinkPreviewInvalidReason | null,
  ): ShareLinkPreviewResponseDto {
    return plainToInstance(
      ShareLinkPreviewResponseDto,
      {
        valid: reason === null,
        reason: reason ?? undefined,
        type: link?.type,
        trainerDisplayName: link?.trainer.businessName,
        logoUrl: link?.trainer.logoUrl,
        primaryColorHex: link?.trainer.primaryColorHex,
      },
      { excludeExtraneousValues: true },
    );
  }
}
