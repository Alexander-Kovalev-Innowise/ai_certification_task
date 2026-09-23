import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';

import { JOB_TYPES } from '../../shared/jobs/job-types.const';
import { OutboxService } from '../../shared/jobs/outbox.service';
import { buildTrainerInviteEmailPayload } from '../../shared/mail/templates/trainer-invite.template';
import { generateOpaqueToken, hashOpaqueToken } from '../auth/opaque-token.util';
import { PasswordResetTokenRepository } from '../auth/password-reset-token.repository';
import { PasswordService } from '../auth/password.service';
import { AccountProvisioningService } from '../users/account-provisioning.service';

import type { CreateTrainerDto } from './dto/create-trainer.dto';
import { TrainerCreatedResponseDto } from './dto/trainer-response.dto';
import { TrainersRepository } from './trainers.repository';

// Postgres unique-violation code — see users.service.ts's identical constant/usage.
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

// 7 days — not specified by api-designer-spec.md (which only says "setup-
// link" without a TTL) or architect-architecture.md's arch §6.1 token-TTL
// table (that table only covers PASSWORD_RESET's 1h and email-verification's
// 24h). A Super-Admin-issued account-setup invite is a materially different
// use case from a self-service password reset — the trainer may not act on
// it same-day — so a longer TTL than PASSWORD_RESET's 1h is used here as an
// implementation decision, flagged per the plan's own convention for
// unresolved specifics (Task 1.1's plan-header note models the same
// disclosure style for the PasswordResetToken.purpose reuse decision).
const TRAINER_SETUP_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Task 3.8, extended in Task 3.9 (getTrainer/updateTrainer).
@Injectable()
export class TrainerService {
  constructor(
    private readonly accountProvisioningService: AccountProvisioningService,
    private readonly trainersRepository: TrainersRepository,
    private readonly passwordResetTokenRepository: PasswordResetTokenRepository,
    private readonly passwordService: PasswordService,
    private readonly outboxService: OutboxService,
  ) {}

  /**
   * Task 3.8 (api §4.1 "POST /trainers", FR-010/BR-005). One transaction
   * (AccountProvisioningService.createUserWithProfile's own, extended via
   * Task 3.8's new `afterCreate` hook): User(role=TRAINER, status=ACTIVE,
   * mustChangePassword=true) + TrainerProfile + PasswordResetToken(purpose:
   * 'TRAINER_SETUP') + OutboxJob(EMAIL_TRAINER_INVITE). No password is
   * ever generated FOR THE TRAINER or emailed (OQ-8) — `passwordHash` is
   * still a required NOT NULL column, so it's seeded with a real argon2
   * hash of an unguessable random value nobody is ever told, purely so
   * PasswordService.verify() never has to handle a malformed hash if
   * someone guesses at logging in before setup completes; the trainer's
   * actual password is set for the first time by /auth/register
   * (completeTrainerSetup, Task 2.20), which overwrites this.
   */
  async createTrainer(dto: CreateTrainerDto): Promise<TrainerCreatedResponseDto> {
    const placeholderPasswordHash = await this.passwordService.hash(generateOpaqueToken());

    let user;
    try {
      user = await this.accountProvisioningService.createUserWithProfile({
        role: 'TRAINER',
        email: dto.email,
        passwordHash: placeholderPasswordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        status: 'ACTIVE',
        mustChangePassword: true,
        createProfile: async (tx, userId) => {
          await this.trainersRepository.create({ user: { connect: { id: userId } }, businessName: dto.businessName }, tx);
        },
        afterCreate: async (tx, createdUser) => {
          const rawSetupToken = generateOpaqueToken();
          await this.passwordResetTokenRepository.create(
            {
              userId: createdUser.id,
              token: hashOpaqueToken(rawSetupToken),
              purpose: 'TRAINER_SETUP',
              expiresAt: new Date(Date.now() + TRAINER_SETUP_TOKEN_TTL_MS),
            },
            tx,
          );
          await this.outboxService.enqueue(
            tx,
            JOB_TYPES.EMAIL_TRAINER_INVITE,
            buildTrainerInviteEmailPayload(createdUser.email, {
              firstName: createdUser.firstName,
              businessName: dto.businessName,
              setupToken: rawSetupToken,
            }) as unknown as Prisma.InputJsonValue,
          );
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION) {
        throw new ConflictException({ message: 'Email already in use', errorCode: 'CONFLICT' });
      }
      throw error;
    }

    const trainerProfile = await this.trainersRepository.findByUserId(user.id);
    if (!trainerProfile) {
      // Unreachable in practice (created in the same transaction above) —
      // narrows the type for the plainToInstance call below.
      throw new NotFoundException({ message: 'Trainer profile not found', errorCode: 'NOT_FOUND' });
    }

    return plainToInstance(
      TrainerCreatedResponseDto,
      {
        id: trainerProfile.id,
        userId: user.id,
        businessName: trainerProfile.businessName,
        email: user.email,
        status: 'Active',
        createdAt: trainerProfile.createdAt,
      },
      { excludeExtraneousValues: true },
    );
  }
}
