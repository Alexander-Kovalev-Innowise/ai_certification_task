import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import type { AuthContext } from '../../shared/security/auth-context.interface';
import { Capability } from '../../shared/security/capability.enum';
import { CurrentUser } from '../../shared/security/decorators/current-user.decorator';
import { RequiresCapability } from '../../shared/security/decorators/requires-capability.decorator';
import { Roles } from '../../shared/security/decorators/roles.decorator';

import { AvailabilityService } from './availability.service';
import { ConflictCheckService } from './conflict-check.service';
import {
  AvailabilityGridResponseDto,
  CoachAvailabilityGridResponseDto,
  ConflictCheckQueryDto,
  ConflictCheckResponseDto,
  SetAvailabilityDto,
} from './dto/availability-grid.dto';
import { CoachOverrideResponseDto, CreateOverrideDto } from './dto/create-override.dto';

// Task 5.11 (api §4.5 "Player availability", the player-profile half of
// `AvailabilityController` — the coach "My Times" pair is Phase 6). No
// `@Roles()` — ownership/association is a row-data check the service makes
// (arch §7.1). Neither endpoint declares `@ApiHeader('X-Trainer-Context')`:
// api §4.5's own design note says the header is not required here
// (`Availability` has no `trainerId` column — the grid is visible to every
// associated trainer, not per-trainer copies).
@ApiTags('availability')
@ApiBearerAuth()
@Controller('player-profiles/:id/availability')
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  // Task 5.11 (api §4.5 "GET /player-profiles/:id/availability").
  @RequiresCapability(Capability.VIEW_PLAYER_AVAILABILITY)
  @Get()
  @ApiOperation({ summary: "A player's weekly availability grid ('Best Times')" })
  @ApiResponse({ status: 200, type: AvailabilityGridResponseDto })
  @ApiResponse({ status: 404 })
  async getAvailability(@CurrentUser() ctx: AuthContext, @Param('id') id: string): Promise<AvailabilityGridResponseDto> {
    return this.availabilityService.getSummaryForPlayer(ctx, id);
  }

  // Task 5.11 (api §4.5 "PUT /player-profiles/:id/availability", FR-090).
  @RequiresCapability(Capability.SET_OWN_AVAILABILITY)
  @Put()
  @ApiOperation({ summary: "Full replace of a player's weekly availability grid" })
  @ApiResponse({ status: 200, type: AvailabilityGridResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid range (startTime >= endTime, or out of 0-1440)' })
  @ApiResponse({ status: 404 })
  async setAvailability(
    @CurrentUser() ctx: AuthContext,
    @Param('id') id: string,
    @Body() dto: SetAvailabilityDto,
  ): Promise<AvailabilityGridResponseDto> {
    return this.availabilityService.setPlayerAvailability(ctx, id, dto.slots);
  }
}

// Task 6.1 (api §4.5 "GET/PUT /coaches/:id/availability", FR-062 "My
// Times"), extended in Task 6.2 (`GET .../check`) and Task 6.3
// (`POST .../override`). A separate controller class/prefix from
// `AvailabilityController` above — `:id` means something different on each
// (`PlayerProfile.id` vs `CoachProfile.id`), and the two resources' access
// rules don't overlap enough to share one class. No `@Roles()` on the
// GET/PUT pair (ownership is a row-data check in AvailabilityService, same
// convention as the player pair); `check`/`override` DO carry `@Roles()`
// since api §4.5 restricts both to "the employing trainer" (TRAINER) plus
// SUPER_ADMIN, never COACH.
@ApiTags('availability')
@ApiBearerAuth()
@Controller('coaches/:id/availability')
export class CoachAvailabilityController {
  constructor(
    private readonly availabilityService: AvailabilityService,
    private readonly conflictCheckService: ConflictCheckService,
  ) {}

  // Task 6.1 (api §4.5 "GET /coaches/:id/availability"). Reuses
  // `VIEW_PLAYER_AVAILABILITY` rather than a dedicated capability — api
  // §4.5 footnote flags this as accepted naming looseness.
  @RequiresCapability(Capability.VIEW_PLAYER_AVAILABILITY)
  @Get()
  @ApiOperation({ summary: "A coach's weekly availability grid ('My Times')" })
  @ApiResponse({ status: 200, type: CoachAvailabilityGridResponseDto })
  @ApiResponse({ status: 404 })
  async getCoachAvailability(@CurrentUser() ctx: AuthContext, @Param('id') id: string): Promise<CoachAvailabilityGridResponseDto> {
    return this.availabilityService.getSummaryForCoach(ctx, id);
  }

  // Task 6.1 (api §4.5 "PUT /coaches/:id/availability", FR-062). Restricted
  // to the coach themself — AvailabilityService.setCoachAvailability.
  @RequiresCapability(Capability.SET_OWN_AVAILABILITY)
  @Put()
  @ApiOperation({ summary: "Full replace of a coach's weekly availability grid" })
  @ApiResponse({ status: 200, type: CoachAvailabilityGridResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid range (startTime >= endTime, or out of 0-1440)' })
  @ApiResponse({ status: 403, description: 'Non-owner (coach profile exists, caller is not the coach)' })
  @ApiResponse({ status: 404 })
  async setCoachAvailability(
    @CurrentUser() ctx: AuthContext,
    @Param('id') id: string,
    @Body() dto: SetAvailabilityDto,
  ): Promise<CoachAvailabilityGridResponseDto> {
    return this.availabilityService.setCoachAvailability(ctx, id, dto.slots);
  }

  // Task 6.2 (api §4.5 "GET /coaches/:id/availability/check", *added*).
  // Own tenant only — "Only the employing trainer" per api §4.5.
  @Roles(Role.TRAINER, Role.SUPER_ADMIN)
  @RequiresCapability(Capability.OVERRIDE_COACH_CONFLICT)
  @Get('check')
  @ApiOperation({ summary: "Gap-fill check: does this window conflict with the coach's saved availability?" })
  @ApiResponse({ status: 200, type: ConflictCheckResponseDto })
  @ApiResponse({ status: 403, description: 'Non-owning trainer' })
  async checkConflict(
    @CurrentUser() ctx: AuthContext,
    @Param('id') id: string,
    @Query() query: ConflictCheckQueryDto,
  ): Promise<ConflictCheckResponseDto> {
    return this.conflictCheckService.checkConflict(ctx, id, query);
  }

  // Task 6.3 (api §4.5 "POST /coaches/:id/availability/override", FR-063/
  // BR-012). Never blocks (BR-012) — logs a decision already made.
  @Roles(Role.TRAINER, Role.SUPER_ADMIN)
  @RequiresCapability(Capability.OVERRIDE_COACH_CONFLICT)
  @Post('override')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Log a trainer override of a coach availability conflict (never blocks)' })
  @ApiResponse({ status: 201, type: CoachOverrideResponseDto })
  @ApiResponse({ status: 400, description: 'Missing/invalid reason' })
  @ApiResponse({ status: 403, description: 'Non-owning trainer' })
  async createOverride(
    @CurrentUser() ctx: AuthContext,
    @Param('id') id: string,
    @Body() dto: CreateOverrideDto,
  ): Promise<CoachOverrideResponseDto> {
    return this.availabilityService.createOverride(ctx, id, dto);
  }
}
