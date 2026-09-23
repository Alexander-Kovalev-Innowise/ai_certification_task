import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
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
  async inviteCoach(
    @CurrentUser() ctx: AuthContext,
    @Body() dto: InviteCoachDto,
  ): Promise<InviteCoachResponseDto> {
    return this.coachService.inviteCoach(ctx, dto);
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
}
