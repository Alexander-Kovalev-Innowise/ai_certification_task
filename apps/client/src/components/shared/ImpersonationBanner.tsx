'use client';

import { useEffect, useRef, useState } from 'react';

import { publicApiRequest, refreshSession } from '../../lib/api/apiClient';
import { decodeAccessTokenPayload } from '../../lib/api/decodeAccessToken';
import { useAuthStore } from '../../stores/useAuthStore';

import { Button } from './Button';

const TICK_MS = 1_000;
const WARNING_THRESHOLD_MS = 5 * 60 * 1000;
// fe §1.3 — "banner slides down from translateY(-100%) on entry, up on
// exit, 240ms — deliberately slower/heavier than the context-switch fade."
const SLIDE_MS = 240;

/**
 * `ApprovalCard.tsx`'s `useNow` pattern (Task 14.8), reused verbatim here —
 * itself following `lib/api/authSession.ts`'s `Date.now()` convention: the
 * initial read happens inside `useState`'s lazy initializer (evaluated once,
 * at mount, not on every render — what `react-hooks/purity` actually
 * flags), every subsequent read happens inside a `setInterval` callback (a
 * timer callback, not render).
 */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * fe §5.1's three-step exit sequence, shared by the auto-exit-at-0 path and
 * the manual "Exit Impersonation" click:
 *   1. POST /impersonation/end (best-effort — api §2 documents this may
 *      itself 401 if the impersonation token is already past its 60-minute
 *      cap; the client proceeds regardless, so the response is never
 *      inspected).
 *   2. discard the impersonation access token client-side.
 *   3. POST /auth/refresh on the admin's own, untouched refresh cookie.
 *
 * Deliberately uses `publicApiRequest`, not `apiRequest`: a 401 here is an
 * *expected*, best-effort outcome, and `apiRequest`'s built-in
 * 401-retry/clear/redirect-to-/login handling would otherwise hijack the
 * exact "recover the admin's own session" flow this function exists to run.
 *
 * Step 2 (`clear()`) must run BEFORE step 3 (`refreshSession()`):
 * `refreshSession()` itself short-circuits to `false` while
 * `useAuthStore.getState().isImpersonating` is still `true` (fe §6.2, since
 * an impersonation session has no refresh token behind it to rotate) —
 * clearing first is what makes step 3 a real network call again.
 */
async function runExitSequence(): Promise<void> {
  try {
    await publicApiRequest('/impersonation/end', { method: 'POST' });
  } catch {
    // Best-effort (api §2) — a network failure here must not block
    // recovering the admin's own session in steps 2-3.
  }
  useAuthStore.getState().clear();
  await refreshSession();
}

