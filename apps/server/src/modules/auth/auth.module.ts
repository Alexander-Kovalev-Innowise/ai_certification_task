import { Module } from '@nestjs/common';

import { env } from '../../shared/config/config.module';
import { JobsModule } from '../../shared/jobs/jobs.module';
import { UsersModule } from '../users/users.module';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailVerificationTokenRepository } from './email-verification-token.repository';
import { PasswordResetTokenRepository } from './password-reset-token.repository';
import { PasswordService } from './password.service';
import { RefreshTokenRepository } from './refresh-token.repository';
import { TenantClaimsResolver } from './tenant-claims.resolver';
import { TokenMaintenanceJob } from './token-maintenance.job';
import { TokenRotationService } from './token-rotation.service';
import { TokenService } from './token.service';

// Not one of Task 2.13's three named files, but the DI wiring point every
// one of them needs — created now (first endpoint), extended in place by
// every later auth task rather than re-created. JobsModule (Task 2.16)
// brings in OutboxService for the forgot-password email enqueue, and
// already conditionally registers ScheduleModule.forRoot() when
// SCHEDULER_ENABLED (Task 1.12's pattern) — TokenMaintenanceJob (Task 2.21)
// only needs to be a provider here, gated the same way OutboxPump is.
@Module({
  imports: [UsersModule, JobsModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    TokenRotationService,
    RefreshTokenRepository,
    PasswordResetTokenRepository,
    EmailVerificationTokenRepository,
    TenantClaimsResolver,
    ...(env.SCHEDULER_ENABLED ? [TokenMaintenanceJob] : []),
  ],
  exports: [AuthService, PasswordService, TokenService, TokenRotationService, TenantClaimsResolver],
})
export class AuthModule {}
