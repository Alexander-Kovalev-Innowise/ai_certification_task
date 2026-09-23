import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { env } from '../config/config.module';

import { AuthSnapshotRepository } from './auth-snapshot.repository';

// Not one of Task 2.4's two named files, but necessary infrastructure for it:
// JwtAuthGuard (and, later, TokenService, Task 2.11) needs a `JwtService`
// bound with `JWT_SECRET` (arch §6.1, HS256), and AuthSnapshotRepository
// needs to be resolvable wherever the guard is instantiated. `@Global()`
// follows the same convention PrismaModule/ConfigModule already use in this
// codebase — the guard pipeline is registered once in AppModule (Task 2.8)
// via `APP_GUARD`, and Nest resolves those providers' dependencies from the
// full global module graph, not from a per-feature-module import list.
@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: env.JWT_SECRET,
      signOptions: { algorithm: 'HS256' },
    }),
  ],
  providers: [AuthSnapshotRepository],
  exports: [JwtModule, AuthSnapshotRepository],
})
export class SecurityModule {}
