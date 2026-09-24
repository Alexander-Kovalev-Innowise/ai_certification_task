import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { User } from '@prisma/client';
import { plainToInstance } from 'class-transformer';

import { buildPaginatedResponse, decodeCursor, type PaginatedResponseDto } from '../../shared/http/pagination.dto';
import type { AuthContext } from '../../shared/security/auth-context.interface';
import { AssociationsRepository } from '../associations/associations.repository';
import { AssociationsService } from '../associations/associations.service';
import type { UserSummaryDto } from '../auth/dto/auth-session-response.dto';
import { AvailabilityRepository } from '../availability/availability.repository';
import { ChildApprovalsRepository } from '../child-approvals/child-approvals.repository';
import { CoachesRepository } from '../coaches/coaches.repository';
import { PlayerProfileService } from '../player-profiles/player-profile.service';
import { TrainerResponseDto } from '../trainers/dto/trainer-response.dto';
import { TrainersRepository } from '../trainers/trainers.repository';

import type { ListUsersQueryDto } from './dto/list-users-query.dto';
import type {
  CoachBootstrapDto,
  MeBootstrapResponseDto,
  PlayerParentBootstrapDto,
  TrainerBootstrapDto,
} from './dto/me-bootstrap-response.dto';
import { MeResponseDto } from './dto/me-response.dto';
import type { UpdateMeDto } from './dto/update-me.dto';
import type { UpdateUserDto } from './dto/update-user.dto';
import { UserDetailResponseDto } from './dto/user-detail-response.dto';
import { UserDirectoryRowDto } from './dto/user-directory-row.dto';
import { UsersRepository } from './users.repository';

// Postgres unique-violation code, surfaced by Prisma as
// PrismaClientKnownRequestError.code === 'P2002' — used by updateUser below
// to translate a duplicate-email PATCH into 409 CONFLICT (api §3) rather
// than letting the raw DB error escape as a 500.
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

// Fields a CHILD login may never write via PATCH /me — FR-050 (api §3):
// "update basic profile info (photo, preferences)" only. Guardian-owned
// data for a minor.
const CHILD_NOT_EDITABLE_FIELDS = ['firstName', 'lastName', 'phone'] as const;

