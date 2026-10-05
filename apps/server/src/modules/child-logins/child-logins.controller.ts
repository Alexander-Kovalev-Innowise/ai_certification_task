import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import type { AuthContext } from '../../shared/security/auth-context.interface';
import { Capability } from '../../shared/security/capability.enum';
import { CurrentUser } from '../../shared/security/decorators/current-user.decorator';
import { RequiresCapability } from '../../shared/security/decorators/requires-capability.decorator';

import { ChildLoginsService } from './child-logins.service';
import { ChildLoginResponseDto } from './dto/child-login-response.dto';
import { CreateChildLoginDto } from './dto/create-child-login.dto';
import { ResetChildLoginPasswordDto } from './dto/reset-child-login-password.dto';

// Mounted under `/player-profiles/:id/child-login` — the same resource
// surface PlayerProfilesController owns, split into its own module only to
// avoid a UsersModule <-> PlayerProfilesModule import cycle (this needs
// AccountProvisioningService + PasswordService).
@ApiTags('child-logins')
@ApiBearerAuth()
@Controller('player-profiles/:id/child-login')
export class ChildLoginsController {
  constructor(private readonly childLoginsService: ChildLoginsService) {}

  @RequiresCapability(Capability.MANAGE_CHILD_PROFILES)
  @Post()
  @ApiOperation({ summary: "Create the child's own login (typ: CHILD account) for a child profile" })
  @ApiResponse({ status: 201, type: ChildLoginResponseDto })
  @ApiResponse({ status: 403, description: 'Denied for typ: CHILD tokens', schema: { example: { errorCode: 'CHILD_CAPABILITY_DENIED' } } })
  @ApiResponse({ status: 404, description: "Unknown profile, or not the caller's" })
  @ApiResponse({ status: 409, description: 'Child already has a login, or email already in use' })
  async createChildLogin(
    @CurrentUser() ctx: AuthContext,
    @Param('id') id: string,
    @Body() dto: CreateChildLoginDto,
  ): Promise<ChildLoginResponseDto> {
    return this.childLoginsService.createChildLogin(ctx, id, dto);
  }

  @RequiresCapability(Capability.MANAGE_CHILD_PROFILES)
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Guardian resets the child's login password (revokes the child's sessions)" })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async resetPassword(
    @CurrentUser() ctx: AuthContext,
    @Param('id') id: string,
    @Body() dto: ResetChildLoginPasswordDto,
  ): Promise<{ message: string }> {
    return this.childLoginsService.resetChildLoginPassword(ctx, id, dto.password);
  }
}
