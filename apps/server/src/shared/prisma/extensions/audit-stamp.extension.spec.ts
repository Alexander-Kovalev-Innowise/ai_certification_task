import type { AuthContext } from '../../security/auth-context.interface';
import { runWithAuthContext } from '../../security/auth-context.store';

import { AUDIT_STAMPED_MODELS, auditStampAllOperations, stampAuditFields } from './audit-stamp.extension';

// Not Testcontainers-backed: this extension is pure argument-shaping logic
// with no DB-enforced invariant to verify (no CHECK constraint, no trigger),
// and — as documented in audit-stamp.extension.ts — no Epic-01 model
// actually carries the columns it would stamp, so there is no real table to
// write through yet. Task 0.9's request-context.middleware.spec.ts sets the
// precedent for testing ALS-based behavior this way (unit-level, not DB).
describe('auditStampExtension (Task 1.7)', () => {
  const fieldMap = { actorField: 'actorUserId', logIdField: 'impersonationLogId' };

  const impersonatedContext: AuthContext = {
    userId: 'target-user',
    role: 'TRAINER',
    accountType: 'ADULT',
    impersonation: {
      actorUserId: 'admin-1',
      actorRole: 'SUPER_ADMIN',
      logId: 'log-1',
      expiresAt: new Date('2026-01-01T00:00:00Z'),
    },
    auditActorId: 'admin-1',
  };

  describe('stampAuditFields (pure)', () => {
    it('stamps actorUserId/impersonationLogId while impersonation context is present in ALS', async () => {
      const result = await runWithAuthContext(impersonatedContext, () => stampAuditFields({ name: 'x' }, fieldMap));
      expect(result).toEqual({ name: 'x', actorUserId: 'admin-1', impersonationLogId: 'log-1' });
    });

    it('leaves data untouched when there is no impersonation context in ALS', () => {
      const result = stampAuditFields({ name: 'x' }, fieldMap);
      expect(result).toEqual({ name: 'x' });
    });
  });

  describe('auditStampAllOperations wiring', () => {
    const modelName = 'TestAuditStampedModel';

    afterEach(() => {
      delete AUDIT_STAMPED_MODELS[modelName];
    });

    it('rewrites args.data for a registered model + write operation while impersonating', async () => {
      AUDIT_STAMPED_MODELS[modelName] = fieldMap;
      const query = jest.fn().mockResolvedValue({ ok: true });

      await runWithAuthContext(impersonatedContext, () =>
        auditStampAllOperations({ model: modelName, operation: 'create', args: { data: { name: 'x' } }, query }),
      );

      expect(query).toHaveBeenCalledWith({ data: { name: 'x', actorUserId: 'admin-1', impersonationLogId: 'log-1' } });
    });

    it('does not rewrite args for a model with no registry entry', async () => {
      const query = jest.fn().mockResolvedValue({ ok: true });

      await runWithAuthContext(impersonatedContext, () =>
        auditStampAllOperations({ model: 'User', operation: 'create', args: { data: { name: 'x' } }, query }),
      );

      expect(query).toHaveBeenCalledWith({ data: { name: 'x' } });
    });

    it('does not rewrite args for a registered model when there is no impersonation context', async () => {
      AUDIT_STAMPED_MODELS[modelName] = fieldMap;
      const query = jest.fn().mockResolvedValue({ ok: true });

      await auditStampAllOperations({ model: modelName, operation: 'create', args: { data: { name: 'x' } }, query });

      expect(query).toHaveBeenCalledWith({ data: { name: 'x' } });
    });

    it('does not rewrite args for a non-write operation (e.g. findMany) even on a registered model', async () => {
      AUDIT_STAMPED_MODELS[modelName] = fieldMap;
      const query = jest.fn().mockResolvedValue([]);

      await runWithAuthContext(impersonatedContext, () =>
        auditStampAllOperations({ model: modelName, operation: 'findMany', args: { where: {} }, query }),
      );

      expect(query).toHaveBeenCalledWith({ where: {} });
    });
  });
});
