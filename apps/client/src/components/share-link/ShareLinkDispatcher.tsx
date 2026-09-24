'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { apiRequest } from '../../lib/api/apiClient';
import { parseApiErrorBody } from '../../lib/api/apiError';
import { toAuthSession } from '../../lib/api/authSession';
import { useAuthStore } from '../../stores/useAuthStore';
import type { AuthSessionResponseDto, UserSummaryDto } from '../../types/auth';

import { AnonymousJoinForm, type AnonymousJoinRequestBody } from './AnonymousJoinForm';
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
}

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
export function ShareLinkDispatcher({ code }: ShareLinkDispatcherProps) {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const setSession = useAuthStore((state) => state.setSession);
  const [stage, setStage] = useState<Stage>({ kind: 'pending' });

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

  if (stage.kind === 'pending') {
    return (
      <div role="status" aria-live="polite" className="text-body text-[var(--text-secondary)]">
        Loading invitation…
      </div>
    );
  }

  if (stage.kind === 'invalid') {
    return <ShareLinkInvalidCard reason={stage.reason} />;
  }

  if (stage.kind === 'resolved') {
    return (
      <p role="status" className="text-body text-[var(--text-primary)]">
        {stage.message}
      </p>
    );
  }

  const { preview } = stage;
  const submitError = stage.kind === 'ready' ? stage.submitError : null;
  const isSubmitting = stage.kind === 'submitting';
  const branch = selectBranch(user, preview.type ?? 'PLAYER_STATIC');

  function handleAnonymousSubmit(body: AnonymousJoinRequestBody) {
    void submitRedeem(preview, body);
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
      {branch === 'anonymous' && (
        <AnonymousJoinForm
          type={preview.type ?? 'PLAYER_STATIC'}
          onSubmit={handleAnonymousSubmit}
          isSubmitting={isSubmitting}
          submitError={submitError}
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
      {branch === 'child-blocked' && <ChildBlockedNotice />}
      {branch === 'role-cannot-join' && <RoleCannotJoinNotice />}
      {branch === 'unsupported' && <RoleCannotJoinNotice />}
    </ShareLinkPreview>
  );
}
