'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { apiRequest, publicApiRequest } from '../../lib/api/apiClient';
import { parseApiErrorBody } from '../../lib/api/apiError';
import { toAuthSession } from '../../lib/api/authSession';
import { useAuthStore } from '../../stores/useAuthStore';
import type { AuthSessionResponseDto, UserSummaryDto } from '../../types/auth';

import { AnonymousJoinForm, type AnonymousJoinRequestBody } from './AnonymousJoinForm';
import type { CampPrefillResponse } from './campPrefill';
import { ChildBlockedNotice } from './ChildBlockedNotice';
import { CoachAcceptForm } from './CoachAcceptForm';
import { FamilyPickerForm } from './FamilyPickerForm';
import { RoleCannotJoinNotice } from './RoleCannotJoinNotice';
import { ShareLinkInvalidCard, type ShareLinkInvalidReason } from './ShareLinkInvalidCard';
import { ShareLinkPreview } from './ShareLinkPreview';

export type ShareLinkType = 'PLAYER_STATIC' | 'COACH_UNIQUE';

// api §4.4 GET /share-links/:code's exact response shape.
export interface ShareLinkPreviewResponse {
  valid: boolean;
  reason?: ShareLinkInvalidReason;
  type?: ShareLinkType;
  trainerDisplayName?: string;
  logoUrl?: string | null;
  primaryColorHex?: string | null;
}

// fe §4.2 — the auth-state x link-type branch selection table, reproduced
// exactly. `unsupported` covers combinations the deep-dive table doesn't
// name at all (e.g. an authenticated COACH visiting a PLAYER_STATIC link) —
// there is no server branch such a submission could resolve to either, so
// this never attempts a redeem call, matching the CHILD/TRAINER
// pre-emption pattern's spirit of "don't call an endpoint whose outcome is
// already known to be unusable."
type Branch = 'anonymous' | 'family-picker' | 'child-blocked' | 'coach-accept' | 'role-cannot-join' | 'unsupported';

function selectBranch(user: UserSummaryDto | null, linkType: ShareLinkType): Branch {
  if (!user) {
    return linkType === 'PLAYER_STATIC' || linkType === 'COACH_UNIQUE' ? 'anonymous' : 'unsupported';
  }
  if (user.accountType === 'CHILD') {
    return 'child-blocked';
  }
  if (user.role === 'TRAINER' || user.role === 'SUPER_ADMIN') {
    return 'role-cannot-join';
  }
  if (user.role === 'PLAYER_PARENT') {
    return 'family-picker';
  }
  if (user.role === 'COACH' && linkType === 'COACH_UNIQUE') {
    return 'coach-accept';
  }
  return 'unsupported';
}

// fe §4.2 — "pending → previewed → {branch} → submitting →
// {resolved|race-retry}". `race-retry` is folded back into a fresh
// `pending` re-fetch (Task 11.10's "re-fetch stage 1's GET to pick up the
// now-EXHAUSTED reason") rather than a distinct rendered state.
type Stage =
  | { kind: 'pending' }
  | { kind: 'invalid'; reason?: ShareLinkInvalidReason }
  | { kind: 'ready'; preview: ShareLinkPreviewResponse; submitError: string | null }
  | { kind: 'submitting'; preview: ShareLinkPreviewResponse }
  | { kind: 'resolved'; message: string };

export interface ShareLinkDispatcherProps {
  code: string;
  /** `?camp=<token>` from a camp/evaluation sign-up (Camp-to-User Conversion): pre-fills the registration. */
  campToken?: string | null;
}

// Camp conversion token state: 'none' (no token / not applicable), 'loading', 'ready' (prefill fetched) or
// 'unavailable' (expired / already used / unknown / network) - the latter falls back to the ordinary empty form.
type CampState =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'ready'; data: CampPrefillResponse }
  | { kind: 'unavailable'; message: string };

const CAMP_UNAVAILABLE_MESSAGES = {
  expired: 'Your camp sign-up link has expired, so we could not pre-fill the form. Please fill in your details below.',
  used: 'This camp sign-up link was already used or is not valid, so we could not pre-fill the form. Please fill in your details below.',
} as const;

const DASHBOARD_PATH = '/dashboard';
const RESOLVED_REDIRECT_DELAY_MS = 900;

