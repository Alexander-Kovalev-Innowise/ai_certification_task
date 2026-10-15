import * as env from '../scripts/e2e-env.cjs';

/**
 * Direct access to the ISOLATED e2e database (practiceperfect_e2e - never the dev DB; the URL is derived and
 * guarded by scripts/e2e-env.cjs). Only used to ARRANGE time-dependent states that cannot be reached through the UI
 * in a test run, e.g. an invitation or reset link that "expired" a week ago.
 */
interface PgClient {
  connect(): Promise<void>;
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
  end(): Promise<void>;
}

export async function sql(text: string, params: unknown[] = []) {
  const { Client } = env.serverRequire('pg') as { Client: new (opts: { connectionString: string }) => PgClient };
  const client = new Client({ connectionString: env.databaseUrls().e2eUrl });
  await client.connect();
  try {
    return await client.query(text, params);
  } finally {
    await client.end();
  }
}

/** Makes a ShareLink look like it expired two days ago (roster -> "Expired", /join/:code -> EXPIRED). */
export async function expireShareLink(code: string): Promise<void> {
  const res = await sql(`UPDATE "ShareLink" SET "expiresAt" = now() - interval '2 days' WHERE code = $1`, [code]);
  if (!res.rowCount) throw new Error(`No ShareLink with code ${code}`);
}

/** Makes every unused password-reset / trainer-setup token of a user expired. */
export async function expireResetTokens(email: string): Promise<void> {
  await sql(
    `UPDATE "PasswordResetToken" SET "expiresAt" = now() - interval '2 hours'
       WHERE "userId" = (SELECT id FROM "User" WHERE email = $1) AND "usedAt" IS NULL`,
    [email.toLowerCase()],
  );
}

/** Makes every unused email-verification token of a user expired. */
export async function expireVerificationTokens(email: string): Promise<void> {
  await sql(
    `UPDATE "EmailVerificationToken" SET "expiresAt" = now() - interval '2 hours'
       WHERE "userId" = (SELECT id FROM "User" WHERE email = $1) AND "usedAt" IS NULL`,
    [email.toLowerCase()],
  );
}

/** Makes every still-PENDING purchase approval of a player profile look 48h+ old (past `expiresAt`), so ApprovalExpiryJob picks it up. */
export async function expirePendingApprovals(playerProfileId: string): Promise<number> {
  const res = await sql(
    `UPDATE "ChildPurchaseApproval" SET "expiresAt" = now() - interval '1 hour', "requestedAt" = now() - interval '49 hours'
       WHERE "playerProfileId" = $1 AND status = 'PENDING'`,
    [playerProfileId],
  );
  return res.rowCount ?? 0;
}
