import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import type { AuthContext } from '../../shared/security/auth-context.interface';
import { Capability } from '../../shared/security/capability.enum';
import { CurrentUser } from '../../shared/security/decorators/current-user.decorator';
import { RequiresCapability } from '../../shared/security/decorators/requires-capability.decorator';

import { AvailabilityService } from './availability.service';
import { AvailabilityGridResponseDto, SetAvailabilityDto } from './dto/availability-grid.dto';

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
