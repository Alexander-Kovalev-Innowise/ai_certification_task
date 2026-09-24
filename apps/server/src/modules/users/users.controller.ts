import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiExtraModels, ApiHeader, ApiOperation, ApiResponse, ApiTags, getSchemaPath } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import type { PaginatedResponseDto } from '../../shared/http/pagination.dto';
import type { AuthContext } from '../../shared/security/auth-context.interface';
import { Capability } from '../../shared/security/capability.enum';
import { CurrentUser } from '../../shared/security/decorators/current-user.decorator';
import { RequiresCapability } from '../../shared/security/decorators/requires-capability.decorator';
import { Roles } from '../../shared/security/decorators/roles.decorator';

import { AccountLifecycleService } from './account-lifecycle.service';
import { GdprDeleteUserDto } from './dto/gdpr-delete-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import {
  CoachBootstrapDto,
  type MeBootstrapResponseDto,
  PlayerParentBootstrapDto,
  SuperAdminBootstrapDto,
  TrainerBootstrapDto,
} from './dto/me-bootstrap-response.dto';
import { MeResponseDto } from './dto/me-response.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserDetailResponseDto } from './dto/user-detail-response.dto';
import { UserDirectoryRowDto } from './dto/user-directory-row.dto';
import { UsersService } from './users.service';

