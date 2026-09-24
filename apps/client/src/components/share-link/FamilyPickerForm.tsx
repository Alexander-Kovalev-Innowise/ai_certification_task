'use client';

import { useEffect, useState } from 'react';

import { apiRequest } from '../../lib/api/apiClient';

export interface FamilyPickerFormProps {
  trainerDisplayName: string;
  onSubmit: (body: { subjectProfileIds: string[] }) => void;
  isSubmitting?: boolean;
  submitError?: string | null;
}

// api §4.3 GET /player-profiles response — only the fields this checklist
// needs (the full PlayerProfileResponseDto carries more).
interface PlayerProfileOption {
  id: string;
  name: string;
  isSelf: boolean;
}

// fe §4.2 — "access token present, role=PLAYER_PARENT, accountType=ADULT →
// render <FamilyPickerForm> ('Who will train with {trainerDisplayName}?' —
// Me + each child, FR-021) → submits ASSOCIATE_EXISTING
// { subjectProfileIds }". The checklist itself is sourced from `GET
// /player-profiles` (self + children) — never invented client-side.
export function FamilyPickerForm({ trainerDisplayName, onSubmit, isSubmitting = false, submitError = null }: FamilyPickerFormProps) {
  const [profiles, setProfiles] = useState<PlayerProfileOption[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    apiRequest('/player-profiles')
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`GET /player-profiles failed with status ${res.status}`);
        }
        const items = (await res.json()) as PlayerProfileOption[];
        if (!cancelled) {
          setProfiles(items.map((item) => ({ id: item.id, name: item.name, isSelf: item.isSelf })));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((existing) => existing !== id) : [...prev, id]));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    onSubmit({ subjectProfileIds: selectedIds });
  }

  if (loadFailed) {
    return (
      <p role="alert" className="text-body text-[var(--danger)]">
        Couldn&apos;t load your family profiles. Please try again.
      </p>
    );
  }

  if (!profiles) {
    return (
      <p role="status" aria-live="polite" className="text-body text-[var(--text-secondary)]">
        Loading your profiles…
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-md">
      <fieldset className="flex flex-col gap-xxs">
        <legend className="text-body text-[var(--text-secondary)]">Who will train with {trainerDisplayName}?</legend>
        {profiles.map((profile) => (
          <label key={profile.id} className="flex items-center gap-xs text-body text-[var(--text-primary)]">
            <input type="checkbox" checked={selectedIds.includes(profile.id)} onChange={() => toggle(profile.id)} />
            {profile.isSelf ? 'Me' : profile.name}
          </label>
        ))}
      </fieldset>

      {submitError && (
        <p role="alert" className="text-body text-[var(--danger)]">
          {submitError}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting || selectedIds.length === 0}
        className="rounded-sm bg-[var(--brand-primary)] p-sm text-body font-semibold text-[#0D0D0D] shadow-button-primary disabled:opacity-60"
      >
        {isSubmitting ? 'Connecting…' : 'Connect'}
      </button>
    </form>
  );
}
