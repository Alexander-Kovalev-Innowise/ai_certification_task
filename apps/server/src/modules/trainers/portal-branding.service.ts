import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';

import { JOB_TYPES } from '../../shared/jobs/job-types.const';
import { OutboxService } from '../../shared/jobs/outbox.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { AuthContext } from '../../shared/security/auth-context.interface';

import { BrandingResponseDto } from './dto/branding-response.dto';
import type { UpdateBrandingDto } from './dto/update-branding.dto';
import { TrainersRepository } from './trainers.repository';
import { computeDerivedPalette, type DerivedPalette } from './wcag-contrast.util';

/**
 * Task 8.1 (arch §5 "PortalBrandingService folded into trainers" — mutates
 * two columns on TrainerProfile and shares TrainerService's own ownership
 * rule, so a separate module would just duplicate the guard for no boundary
 * benefit). Extended in Task 8.2 to enqueue the MEDIA_LOGO_RESIZE outbox job
 * when `logoUrl` changes, atomically with the TrainerProfile write — "the
 * PATCH response carries the pre-resize URL immediately, the resized one
 * lands after the job runs" (Task 8.2's Do) is a statement about THIS PATCH
 * handler, not the pre-upload step: the upload step (shared/storage,
 * StorageController) only stores the raw bytes and returns a URL, it never
 * touches the outbox — this is what keeps StorageModule and JobsModule from
 * needing to import each other (JobsModule already imports StorageModule for
 * StorageService; the reverse edge would be circular).
 */
@Injectable()
export class PortalBrandingService {
  constructor(
    private readonly trainersRepository: TrainersRepository,
    private readonly outboxService: OutboxService,
    private readonly prisma: PrismaService,
  ) {}

  async updateBranding(ctx: AuthContext, id: string, dto: UpdateBrandingDto): Promise<BrandingResponseDto> {
    this.assertOwnershipOrNotFound(ctx, id);

    const existing = await this.trainersRepository.findById(id);
    if (!existing) {
      throw new NotFoundException({ message: 'Trainer not found', errorCode: 'NOT_FOUND' });
    }

    if (dto.resetToDefault) {
      const cleared = await this.trainersRepository.update(id, {
        logoUrl: null,
        primaryColorHex: null,
        derivedPaletteJson: Prisma.JsonNull,
      });
      return this.toResponse(cleared);
    }

    const updateData: Prisma.TrainerProfileUpdateInput = {};
    let contrastWarning: string | undefined;

    if (dto.logoUrl !== undefined) {
      updateData.logoUrl = dto.logoUrl;
    }

    if (dto.primaryColorHex !== undefined) {
      const computed = computeDerivedPalette(dto.primaryColorHex);
      updateData.primaryColorHex = dto.primaryColorHex;
      updateData.derivedPaletteJson = computed.palette as unknown as Prisma.InputJsonValue;
      contrastWarning = computed.contrastWarning;
    }

    // Enqueue MEDIA_LOGO_RESIZE in the SAME transaction as the
    // TrainerProfile write (arch §13.2 — a job row must commit atomically
    // with the business row it belongs to). `targetKey` reuses the just-
    // uploaded object's own key so the resize overwrites it in place: the
    // logoUrl the caller gets back never changes, only its bytes do once the
    // outbox drains it (Task 8.2's Do).
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await this.trainersRepository.update(id, updateData, tx);
      if (dto.logoUrl !== undefined) {
        await this.outboxService.enqueue(tx, JOB_TYPES.MEDIA_LOGO_RESIZE, {
          sourceUrl: dto.logoUrl,
          targetKey: storageKeyFromUrl(dto.logoUrl),
        });
      }
      return row;
    });

    return this.toResponse(updated, contrastWarning);
  }

  /** Same pattern as TrainerService.assertOwnershipOrNotFound (api §4.1 footnote) — duplicated per this codebase's established convention (see also CoachService, ShareLinkService, AssociationsService). */
  private assertOwnershipOrNotFound(ctx: AuthContext, id: string): void {
    if (ctx.role === 'SUPER_ADMIN') {
      return;
    }
    if (ctx.role === 'TRAINER' && ctx.trainerId === id) {
      return;
    }
    throw new NotFoundException({ message: 'Trainer not found', errorCode: 'NOT_FOUND' });
  }

  private toResponse(
    trainer: { logoUrl: string | null; primaryColorHex: string | null; derivedPaletteJson: Prisma.JsonValue | null },
    contrastWarning?: string,
  ): BrandingResponseDto {
    return plainToInstance(
      BrandingResponseDto,
      {
        logoUrl: trainer.logoUrl,
        primaryColorHex: trainer.primaryColorHex,
        derivedPalette: (trainer.derivedPaletteJson as unknown as DerivedPalette | null) ?? null,
        contrastWarning,
      },
      { excludeExtraneousValues: true },
    );
  }
}

/**
 * Recovers the storage key from a StorageService-issued URL so the resize
 * job can overwrite the same object. Deliberately just the URL's final path
 * segment — both LocalStorageAdapter (`file://.../<key>`, Task 1.11's flat,
 * no-subdirectory keys) and a real S3-style URL (`https://.../<key>`) carry
 * the key as their last path segment.
 */
function storageKeyFromUrl(url: string): string {
  const { pathname } = new URL(url);
  const segments = pathname.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? pathname;
}
