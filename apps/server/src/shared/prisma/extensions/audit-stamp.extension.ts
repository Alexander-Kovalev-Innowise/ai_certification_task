import { Prisma } from '@prisma/client';

import { getAuthContext } from '../../security/auth-context.store';

// Task 1.7 (arch §10 impersonation audit row). While AuthContext.impersonation
// is present in ALS, stamps actorUserId/impersonationLogId onto write
// operations for models that carry those columns.
//
// AUDIT_STAMPED_MODELS is intentionally EMPTY for Epic-01: a grep of the
// Task 1.1 schema (reproduced verbatim from the plan) confirms no model yet
// has an actorUserId/impersonationLogId column pair. This matches the
// plan's own framing — "most Epic-01 models don't have these columns yet;
// this extension's job in Epic-01 is narrow: it exists and is tested now so
// impersonation (Phase 7) has nothing left to build here." A later
// epic/phase registers an entry here per model as those columns are added.
export interface AuditStampFieldMap {
  actorField: string;
  logIdField: string;
}

export const AUDIT_STAMPED_MODELS: Record<string, AuditStampFieldMap> = {};

const WRITE_OPERATIONS = new Set(['create', 'update', 'upsert', 'createMany', 'updateMany']);

/**
 * Pure stamping function, exported and independently unit-tested: given a
 * write payload and the field names to stamp, overwrites them from the
 * current AuthContext.impersonation (ALS) if present, otherwise returns
 * `data` unchanged.
 */
export function stampAuditFields(
  data: Record<string, unknown> | undefined,
  fieldMap: AuditStampFieldMap,
): Record<string, unknown> | undefined {
  const ctx = getAuthContext();
  if (!data || !ctx?.impersonation) {
    return data;
  }
  return {
    ...data,
    [fieldMap.actorField]: ctx.impersonation.actorUserId,
    [fieldMap.logIdField]: ctx.impersonation.logId,
  };
}

function stampArgs(model: string, operation: string, args: Record<string, unknown> | undefined) {
  const fieldMap = AUDIT_STAMPED_MODELS[model];
  if (!fieldMap || !WRITE_OPERATIONS.has(operation) || !args) {
    return args;
  }

  if (Array.isArray(args.data)) {
    return {
      ...args,
      data: (args.data as Record<string, unknown>[]).map((entry) => stampAuditFields(entry, fieldMap)),
    };
  }

  if (operation === 'upsert') {
    return {
      ...args,
      create: stampAuditFields(args.create as Record<string, unknown> | undefined, fieldMap),
      update: stampAuditFields(args.update as Record<string, unknown> | undefined, fieldMap),
    };
  }

  return { ...args, data: stampAuditFields(args.data as Record<string, unknown> | undefined, fieldMap) };
}

// Exported separately from the `Prisma.defineExtension(...)` wrapper below so
// it can be unit-tested directly without needing a real Prisma model that
// carries the stamped columns (none exist yet in Epic-01 — see
// AUDIT_STAMPED_MODELS above).
export function auditStampAllOperations({
  model,
  operation,
  args,
  query,
}: {
  model: string;
  operation: string;
  args: Record<string, unknown> | undefined;
  query: (args: unknown) => Promise<unknown>;
}) {
  return query(stampArgs(model, operation, args));
}

export const auditStampExtension = Prisma.defineExtension({
  name: 'audit-stamp',
  query: {
    $allModels: {
      $allOperations: auditStampAllOperations,
    },
  },
});
