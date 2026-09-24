import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import type { AuthContext } from '../../shared/security/auth-context.interface';
import { Capability } from '../../shared/security/capability.enum';
import { CurrentUser } from '../../shared/security/decorators/current-user.decorator';
import { RequiresCapability } from '../../shared/security/decorators/requires-capability.decorator';
import { Roles } from '../../shared/security/decorators/roles.decorator';

import { BrandingResponseDto } from './dto/branding-response.dto';
import { CreateTrainerDto } from './dto/create-trainer.dto';
import { TrainerCreatedResponseDto, TrainerResponseDto } from './dto/trainer-response.dto';
import { UpdateBrandingDto } from './dto/update-branding.dto';
import { UpdateTrainerDto } from './dto/update-trainer.dto';
import { PortalBrandingService } from './portal-branding.service';
import { TrainerService } from './trainer.service';

// Task 3.8, first endpoint — extended in Task 3.9 (GET/PATCH /trainers/:id).
@ApiTags('trainers')
@ApiBearerAuth()
@Controller('trainers')
export class TrainersController {
  constructor(
    private readonly trainerService: TrainerService,
    private readonly portalBrandingService: PortalBrandingService,
  ) {}

  // Task 3.8 (api §4.1 "POST /trainers", FR-010/BR-005). Only Super Admin.
  @Roles(Role.SUPER_ADMIN)
  @RequiresCapability(Capability.CREATE_TRAINER_ACCOUNT)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Super Admin creates a trainer account (setup-link only, no password)' })
  @ApiResponse({ status: 201, type: TrainerCreatedResponseDto })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 409, description: 'Duplicate email', schema: { example: { errorCode: 'CONFLICT' } } })
  async createTrainer(@Body() dto: CreateTrainerDto): Promise<TrainerCreatedResponseDto> {
    return this.trainerService.createTrainer(dto);
  }

  // Task 3.9 (api §4.1 "GET /trainers/:id"). Coarse @Roles gate + the
  // service-layer ownership check (EDIT_OWN_PROFILE is not a dedicated
  // capability here, api §4.1 footnote).
  @Roles(Role.TRAINER, Role.SUPER_ADMIN)
  @RequiresCapability(Capability.EDIT_OWN_PROFILE)
  @Get(':id')
  @ApiOperation({ summary: "Read a trainer's profile (own profile for TRAINER, any for SUPER_ADMIN)" })
  @ApiResponse({ status: 200, type: TrainerResponseDto })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 404, description: 'Non-owning trainer or unknown id (never 403, arch §8 Layer 3)' })
  async getTrainer(@CurrentUser() ctx: AuthContext, @Param('id') id: string): Promise<TrainerResponseDto> {
    return this.trainerService.getTrainer(ctx, id);
  }

  // Task 3.9 (api §4.1 "PATCH /trainers/:id"). Business details only.
  @Roles(Role.TRAINER, Role.SUPER_ADMIN)
  @RequiresCapability(Capability.EDIT_OWN_PROFILE)
  @Patch(':id')
  @ApiOperation({ summary: "Edit a trainer's business details (own for TRAINER, any for SUPER_ADMIN)" })
  @ApiResponse({ status: 200, type: TrainerResponseDto })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 404 })
  async updateTrainer(
    @CurrentUser() ctx: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateTrainerDto,
  ): Promise<TrainerResponseDto> {
    return this.trainerService.updateTrainer(ctx, id, dto);
  }

  // Task 8.1 (api §4.1 "PATCH /trainers/:id/branding", FR-071/OQ-7). Same
  // @Roles/ownership shape as PATCH /trainers/:id above, but its own
  // capability (MANAGE_PORTAL_BRANDING) and its own DTO/service — branding
  // has different validation and a different FR (api §4.1 footnote at the
  // top of that section). NOT_FOUND, not FORBIDDEN, for a non-owning
  // trainer's :id — arch §8 Layer 3's "never 403, to avoid existence
  // disclosure" applies to every tenant-owned resource in this controller,
  // this endpoint included (matches PATCH /trainers/:id immediately above).
  @Roles(Role.TRAINER, Role.SUPER_ADMIN)
  @RequiresCapability(Capability.MANAGE_PORTAL_BRANDING)
  @Patch(':id/branding')
  @ApiOperation({ summary: "Update a trainer's portal branding — logo/primary color (own tenant for TRAINER, any for SUPER_ADMIN)" })
  @ApiResponse({ status: 200, type: BrandingResponseDto })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 404 })
  async updateBranding(
    @CurrentUser() ctx: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateBrandingDto,
  ): Promise<BrandingResponseDto> {
    return this.portalBrandingService.updateBranding(ctx, id, dto);
  }
}
