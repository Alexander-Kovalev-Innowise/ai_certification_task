'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { publicApiRequest } from '../../lib/api/apiClient';

type Status = 'checking' | 'verified' | 'invalid';

// fe §4.1 "/verify-email?token=" (api §1 POST /auth/verify-email) — a
// landing confirmation only, never a gate: architecture §6.5 is explicit
// that no guard anywhere checks `emailVerified`, so this route has nothing
// to block on and nothing to retry from. Resend lives on the persistent
// banner (Task 18.2), not here — this component only ever reports
// success/failure of the link that was just clicked.
export function VerifyEmailStatus() {
  const token = useSearchParams().get('token');
  const [status, setStatus] = useState<Status>(token ? 'checking' : 'invalid');

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;

    publicApiRequest('/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then((res) => {
        if (!cancelled) {
          setStatus(res.ok ? 'verified' : 'invalid');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('invalid');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (status === 'checking') {
    return (
      <p role="status" aria-live="polite" className="text-body text-[var(--text-secondary)]">
        Verifying your email…
      </p>
    );
  }

  if (status === 'verified') {
    return (
      <div className="flex flex-col gap-sm">
        <p role="status" className="text-body text-[var(--text-primary)]">
          Your email has been verified.
        </p>
        <a href="/dashboard" className="text-body text-[var(--brand-primary)] underline">
          Continue
        </a>
      </div>
    );
  }

  return (
    <p role="alert" className="text-body text-[var(--text-primary)]">
      This link is invalid or has expired.
    </p>
  );
}
