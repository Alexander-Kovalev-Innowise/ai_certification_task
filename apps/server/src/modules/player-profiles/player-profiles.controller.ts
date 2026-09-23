import { Body, Controller, Get, Param, Patch, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import type { AuthContext } from '../../shared/security/auth-context.interface';
import { Capability } from '../../shared/security/capability.enum';
import { CurrentUser } from '../../shared/security/decorators/current-user.decorator';
import { RequiresCapability } from '../../shared/security/decorators/requires-capability.decorator';

import { CreateChildProfileDto } from './dto/create-child-profile.dto';
import { PlayerProfileResponseDto } from './dto/player-profile-response.dto';
import { UpdatePlayerProfileDto } from './dto/update-player-profile.dto';
import { PlayerProfileService } from './player-profile.service';
import type { TrainerRowForProfile } from './player-profiles.repository';

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

  // Task 5.3 (api §4.3 "GET /player-profiles/:id"). Ownership-checked in
  // the service; cross-ownership is 404, never 403.
  @RequiresCapability(Capability.EDIT_OWN_PROFILE)
  @Get(':id')
  @ApiOperation({ summary: 'Read one player profile (adult owner, the child themself, or SUPER_ADMIN)' })
  @ApiResponse({ status: 200, type: PlayerProfileResponseDto })
  @ApiResponse({ status: 404, description: 'Cross-ownership read (never 403)' })
  async getProfileById(@CurrentUser() ctx: AuthContext, @Param('id') id: string): Promise<PlayerProfileResponseDto> {
    return this.playerProfileService.getProfileById(ctx, id);
  }

  // Task 5.4 (api §4.3 "PATCH /player-profiles/:id"). Same ownership gate
  // as GET /player-profiles/:id, plus the CHILD_FIELD_NOT_EDITABLE
  // restriction on `allowChildTokenSpendWithoutApproval` (service layer).
  @RequiresCapability(Capability.EDIT_OWN_PROFILE)
  @Patch(':id')
  @ApiOperation({ summary: 'Update basic player-profile fields' })
  @ApiResponse({ status: 200, type: PlayerProfileResponseDto })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 403, description: 'CHILD_FIELD_NOT_EDITABLE (allowChildTokenSpendWithoutApproval)', schema: { example: { errorCode: 'CHILD_FIELD_NOT_EDITABLE' } } })
  @ApiResponse({ status: 404 })
  async updateProfile(
    @CurrentUser() ctx: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdatePlayerProfileDto,
  ): Promise<PlayerProfileResponseDto> {
    return this.playerProfileService.updateProfile(ctx, id, dto);
  }

  // Task 5.5 (api §4.3 "GET /player-profiles/:id/trainers", FR-032).
  @RequiresCapability(Capability.EDIT_OWN_PROFILE)
  @Get(':id/trainers')
  @ApiOperation({ summary: "A child's per-trainer connection list, with dates" })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async listTrainersForProfile(@CurrentUser() ctx: AuthContext, @Param('id') id: string): Promise<TrainerRowForProfile[]> {
    return this.playerProfileService.listTrainersForProfile(ctx, id);
  }
}