// fe §5.1 — fixed top bar mounted at the ROOT boundary (BootSequence.tsx,
// Task 16.1 replacing its `ImpersonationBannerSlot` placeholder from Task
// 10.8), not a role layout: a Super Admin impersonating a Trainer renders
// *inside* the target's own role layout, so this has to sit above that
// entire subtree. Renders nothing when not impersonating. Task 16.3 wires
// this end-to-end with `ImpersonateConfirmModal` (Task 12.6) — see
// `ImpersonationFlow.spec.tsx`: the modal's `POST /impersonation/start`
// populates `useAuthStore`, and this component appears immediately off
// that same store update (no fetch of its own), then its own manual "Exit
// Impersonation" runs the identical 3-step sequence as the auto-exit-at-0
// path below.
export function ImpersonationBanner() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const user = useAuthStore((state) => state.user);
  const now = useNow(TICK_MS);

  // Guards against the effect below re-firing `runExitSequence()` on every
  // subsequent tick while the exit is still in flight (clearing the store
  // is asynchronous — it only happens once `POST /impersonation/end`
  // resolves). A ref, not state: resetting it is folded into the same
  // effect rather than a second state-syncing effect (`react-hooks/
  // set-state-in-effect`), and it carries no re-render of its own.
  const exitTriggeredRef = useRef(false);

  // fe §5.1 — state source: the presence of an `act` claim (api §2) in the
  // decoded in-memory access token. Never a separate fetch; decoding is a
  // pure, display-only read, never trusted for authorization (the server
  // re-derives everything from the signed token on every request).
  const payload = accessToken ? decodeAccessTokenPayload(accessToken) : null;
  const isImpersonating = !!payload?.act;
  const remainingMs = payload ? payload.exp * 1000 - now : 0;

  // fe §1.3/Task 18.5 — "slides down from translateY(-100%) on entry, up on
  // exit, 240ms". `isImpersonating`/`user`/`remainingMs` above are derived
  // fresh from the CURRENT store every render, so by the moment the exit
  // sequence clears the store they no longer describe the session that's
  // leaving. `liveViewRef` mirrors the last real impersonation view into a
  // ref from inside an effect (never read during render — `react-hooks/refs`
  // disallows that); `exitSnapshot` (real state) is populated from that ref,
  // also inside an effect, at the exact render where `isImpersonating` flips
  // to `false` — this is what lets the banner keep showing the correct
  // target user/countdown while it slides away, instead of the admin's own
  // session (already live in the store by then) or nothing at all.
  const liveViewRef = useRef<{ user: NonNullable<typeof user>; remainingMs: number } | null>(null);
  useEffect(() => {
    if (isImpersonating && user) {
      liveViewRef.current = { user, remainingMs };
    }
  });

  const [exitSnapshot, setExitSnapshot] = useState<{ user: NonNullable<typeof user>; remainingMs: number } | null>(null);
  const [mounted, setMounted] = useState(isImpersonating);
  const [entered, setEntered] = useState(isImpersonating);

  // `react-hooks/set-state-in-effect` disallows calling setState
  // synchronously in an effect's own body — every setState call below is
  // deferred into a `requestAnimationFrame`/`setTimeout` callback instead
  // (the rule's own sanctioned shape: "calling setState in a callback
  // function when external state changes"), which is also what a genuine
  // one-frame-delay entrance animation needs anyway (the browser must paint
  // the `-translate-y-full` starting position before the transition to
  // `translate-y-0` can animate rather than snap).
  useEffect(() => {
    if (isImpersonating) {
      const raf = requestAnimationFrame(() => {
        setMounted(true);
        setEntered(true);
      });
      return () => cancelAnimationFrame(raf);
    }
    const raf = requestAnimationFrame(() => {
      setExitSnapshot(liveViewRef.current);
      setEntered(false);
    });
    const timeout = setTimeout(() => setMounted(false), SLIDE_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
  }, [isImpersonating]);

  useEffect(() => {
    if (!isImpersonating) {
      exitTriggeredRef.current = false;
      return;
    }
    if (remainingMs <= 0 && !exitTriggeredRef.current) {
      exitTriggeredRef.current = true;
      void runExitSequence();
    }
  }, [isImpersonating, remainingMs]);

  if (!mounted) {
    return null;
  }

  const view = isImpersonating && user ? { user, remainingMs } : exitSnapshot;
  if (!view) {
    return null;
  }

  const isWarning = view.remainingMs > 0 && view.remainingMs <= WARNING_THRESHOLD_MS;

  function handleManualExit() {
    exitTriggeredRef.current = true;
    void runExitSequence();
  }

  return (
    <div
      data-testid="impersonation-banner"
      className={`sticky top-0 z-40 flex flex-wrap items-center justify-center gap-md bg-[var(--danger)] px-lg py-xs text-caption font-semibold text-[#0D0D0D] transition-transform ease-out motion-reduce:transition-none ${
        entered ? 'translate-y-0' : '-translate-y-full'
      } ${isWarning ? 'animate-pulse motion-reduce:animate-none' : ''}`}
      style={{ transitionDuration: `${SLIDE_MS}ms` }}
    >
      <span>
        Viewing as {view.user.firstName} {view.user.lastName} ({view.user.role})
      </span>
      <span aria-hidden="true">·</span>
      <span data-testid="impersonation-countdown" className="font-numeric" style={isWarning ? { color: 'var(--warning)' } : undefined}>
        {formatCountdown(view.remainingMs)}
      </span>
      {isWarning && (
        <span role="alert" style={{ color: 'var(--warning)' }}>
          Session ending soon
        </span>
      )}
      <span aria-hidden="true">·</span>
      <Button
        variant="secondary"
        onClick={handleManualExit}
        className="border-[#0D0D0D]/40 text-caption text-[#0D0D0D] underline hover:border-[#0D0D0D]/70 hover:text-[#0D0D0D]"
      >
        Exit Impersonation
      </Button>
    </div>
  );
}
