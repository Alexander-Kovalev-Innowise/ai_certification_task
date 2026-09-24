// fe §6.2 / api §0.4 — every non-2xx response from apps/server's
// GlobalExceptionFilter (apps/server/src/shared/http/global-exception.filter.ts)
// carries this exact envelope. apiClient.ts's apiRequest() deliberately
// returns the raw Response (so 401 retry/redirect stays generic across every
// call site) rather than parsing this body itself — Phase 11 is the first
// place the client needs to branch UI copy on `errorCode` (fe §4.1: "the one
// place the client is allowed to branch UI text on errorCode"), so this
// small parsing helper is shared across every auth/join form instead of
// each one re-implementing the same res.json() + shape-check.
export interface ApiErrorDetail {
  field: string;
  message: string;
}

export interface ApiErrorBody {
  statusCode: number;
  message: string;
  error: string;
  errorCode: string;
  path: string;
  requestId: string;
  details?: ApiErrorDetail[];
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).errorCode === 'string'
  );
}

/**
 * Best-effort parse of a non-ok Response's JSON body into the shared error
 * envelope. Never throws — a body that isn't JSON, or doesn't carry
 * `errorCode`, resolves to `null` so callers can fall back to a generic
 * message rather than crash on a malformed/empty error response.
 */
export async function parseApiErrorBody(res: Response): Promise<ApiErrorBody | null> {
  try {
    const body: unknown = await res.json();
    return isApiErrorBody(body) ? body : null;
  } catch {
    return null;
  }
}

/** `Retry-After` (seconds) off a 429 response, api §0.6 — null when absent/unparseable. */
export function readRetryAfterSeconds(res: Response): number | null {
  const header = res.headers.get('Retry-After');
  if (!header) {
    return null;
  }
  const seconds = Number.parseInt(header, 10);
  return Number.isNaN(seconds) ? null : seconds;
}
