'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { useTrainerContextStore } from '../../stores/useTrainerContextStore';
import type { AccountType } from '../../types/auth';

// api §4.3 "GET /me/contexts" ContextEntryDto, reproduced verbatim — also
// the shape of each entry in GET /me/bootstrap's `contexts[]`/`activeContext`
// (PlayerParentBootstrapDto), which is this component's real data source
// (fe §5.2: "never invents context data client-side").
export interface ContextEntry {
  playerProfileId: string;
  playerProfileName: string;
  isSelf: boolean;
  trainerId: string;
  trainerDisplayName: string;
  logoUrl: string | null;
  primaryColorHex: string | null;
  connectedAt: string;
}

const TENANT_CONTEXT_INVALID_EVENT = 'pp:trainer-context-invalid';

/**
 * fe §5.2 point 3 — any call site that receives a `403
 * TENANT_CONTEXT_INVALID` on a trainer-scoped request calls this instead of
 * silently retrying. A window `CustomEvent`, not a prop/callback threaded
 * through every Phase 14 page: the set of call sites that can hit this
 * (every trainer-scoped request built across Tasks 14.2-14.9) has no direct
 * relationship with `ContextSwitcher` — it's mounted once in
 * `(player)/layout.tsx`, they're its layout children, several levels away.
 */
export function notifyTenantContextInvalid(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(TENANT_CONTEXT_INVALID_EVENT));
  }
}

export interface ContextSwitcherProps {
  accountType: AccountType;
  contexts: ContextEntry[];
  activeContext: ContextEntry | null;
}

function contextKey(entry: Pick<ContextEntry, 'playerProfileId' | 'trainerId'>): string {
  return `${entry.playerProfileId}::${entry.trainerId}`;
}

interface ProfileGroup {
  profileId: string;
  profileName: string;
  trainers: string[];
}

function groupByProfile(entries: ContextEntry[]): ProfileGroup[] {
  const order: string[] = [];
  const map = new Map<string, ProfileGroup>();
  for (const entry of entries) {
    let group = map.get(entry.playerProfileId);
    if (!group) {
      group = { profileId: entry.playerProfileId, profileName: entry.playerProfileName, trainers: [] };
      map.set(entry.playerProfileId, group);
      order.push(entry.playerProfileId);
    }
    group.trainers.push(entry.trainerDisplayName);
  }
  return order.map((id) => map.get(id) as ProfileGroup);
}

function currentLabel(current: ContextEntry | null, accountType: AccountType): string {
  if (!current) {
    return 'Select a trainer';
  }
  if (accountType === 'CHILD') {
    return current.trainerDisplayName;
  }
  return current.isSelf ? `${current.playerProfileName} (Me) → ${current.trainerDisplayName}` : `${current.playerProfileName} → ${current.trainerDisplayName}`;
}

const SELECT_CLASSNAME =
  'rounded-sm border border-[var(--border-soft)] bg-[var(--surface-0)] p-xxs text-body text-[var(--text-primary)] outline-none focus:border-[var(--brand-primary)]';

/**
 * fe §5.2/Epic-01 spec §US-01.04 — mounted once in `(player)/layout.tsx`.
 * Renders one of three documented formats, chosen by `accountType` and
 * whether any context has `isSelf: true`:
 *
 *  - `accountType: 'CHILD'` → "Child with own login" (FR-034: no "Me"/parent
 *    section at all, regardless of any entry's `isSelf` value).
 *  - `accountType: 'ADULT'` with at least one `isSelf: true` entry →
 *    "Parent who also trains" (Your Training + Your Children's Training).
 *  - `accountType: 'ADULT'` with no `isSelf: true` entry → "Parent who
 *    doesn't train" (Your Children's Training only).
 *
 * Note: the spec's mockup for the CHILD format annotates each trainer with a
 * parenthetical sport ("Coach Bob (Basketball)") — `ContextEntryDto` (api
 * §4.3, verified against the real DTO) carries no sport/discipline field, so
 * that annotation is dropped here rather than fabricated client-side.
 *
 * fe §1.3/Task 18.5 (motion confirmation pass) — the "180ms cross-fade when
 * the accent-color CSS variables change" lives in `globals.css`'s
 * `[data-branding], [data-branding] *` rule (Task 10.10), not in this
 * component: `handleSelect` below writes the new `activeTrainerId` to
 * `useTrainerContextStore`, `(player)/layout.tsx` re-renders `BrandingProvider`
 * with the new context's branding, and every descendant reading a
 * `var(--brand-primary...)` color/background/border/fill — including this
 * component's own `select`'s `focus:border-[var(--brand-primary)]` — eases
 * into the new value because it sits inside that `[data-branding]` wrapper.
 * Confirmed here rather than duplicated as component-local CSS, since the
 * transition needs to apply uniformly to everything under the wrapper, not
 * just this one component.
 */
