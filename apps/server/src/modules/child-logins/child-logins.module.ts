import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { RefreshTokenRepository } from '../auth/refresh-token.repository';
import { PlayerProfilesModule } from '../player-profiles/player-profiles.module';
import { UsersModule } from '../users/users.module';

import { ChildLoginsController } from './child-logins.controller';
import { ChildLoginsService } from './child-logins.service';

// `RefreshTokenRepository` is declared directly (not exported by AuthModule) —
// same workaround UsersModule uses.
@Module({
  imports: [AuthModule, UsersModule, PlayerProfilesModule],
  controllers: [ChildLoginsController],
  providers: [ChildLoginsService, RefreshTokenRepository],
})
export class ChildLoginsModule {}
