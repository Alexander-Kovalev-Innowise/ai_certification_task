import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import type { AuthContext } from '../../shared/security/auth-context.interface';
import { Capability } from '../../shared/security/capability.enum';
import { CurrentUser } from '../../shared/security/decorators/current-user.decorator';
import { RequiresCapability } from '../../shared/security/decorators/requires-capability.decorator';

import { CreateChildProfileDto } from './dto/create-child-profile.dto';
import { PlayerProfileResponseDto } from './dto/player-profile-response.dto';
import { PlayerProfileService } from './player-profile.service';

// Task 5.1, extended in Tasks 5.2-5.5 (api §4.3). No `@Roles()` on any
// endpoint in this controller — ownership (adult owner / the child
// themself / SUPER_ADMIN) is a row-data check the service layer makes, not
// something a role list can express (arch §7.1: "ownership checks... are
// not guards — they live in the service layer").
@ApiTags('player-profiles')
@ApiBearerAuth()
@Controller('player-profiles')
export class PlayerProfilesController {
  constructor(private readonly playerProfileService: PlayerProfileService) {}

  // Task 5.1 (api §4.3 "POST /player-profiles", FR-030/FR-031).
  // `@RequiresCapability(MANAGE_CHILD_PROFILES)` -> CHILD tokens get
  // `403 CHILD_CAPABILITY_DENIED` automatically (deny-list). `@Res()`
  // without `passthrough` — the FR-030 non-blocking-duplicate branch
  // returns `200` instead of the normal `201`, which a passthrough return
  // value can't express (see PlayerProfileService.CreateChildProfileResult's
  // comment).
  @RequiresCapability(Capability.MANAGE_CHILD_PROFILES)
  @Post()
  @ApiOperation({ summary: 'Create a child player profile (self profiles are provisioned at registration, never here)' })
  @ApiResponse({ status: 201, type: PlayerProfileResponseDto })
  @ApiResponse({ status: 200, description: 'Non-blocking FR-030 duplicate name/age warning', type: PlayerProfileResponseDto })
  @ApiResponse({ status: 400, description: 'Age outside 1-18' })
  @ApiResponse({ status: 403, description: 'Denied for typ: CHILD tokens', schema: { example: { errorCode: 'CHILD_CAPABILITY_DENIED' } } })
  async createChildProfile(
    @CurrentUser() ctx: AuthContext,
    @Body() dto: CreateChildProfileDto,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.playerProfileService.createChildProfile(ctx, dto);
    res.status(result.statusCode).json(result.body);
  }

  // Task 5.2 (api §4.3 "GET /player-profiles", FR-032). Not a cross-trainer
  // content view (FR-022 doesn't apply) — account-management metadata only.
  @RequiresCapability(Capability.EDIT_OWN_PROFILE)
  @Get()
  @ApiOperation({ summary: "List the caller's own family (self + children), or just the child's own profile for a CHILD token" })
  @ApiResponse({ status: 200, type: [PlayerProfileResponseDto] })
  async listProfiles(@CurrentUser() ctx: AuthContext): Promise<PlayerProfileResponseDto[]> {
    return this.playerProfileService.listProfiles(ctx);
  }
}