export function ContextSwitcher({ accountType, contexts, activeContext }: ContextSwitcherProps) {
  const queryClient = useQueryClient();
  const activeTrainerId = useTrainerContextStore((state) => state.activeTrainerId);
  const setActiveTrainerId = useTrainerContextStore((state) => state.setActiveTrainerId);
  const [reconnectMessage, setReconnectMessage] = useState<string | null>(null);

  useEffect(() => {
    function handleInvalid() {
      setReconnectMessage('This connection is no longer active.');
      // fe §5.2 point 3 — GET /me/bootstrap carries the same
      // contexts/activeContext shape as GET /me/contexts (§4.3); refetching
      // it is this app's "forced /me/contexts refetch" since every Phase 14
      // layout already sources its context list from bootstrap, not a
      // separate query.
      void queryClient.invalidateQueries({ queryKey: ['me', 'bootstrap'] });
    }
    window.addEventListener(TENANT_CONTEXT_INVALID_EVENT, handleInvalid);
    return () => window.removeEventListener(TENANT_CONTEXT_INVALID_EVENT, handleInvalid);
  }, [queryClient]);

  const current =
    contexts.find((entry) => entry.trainerId === activeTrainerId) ??
    (activeContext && contexts.find((entry) => contextKey(entry) === contextKey(activeContext))) ??
    contexts[0] ??
    null;

  function handleSelect(key: string) {
    const next = contexts.find((entry) => contextKey(entry) === key);
    if (!next) {
      return;
    }
    setReconnectMessage(null);
    setActiveTrainerId(next.trainerId);
    // fe §5.2 point 1/§6.3 — every subsequent request must pick up the new
    // X-Trainer-Context; invalidating the whole cache (not a hand-picked
    // list of "trainer-scoped" keys — no such registry exists) is what
    // guarantees stale data from the previous context can't flash before the
    // new context's data loads.
    void queryClient.invalidateQueries();
  }

  const selfEntries = accountType === 'CHILD' ? [] : contexts.filter((entry) => entry.isSelf);
  const childEntries = accountType === 'CHILD' ? [] : contexts.filter((entry) => !entry.isSelf);
  const selfGroups = groupByProfile(selfEntries);
  const childGroups = groupByProfile(childEntries);

  return (
    <div className="flex flex-col gap-xs border-b border-[var(--border-soft)] bg-[var(--surface-1)] p-md">
      {reconnectMessage && (
        <p role="alert" className="text-caption text-[var(--danger)]">
          {reconnectMessage}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-sm">
        <label htmlFor="context-switcher-select" className="text-caption text-[var(--text-secondary)]">
          Current:
        </label>
        <select
          id="context-switcher-select"
          aria-label="Active trainer context"
          className={SELECT_CLASSNAME}
          value={current ? contextKey(current) : ''}
          onChange={(event) => handleSelect(event.target.value)}
        >
          {contexts.length === 0 && <option value="">No trainers yet</option>}

          {accountType === 'CHILD'
            ? contexts.map((entry) => (
                <option key={contextKey(entry)} value={contextKey(entry)}>
                  {entry.trainerDisplayName}
                </option>
              ))
            : [
                selfEntries.length > 0 && (
                  <optgroup key="self" label="Your Training">
                    {selfEntries.map((entry) => (
                      <option key={contextKey(entry)} value={contextKey(entry)}>
                        {entry.playerProfileName} (Me) → {entry.trainerDisplayName}
                      </option>
                    ))}
                  </optgroup>
                ),
                childEntries.length > 0 && (
                  <optgroup key="children" label="Your Children's Training">
                    {childEntries.map((entry) => (
                      <option key={contextKey(entry)} value={contextKey(entry)}>
                        {entry.playerProfileName} → {entry.trainerDisplayName}
                      </option>
                    ))}
                  </optgroup>
                ),
              ]}
        </select>
        <span data-testid="context-switcher-current" className="text-body font-semibold text-[var(--text-primary)]">
          {currentLabel(current, accountType)}
        </span>
      </div>

      {accountType === 'CHILD' ? (
        contexts.length > 0 && (
          <p className="text-caption text-[var(--text-secondary)]">Your Training: {contexts.map((entry) => entry.trainerDisplayName).join(' · ')}</p>
        )
      ) : (
        <>
          {selfGroups.length > 0 && (
            <p className="text-caption text-[var(--text-secondary)]">
              Your Training: {selfGroups.map((group) => `${group.profileName} (Me) → ${group.trainers.join(' / ')}`).join(' · ')}
            </p>
          )}
          {childGroups.length > 0 && (
            <p className="text-caption text-[var(--text-secondary)]">
              Your Children&apos;s Training: {childGroups.map((group) => `${group.profileName} → ${group.trainers.join(', ')}`).join(' · ')}
            </p>
          )}
        </>
      )}
    </div>
  );
}