// Task 2.22, first endpoints — the universal self-profile surface (any
// authenticated role, ownership-checked implicitly since it always acts on
// the caller's own id, arch §7.1). Task 3.1 onward adds the Super-Admin
// global directory + lifecycle surface (GET/PATCH /users, deactivate/
// reactivate/GDPR-delete).
@ApiTags('users')
@ApiBearerAuth()
@Controller()
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly accountLifecycleService: AccountLifecycleService,
  ) {}

  @RequiresCapability(Capability.EDIT_OWN_PROFILE)
  @Get('me')
  @ApiOperation({ summary: 'Get the current caller’s own profile' })
  @ApiResponse({ status: 200, type: MeResponseDto })
  async getMe(@CurrentUser() ctx: AuthContext): Promise<MeResponseDto> {
    return this.usersService.getMe(ctx);
  }

  @RequiresCapability(Capability.EDIT_OWN_PROFILE)
  @Patch('me')
  @ApiOperation({ summary: 'Update the current caller’s own profile' })
  @ApiResponse({ status: 200, type: MeResponseDto })
  @ApiResponse({ status: 403, description: 'typ: CHILD attempted to edit a guardian-owned field', schema: { example: { errorCode: 'CHILD_FIELD_NOT_EDITABLE' } } })
  async updateMe(@CurrentUser() ctx: AuthContext, @Body() dto: UpdateMeDto): Promise<MeResponseDto> {
    return this.usersService.updateMe(ctx, dto);
  }

  // Gap-fill: api §5 "GET /me/bootstrap" (OQ-4, approved as a first-class
  // aggregate endpoint; arch §14/NFR-001 — one round trip, not an N+1
  // waterfall). Phase 9's DoD sweep found this endpoint had been referenced
  // as existing infrastructure by every prior phase without any phase ever
  // implementing it; this route is that gap closed. Sibling route on this
  // same controller (not a new module) — same `EDIT_OWN_PROFILE` capability
  // as `GET /me` above, since it anchors on the same "own identity" concern.
  @RequiresCapability(Capability.EDIT_OWN_PROFILE)
  @Get('me/bootstrap')
  @ApiExtraModels(SuperAdminBootstrapDto, TrainerBootstrapDto, CoachBootstrapDto, PlayerParentBootstrapDto)
  @ApiOperation({ summary: 'Aggregate, per-role dashboard bootstrap payload — one round trip (arch §14, NFR-001)' })
  @ApiHeader({
    name: 'X-Trainer-Context',
    required: false,
    description:
      'Optional here (unlike most player-facing routes): absent, `activeContext` is null and the client picks one from `contexts`; if supplied, it is validated against the caller\'s active associations and echoed back as `activeContext`.',
  })
  @ApiResponse({
    status: 200,
    schema: {
      oneOf: [
        { $ref: getSchemaPath(SuperAdminBootstrapDto) },
        { $ref: getSchemaPath(TrainerBootstrapDto) },
        { $ref: getSchemaPath(CoachBootstrapDto) },
        { $ref: getSchemaPath(PlayerParentBootstrapDto) },
      ],
      discriminator: { propertyName: 'role' },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'X-Trainer-Context supplied but does not match an active association',
    schema: { example: { errorCode: 'TENANT_CONTEXT_INVALID' } },
  })
  async getMeBootstrap(
    @CurrentUser() ctx: AuthContext,
    @Headers('x-trainer-context') trainerContext?: string,
  ): Promise<MeBootstrapResponseDto> {
    return this.usersService.getMeBootstrap(ctx, trainerContext);
  }

  // Task 3.1 (api §3 "GET /users", FR-011). Super Admin's global directory.
  @Roles(Role.SUPER_ADMIN)
  @RequiresCapability(Capability.MANAGE_ANY_USER)
  @Get('users')
  @ApiOperation({ summary: "Super Admin's global user directory (keyset pagination, trigram search)" })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403 })
  async listUsers(@Query() query: ListUsersQueryDto): Promise<PaginatedResponseDto<UserDirectoryRowDto>> {
    return this.usersService.listUsers(query);
  }

  // Task 3.2 (api §3 "GET /users/:id"). withDeleted: true opt-in (arch §11.1).
  @Roles(Role.SUPER_ADMIN)
  @RequiresCapability(Capability.MANAGE_ANY_USER)
  @Get('users/:id')
  @ApiOperation({ summary: 'Look up any user by id, including soft-deleted rows' })
  @ApiResponse({ status: 200, type: UserDetailResponseDto })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 404 })
  async getUserById(@Param('id') id: string): Promise<UserDetailResponseDto> {
    return this.usersService.getUserById(id);
  }

  // Task 3.3 (api §3 "PATCH /users/:id", FR-012).
  @Roles(Role.SUPER_ADMIN)
  @RequiresCapability(Capability.MANAGE_ANY_USER)
  @Patch('users/:id')
  @ApiOperation({ summary: "Super Admin edits any user's account/profile fields" })
  @ApiResponse({ status: 200, type: UserDetailResponseDto })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 409, description: 'Duplicate email', schema: { example: { errorCode: 'CONFLICT' } } })
  async updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto): Promise<UserDetailResponseDto> {
    return this.usersService.updateUser(id, dto);
  }

  // Task 3.5 (api §3 "POST /users/:id/deactivate", FR-013/BR-011).
  @Roles(Role.SUPER_ADMIN)
  @RequiresCapability(Capability.DEACTIVATE_REACTIVATE_USER)
  @Post('users/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a user — immediately rejects their next request' })
  @ApiResponse({ status: 200, type: UserDetailResponseDto })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 409, description: 'Already inactive/deleted', schema: { example: { errorCode: 'CONFLICT' } } })
  async deactivateUser(@Param('id') id: string): Promise<UserDetailResponseDto> {
    const user = await this.accountLifecycleService.deactivate(id);
    return this.usersService.toDetailResponse(user);
  }

  // Task 3.6 (api §3 "POST /users/:id/reactivate").
  @Roles(Role.SUPER_ADMIN)
  @RequiresCapability(Capability.DEACTIVATE_REACTIVATE_USER)
  @Post('users/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivate a deactivated user (hard-rejects a GDPR-deleted target)' })
  @ApiResponse({ status: 200, type: UserDetailResponseDto })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 409, description: 'Target is DELETED', schema: { example: { errorCode: 'CANNOT_REACTIVATE_DELETED_USER' } } })
  async reactivateUser(@Param('id') id: string): Promise<UserDetailResponseDto> {
    const user = await this.accountLifecycleService.reactivate(id);
    return this.usersService.toDetailResponse(user);
  }

  // Task 3.7 (api §3 "DELETE /users/:id", FR-014/SEC-005). GDPR anonymization.
  @Roles(Role.SUPER_ADMIN)
  @RequiresCapability(Capability.GDPR_DELETE_USER)
  @Delete('users/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Irreversibly anonymize a user (GDPR erasure)' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 400, description: 'Missing reason' })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 409, description: 'Already DELETED', schema: { example: { errorCode: 'CONFLICT' } } })
  async gdprDeleteUser(
    @Param('id') id: string,
    @Body() dto: GdprDeleteUserDto,
    @CurrentUser() ctx: AuthContext,
  ): Promise<void> {
    await this.accountLifecycleService.gdprDelete(id, dto.reason, ctx.userId);
  }
}