// fe §4.2 (deep dive) — the orchestrating state machine for /join/[code].
// On mount: GET /share-links/:code, which per api §4.4 ALWAYS resolves 200
// (even an unknown code) — this component must never let that turn into a
// thrown exception or a Next.js not-found boundary (fe §9.3), so both a
// non-ok HTTP status and an outright network failure are handled as DATA
// (render ShareLinkInvalidCard), not re-thrown. On submit (Task 11.10):
// POST /share-links/:code/redeem with the branch-specific body, routing
// every response per fe §4.2's table.
export function ShareLinkDispatcher({ code, campToken = null }: ShareLinkDispatcherProps) {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const setSession = useAuthStore((state) => state.setSession);
  const [stage, setStage] = useState<Stage>({ kind: 'pending' });
  const [camp, setCamp] = useState<CampState>(campToken ? { kind: 'loading' } : { kind: 'none' });

  // Deliberately does NOT reset `stage` to 'pending' synchronously before
  // the fetch (react-hooks/set-state-in-effect flags a setState call that
  // happens synchronously inside a useEffect body, which the mount effect
  // below would trigger otherwise). The mount call needs no reset anyway —
  // `stage` already starts as 'pending' — and the race-retry call from
  // submitRedeem() intentionally leaves the last-known UI in place (rather
  // than flashing back to the bare loading spinner) until the re-fetch
  // resolves into either 'invalid' or a fresh 'ready'.
  const fetchPreview = useCallback(() => {
    apiRequest(`/share-links/${code}`)
      .then(async (res) => {
        if (!res.ok) {
          setStage({ kind: 'invalid' });
          return;
        }

        const preview = (await res.json()) as ShareLinkPreviewResponse;
        setStage(preview.valid ? { kind: 'ready', preview, submitError: null } : { kind: 'invalid', reason: preview.reason });
      })
      .catch(() => {
        setStage({ kind: 'invalid' });
      });
  }, [code]);

  useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  // Camp-to-User Conversion: fetch the stored camp sign-up so the registration form arrives pre-filled.
  // A bad token never blocks joining - it degrades to the normal empty form with an explanation.
  useEffect(() => {
    if (!campToken) {
      return;
    }
    let cancelled = false;
    publicApiRequest(`/camp-conversions/${encodeURIComponent(campToken)}`)
      .then(async (res) => {
        if (cancelled) {
          return;
        }
        if (res.ok) {
          setCamp({ kind: 'ready', data: (await res.json()) as CampPrefillResponse });
          return;
        }
        setCamp({ kind: 'unavailable', message: res.status === 410 ? CAMP_UNAVAILABLE_MESSAGES.expired : CAMP_UNAVAILABLE_MESSAGES.used });
      })
      .catch(() => {
        if (!cancelled) {
          setCamp({ kind: 'unavailable', message: CAMP_UNAVAILABLE_MESSAGES.used });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [campToken]);

  const submitRedeem = useCallback(
    async (preview: ShareLinkPreviewResponse, body: Record<string, unknown>) => {
      setStage({ kind: 'submitting', preview });

      const res = await apiRequest(`/share-links/${code}/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const contentType = res.headers.get('content-type') ?? '';
        const payload = contentType.includes('json') ? await res.json() : null;

        // 201 (or 200) with an AuthSessionResponseDto — ANONYMOUS_REGISTRATION
        // or an anonymous COACH_ACCEPT (both auto-login).
        if (payload && typeof payload === 'object' && 'accessToken' in payload) {
          const session = payload as AuthSessionResponseDto;
          setSession(toAuthSession(session));
          setStage({ kind: 'resolved', message: `Welcome, ${session.user.firstName}!` });
          return;
        }

        // 200 AssociatedProfileResultDto[] — ASSOCIATE_EXISTING. Verified
        // against share-link-redemption.service.ts: an array, one entry per
        // submitted profile (a deviation from the older spec prose's
        // "single object" framing) — nothing on it is needed for display
        // here beyond knowing the call succeeded.
        if (Array.isArray(payload)) {
          setStage({ kind: 'resolved', message: `Connected with ${preview.trainerDisplayName ?? 'your trainer'}` });
          return;
        }

        // 200 CoachAcceptResultDto ({ trainerId, status }) — COACH_ACCEPT
        // (authenticated).
        if (payload && typeof payload === 'object' && 'trainerId' in payload) {
          setStage({ kind: 'resolved', message: `Connected with ${preview.trainerDisplayName ?? 'your trainer'}` });
          return;
        }

        // Unrecognized-but-ok shape — treat as resolved rather than stuck.
        setStage({ kind: 'resolved', message: 'Done!' });
        return;
      }

      const errorBody = await parseApiErrorBody(res);

      // fe §4.2 — "409 SHARE_LINK_UNAVAILABLE → race condition ... re-fetch
      // step 1's GET to pick up the now-EXHAUSTED reason and re-render
      // ShareLinkInvalidCard, rather than showing a raw error toast."
      if (errorBody?.errorCode === 'SHARE_LINK_UNAVAILABLE') {
        fetchPreview();
        return;
      }

      // Pre-empted branches reachable only as a server-is-source-of-truth
      // fallback (fe §4.2) — the client normally never gets here because
      // ChildBlockedNotice/RoleCannotJoinNotice never call submitRedeem.
      if (errorBody?.errorCode === 'CHILD_SHARE_LINK_BLOCKED') {
        setStage({ kind: 'invalid', reason: undefined });
        return;
      }

      // The camp token was consumed/expired between the prefill and the submit: drop it, keep what the user typed
      // out of the picture and let them retry with the ordinary form.
      if ('conversionToken' in body && (res.status === 404 || res.status === 410)) {
        setCamp({ kind: 'unavailable', message: res.status === 410 ? CAMP_UNAVAILABLE_MESSAGES.expired : CAMP_UNAVAILABLE_MESSAGES.used });
        setStage({ kind: 'ready', preview, submitError: null });
        return;
      }

      setStage({
        kind: 'ready',
        preview,
        submitError: errorBody?.message ?? 'Something went wrong. Please try again.',
      });
    },
    [code, fetchPreview, setSession],
  );

  useEffect(() => {
    if (stage.kind !== 'resolved') {
      return;
    }
    const timer = setTimeout(() => router.push(DASHBOARD_PATH), RESOLVED_REDIRECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [stage, router]);

  if (stage.kind === 'pending' || camp.kind === 'loading') {
    return (
      <div role="status" aria-live="polite" className="text-body text-text-secondary">
        Loading invitation…
      </div>
    );
  }

  if (stage.kind === 'invalid') {
    return <ShareLinkInvalidCard reason={stage.reason} />;
  }

  if (stage.kind === 'resolved') {
    return (
      <p role="status" className="text-body text-text-primary">
        {stage.message}
      </p>
    );
  }

  const { preview } = stage;
  const submitError = stage.kind === 'ready' ? stage.submitError : null;
  const isSubmitting = stage.kind === 'submitting';
  const branch = selectBranch(user, preview.type ?? 'PLAYER_STATIC');

  const campPrefill = branch === 'anonymous' && preview.type !== 'COACH_UNIQUE' && camp.kind === 'ready' ? camp.data : null;

  function handleAnonymousSubmit(body: AnonymousJoinRequestBody) {
    void submitRedeem(preview, campPrefill && campToken ? { ...body, conversionToken: campToken } : body);
  }

  function handleFamilyPickerSubmit(body: { subjectProfileIds: string[] }) {
    void submitRedeem(preview, body);
  }

  function handleCoachAcceptSubmit() {
    void submitRedeem(preview, {});
  }

  return (
    <ShareLinkPreview
      trainerDisplayName={preview.trainerDisplayName ?? ''}
      logoUrl={preview.logoUrl ?? null}
      primaryColorHex={preview.primaryColorHex ?? null}
    >
      {branch === 'anonymous' && camp.kind === 'unavailable' && (
        <p role="status" className="mb-md rounded-md border border-border-soft bg-surface-2 p-md text-left text-body text-text-primary">
          {camp.message}
        </p>
      )}
      {branch === 'anonymous' && (
        <AnonymousJoinForm
          type={preview.type ?? 'PLAYER_STATIC'}
          onSubmit={handleAnonymousSubmit}
          isSubmitting={isSubmitting}
          submitError={submitError}
          signInHref={`/login?next=/join/${encodeURIComponent(code)}`}
          prefill={campPrefill?.prefill ?? null}
        />
      )}
      {branch === 'family-picker' && (
        <FamilyPickerForm
          trainerDisplayName={preview.trainerDisplayName ?? ''}
          onSubmit={handleFamilyPickerSubmit}
          isSubmitting={isSubmitting}
          submitError={submitError}
        />
      )}
      {branch === 'coach-accept' && (
        <CoachAcceptForm
          trainerDisplayName={preview.trainerDisplayName ?? ''}
          onSubmit={handleCoachAcceptSubmit}
          isSubmitting={isSubmitting}
          submitError={submitError}
        />
      )}
      {branch === 'child-blocked' && <ChildBlockedNotice code={code} />}
      {branch === 'role-cannot-join' && <RoleCannotJoinNotice />}
      {branch === 'unsupported' && <RoleCannotJoinNotice />}
    </ShareLinkPreview>
  );
}
