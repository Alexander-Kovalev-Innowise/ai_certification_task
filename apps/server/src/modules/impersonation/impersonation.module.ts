import { Module } from '@nestjs/common';

import { env } from '../../shared/config/config.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';

import { ImpersonationMaintenanceJob } from './impersonation-maintenance.job';
import { ImpersonationController } from './impersonation.controller';
import { ImpersonationRepository } from './impersonation.repository';
import { ImpersonationService } from './impersonation.service';

// Task 7.1, extended in Task 7.4 with `ImpersonationMaintenanceJob`
// (registered only when `SCHEDULER_ENABLED`, same convention
// `TokenMaintenanceJob`/`ApprovalExpiryJob` already use). `AuthModule`
// brings in `TokenService` (issueImpersonationToken) and
// `TenantClaimsResolver`; `UsersModule` brings in `UsersRepository` for the
// target-user lookup. Neither imports this module back, so no cycle.
@Module({
  imports: [AuthModule, UsersModule],
  controllers: [ImpersonationController],
  providers: [
    ImpersonationRepository,
    ImpersonationService,
    ...(env.SCHEDULER_ENABLED ? [ImpersonationMaintenanceJob] : []),
  ],
  exports: [ImpersonationRepository, ImpersonationService],
})
export class ImpersonationModule {}
