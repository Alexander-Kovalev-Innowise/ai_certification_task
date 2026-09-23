import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Capability } from '../../shared/security/capability.enum';
import { RequiresCapability } from '../../shared/security/decorators/requires-capability.decorator';
import { Roles } from '../../shared/security/decorators/roles.decorator';

import { CreateTrainerDto } from './dto/create-trainer.dto';
import { TrainerCreatedResponseDto } from './dto/trainer-response.dto';
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
}
