import { Module } from '@nestjs/common';

import { JobsModule } from '../../shared/jobs/jobs.module';
import { PasswordResetTokenRepository } from '../auth/password-reset-token.repository';
import { PasswordService } from '../auth/password.service';
import { UsersModule } from '../users/users.module';

import { TrainerService } from './trainer.service';
import { TrainersController } from './trainers.controller';
import { TrainersRepository } from './trainers.repository';

// Task 3.8. `PasswordResetTokenRepository`/`PasswordService` are imported
// directly from the auth module (registered as providers here) rather than
// via an `AuthModule` import + its `exports` list — `PasswordResetTokenRepository`
// isn't in AuthModule's exports (only AuthService/PasswordService/TokenService/
// TokenRotationService are), and both classes are stateless beyond the
// shared PrismaService/argon2 calls, so a second DI instance is safe (same
// pattern UsersModule already uses for RefreshTokenRepository, Task 3.5).
@Module({
  imports: [UsersModule, JobsModule],
  controllers: [TrainersController],
  providers: [TrainersRepository, TrainerService, PasswordResetTokenRepository, PasswordService],
  exports: [TrainersRepository],
})
export class TrainersModule {}
