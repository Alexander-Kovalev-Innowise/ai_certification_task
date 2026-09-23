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

  /**
   * Task 5.2 (api §4.3 "GET /player-profiles", FR-032). Adult
   * `PLAYER_PARENT`: self + every child profile the account owns. `typ:
   * CHILD`: only that child's own profile — never a sibling's, never the
   * guardian's self profile (arch §9.2's service-layer restriction, the
   * repository-level equivalent of Task 5.1's capability-level CHILD
   * restriction). Each row's `trainerCount` is a plain count, never the
   * full trainer objects `GET /player-profiles/:id/trainers` (Task 5.5)
   * returns — keeps this list light for the family-picker UI (api §4.3).
   */
  async listProfiles(ctx: AuthContext): Promise<PlayerProfileResponseDto[]> {
    const profiles =
      ctx.accountType === 'CHILD'
        ? await this.listChildOwnProfile(ctx.userId)
        : await this.playerProfilesRepository.listForAccount(ctx.userId);

    return Promise.all(profiles.map((profile) => this.toResponseWithTrainerCount(profile)));
  }

  /**
   * Task 5.3 (api §4.3 "GET /player-profiles/:id"). Ownership-checked: the
   * adult owner (`accountUserId`), the child themself
   * (`childUserId = caller`), or `SUPER_ADMIN`. A cross-ownership read is a
   * generic `404`, never `403` — same existence-disclosure posture as the
   * tenant-isolation 404s elsewhere in this codebase (arch §8 Layer 3),
   * applied here to family ownership rather than trainer tenancy.
   */
  async getProfileById(ctx: AuthContext, id: string): Promise<PlayerProfileResponseDto> {
    const profile = await this.playerProfilesRepository.findById(id);
    if (!profile || !this.canRead(ctx, profile)) {
      throw new NotFoundException({ message: 'Player profile not found', errorCode: 'NOT_FOUND' });
    }
    return this.toResponse(profile);
  }

  private canRead(ctx: AuthContext, profile: PlayerProfile): boolean {
    if (ctx.role === 'SUPER_ADMIN') {
      return true;
    }
    if (ctx.accountType === 'CHILD') {
      return profile.childUserId === ctx.userId;
    }
    return profile.accountUserId === ctx.userId;
  }

  private async listChildOwnProfile(childUserId: string): Promise<PlayerProfile[]> {
    const own = await this.playerProfilesRepository.findByChildUserId(childUserId);
    return own ? [own] : [];
  }

  private async toResponseWithTrainerCount(profile: PlayerProfile): Promise<PlayerProfileResponseDto> {
    const trainerCount = await this.playerProfilesRepository.countActiveTrainers(profile.id);
    const response = this.toResponse(profile);
    response.trainerCount = trainerCount;
    return response;
  }

  private toResponse(profile: PlayerProfile): PlayerProfileResponseDto {
    return plainToInstance(PlayerProfileResponseDto, profile, { excludeExtraneousValues: true });
  }
}
