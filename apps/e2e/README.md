# apps/e2e - Playwright end-to-end tests with video

Every test records a 1280x720 video of the app being used (`slowMo: 150ms`, on-screen captions via `narrate()`),
so the suite doubles as a watchable demo of Epic-01 functionality.

## Run

```bash
npm run test:e2e                      # from repo root (or: cd apps/e2e && npx playwright test)
npx playwright test tests/01-auth.spec.ts          # one spec
npx playwright test -g "sign out"                  # one test by title
npm run test:headed -w e2e                         # watch the browser live
npm run videos -w e2e                              # list recorded videos
npm run report -w e2e                              # open the HTML report
```

`E2E_RESET_DB=1 npm run test:e2e` drops and recreates the e2e database first. `CI=1` disables server reuse.

## Where the videos land

`apps/e2e/videos/<spec-file>/<test-title-slug>.webm` - stable, human-readable paths (copied after each test by
the `page` fixture in `support/test.ts`; a second page in one test gets a `-page2` suffix). Raw Playwright output,
traces and failure screenshots are in `test-results/`, the HTML report in `playwright-report/`.
All of these, plus `.uploads/`, `.client-snapshot/` and `apps/server/.e2e-dist/`, are git-ignored.
Videos of old tests are not deleted automatically.

## The isolated stack (never touches your dev servers or data)

| What   | Where                                  | Notes |
| ------ | -------------------------------------- | ----- |
| API    | http://localhost:3100                  | `scripts/start-api.cjs`: creates DB `practiceperfect_e2e` (derived from the root `.env` `DATABASE_URL`, name swapped), `prisma migrate deploy`, seeds the Super Admin, compiles `apps/server` to `apps/server/.e2e-dist` (not `dist`, which the dev watcher owns), runs it |
| Client | http://localhost:3101                  | `scripts/start-client.cjs`: `next dev -p 3101 --webpack` on a throwaway copy of `apps/client` in `.client-snapshot/` (two `next dev` cannot share one `.next/dev` lock) |

Env contract for the API process: `DATABASE_URL` (e2e DB), `PORT=3100`, `CLIENT_URL=http://localhost:3101`,
`NODE_ENV=development`, `MAIL_PROVIDER=dev`, `RATE_LIMITS_DISABLED=true`, `SCHEDULER_ENABLED=true`,
`PUBLIC_API_URL=http://localhost:3100`, `UPLOADS_DIR=apps/e2e/.uploads`; everything else (`JWT_SECRET`,
`SEED_SUPER_ADMIN_*`) comes from the root `.env`, which is only loaded programmatically, never printed.
Client: `NEXT_PUBLIC_API_URL=http://localhost:3100`. Single source of truth: `scripts/e2e-env.cjs`
(overrides: `E2E_API_PORT`, `E2E_CLIENT_PORT`, `E2E_DB_NAME`, `E2E_DATABASE_URL`).

Playwright starts `webServer`s before `global-setup.ts`, so DB preparation lives in `start-api.cjs`;
`global-setup.ts` then verifies the API, the seeded login, and clears the dev mailbox.
The API needs `MAIL_PROVIDER=dev`: `GET /__dev/mailbox?to=<email>` -> `[{to,subject,templateId,html,text,links[],sentAt}]`,
`DELETE /__dev/mailbox`.

## Support library (`support/`)

Import everything from `../support/test`:

- `test`, `expect` - extended Playwright test (video saving built in)
- fixtures: `api` (typed fetch client: `login`, `refresh` (cookie-only + CSRF header), `logout`, `superAdmin()`, `get/post/patch/put/delete`),
  `mailbox` (`waitFor(to)`, `linkTo(to, /register\?token=/)`, `clear()`), `seed` (Super Admin credentials),
  `narrate(text)`, `loginAs(email, password)` (fills the real form), `shell` (sidebar, `goTo(label)`, user menu `signOut()`, `toggleTheme()`, `markSidebar()`)
- helpers: `uid()`, `uniqueEmail()`, `uniqueName()`, `strongPassword()`, `highlight(locator)`

The database persists between runs, so always create data with unique ids (`uniqueEmail('trainer')`) and look it up by that.

Arrange-by-API helpers (`support/arrange.ts`, also exported from `support/test`): `createTrainer(api, mailbox)` (Super Admin creates +
setup link completed, returns a logged-in session), `createCoach(api, mailbox, trainer)`, `createPlayer(api, trainer)`, `validPhone()`,
`nextDateOnWeekday(n)`, `makePng()` / `makeSvg()` (tiny generated images for upload tests), `showEmail(page, mail)` (renders a mailbox
message in the video). `support/db.ts` (`expireShareLink`, `expireResetTokens`, `expireVerificationTokens`, `sql`) talks to the ISOLATED
e2e database only, to reach time-dependent states (7-day / 1h / 24h link expiry) that cannot be produced through the UI.

Spec map (tests/): `10` US-01.01 create trainer, `11` US-01.07 impersonation, `12` US-01.08 invite coach, `13` US-01.10 coach My Times +
conflict override, `14` US-01.11 edit profile, `15` US-01.12 deactivate/reactivate, `16` US-01.13 GDPR delete, `17` US-01.14 branding,
`18` auth (sign-in, password reset, email verification, change password, sessions), `19` role access + tenant isolation, `20` users
directory, `21` dashboards.
Player / parent / child side: `30` US-01.02 player registers via ShareLink (+ second trainer, family picker, context switcher, coach link),
`31` US-01.03 parent creates a child profile, `32` US-01.04 parent manages child-trainer associations, `33` US-01.05 child purchase approval
(incl. the real 5-minute ApprovalExpiryJob run - that one test waits up to ~5 min), `34` US-01.06 child login constraints, `35` US-01.09 Best Times,
`36` business rules (under-18 parent-managed, e-mail uniqueness / single role, multi-trainer isolation). Family arrange helpers live in
`support/family.ts` (`registerParent`, `addChildProfile`, `createChildLogin`, `connectProfilesViaLink`, `setPlayerAvailability`, ...);
`support/db.ts` also has `expirePendingApprovals`.

## Adding a spec for a user story

Create `tests/NN-us-XXX-short-name.spec.ts` (the file name becomes the video folder):

```ts
import { test, expect, highlight, shell, uniqueEmail, strongPassword } from '../support/test';

test.describe('US-XXX: <story title>', () => {
  test('<acceptance criterion in plain words>', async ({ page, api, mailbox, seed, narrate, loginAs }) => {
    // 1. Arrange via the API (fast, not the thing under test)
    const admin = await api.superAdmin();
    const email = uniqueEmail('trainer');
    // await api.post('/users/trainers', { auth: admin, body: { email, ... } });

    // 2. Act through the REAL UI - this is what the video shows
    await narrate('Super Admin signs in');
    await loginAs(seed.superAdmin.email, seed.superAdmin.password);
    await narrate('What this step proves');
    await shell(page).goTo('Users');

    // 3. Assert visible behaviour; highlight() draws a box around what is checked
    await expect(page.getByRole('table', { name: 'Users' })).toBeVisible();
    await highlight(page.getByRole('table', { name: 'Users' }));
  });
});
```

Prefer role/label locators; use one `narrate()` per meaningful step so the video explains itself.
