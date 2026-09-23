import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import type { PaginatedResponseDto } from '../../shared/http/pagination.dto';
import type { AuthContext } from '../../shared/security/auth-context.interface';
import { Capability } from '../../shared/security/capability.enum';
import { CurrentUser } from '../../shared/security/decorators/current-user.decorator';
import { RequiresCapability } from '../../shared/security/decorators/requires-capability.decorator';

import { AssociationsService } from './associations.service';
import { AddTrainerAssociationDto } from './dto/add-trainer-association.dto';
import { ContextListResponseDto } from './dto/context-list-response.dto';
import { ListRosterQueryDto } from './dto/list-roster-query.dto';
import { RosterRowDto } from './dto/roster-row.dto';

// Task 5.7, first endpoint — extended in Tasks 5.8-5.10 (api §4.3's
// `AssociationsController`, the second owning module mounted under
// `/player-profiles`/`/me`/`/trainers`, per architect-architecture.md §2's
// "one resource surface, two owning modules" split). Empty `@Controller()`
// prefix — same reason ShareLinksController/CoachesController use one,
// this class mixes `/me/contexts`, `/player-profiles/:id/trainers` and
// `/trainers/:id/players` paths.
@ApiTags('associations')
@ApiBearerAuth()
@Controller()
export class AssociationsController {
  constructor(private readonly associationsService: AssociationsService) {}

  // Task 5.7 (api §4.3 "GET /me/contexts", FR-034).
  @RequiresCapability(Capability.EDIT_OWN_PROFILE)
  @Get('me/contexts')
  @ApiOperation({ summary: 'List every active (playerProfile, trainer) context — populates the trainer-context switcher' })
  @ApiResponse({ status: 200, type: ContextListResponseDto })
  async listContexts(@CurrentUser() ctx: AuthContext): Promise<ContextListResponseDto> {
    return this.associationsService.listContextsForUser(ctx);
  }

  // Task 5.8 (api §4.3 "POST /player-profiles/:id/trainers", FR-032).
  // `@Res()` without `passthrough` — idempotent re-association returns
  // `200` with the existing row instead of the normal `201` (see
  // AssociationsService.AddTrainerAssociationResult's comment).
  @RequiresCapability(Capability.MANAGE_TRAINER_ASSOCIATIONS)
  @Post('player-profiles/:id/trainers')
  @ApiOperation({ summary: 'Add a trainer to a player profile, by ShareLink code or trainerId (oneOf)' })
  @ApiResponse({ status: 201, description: 'Newly created association' })
  @ApiResponse({ status: 200, description: 'Already associated — idempotent, existing row returned' })
  @ApiResponse({ status: 400, description: 'Neither or both of shareLinkCode/trainerId supplied' })
  @ApiResponse({ status: 403, description: 'Denied for typ: CHILD tokens', schema: { example: { errorCode: 'CHILD_CAPABILITY_DENIED' } } })
  @ApiResponse({ status: 404, description: 'Unknown code/trainer, or the player profile is not the caller\'s own' })
  async addTrainerAssociation(
    @CurrentUser() ctx: AuthContext,
    @Param('id') id: string,
    @Body() dto: AddTrainerAssociationDto,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.associationsService.addTrainerAssociation(ctx, id, dto);
    res.status(result.statusCode).json(result.body);
  }

  // Task 5.9 (api §4.3 "DELETE /player-profiles/:id/trainers/:trainerId",
  // FR-032). Soft-delete-with-cascade, unconditional (no server-side
  // confirmation step).
  @RequiresCapability(Capability.MANAGE_TRAINER_ASSOCIATIONS)
  @Delete('player-profiles/:id/trainers/:trainerId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a trainer association (soft — status becomes INACTIVE)' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 403, description: 'Denied for typ: CHILD tokens', schema: { example: { errorCode: 'CHILD_CAPABILITY_DENIED' } } })
  @ApiResponse({ status: 404 })
  async removeTrainerAssociation(
    @CurrentUser() ctx: AuthContext,
    @Param('id') id: string,
    @Param('trainerId') trainerId: string,
  ): Promise<void> {
    await this.associationsService.removeTrainerAssociation(ctx, id, trainerId);
  }

  // Task 5.10 (api §4.3 "GET /trainers/:id/players", FR-070 gap-fill §8.8).
  // Own tenant for TRAINER, any for SUPER_ADMIN.
  @RequiresCapability(Capability.VIEW_PLAYER_AVAILABILITY)
  @Get('trainers/:id/players')
  @ApiOperation({ summary: "A trainer's minimal player roster with availability summary — not full CRM" })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'Cross-tenant (never 403, arch §8 Layer 3)' })
  async listRosterForTrainer(
    @CurrentUser() ctx: AuthContext,
    @Param('id') id: string,
    @Query() query: ListRosterQueryDto,
  ): Promise<PaginatedResponseDto<RosterRowDto>> {
    return this.associationsService.listRosterForTrainer(ctx, id, query);
  }
}
