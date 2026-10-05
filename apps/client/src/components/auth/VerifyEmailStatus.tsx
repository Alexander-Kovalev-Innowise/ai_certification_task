'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { publicApiRequest } from '../../lib/api/apiClient';

type Status = 'checking' | 'verified' | 'invalid';

const inFlightVerifications = new Map<string, Promise<boolean>>();

// fe §4.1 "/verify-email?token=" (api §1 POST /auth/verify-email) — a
// landing confirmation only, never a gate: architecture §6.5 is explicit
// that no guard anywhere checks `emailVerified`, so this route has nothing
// to block on and nothing to retry from. Resend lives on the persistent
// banner (Task 18.2), not here — this component only ever reports
// success/failure of the link that was just clicked.
export function VerifyEmailStatus() {
  const token = useSearchParams().get('token');
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>(token ? 'checking' : 'invalid');

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;

    // The token is single-use. React StrictMode (dev) runs this effect twice; both runs must share ONE
    // request, otherwise the second one finds the token already consumed and reports "invalid".
    let verification = inFlightVerifications.get(token);
    if (!verification) {
      verification = publicApiRequest('/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
        .then((res) => {
          if (res.ok) {
            // Cached (or still in-flight) `GET /me` says emailVerified:false - drop it
            // and refetch so the persistent "Verify your email" banner goes away without
            // a reload. An in-flight fetch must be cancelled first, otherwise
            // invalidate would just reuse that stale request.
            void queryClient.cancelQueries({ queryKey: ['me'] }).then(() => queryClient.invalidateQueries({ queryKey: ['me'] }));
          }
          return res.ok;
        })
        .catch(() => false)
        .finally(() => inFlightVerifications.delete(token));
      inFlightVerifications.set(token, verification);
    }

    void verification.then((ok) => {
      if (!cancelled) {
        setStatus(ok ? 'verified' : 'invalid');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [token, queryClient]);

  if (status === 'checking') {
    return (
      <p role="status" aria-live="polite" className="text-body text-text-secondary">
        Verifying your email…
      </p>
    );
  }

  if (status === 'verified') {
    return (
      <div className="flex flex-col gap-sm">
        <p role="status" className="text-body text-text-primary">
          Your email has been verified.
        </p>
        <Link href="/dashboard" className="text-body text-brand-primary underline">
          Continue
        </Link>
      </div>
    );
  }

  return (
    <p role="alert" className="text-body text-text-primary">
      This link is invalid or has expired.
    </p>
  );
}
