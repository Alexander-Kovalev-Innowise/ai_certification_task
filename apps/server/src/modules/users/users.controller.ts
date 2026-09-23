import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import type { PaginatedResponseDto } from '../../shared/http/pagination.dto';
import type { AuthContext } from '../../shared/security/auth-context.interface';
import { Capability } from '../../shared/security/capability.enum';
import { CurrentUser } from '../../shared/security/decorators/current-user.decorator';
import { RequiresCapability } from '../../shared/security/decorators/requires-capability.decorator';
import { Roles } from '../../shared/security/decorators/roles.decorator';

import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { MeResponseDto } from './dto/me-response.dto';
import { UpdateMeDto } from './dto/update-me.dto';
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
  constructor(private readonly usersService: UsersService) {}

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
}
