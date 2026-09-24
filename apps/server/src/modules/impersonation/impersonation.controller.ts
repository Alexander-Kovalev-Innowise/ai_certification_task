import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';

import type { AuthContext } from '../../shared/security/auth-context.interface';
import { Capability } from '../../shared/security/capability.enum';
import { CurrentUser } from '../../shared/security/decorators/current-user.decorator';
import { RequiresCapability } from '../../shared/security/decorators/requires-capability.decorator';
import { Roles } from '../../shared/security/decorators/roles.decorator';

import { ImpersonationStartResponseDto } from './dto/impersonation-start-response.dto';
import { StartImpersonationDto } from './dto/start-impersonation.dto';
import { ImpersonationService } from './impersonation.service';

// Task 7.1, first endpoint — extended in Task 7.2 (`/end`) and Task 7.3
// (`/history`).
@ApiTags('impersonation')
@ApiBearerAuth()
@Controller('impersonation')
export class ImpersonationController {
  constructor(private readonly impersonationService: ImpersonationService) {}

  // Task 7.1 (api §2 "POST /impersonation/start", arch §10). Rate limiter
  // 'impersonation' (10/h, keyed by the admin's own id) already registered
  // in AuthThrottlerGuard's named limiters (Task 2.7) — this is its first
  // and only consumer.
  @Roles(Role.SUPER_ADMIN)
  @RequiresCapability(Capability.IMPERSONATE_USER)
  @Throttle({ impersonation: {} })
  @Post('start')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Start impersonating another user (act-claim token, 60-minute hard cap, no refresh token)' })
  @ApiResponse({ status: 201, type: ImpersonationStartResponseDto })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 403, description: 'Non-Super-Admin caller, or already impersonating', schema: { example: { errorCode: 'IMPERSONATION_NOT_ALLOWED' } } })
  @ApiResponse({ status: 404, description: 'Unknown target' })
  @ApiResponse({ status: 422, description: 'Target is a SUPER_ADMIN', schema: { example: { errorCode: 'IMPERSONATION_TARGET_INVALID' } } })
  @ApiResponse({ status: 429, description: 'Too many attempts (10/hour, keyed by the admin)' })
  async start(@CurrentUser() ctx: AuthContext, @Body() dto: StartImpersonationDto): Promise<ImpersonationStartResponseDto> {
    return this.impersonationService.start(ctx, dto);
  }
}
