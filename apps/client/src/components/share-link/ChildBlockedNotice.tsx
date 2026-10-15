'use client';

import { useEffect } from 'react';

import { apiRequest } from '../../lib/api/apiClient';

// fe §4.2 / FR-052 — a signed-in CHILD opening a join link can never register
// themselves. On mount this notice calls POST /share-links/:code/redeem once:
// the server answers 403 CHILD_SHARE_LINK_BLOCKED and, as its side effect,
// emails the guardian a "review this registration" link (SEC-006). The
// response is intentionally ignored — the child just sees the message below.
//
// De-duplicated per code for the lifetime of the page: re-renders, React
// StrictMode's double effect run and a remount of this notice must not send
// the guardian several identical emails.
const notifiedCodes = new Set<string>();

export interface ChildBlockedNoticeProps {
  code: string;
}

export function ChildBlockedNotice({ code }: ChildBlockedNoticeProps) {
  useEffect(() => {
    if (notifiedCodes.has(code)) {
      return;
    }
    notifiedCodes.add(code);
    apiRequest(`/share-links/${encodeURIComponent(code)}/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => {
      // Best effort: the guardian email is a side effect, not something the
      // child can act on — a network failure must not surface as an error.
    });
  }, [code]);

  return (
    <div
      role="alert"
      className="flex flex-col gap-sm rounded-md border border-border-soft bg-surface-1 p-lg text-center"
    >
      <p className="text-body text-text-primary">Ask your parent to register you with this trainer.</p>
      <p className="text-caption text-text-secondary">
        We&apos;ve let your parent know — they can complete your registration from the link we emailed them.
      </p>
    </div>
  );
}
