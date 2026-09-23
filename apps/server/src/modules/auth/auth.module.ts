import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { RefreshTokenRepository } from './refresh-token.repository';
import { TokenRotationService } from './token-rotation.service';
import { TokenService } from './token.service';

// Not one of Task 2.13's three named files, but the DI wiring point every
// one of them needs — created now (first endpoint), extended in place by
// every later auth task rather than re-created.
@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService, TokenRotationService, RefreshTokenRepository],
  exports: [AuthService, PasswordService, TokenService, TokenRotationService],
})
export class AuthModule {}
