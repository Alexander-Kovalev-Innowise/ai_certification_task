import { ConflictException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { JOB_TYPES } from '../../shared/jobs/job-types.const';
import { OutboxService } from '../../shared/jobs/outbox.service';
import { buildCampConversionLinkEmailPayload } from '../../shared/mail/templates/camp-conversion-link.template';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { generateOpaqueToken, hashOpaqueToken } from '../auth/opaque-token.util';
import { resolveShareLinkInvalidReason } from '../share-links/share-link.service';

import { toPrefill } from './camp-conversion.payload';
import type { CampConversionPayload } from './camp-conversion.payload';
import { CampConversionsRepository, CampConversionWithLink } from './camp-conversions.repository';
import type { CampConversionCreatedDto, CampConversionPrefillDto } from './dto/camp-conversion-response.dto';
import type { CreateCampConversionDto } from './dto/create-camp-conversion.dto';

export const CAMP_CONVERSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function notFound(): NotFoundException {
  return new NotFoundException({ message: 'Unknown or already used camp sign-up', errorCode: 'NOT_FOUND' });
}

// Camp/evaluation sign-up -> account conversion. The Epic-08 camp form posts here; the person gets an opaque
// token that pre-fills the ordinary ShareLink registration (ShareLinkRedemptionService accepts it as
// `conversionToken`) so nothing has to be typed twice.
@Injectable()
export class CampConversionsService {
  constructor(
    private readonly repository: CampConversionsRepository,
    private readonly outboxService: OutboxService,
    private readonly prisma: PrismaService,
  ) {}

  async create(dto: CreateCampConversionDto): Promise<CampConversionCreatedDto> {
    const link = await this.repository.findShareLinkByCode(dto.shareLinkCode);
    // Only a reusable player link can carry a camp sign-up; anything else looks "unknown" (no probing of code types).
    if (!link || link.type !== 'PLAYER_STATIC') {
      throw new NotFoundException({ message: 'Unknown ShareLink code', errorCode: 'NOT_FOUND' });
    }
    if (resolveShareLinkInvalidReason(link) !== null) {
      throw new ConflictException({ message: 'This ShareLink is no longer available', errorCode: 'SHARE_LINK_UNAVAILABLE' });
    }

    const payload: CampConversionPayload = {
      parentFirstName: dto.parentFirstName.trim(),
      parentLastName: dto.parentLastName.trim(),
      email: dto.email.trim(),
      phone: dto.phone,
      playerName: dto.playerName.trim(),
      playerAge: dto.playerAge,
      playerGender: dto.playerGender,
      source: dto.source ?? 'CAMP',
      ...(dto.submissionRef ? { submissionRef: dto.submissionRef } : {}),
    };

    const token = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + CAMP_CONVERSION_TTL_MS);
    await this.repository.create({
      tokenHash: hashOpaqueToken(token),
      shareLinkId: link.id,
      payload: payload as unknown as Prisma.InputJsonValue,
      expiresAt,
    });

    return { conversionToken: token, expiresAt, joinUrl: `/join/${link.code}?camp=${token}` };
  }

  async getPrefill(token: string): Promise<CampConversionPrefillDto> {
    const conversion = await this.requireUsable(token);
    const payload = conversion.payload as unknown as CampConversionPayload;
    return {
      shareLinkCode: conversion.shareLink.code,
      source: payload.source,
      expiresAt: conversion.expiresAt,
      trainer: {
        displayName: conversion.shareLink.trainer.businessName,
        logoUrl: conversion.shareLink.trainer.logoUrl,
        primaryColorHex: conversion.shareLink.trainer.primaryColorHex,
      },
      prefill: toPrefill(payload),
    };
  }

  /** "Email me the link for later": queues the join link (carrying the token) to the address from the camp form. */
  async emailLink(token: string): Promise<void> {
    const conversion = await this.requireUsable(token);
    const payload = conversion.payload as unknown as CampConversionPayload;
    const trainerBusinessName = conversion.shareLink.trainer.businessName;

    await this.prisma.$transaction(async (tx) => {
      await this.outboxService.enqueue(
        tx,
        JOB_TYPES.EMAIL_CAMP_CONVERSION_LINK,
        buildCampConversionLinkEmailPayload(payload.email, {
          firstName: payload.parentFirstName,
          trainerBusinessName,
          shareLinkCode: conversion.shareLink.code,
          conversionToken: token,
        }) as unknown as Prisma.InputJsonValue,
      );
    });
    this.outboxService.nudge();
  }

  /**
   * Used by the redemption flow: the usable conversion for `token` that belongs to `shareLinkId`, or a 404/410.
   * A token minted for a different link is reported as unknown (never confirms that it exists).
   */
  async resolveForRedemption(token: string, shareLinkId: string): Promise<{ id: string; payload: CampConversionPayload }> {
    const conversion = await this.requireUsable(token);
    if (conversion.shareLinkId !== shareLinkId) {
      throw notFound();
    }
    return { id: conversion.id, payload: conversion.payload as unknown as CampConversionPayload };
  }

  /** Inside the registration transaction: losing the race (used/expired meanwhile) => 404 and the whole registration rolls back. */
  async markUsed(id: string, tx: Prisma.TransactionClient): Promise<void> {
    const claimed = await this.repository.markUsed(id, tx);
    if (claimed.count === 0) {
      throw notFound();
    }
  }

  private async requireUsable(token: string): Promise<CampConversionWithLink> {
    const conversion = await this.repository.findByTokenHash(hashOpaqueToken(token));
    if (!conversion || conversion.usedAt) {
      throw notFound();
    }
    if (conversion.expiresAt.getTime() <= Date.now()) {
      throw new GoneException({ message: 'This camp sign-up link has expired', errorCode: 'TOKEN_EXPIRED' });
    }
    return conversion;
  }
}
