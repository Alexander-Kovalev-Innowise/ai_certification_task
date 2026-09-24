import { createHash } from 'node:crypto';

import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerOptions } from '@nestjs/throttler';

import type { AuthenticatedRequest } from './jwt-auth.guard';

// @nestjs/throttler uses sha256 internally (its own generateKey) but does
// NOT export it from the package's public entry point (hash.ts is absent
// from index.ts's `export *` list, despite hash.d.ts existing) — so this is
// a plain Node crypto helper, not a re-export.
function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

// Task 2.7 (arch §12, api §0.6). Named limiters:
//   default          300 / 60s     — IP, always on
//   auth-ip           20 / 15min   — IP, opt-in via @Throttle
//   auth-identity       5 / 15min  — sha256(route + normalizedEmail), opt-in
//   token-consume      10 / 15min  — IP, opt-in
//   impersonation      10 / hour   — adminUserId, opt-in
//
// Deviation from the plan's literal wording ("AuthThrottlerGuard overrides
// getTracker()"): @nestjs/throttler v6 invokes ONE shared `getTracker(req)`
// call per registered named throttler on every request (see canActivate's
// loop in the installed package) — a single class-level override has no way
// to tell which named throttler it's currently being called for, so it
// cannot make "auth-identity hashes the email, auth-ip stays IP-only, all
// the others differ too" true with one function. The library's actual,
// documented mechanism for that is a per-throttler `getTracker` on that
// throttler's own config object (`namedThrottler.getTracker` takes
// precedence over the class-level one) — buildAuthThrottlerConfigs() below
// is where that lives; AUTH_IDENTITY_TRACKER and IMPERSONATION_TRACKER are
// the two throttlers that need something other than the base class's
// default IP tracker.
//
// Also load-bearing and NOT mentioned by name in the plan: without an
// opt-in gate, @nestjs/throttler applies every registered named throttler
// to every route by default (only `@Throttle`/`@SkipThrottle` per-route
// metadata tunes an ALREADY-applied throttler's limit/ttl — it doesn't, by
// itself, make an unlisted throttler skip). Registering `auth-ip` (20/15min)
// globally without a gate would silently impose that same 20-requests-per-
// 15-minutes ceiling on every unrelated authenticated route in the app
// (e.g. GET /users pagination), which is not what api §0.6 describes
// ("Endpoints with none listed fall through to the global default limiter
// only"). `skipIf` on each non-default throttler checks for the presence of
// that throttler's own `@Throttle({...})` metadata on the route and skips
// evaluating it entirely when absent — this is what makes the opt-in real.
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Never store/log a raw email as a throttler key (arch §12) — hash it,
// scoped to the route so the same email hitting two different endpoints
// (login vs forgot-password) doesn't share one counter.
export function authIdentityTracker(req: Record<string, unknown>): string {
  const body = req.body as { email?: unknown } | undefined;
  const email = typeof body?.email === 'string' ? normalizeEmail(body.email) : '';
  const route = (req as { route?: { path?: string }; path?: string }).route?.path ?? (req as { path?: string }).path ?? '';
  return sha256(`${route}:${email}`);
}

// Decodes a JWT's payload without verifying its signature — deliberately:
// this is a rate-limit bucket KEY, not an authorization decision. A forged
// `sub` just buys the caller their own throttle bucket; JwtAuthGuard still
// rejects the token itself with 401 immediately afterward regardless of
// which bucket it was counted against. Same trust level authIdentityTracker
// already gives the raw, unverified `req.body.email`.
function decodeJwtSubUnsafe(token: string): string | undefined {
  try {
    const payloadSegment = token.split('.')[1];
    if (!payloadSegment) {
      return undefined;
    }
    const payload = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8')) as { sub?: unknown };
    return typeof payload.sub === 'string' ? payload.sub : undefined;
  } catch {
    return undefined;
  }
}

// Bug found while implementing Phase 7 (the first real consumer of this
// named limiter — Task 7.1's `POST /impersonation/start`): `AuthContext` is
// NEVER populated when this tracker runs. `AuthThrottlerGuard` is pipeline
// position 1 (arch §5 step 4); `JwtAuthGuard`, the guard that actually sets
// `request.authContext`, is position 2 (step 5) — strictly AFTER. So in the
// real app `authContext` is always `undefined` here, and every caller fell
// into the `'anonymous'` fallback, making "10/h, keyed by adminUserId"
// (arch §12) a single GLOBAL 10-per-hour bucket shared by every admin
// instead. The existing unit tests above only ever exercised this function
// directly with a hand-built `{authContext: {...}}` object, which is why
// this went unnoticed since Task 2.7 — nothing had called the real endpoint
// through the real pipeline until now. Fixed by falling back to reading
// `sub` straight off the bearer token when `authContext` isn't there yet,
// rather than reordering the global guard pipeline (out of this task's
// scope and would touch every other named limiter too).
export function impersonationTracker(req: Record<string, unknown>): string {
  const authContext = (req as unknown as AuthenticatedRequest).authContext;
  if (authContext?.userId) {
    return authContext.userId;
  }

  const header = (req as { headers?: Record<string, unknown> }).headers?.authorization;
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  return (token && decodeJwtSubUnsafe(token)) ?? 'anonymous';
}

const FIFTEEN_MINUTES_MS = 15 * 60_000;
const ONE_HOUR_MS = 60 * 60_000;

// `THROTTLER:LIMIT` matches @nestjs/throttler's internal Reflect metadata
// key prefix used by its `@Throttle()` decorator (verified against the
// pinned `^6.7.0` install — not part of the package's public API/index.d.ts,
// so this needs re-checking on any throttler major-version bump).
const THROTTLER_LIMIT_METADATA_PREFIX = 'THROTTLER:LIMIT';

function routeDeclaresThrottler(name: string, context: ExecutionContext): boolean {
  const key = `${THROTTLER_LIMIT_METADATA_PREFIX}${name}`;
  return Reflect.hasMetadata(key, context.getHandler()) || Reflect.hasMetadata(key, context.getClass());
}

function optInSkip(name: string) {
  return (context: ExecutionContext) => !routeDeclaresThrottler(name, context);
}

export function buildAuthThrottlerConfigs(): ThrottlerOptions[] {
  return [
    { name: 'default', ttl: 60_000, limit: 300 },
    { name: 'auth-ip', ttl: FIFTEEN_MINUTES_MS, limit: 20, skipIf: optInSkip('auth-ip') },
    {
      name: 'auth-identity',
      ttl: FIFTEEN_MINUTES_MS,
      limit: 5,
      skipIf: optInSkip('auth-identity'),
      getTracker: authIdentityTracker,
    },
    { name: 'token-consume', ttl: FIFTEEN_MINUTES_MS, limit: 10, skipIf: optInSkip('token-consume') },
    {
      name: 'impersonation',
      ttl: ONE_HOUR_MS,
      limit: 10,
      skipIf: optInSkip('impersonation'),
      getTracker: impersonationTracker,
    },
  ];
}

@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {}