// Task 2.22.
@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly trainersRepository: TrainersRepository,
    private readonly coachesRepository: CoachesRepository,
    private readonly associationsRepository: AssociationsRepository,
    private readonly associationsService: AssociationsService,
    private readonly playerProfileService: PlayerProfileService,
    private readonly availabilityRepository: AvailabilityRepository,
    private readonly childApprovalsRepository: ChildApprovalsRepository,
  ) {}

  async getMe(ctx: AuthContext): Promise<MeResponseDto> {
    const user = await this.loadUserOrThrow(ctx.userId);
    return this.toMeResponse(user, ctx.accountType);
  }

  async updateMe(ctx: AuthContext, dto: UpdateMeDto): Promise<MeResponseDto> {
    if (ctx.accountType === 'CHILD') {
      const offendingFields = CHILD_NOT_EDITABLE_FIELDS.filter((field) => dto[field] !== undefined);
      if (offendingFields.length > 0) {
        throw new ForbiddenException({
          message: 'These fields are not editable by a child login',
          errorCode: 'CHILD_FIELD_NOT_EDITABLE',
          details: offendingFields.map((field) => ({
            field,
            message: `${field} is guardian-owned and cannot be edited by a child login`,
          })),
        });
      }
    }

    const updated = await this.usersRepository.update(ctx.userId, {
      ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
      ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
      ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
      ...(dto.photoUrl !== undefined ? { photoUrl: dto.photoUrl } : {}),
      ...(dto.notificationPrefs !== undefined ? { notificationPrefs: dto.notificationPrefs } : {}),
    });

    return this.toMeResponse(updated, ctx.accountType);
  }

  /**
   * `GET /me/bootstrap` (api §5, arch §14/NFR-001). Aggregates across
   * `users`, `trainer-profiles`/`coach-profiles`, `player-profiles` and
   * `associations` in one round trip, so the dashboard-load NFR is met
   * without an N+1 waterfall of separate calls. Phase 9's DoD sweep found
   * every prior phase had referenced this endpoint as existing
   * infrastructure without any phase ever having implemented it — this
   * method (and the discriminated `MeBootstrapResponseDto` union it
   * returns, api §5's per-role table reproduced verbatim in that file) is
   * that gap closed.
   *
   * `ctx.role`/`ctx.userId`/`ctx.accountType` are already the EFFECTIVE
   * identity (auth-context.interface.ts's own comment) — an
   * impersonation-token caller reaches this exactly like a real login of
   * the target role, no separate impersonation branch needed here.
   * `trainerContextHeader` is `X-Trainer-Context`, read by the controller —
   * optional (api §5: the whole point of bootstrap for a multi-trainer
   * player is returning every context in one shot before the client has
   * picked one) and only meaningful for the PLAYER_PARENT shape, the only
   * one with a `contexts`/`activeContext` pair.
   */
  async getMeBootstrap(ctx: AuthContext, trainerContextHeader?: string): Promise<MeBootstrapResponseDto> {
    const user = await this.loadUserOrThrow(ctx.userId);
    const userSummary = this.toUserSummary(user, ctx.accountType);

    if (ctx.role === 'SUPER_ADMIN') {
      // Deliberately minimal (api §5) — Super Admin has PLATFORM scope and
      // no per-tenant dashboard data to aggregate; no `stats` block in
      // Epic-01.
      return { role: 'SUPER_ADMIN', user: userSummary };
    }

    if (ctx.role === 'TRAINER') {
      return this.buildTrainerBootstrap(ctx, userSummary);
    }

    if (ctx.role === 'COACH') {
      return this.buildCoachBootstrap(ctx, userSummary);
    }

    // PLAYER_PARENT — covers both ADULT and CHILD `typ` (accountType field).
    return this.buildPlayerParentBootstrap(ctx, userSummary, trainerContextHeader);
  }

  private toUserSummary(user: User, accountType: 'ADULT' | 'CHILD'): UserSummaryDto {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      accountType,
      firstName: user.firstName,
      lastName: user.lastName,
      mustChangePassword: user.mustChangePassword,
    };
  }

  /** TRAINER branch (api §5) — own TrainerProfile + branding + roster counts, own tenant only. */
  private async buildTrainerBootstrap(ctx: AuthContext, user: UserSummaryDto): Promise<TrainerBootstrapDto> {
    const trainerProfile = await this.trainersRepository.findByUserId(ctx.userId);
    if (!trainerProfile) {
      // Unreachable via a real TRAINER token — AccountProvisioningService
      // always creates the TrainerProfile in the same transaction as the
      // User row (TrainerService.createTrainer). Narrows the type below.
      throw new NotFoundException({ message: 'Trainer profile not found', errorCode: 'NOT_FOUND' });
    }

    const [coachCount, activePlayerCount] = await Promise.all([
      this.coachesRepository.countActiveByTrainer(trainerProfile.id),
      this.associationsRepository.countActiveForTrainer(trainerProfile.id),
    ]);

    return {
      role: 'TRAINER',
      user,
      trainerProfile: plainToInstance(TrainerResponseDto, trainerProfile, { excludeExtraneousValues: true }),
      branding: { logoUrl: trainerProfile.logoUrl, primaryColorHex: trainerProfile.primaryColorHex },
      coachCount,
      activePlayerCount,
    };
  }

  /** COACH branch (api §5) — own CoachProfile + employing trainer's branding + whether "My Times" has been set at all. */
  private async buildCoachBootstrap(ctx: AuthContext, user: UserSummaryDto): Promise<CoachBootstrapDto> {
    const coachProfile = await this.coachesRepository.findByUserId(ctx.userId);
    if (!coachProfile) {
      // Unreachable via a real COACH token — mirrors buildTrainerBootstrap's own defensive narrowing.
      throw new NotFoundException({ message: 'Coach profile not found', errorCode: 'NOT_FOUND' });
    }

    const slots = await this.availabilityRepository.findSlotsForCoach(coachProfile.id);

    return {
      role: 'COACH',
      user,
      coachProfile: {
        id: coachProfile.id,
        userId: coachProfile.userId,
        trainerId: coachProfile.trainerId,
        status: coachProfile.status,
        bio: coachProfile.bio,
        credentials: coachProfile.credentials,
        certifications: coachProfile.certifications,
        publicProfile: coachProfile.publicProfile,
      },
      employingTrainer: {
        id: coachProfile.trainer.id,
        businessName: coachProfile.trainer.businessName,
        logoUrl: coachProfile.trainer.logoUrl,
        primaryColorHex: coachProfile.trainer.primaryColorHex,
      },
      availabilitySet: slots.length > 0,
    };
  }

  /**
   * PLAYER_PARENT branch (api §5), both ADULT and CHILD `typ`. Delegates to
   * `PlayerProfileService.listProfiles`/`AssociationsService.listContextsForUser`
   * for the actual per-accountType scoping (arch §9.2) rather than
   * re-deriving it here — both already implement exactly the
   * self-plus-children / own-profile-only split this shape needs.
   */
  private async buildPlayerParentBootstrap(
    ctx: AuthContext,
    user: UserSummaryDto,
    trainerContextHeader?: string,
  ): Promise<PlayerParentBootstrapDto> {
    const [profiles, contextsResult] = await Promise.all([
      this.playerProfileService.listProfiles(ctx),
      this.associationsService.listContextsForUser(ctx),
    ]);
    const contexts = contextsResult.contexts;

    let activeContext: PlayerParentBootstrapDto['activeContext'] = null;
    if (trainerContextHeader) {
      const matched = contexts.find((entry) => entry.trainerId === trainerContextHeader);
      if (!matched) {
        throw new ForbiddenException({
          message: 'X-Trainer-Context does not match an active association for this caller',
          errorCode: 'TENANT_CONTEXT_INVALID',
        });
      }
      activeContext = matched;
    }

    if (ctx.accountType === 'CHILD') {
      const [ownProfile] = profiles;
      if (!ownProfile) {
        // Unreachable via a real CHILD token — every CHILD login is minted
        // for an existing PlayerProfile.childUserId (ShareLink redemption,
        // Phase 4). Narrows the type below.
        throw new NotFoundException({ message: 'Player profile not found', errorCode: 'NOT_FOUND' });
      }
      return {
        role: 'PLAYER_PARENT',
        accountType: 'CHILD',
        user,
        playerProfile: ownProfile,
        contexts,
        activeContext,
      };
    }

    // ADULT only — `VIEW_GUARDIAN_DATA` is CHILD-denied (capability.enum.ts), so this is never even queried for a CHILD caller.
    const pendingApprovalsCount = await this.childApprovalsRepository.countPendingForParent(ctx.userId);

    return {
      role: 'PLAYER_PARENT',
      accountType: 'ADULT',
      user,
      playerProfiles: profiles,
      contexts,
      activeContext,
      pendingApprovalsCount,
    };
  }

  /** Task 3.1 (api §3 "GET /users"). RBAC is a route-level @Roles(SUPER_ADMIN) concern (users.controller.ts), not this service's job. */
  async listUsers(query: ListUsersQueryDto): Promise<PaginatedResponseDto<UserDirectoryRowDto>> {
    const limit = query.limit ?? 50;
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;

    const rows = await this.usersRepository.findAllPaginated({
      limit,
      cursor,
      search: query.search,
      role: query.role,
      status: query.status,
    });

    const page = buildPaginatedResponse(rows, limit, (u) => ({ createdAt: u.createdAt.toISOString(), id: u.id }));

    return { ...page, items: page.items.map((u) => this.toDirectoryRow(u)) };
  }

  private toDirectoryRow(user: User): UserDirectoryRowDto {
    return plainToInstance(UserDirectoryRowDto, user, { excludeExtraneousValues: true });
  }

  /**
   * Task 3.2 (api §3 "GET /users/:id"). Uses `findByIdWithDeleted` so a
   * Super Admin can still look up a soft-deleted/GDPR-deleted row (arch
   * §11.1's "historical/admin reads opt in explicitly") — unlike `getMe`,
   * which deliberately can never see one.
   */
  async getUserById(id: string): Promise<UserDetailResponseDto> {
    const user = await this.usersRepository.findByIdWithDeleted(id);
    if (!user) {
      throw new NotFoundException({ message: 'User not found', errorCode: 'NOT_FOUND' });
    }

    return this.toDetailResponse(user);
  }

  /**
   * Task 3.3 (api §3 "PATCH /users/:id", FR-012). Superset of updateMe: no
   * CHILD-field restriction (this is an admin action, not a self-service
   * one) and additionally allows `email`. Deliberately never accepts
   * `role` — see UpdateUserDto's own comment.
   */
  async updateUser(id: string, dto: UpdateUserDto): Promise<UserDetailResponseDto> {
    const existing = await this.usersRepository.findById(id);
    if (!existing) {
      throw new NotFoundException({ message: 'User not found', errorCode: 'NOT_FOUND' });
    }

    let updated: User;
    try {
      updated = await this.usersRepository.update(id, {
        ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
        ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.photoUrl !== undefined ? { photoUrl: dto.photoUrl } : {}),
        ...(dto.notificationPrefs !== undefined ? { notificationPrefs: dto.notificationPrefs } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION) {
        throw new ConflictException({ message: 'Email already in use', errorCode: 'CONFLICT' });
      }
      throw error;
    }

    return this.toDetailResponse(updated);
  }

  /**
   * Shared by getUserById/updateUser (Tasks 3.2/3.3) and, from Task 3.5
   * onward, AccountLifecycleService's deactivate/reactivate/gdprDelete
   * response mapping — every admin-facing endpoint that returns a full
   * `UserDetailResponseDto` for an arbitrary user (not the caller's own
   * profile, which is toMeResponse's job).
   */
  async toDetailResponse(user: User): Promise<UserDetailResponseDto> {
    const isChild = await this.usersRepository.isChildLogin(user.id);
    return plainToInstance(
      UserDetailResponseDto,
      { ...user, accountType: isChild ? 'CHILD' : 'ADULT', emailVerified: user.emailVerifiedAt !== null },
      { excludeExtraneousValues: true },
    );
  }

  private async loadUserOrThrow(userId: string): Promise<User> {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new UnauthorizedException({ message: 'Account is inactive', errorCode: 'ACCOUNT_INACTIVE' });
    }
    return user;
  }

  private toMeResponse(user: User, accountType: 'ADULT' | 'CHILD'): MeResponseDto {
    return plainToInstance(
      MeResponseDto,
      {
        ...user,
        accountType,
        emailVerified: user.emailVerifiedAt !== null,
      },
      { excludeExtraneousValues: true },
    );
  }
}
