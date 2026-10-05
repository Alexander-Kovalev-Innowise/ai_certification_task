import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import type { PaginatedResponseDto } from '../../shared/http/pagination.dto';
import type { AuthContext } from '../../shared/security/auth-context.interface';
import { Capability } from '../../shared/security/capability.enum';
import { CurrentUser } from '../../shared/security/decorators/current-user.decorator';
import { RequiresCapability } from '../../shared/security/decorators/requires-capability.decorator';
import { Roles } from '../../shared/security/decorators/roles.decorator';

import { CoachService } from './coach.service';
import { CoachRosterRowDto } from './dto/coach-roster-row.dto';
import { InviteCoachDto, InviteCoachResponseDto } from './dto/invite-coach.dto';
import { ListCoachesQueryDto } from './dto/list-coaches-query.dto';
import { CoachProfileResponseDto, UpdateCoachDto } from './dto/update-coach.dto';

// Task 4.11, first endpoint — extended in Task 4.12 (GET /trainers/:id/coaches)
// and Task 4.13 (PATCH /coaches/:id). Empty `@Controller()` prefix (matching
// ShareLinksController's own pattern) because this resource surface mixes
// `/coaches/...` and `/trainers/:id/coaches` paths under one module (api §4.2).
@ApiTags('coaches')
@ApiBearerAuth()
@Controller()
export class CoachesController {
  constructor(private readonly coachService: CoachService) {}

  // Task 4.11 (api §4.2 "POST /coaches/invite", FR-060). Trainer only, own tenant.
  @Roles(Role.TRAINER)
  @RequiresCapability(Capability.INVITE_COACH)
  @Post('coaches/invite')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Invite a coach by email — generates a COACH_UNIQUE ShareLink and emails it' })
  @ApiResponse({ status: 201, type: InviteCoachResponseDto })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 409, description: 'Email already belongs to an ACTIVE coach (COACH_ALREADY_ASSIGNED / COACH_ALREADY_ON_ROSTER)' })
  async inviteCoach(
    @CurrentUser() ctx: AuthContext,
    @Body() dto: InviteCoachDto,
  ): Promise<InviteCoachResponseDto> {
    return this.coachService.inviteCoach(ctx, dto);
  }

  // US-01.08 resend. Revokes the old link, issues a fresh 7-day one — never a duplicate roster row.
  @Roles(Role.TRAINER)
  @RequiresCapability(Capability.INVITE_COACH)
  @Post('coaches/invites/:id/resend')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Resend a coach invite — revokes the old link and issues a new 7-day link' })
  @ApiResponse({ status: 201, type: InviteCoachResponseDto })
  @ApiResponse({ status: 404, description: 'Not found or not this trainer invite' })
  @ApiResponse({ status: 409, description: 'Already accepted / coach already assigned' })
  async resendInvite(@CurrentUser() ctx: AuthContext, @Param('id') id: string): Promise<InviteCoachResponseDto> {
    return this.coachService.resendInvite(ctx, id);
  }

  // Epic §3 "Manage own organization users": remove a coach from the trainer's org (soft, INACTIVE).
  @Roles(Role.TRAINER)
  @RequiresCapability(Capability.INVITE_COACH)
  @Delete('coaches/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Remove a coach from the trainer's organisation (soft — status becomes INACTIVE)" })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, description: 'Unknown id or another tenant coach (never 403)' })
  async removeCoach(@CurrentUser() ctx: AuthContext, @Param('id') id: string): Promise<void> {
    await this.coachService.removeCoach(ctx, id);
  }

  // Task 4.12 (api §4.2 "GET /trainers/:id/coaches", FR-060). Own tenant for
  // TRAINER, any for SUPER_ADMIN — same ownership pattern as
  // TrainersController.getTrainer / ShareLinksController.listShareLinks.
  @Roles(Role.TRAINER, Role.SUPER_ADMIN)
  @RequiresCapability(Capability.VIEW_OWN_COACH_ROSTER)
  @Get('trainers/:id/coaches')
  @ApiOperation({ summary: "List a trainer's coach roster (accepted, pending and expired invites)" })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'Cross-tenant (never 403, arch §8 Layer 3)' })
  async listCoaches(
    @CurrentUser() ctx: AuthContext,
    @Param('id') id: string,
    @Query() query: ListCoachesQueryDto,
  ): Promise<PaginatedResponseDto<CoachRosterRowDto>> {
    return this.coachService.listCoaches(ctx, id, query);
  }

  // Task 4.13 (api §4.2 "PATCH /coaches/:id", dual-actor field restriction).
  // Owning TRAINER may send `status` only; the COACH themself may send
  // `bio`/`credentials`/`certifications`/`publicProfile` only — enforced in
  // CoachService.updateCoach (`403 FIELD_NOT_ALLOWED_FOR_ROLE`), not here.
  @Roles(Role.TRAINER, Role.COACH)
  @RequiresCapability(Capability.MANAGE_COACH_PROFILE)
  @Patch('coaches/:id')
  @ApiOperation({ summary: 'Update a coach profile — dual actor: TRAINER sets status, COACH sets their own bio/credentials/certifications/publicProfile' })
  @ApiResponse({ status: 200, type: CoachProfileResponseDto })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 403, description: 'Field not allowed for this role', schema: { example: { errorCode: 'FIELD_NOT_ALLOWED_FOR_ROLE' } } })
  @ApiResponse({ status: 404 })
  async updateCoach(
    @CurrentUser() ctx: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateCoachDto,
  ): Promise<CoachProfileResponseDto> {
    return this.coachService.updateCoach(ctx, id, dto);
  }
}
