import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import type { AuthContext } from '../../shared/security/auth-context.interface';
import { Capability } from '../../shared/security/capability.enum';
import { CurrentUser } from '../../shared/security/decorators/current-user.decorator';
import { RequiresCapability } from '../../shared/security/decorators/requires-capability.decorator';
import { Roles } from '../../shared/security/decorators/roles.decorator';

import { CreateTrainerDto } from './dto/create-trainer.dto';
import { TrainerCreatedResponseDto, TrainerResponseDto } from './dto/trainer-response.dto';
import { UpdateTrainerDto } from './dto/update-trainer.dto';
import { TrainerService } from './trainer.service';

// Task 3.8, first endpoint — extended in Task 3.9 (GET/PATCH /trainers/:id).
@ApiTags('trainers')
@ApiBearerAuth()
@Controller('trainers')
export class TrainersController {
  constructor(private readonly trainerService: TrainerService) {}

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
}
