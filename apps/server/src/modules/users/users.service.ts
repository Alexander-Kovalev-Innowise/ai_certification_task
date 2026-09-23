import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { User } from '@prisma/client';
import { plainToInstance } from 'class-transformer';

import { buildPaginatedResponse, decodeCursor, type PaginatedResponseDto } from '../../shared/http/pagination.dto';
import type { AuthContext } from '../../shared/security/auth-context.interface';

import type { ListUsersQueryDto } from './dto/list-users-query.dto';
import { MeResponseDto } from './dto/me-response.dto';
import type { UpdateMeDto } from './dto/update-me.dto';
import { UserDirectoryRowDto } from './dto/user-directory-row.dto';
import { UsersRepository } from './users.repository';

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
