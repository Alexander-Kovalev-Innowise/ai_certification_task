import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { User } from '@prisma/client';
import { plainToInstance } from 'class-transformer';

import { buildPaginatedResponse, decodeCursor, type PaginatedResponseDto } from '../../shared/http/pagination.dto';
import type { AuthContext } from '../../shared/security/auth-context.interface';

import type { ListUsersQueryDto } from './dto/list-users-query.dto';
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
  constructor(private readonly usersRepository: UsersRepository) {}

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
