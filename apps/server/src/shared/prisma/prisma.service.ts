import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { env } from '../config/config.module';

import { auditStampExtension } from './extensions/audit-stamp.extension';
import { softDeleteExtension } from './extensions/soft-delete.extension';
import { tenantGuardExtension } from './extensions/tenant-guard.extension';

// Deviation from the plan (Prisma 7.10.0, pinned in Phase 0): Prisma 7
// requires a driver adapter at runtime — `new PrismaClient()` with no
// arguments throws ("A driver adapter is required to connect to your
// database"). `PrismaPg` from `@prisma/adapter-pg` replaces the implicit
// `datasource.url` wiring that worked in Prisma ≤6.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private extendedClient?: ReturnType<PrismaService['buildExtendedClient']>;

  constructor() {
    super({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Prisma disconnected');
  }

  /**
   * Query surface with the tenant-guard, soft-delete, and audit-stamp
   * extensions (Tasks 1.5/1.6/1.7) actually applied — added in Task 2.4.
   * Phase 1 built and unit-tested all three extensions but never wired any
   * of them onto the app's real, injected `PrismaService`: each extension's
   * own spec applies it to a throwaway `new PrismaClient({adapter}).
   * $extends(...)`, not to this class. That's an invisible gap for anything
   * that doesn't exercise it end-to-end — but Task 2.4's own DoD requires a
   * real proof that the tenant-guard extension doesn't throw on the guard's
   * pre-ALS `User` read, and Task 2.9's `UsersRepository.findById` is
   * documented as relying on `findFirst`'s soft-delete filtering — neither
   * is a real guarantee unless something in this codebase actually calls
   * `.$extends(...)` on the live client. This getter is that wiring, kept
   * additive and backward compatible: existing Phase 1 code (e.g.
   * `OutboxRepository`) keeps calling `this.prisma.outboxJob...` directly
   * (unaffected — `OutboxJob` isn't a target of any of the three
   * extensions), and Phase 2+ repositories that need extension behavior
   * call `this.prisma.extended.user.findFirst(...)` etc. instead. Lazily
   * built and cached on first access; shares the same underlying
   * connection/engine as `this` (Prisma's documented `$extends` behavior),
   * so this class's own `$connect`/`$disconnect` still govern the
   * connection lifecycle for both the base and extended surfaces.
   */
  get extended() {
    if (!this.extendedClient) {
      this.extendedClient = this.buildExtendedClient();
    }
    return this.extendedClient;
  }

  private buildExtendedClient() {
    return this.$extends(tenantGuardExtension).$extends(softDeleteExtension).$extends(auditStampExtension);
  }
}
