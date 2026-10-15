'use client';

import type { PlayerProfileSummary } from './ProfileCardGrid';

export interface AvailabilityProfileSwitcherProps {
  profiles: readonly PlayerProfileSummary[];
  /** The profile whose Best Times are currently shown. */
  currentProfileId: string;
  onChange: (profileId: string) => void;
}

// US-01.09 — the parent can hop between their own and their children's
// Best Times grids without going back to the profile list. The parent's own
// profile reads "Me"; children use their name. Hidden when there is nothing to
// switch to.
export function AvailabilityProfileSwitcher({ profiles, currentProfileId, onChange }: AvailabilityProfileSwitcherProps) {
  if (profiles.length < 2) {
    return null;
  }

  return (
    <div className="flex flex-col gap-xxs sm:max-w-[16rem]">
      <label htmlFor="availability-profile-switcher" className="field-label">
        Profile
      </label>
      <select
        id="availability-profile-switcher"
        className="w-full min-w-0"
        value={currentProfileId}
        onChange={(event) => onChange(event.target.value)}
      >
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.isSelf ? 'Me' : profile.name}
          </option>
        ))}
      </select>
    </div>
  );
}
