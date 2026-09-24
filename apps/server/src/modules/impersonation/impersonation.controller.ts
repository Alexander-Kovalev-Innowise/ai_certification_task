import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';

import type { PaginatedResponseDto } from '../../shared/http/pagination.dto';
import type { AuthContext } from '../../shared/security/auth-context.interface';
import { Capability } from '../../shared/security/capability.enum';
import { CurrentUser } from '../../shared/security/decorators/current-user.decorator';
import { RequiresCapability } from '../../shared/security/decorators/requires-capability.decorator';
import { Roles } from '../../shared/security/decorators/roles.decorator';

import { ImpersonationLogResponseDto } from './dto/impersonation-log-response.dto';
import { ImpersonationStartResponseDto } from './dto/impersonation-start-response.dto';
import { ListImpersonationHistoryQueryDto } from './dto/list-impersonation-history-query.dto';
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

  // Task 7.2 (api §2 "POST /impersonation/end"). Called WITH the
  // impersonation access token (not the admin's own) — no @Roles() here
  // (unlike /start): the effective role on that token is the TARGET's,
  // never SUPER_ADMIN (arch §10), so a role gate would make this
  // unreachable. `@RequiresCapability(IMPERSONATE_USER)` matches api §2's
  // endpoint table; Task 7.5's blast-radius wiring in CapabilitiesGuard
  // carries an explicit exemption for this exact route, since ending a
  // session must stay reachable precisely while impersonating (see that
  // guard's own comment).
  @RequiresCapability(Capability.IMPERSONATE_USER)
  @Post('end')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'End the current impersonation session (reachable only while impersonating)' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 401, description: 'Impersonation token itself already expired (60-minute cap)' })
  @ApiResponse({ status: 403, description: 'Not currently impersonating', schema: { example: { errorCode: 'IMPERSONATION_NOT_ALLOWED' } } })
  @ApiResponse({ status: 404, description: 'Log row missing (defensive; should not happen)' })
  async end(@CurrentUser() ctx: AuthContext): Promise<void> {
    await this.impersonationService.end(ctx);
  }

  // Task 7.3 (api §2 "GET /impersonation/history"). Super Admin only, same
  // `@Roles`/`@RequiresCapability` pair as `/start` — an impersonation
  // token can never satisfy `@Roles(SUPER_ADMIN)` either (arch §10), so
  // this route is unreachable mid-impersonation the same way `/start` is,
  // consistent with it needing no blast-radius exemption (unlike `/end`).
  @Roles(Role.SUPER_ADMIN)
  @RequiresCapability(Capability.IMPERSONATE_USER)
  @Get('history')
  @ApiOperation({ summary: 'Impersonation audit history (keyset paginated, filterable by admin/target/date)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403 })
  async getHistory(@Query() query: ListImpersonationHistoryQueryDto): Promise<PaginatedResponseDto<ImpersonationLogResponseDto>> {
    return this.impersonationService.getHistory(query);
  }
}
