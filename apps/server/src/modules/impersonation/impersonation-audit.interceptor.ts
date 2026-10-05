import { CallHandler, ExecutionContext, HttpException, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { catchError, from, mergeMap, Observable, throwError } from 'rxjs';

import type { AuthenticatedRequest } from '../../shared/security/guards/jwt-auth.guard';

import { ImpersonationRepository } from './impersonation.repository';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const MAX_PATH_LENGTH = 500;

function successStatus(context: ExecutionContext, method: string): number {
  const explicit = Reflect.getMetadata(HTTP_CODE_METADATA, context.getHandler()) as number | undefined;
  if (explicit !== undefined) {
    return explicit;
  }
  return method === 'POST' ? 201 : 200;
}

// Audit trail for writes made while impersonating (Epic-01 FR-015/BR-010).
// Registered globally (APP_INTERCEPTOR, impersonation.module.ts): for every
// non-GET request whose AuthContext carries an `impersonation` actor it
// writes {actorUserId (the admin), effectiveUserId (the impersonated user),
// impersonationLogId, method, path, statusCode, at} to
// audit."ImpersonationAuditLog". Runs after the guards, so requests rejected
// by a guard (no business effect) are not recorded; handler failures are,
// with their error status. Query strings are dropped (they can carry tokens).
// The business write has already committed by the time this runs, so an audit
// insert failure is logged, never surfaced to the caller.
@Injectable()
export class ImpersonationAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ImpersonationAuditInterceptor.name);

  constructor(private readonly impersonationRepository: ImpersonationRepository) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const impersonation = request.authContext?.impersonation;

    if (!impersonation || SAFE_METHODS.has(request.method.toUpperCase())) {
      return next.handle();
    }

    const record = (statusCode: number): Promise<void> =>
      this.record({
        actorUserId: impersonation.actorUserId,
        effectiveUserId: request.authContext!.userId,
        impersonationLogId: impersonation.logId,
        method: request.method.toUpperCase(),
        path: (request.originalUrl ?? request.url).split('?', 1)[0]!.slice(0, MAX_PATH_LENGTH),
        statusCode,
      });

    return next.handle().pipe(
      mergeMap(async (value: unknown) => {
        await record(successStatus(context, request.method.toUpperCase()));
        return value;
      }),
      catchError((error: unknown) =>
        from(record(error instanceof HttpException ? error.getStatus() : 500)).pipe(
          mergeMap(() => throwError(() => error)),
        ),
      ),
    );
  }

  private async record(entry: Parameters<ImpersonationRepository['createAuditEntry']>[0]): Promise<void> {
    try {
      await this.impersonationRepository.createAuditEntry(entry);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to record impersonation audit entry (${entry.method} ${entry.path}): ${message}`);
    }
  }
}
