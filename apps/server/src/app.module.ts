import { MiddlewareConsumer, Module, NestModule, OnModuleInit } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';

import { AuthModule } from './modules/auth/auth.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { ChildApprovalsModule } from './modules/child-approvals/child-approvals.module';
import { CoachesModule } from './modules/coaches/coaches.module';
import { PlayerProfilesModule } from './modules/player-profiles/player-profiles.module';
import { ShareLinksModule } from './modules/share-links/share-links.module';
import { TrainersModule } from './modules/trainers/trainers.module';
import { UsersModule } from './modules/users/users.module';
import { ConfigModule } from './shared/config/config.module';
import { EventsModule } from './shared/events/events.module';
import { JobsModule } from './shared/jobs/jobs.module';
import { LoggerModule } from './shared/logging/logger.module';
import { RequestContextMiddleware } from './shared/logging/request-context.middleware';
import { PrismaModule } from './shared/prisma/prisma.module';
import { assertRoutesHaveRequiredCapability } from './shared/security/assert-routes-have-capability';
import { AuthThrottlerGuard, buildAuthThrottlerConfigs } from './shared/security/guards/auth-throttler.guard';
import { CapabilitiesGuard } from './shared/security/guards/capabilities.guard';
import { JwtAuthGuard } from './shared/security/guards/jwt-auth.guard';
import { RolesGuard } from './shared/security/guards/roles.guard';
import { AuthContextInterceptor } from './shared/security/interceptors/auth-context.interceptor';
import { SecurityModule } from './shared/security/security.module';
import { TenantContextInterceptor } from './shared/tenancy/tenant-context.interceptor';

// Task 2.8 — global guard pipeline (arch §5) + boot-time capability
// assertion (arch §9.2/§20). GlobalExceptionFilter is deliberately NOT
// registered here (no APP_FILTER provider): it's already wired in
// main.ts's bootstrap() (Task 0.11), and e2e tests that build their own
// INestApplication (e.g. bootstrap.e2e-spec.ts) replicate that same
// main.ts wiring rather than relying on AppModule for it — registering it
// again here would double-apply it.
//
// Order matches arch §5 exactly:
//   1. ThrottlerGuard      -> AuthThrottlerGuard (named limiters, Task 2.7)
//   2. JwtAuthGuard         (Task 2.4 — skips @Public(), resolves AuthContext)
//   3. RolesGuard           (Task 2.5)
//   4. CapabilitiesGuard    (Task 2.6)
//   [interceptors, after all guards:]
//   AuthContextInterceptor  (Task 2.4's fix — publishes AuthContext to ALS;
//                            MUST run before TenantContextInterceptor, since
//                            TenantContextInterceptor's own intercept() reads
//                            getAuthContext() synchronously at its top)
//   TenantContextInterceptor (Task 1.8)
@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    PrismaModule,
    SecurityModule,
    EventsModule,
    JobsModule,
    DiscoveryModule,
    ThrottlerModule.forRoot(buildAuthThrottlerConfigs()),
    UsersModule,
    AuthModule,
    TrainersModule,
    ShareLinksModule,
    CoachesModule,
    PlayerProfilesModule,
    AvailabilityModule,
    ChildApprovalsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: CapabilitiesGuard },
    { provide: APP_INTERCEPTOR, useClass: AuthContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule implements NestModule, OnModuleInit {
  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }

  onModuleInit(): void {
    assertRoutesHaveRequiredCapability(this.discoveryService, this.metadataScanner, this.reflector);
  }
}
