import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import type { AuthContext } from '../../shared/security/auth-context.interface';
import { Capability } from '../../shared/security/capability.enum';
import { CurrentUser } from '../../shared/security/decorators/current-user.decorator';
import { RequiresCapability } from '../../shared/security/decorators/requires-capability.decorator';

import { MeResponseDto } from './dto/me-response.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UsersService } from './users.service';

// Task 2.22, first endpoints — the universal self-profile surface (any
// authenticated role, ownership-checked implicitly since it always acts on
// the caller's own id, arch §7.1). GET/POST/PATCH /users (Super Admin's
// global directory) are Phase 3 territory, not built here.
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
}
