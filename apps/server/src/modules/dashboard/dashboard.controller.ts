import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import type { AuthContext } from '../../shared/security/auth-context.interface';
import { Capability } from '../../shared/security/capability.enum';
import { CrossTenant } from '../../shared/security/decorators/cross-tenant.decorator';
import { CurrentUser } from '../../shared/security/decorators/current-user.decorator';
import { RequiresCapability } from '../../shared/security/decorators/requires-capability.decorator';

import { DashboardService } from './dashboard.service';
import { DashboardStatsResponseDto } from './dto/dashboard-stats-response.dto';

// Role-aware dashboard metrics for every authenticated role. No `@Roles()`:
// the effective role (incl. impersonation) picks the payload shape, and the
// same self-service `EDIT_OWN_PROFILE` capability `GET /me`/`/me/bootstrap`
// use gates it. `@CrossTenant()` only takes effect for a SUPER_ADMIN's own
// platform-wide aggregates (TenantContextInterceptor); TRAINER/COACH callers
// keep their TRAINER tenant scope regardless.
@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @RequiresCapability(Capability.EDIT_OWN_PROFILE)
  @CrossTenant()
  @Get('stats')
  @ApiOperation({ summary: "Role-aware dashboard metrics for the caller's effective role (tenant-scoped for TRAINER/COACH)" })
  @ApiResponse({ status: 200, type: DashboardStatsResponseDto })
  @ApiResponse({ status: 401 })
  async getStats(@CurrentUser() ctx: AuthContext): Promise<DashboardStatsResponseDto> {
    return this.dashboardService.getStats(ctx);
  }
}
