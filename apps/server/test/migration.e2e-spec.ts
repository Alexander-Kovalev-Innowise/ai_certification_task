import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';

// Task 1.2 — proves the raw SQL appended to the initial migration (Task 1.1's
// generated migration.sql) is enforced by real Postgres. Written as its own
// self-contained Testcontainers setup rather than depending on the shared
// harness Task 1.9 builds later — same "build it now, formalize later"
// pattern the plan uses for Tasks 1.6/1.7 against a manually-set ALS value
// ahead of Task 1.8's interceptor.
describe('migration raw SQL constraints (Task 1.2)', () => {
  jest.setTimeout(180_000);

  const serverRoot = resolve(__dirname, '..');
  let container: StartedPostgreSqlContainer;
  let client: Client;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16').start();

    // Applies every migration file, including our hand-edited raw SQL, to a
    // fresh ephemeral container — this is what actually exercises the SQL
    // this task added (the docker-compose dev DB it was first written against
    // needed a manual re-apply outside of `prisma migrate dev`/`reset`, since
    // that command requires interactive user consent per Prisma's own
    // dangerous-action guard; `migrate deploy` against a disposable
    // Testcontainers instance carries no such risk and needs none).
    // Invoked via the local `prisma` CLI entry point directly (not `npx`) to
    // avoid a shell hop on Windows.
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
      cwd: serverRoot,
      env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
      stdio: 'pipe',
    });

    client = new Client({ connectionString: container.getConnectionUri() });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  async function insertUser(role: string): Promise<string> {
    const id = randomUUID();
    await client.query(
      `INSERT INTO "User" (id, email, "passwordHash", role, "firstName", "lastName", "updatedAt")
       VALUES ($1, $2, 'hash', $3, 'A', 'B', now())`,
      [id, `${id}@example.com`, role],
    );
    return id;
  }

  async function insertTrainerProfile(): Promise<string> {
    const userId = await insertUser('TRAINER');
    const id = randomUUID();
    await client.query(
      `INSERT INTO "TrainerProfile" (id, "userId", "businessName", "updatedAt")
       VALUES ($1, $2, 'Biz', now())`,
      [id, userId],
    );
    return id;
  }

  it('creates the BR-003 partial unique index on CoachProfile(userId) WHERE status = ACTIVE', async () => {
    // Behavioral note: `CoachProfile.userId` already carries a *plain*
    // `@unique` in schema.prisma (Task 1.1, required for the 1:1 relation to
    // User) — that constraint alone already forbids a second CoachProfile row
    // for the same userId, active or not, so it always fires before this
    // partial index could. The partial index is real (queried here directly
    // from the catalog) and would be the operative constraint if the plain
    // @unique were ever relaxed to allow historical/inactive rows — DB-level
    // enforcement of BR-003 that doesn't depend on application code — but
    // under the *current* schema shape it is defense-in-depth, not the
    // constraint an ordinary duplicate-insert test would observe firing.
    const { rows } = await client.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'coach_profile_one_active_trainer'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/UNIQUE INDEX coach_profile_one_active_trainer ON public\."CoachProfile"/);
    expect(rows[0].indexdef).toMatch(/\(status = 'ACTIVE'::"CoachStatus"\)/);
  });

  it('rejects a second CoachProfile row for the same userId regardless of status (BR-003 end-to-end)', async () => {
    const coachUserId = await insertUser('COACH');
    const trainerId = await insertTrainerProfile();

    await client.query(
      `INSERT INTO "CoachProfile" (id, "userId", "trainerId", status) VALUES ($1, $2, $3, 'ACTIVE')`,
      [randomUUID(), coachUserId, trainerId],
    );

    await expect(
      client.query(
        `INSERT INTO "CoachProfile" (id, "userId", "trainerId", status) VALUES ($1, $2, $3, 'ACTIVE')`,
        [randomUUID(), coachUserId, trainerId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects an Availability row with both playerProfileId and coachProfileId set (exclusive arc CHECK)', async () => {
    const accountUserId = await insertUser('PLAYER_PARENT');
    const playerProfileId = randomUUID();
    await client.query(
      `INSERT INTO "PlayerProfile" (id, "accountUserId", name, "dateOfBirth", gender, "updatedAt")
       VALUES ($1, $2, 'Kid', now(), 'MALE', now())`,
      [playerProfileId, accountUserId],
    );

    const coachUserId = await insertUser('COACH');
    const trainerId = await insertTrainerProfile();
    const coachProfileId = randomUUID();
    await client.query(
      `INSERT INTO "CoachProfile" (id, "userId", "trainerId", status) VALUES ($1, $2, $3, 'PENDING')`,
      [coachProfileId, coachUserId, trainerId],
    );

    await expect(
      client.query(
        `INSERT INTO "Availability" (id, "subjectType", "playerProfileId", "coachProfileId", "dayOfWeek", "startTime", "endTime", "updatedAt")
         VALUES ($1, 'PLAYER', $2, $3, 1, 0, 60, now())`,
        [randomUUID(), playerProfileId, coachProfileId],
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'availability_exclusive_arc' });
  });

  it('audit."UserDeletionLog" is write-only: INSERT allowed, SELECT/UPDATE/DELETE denied for a non-superuser role', async () => {
    // The migration's REVOKE targets CURRENT_USER — whoever runs the
    // migration. Both the docker-compose dev role and this Testcontainers
    // image's default role are Postgres *superusers*, which always bypass
    // GRANT/REVOKE. That makes the REVOKE a structural no-op against the role
    // that ran it, in any environment using a superuser connection (flagged
    // in migration.sql). To prove the GRANT/REVOKE statements themselves are
    // correct — which is what a real non-superuser application role would
    // experience — this test creates one explicitly and exercises it.
    await client.query(`CREATE ROLE app_role LOGIN PASSWORD 'app_role_pw'`);
    await client.query(`GRANT USAGE ON SCHEMA audit TO app_role`);
    await client.query(`GRANT INSERT ON audit."UserDeletionLog" TO app_role`);
    await client.query(`REVOKE SELECT, UPDATE, DELETE ON audit."UserDeletionLog" FROM app_role`);

    const adminUserId = await insertUser('SUPER_ADMIN');

    const appClient = new Client({
      host: container.getHost(),
      port: container.getPort(),
      database: container.getDatabase(),
      user: 'app_role',
      password: 'app_role_pw',
    });
    await appClient.connect();

    try {
      await expect(
        appClient.query(
          `INSERT INTO audit."UserDeletionLog" (id, "originalUserId", "originalEmail", "deletedByUserId", reason, "dataBackupJson")
           VALUES ($1, $2, 'deleted@example.com', $2, 'gdpr request', '{}'::jsonb)`,
          [randomUUID(), adminUserId],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });

      await expect(appClient.query(`SELECT * FROM audit."UserDeletionLog"`)).rejects.toMatchObject({
        code: '42501', // insufficient_privilege
      });
    } finally {
      await appClient.end();
    }
  });
});
