import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { JOB_TYPES } from '../../shared/jobs/job-types.const';
import { OutboxService } from '../../shared/jobs/outbox.service';
import { buildCoachInviteEmailPayload } from '../../shared/mail/templates/coach-invite.template';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { AuthContext } from '../../shared/security/auth-context.interface';
import { ShareLinkService } from '../share-links/share-link.service';

import type { InviteCoachDto } from './dto/invite-coach.dto';
import { InviteCoachResponseDto } from './dto/invite-coach.dto';

// Task 4.11, first method — extended in Task 4.12 (listByTrainer) and Task
// 4.13 (updateCoach).
@Injectable()
export class CoachService {
  constructor(
    private readonly shareLinkService: ShareLinkService,
    private readonly outboxService: OutboxService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Task 4.11 (api §4.2 "POST /coaches/invite", FR-060). Trainer only, own
   * tenant. Delegates to `ShareLinkService.generateCoachLink` (Task 4.2) for
   * the actual `ShareLink(type=COACH_UNIQUE)` row — this method's own job is
   * wrapping that call and the `OutboxJob(EMAIL_COACH_INVITE)` enqueue in
   * one `$transaction` (arch §13.2: the invite email must not fire for a
   * link that didn't actually commit), and resolving the trainer's
   * `businessName` for the email (`ctx` carries no display name of its own).
   */
  async inviteCoach(ctx: AuthContext, dto: InviteCoachDto): Promise<InviteCoachResponseDto> {
    if (!ctx.trainerId) {
      // Unreachable via the real route (@Roles(TRAINER) guarantees a `tid`
      // claim) — narrows the type below, same defensive posture as
      // ShareLinkService.requireTrainerId.
      throw new BadRequestException({ message: 'Caller has no tenant to invite a coach into', errorCode: 'VALIDATION_ERROR' });
    }
    const trainerProfile = await this.prisma.trainerProfile.findUniqueOrThrow({ where: { id: ctx.trainerId } });

    const link = await this.prisma.$transaction(async (tx) => {
      const created = await this.shareLinkService.generateCoachLink(ctx, dto.email, tx);
      await this.outboxService.enqueue(
        tx,
        JOB_TYPES.EMAIL_COACH_INVITE,
        buildCoachInviteEmailPayload(dto.email, {
          trainerBusinessName: trainerProfile.businessName,
          inviteeName: dto.name,
          message: dto.message,
          shareLinkCode: created.code,
        }) as unknown as Prisma.InputJsonValue,
      );
      return created;
    });

    const response = new InviteCoachResponseDto();
    response.shareLinkCode = link.code;
    response.expiresAt = link.expiresAt;
    response.status = 'PENDING';
    return response;
  }
}
