'use client';

import { useQuery } from '@tanstack/react-query';

import { apiRequest } from '../lib/api/apiClient';
import type { AccountType, Role } from '../types/auth';

// Mirrors apps/server/src/modules/users/dto/me-response.dto.ts's
// MeResponseDto verbatim (Task 2.22) — hand-kept mirror, same documented
// tradeoff as types/auth.ts's UserSummaryDto (arch §1: no build-time
// dependency on server code).
export interface MeProfile {
  id: string;
  email: string;
  role: Role;
  accountType: AccountType;
  firstName: string;
  lastName: string;
  phone: string | null;
  photoUrl: string | null;
  emailVerified: boolean;
  mustChangePassword: boolean;
  createdAt: string;
}

async function fetchMe(): Promise<MeProfile> {
  const res = await apiRequest('/me');

  if (!res.ok) {
    throw new Error(`GET /me failed with status ${res.status}`);
  }

  return (await res.json()) as MeProfile;
}

// fe §3/§7.2/§9.2 — `GET /me`'s single shared query entry point. Both
// `/account/profile` (AccountProfileForm, Task 18.1) and `EmailVerifiedBanner`
// (Task 18.2) read this same `['me']` key so TanStack Query dedupes the two
// mount sites into one request rather than each firing its own — the same
// "one round trip" reasoning `useBootstrap` already documents for
// `GET /me/bootstrap`. Deliberately a separate query key/hook from
// `useBootstrap`: bootstrap's per-role `user: UserSummaryDto` shape doesn't
// carry `emailVerified`/`phone` (verified against
// apps/server/.../auth-session-response.dto.ts), so there is no bootstrap
// field this could read instead.
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: fetchMe,
  });
}
