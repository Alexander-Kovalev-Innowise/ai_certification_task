'use client';

import { skillLevelLabel } from '../../lib/skillLevel';

// api §4.3 GET /player-profiles — `PlayerProfileResponseDto[]` (each entry
// includes a `trainerCount` summary, not full trainer objects, api §4.3).
export interface PlayerProfileSummary {
  id: string;
  name: string;
  isSelf: boolean;
  trainerCount?: number;
  photoUrl?: string | null;
  /** Trainer-set, read-only here (spec US-01.11). */
  skillLevel?: string;
}

export interface ProfileCardGridProps {
  profiles: PlayerProfileSummary[];
  /** `false` for a `typ: CHILD` session — `MANAGE_CHILD_PROFILES` is CHILD-denied (api §4.3). */
  canAddChild: boolean;
  onAddChild: () => void;
}

const DEFAULT_PHOTO_URL = '/default_logo.svg';

// fe §4.6 — ProfileCardGrid: `/profiles`' self + children grid. Each card
// links to `/profiles/[id]` (Task 14.4); "+Add Child" opens `ChildProfileForm`
// at the page level. Task 14.3.
export function ProfileCardGrid({ profiles, canAddChild, onAddChild }: ProfileCardGridProps) {
  return (
    <div className="flex flex-col gap-md">
      <div className="flex flex-wrap gap-md">
        {profiles.map((profile) => (
          <a
            key={profile.id}
            href={`/profiles/${profile.id}`}
            aria-label={profile.name}
            className="flex w-48 flex-col gap-xxs rounded-md border border-border-soft bg-surface-1 p-md shadow-card-soft hover:border-brand-primary"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- per-profile, user-supplied photo URL; not a fixed remote-pattern host */}
            <img
              src={profile.photoUrl ?? DEFAULT_PHOTO_URL}
              alt=""
              aria-hidden="true"
              className="h-12 w-12 rounded-full object-cover"
            />
            <span className="text-body-lg font-semibold text-text-primary">{profile.name}</span>
            {profile.isSelf && <span className="text-caption text-brand-link">Me</span>}
            {profile.skillLevel && <span className="text-caption text-text-secondary">Skill: {skillLevelLabel(profile.skillLevel)}</span>}
            {profile.trainerCount !== undefined && (
              <span className="text-caption text-text-secondary">
                {profile.trainerCount} {profile.trainerCount === 1 ? 'trainer' : 'trainers'}
              </span>
            )}
          </a>
        ))}

        {canAddChild && (
          <button
            type="button"
            onClick={onAddChild}
            className="flex w-48 flex-col items-center justify-center gap-xxs rounded-md border border-dashed border-border-soft p-md text-body-lg font-semibold text-text-secondary hover:border-brand-primary hover:text-brand-primary"
          >
            + Add Child
          </button>
        )}
      </div>
    </div>
  );
}
