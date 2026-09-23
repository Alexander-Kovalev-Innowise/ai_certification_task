import { Module } from '@nestjs/common';

import { JobsModule } from '../../shared/jobs/jobs.module';
import { UsersModule } from '../users/users.module';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordResetTokenRepository } from './password-reset-token.repository';
import { PasswordService } from './password.service';
import { RefreshTokenRepository } from './refresh-token.repository';
import { TokenRotationService } from './token-rotation.service';
import { TokenService } from './token.service';

// Not one of Task 2.13's three named files, but the DI wiring point every
// one of them needs — created now (first endpoint), extended in place by
// every later auth task rather than re-created. JobsModule (Task 2.16)
// brings in OutboxService for the forgot-password email enqueue.
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
  ],
  exports: [AuthService, PasswordService, TokenService, TokenRotationService],
})
export class AuthModule {}
