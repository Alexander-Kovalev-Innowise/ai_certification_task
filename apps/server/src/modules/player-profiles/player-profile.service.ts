import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PlayerProfile } from '@prisma/client';
import { plainToInstance } from 'class-transformer';

import { PrismaService } from '../../shared/prisma/prisma.service';
import type { AuthContext } from '../../shared/security/auth-context.interface';
import { AssociationsRepository } from '../associations/associations.repository';

import type { CreateChildProfileDto } from './dto/create-child-profile.dto';
import { PlayerProfileResponseDto } from './dto/player-profile-response.dto';
import { PlayerProfilesRepository } from './player-profiles.repository';

// Task 5.1's response also needs a status code that varies per branch (`201`
// normally, `200` for the FR-030 non-blocking-duplicate branch) — same
// "manual @Res()" reason as ShareLinkRedemptionService.RedeemResult; see
// PlayerProfilesController.createChildProfile.
export interface CreateChildProfileResult {
  statusCode: number;
  body: PlayerProfileResponseDto;
}

/** Whole years between `dateOfBirth` and `now`, calendar-correct (not a naive `/365` division). */
function calculateAge(dateOfBirth: Date, now: Date = new Date()): number {
  let age = now.getFullYear() - dateOfBirth.getFullYear();
  const monthDiff = now.getMonth() - dateOfBirth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dateOfBirth.getDate())) {
    age -= 1;
  }
  return age;
}

// Task 5.1, extended in Tasks 5.2-5.4 (list/read/patch).
@Injectable()
export class PlayerProfileService {
  constructor(
    private readonly playerProfilesRepository: PlayerProfilesRepository,
    private readonly associationsRepository: AssociationsRepository,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Task 5.1 (api §4.3 "POST /player-profiles", FR-030/FR-031). CHILD tokens
   * never reach this method — `@RequiresCapability(MANAGE_CHILD_PROFILES)`
   * on the route already produces `403 CHILD_CAPABILITY_DENIED` for them
   * (MANAGE_CHILD_PROFILES is in CHILD_DENIED, capability.enum.ts) before
   * the controller is even invoked.
   *
   * Age (1-18) is validated here, not by a class-validator decorator on the
   * DTO — it needs "now," which isn't expressible declaratively. The
   * FR-030 duplicate check (same account, same name + dateOfBirth) is
   * evaluated BEFORE the write (the newly created row can't be its own
   * duplicate) and is non-blocking: it only adds a `warning` string and
   * downgrades the response to `200`, it never prevents the create.
   */
  async createChildProfile(ctx: AuthContext, dto: CreateChildProfileDto): Promise<CreateChildProfileResult> {
    const dateOfBirth = new Date(dto.dateOfBirth);
    const age = calculateAge(dateOfBirth);
    if (age < 1 || age > 18) {
      throw new BadRequestException({
        message: 'age must be between 1 and 18',
        errorCode: 'VALIDATION_ERROR',
        details: [{ field: 'dateOfBirth', message: 'age must be between 1 and 18' }],
      });
    }

    const duplicate = await this.playerProfilesRepository.findDuplicateSibling(ctx.userId, dto.name, dateOfBirth);

    const created = await this.prisma.$transaction(async (tx) => {
      const profile = await this.playerProfilesRepository.create(
        {
          accountOwner: { connect: { id: ctx.userId } },
          name: dto.name,
          dateOfBirth,
          gender: dto.gender,
          school: dto.school,
          photoUrl: dto.photoUrl,
          isSelf: false,
        },
        tx,
      );

      if (dto.trainerIds && dto.trainerIds.length > 0) {
        for (const trainerId of dto.trainerIds) {
          try {
            await this.associationsRepository.create({ trainerId, playerProfileId: profile.id }, tx);
          } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
              throw new NotFoundException({ message: 'Unknown trainer', errorCode: 'NOT_FOUND' });
            }
            throw error;
          }
        }
      }

      return profile;
    });

    const body = this.toResponse(created);
    if (duplicate) {
      body.warning = 'A profile with this name and date of birth already exists on this account';
      return { statusCode: 200, body };
    }
    return { statusCode: 201, body };
  }

  private toResponse(profile: PlayerProfile): PlayerProfileResponseDto {
    return plainToInstance(PlayerProfileResponseDto, profile, { excludeExtraneousValues: true });
  }
}
