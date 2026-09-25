'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuthStore } from '../src/stores/useAuthStore';

const DASHBOARD_PATH = '/dashboard';
const LOGIN_PATH = '/login';

// fe §3/§4.1 route map — the literal root `/` has no content of its own; it
// only ever decides where to send a visitor. Root layout stays a Server
// Component (see layout.tsx's and BootSequence.tsx's own notes on the
// next-build-turbopack fix), so this redirect lives in a Client Component
// leaf exactly the way RoleGuard.tsx does, instead of adding a new
// middleware/proxy.ts or a server-side cookie read.
//
// Why not proxy.ts (Next.js 16 renamed `middleware.js` to `proxy.js`,
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/
// middleware.md) or a server-side cookie read: this app's auth state isn't
// itself the httpOnly refresh cookie — it's the in-memory access
// token/`useAuthStore.user` populated by `refreshSession()`
// (apiClient.ts/BootSequence.tsx), which only exists after that POST
// /auth/refresh round-trip resolves client-side. A proxy running on the
// edge/server would only ever see the *presence* of the refresh cookie, not
// whether it's actually valid (an expired/rotated cookie still "exists"),
// so it can't reliably distinguish signed-in from signed-out without
// duplicating the refresh call server-side — and BootSequence already makes
// exactly one such call per app load. Piggy-backing on that established
// client-side result (same source of truth RoleGuard already reads) is
// simpler and avoids two independent auth checks disagreeing with each
// other.
//
// By the time this component mounts, BootSequence has already gated
// rendering of `children` on its refresh-on-mount check resolving (it shows
// its own full-screen loading state until then), so `useAuthStore().user`
// here already reflects the final post-boot auth state — no separate
// loading branch is needed in this leaf.
export default function HomePage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    router.replace(user ? DASHBOARD_PATH : LOGIN_PATH);
  }, [user, router]);

  return null;
}
