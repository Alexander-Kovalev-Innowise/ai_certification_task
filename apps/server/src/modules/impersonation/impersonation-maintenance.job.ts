import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { DEFAULT_IMPERSONATION_TTL_SECONDS } from '../../shared/config/env.schema';
import { IMPERSONATION_TTL_SECONDS } from '../auth/impersonation-ttl.token';

import { ImpersonationRepository } from './impersonation.repository';

// Task 7.4 (arch §10 "No refresh" hard cap, §13.1 single-replica cron).
// Every 10 minutes, closes any `ImpersonationLog` past its 60-minute cap
// that never received an explicit `POST /impersonation/end` call (e.g. the
// client crashed mid-session, or the tab was simply closed) — the safety
// net api §2's own "Stale-impersonation safety net" note describes, so the
// audit trail never has a permanently-open session. Registered as a
// provider only when `SCHEDULER_ENABLED`, same single-replica-only gating
// convention `TokenMaintenanceJob`/`ApprovalExpiryJob` already use (see
// impersonation.module.ts).
@Injectable()
export class ImpersonationMaintenanceJob {
  private readonly logger = new Logger(ImpersonationMaintenanceJob.name);

  constructor(
    private readonly impersonationRepository: ImpersonationRepository,
    @Optional() @Inject(IMPERSONATION_TTL_SECONDS) private readonly ttlSeconds: number = DEFAULT_IMPERSONATION_TTL_SECONDS,
  ) {}

  @Cron('0 */10 * * * *')
  async sweep(): Promise<void> {
    const closed = await this.impersonationRepository.closeStaleSessions(this.ttlSeconds);
    if (closed > 0) {
      this.logger.log(`ImpersonationMaintenanceJob closed ${closed} stale impersonation session(s) past their 60-minute cap`);
    }
  }
}
