import type { Role } from '../../types/auth';

// api §2's `act` claim — present ONLY on an impersonation-issued access
// token: `sub`/`role`/`tid` on the token become the TARGET's effective
// identity, while `act` carries the ADMIN's own identity plus the
// `ImpersonationLog` id. `ImpersonationBanner` (Task 16.1, fe §5.1) uses
// its mere *presence* to decide whether to render.
export interface ActClaim {
  sub: string;
  role: Role;
  imp: string;
}

export interface AccessTokenPayload {
  sub: string;
  role: Role;
  exp: number;
  act?: ActClaim;
}

function isAccessTokenPayload(value: unknown): value is AccessTokenPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.sub === 'string' && typeof candidate.role === 'string' && typeof candidate.exp === 'number';
}

function base64UrlDecode(segment: string): string {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  return atob(padded);
}

/**
 * fe §5.1 — decodes a JWT's payload segment for **display purposes only**.
 * Deliberately never verifies the signature (the server is the only party
 * that does that, on every request — arch §6.2/§10); this is a pure,
 * best-effort read used solely to decide what to render (whose name to
 * show, when the token expires, whether an `act` claim is present).
 * Malformed input of any kind resolves to `null` rather than throwing, since
 * a decode failure here must never crash a render.
 */
export function decodeAccessTokenPayload(token: string): AccessTokenPayload | null {
  try {
    const segments = token.split('.');
    const payloadSegment = segments[1];
    if (segments.length !== 3 || !payloadSegment) {
      return null;
    }

    const json: unknown = JSON.parse(base64UrlDecode(payloadSegment));
    return isAccessTokenPayload(json) ? json : null;
  } catch {
    return null;
  }
}
