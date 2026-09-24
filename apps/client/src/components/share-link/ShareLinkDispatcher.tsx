'use client';

import { useEffect, useState } from 'react';

import { apiRequest } from '../../lib/api/apiClient';

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

// fe §4.2 — "pending → previewed → {branch} → submitting →
// {resolved|race-retry}". Task 11.7 implements the first two states
// (pending/previewed, folding the invalid-link case into its own variant);
// the branch/submitting/resolved/race-retry states are wired in once every
// branch component exists (Tasks 11.8-11.10).
type Stage =
  | { kind: 'pending' }
  | { kind: 'invalid'; reason?: ShareLinkInvalidReason }
  | { kind: 'previewed'; preview: ShareLinkPreviewResponse };

export interface ShareLinkDispatcherProps {
  code: string;
}

// fe §4.2 (deep dive) — the orchestrating state machine for /join/[code].
// On mount: GET /share-links/:code, which per api §4.4 ALWAYS resolves 200
// (even an unknown code) — this component must never let that turn into a
// thrown exception or a Next.js not-found boundary (fe §9.3), so both a
// non-ok HTTP status and an outright network failure are handled as DATA
// (render ShareLinkInvalidCard), not re-thrown.
export function ShareLinkDispatcher({ code }: ShareLinkDispatcherProps) {
  const [stage, setStage] = useState<Stage>({ kind: 'pending' });

  useEffect(() => {
    let cancelled = false;

    apiRequest(`/share-links/${code}`)
      .then(async (res) => {
        if (!res.ok) {
          if (!cancelled) {
            setStage({ kind: 'invalid' });
          }
          return;
        }

        const preview = (await res.json()) as ShareLinkPreviewResponse;
        if (cancelled) {
          return;
        }
        setStage(preview.valid ? { kind: 'previewed', preview } : { kind: 'invalid', reason: preview.reason });
      })
      .catch(() => {
        if (!cancelled) {
          setStage({ kind: 'invalid' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [code]);

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

  const { preview } = stage;
  return (
    <ShareLinkPreview
      trainerDisplayName={preview.trainerDisplayName ?? ''}
      logoUrl={preview.logoUrl ?? null}
      primaryColorHex={preview.primaryColorHex ?? null}
    />
  );
}
