// Full catalog per api-designer-spec.md §0.5.
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  CHILD_CAPABILITY_DENIED: 'CHILD_CAPABILITY_DENIED',
  TENANT_CONTEXT_INVALID: 'TENANT_CONTEXT_INVALID',
  IMPERSONATION_NOT_ALLOWED: 'IMPERSONATION_NOT_ALLOWED',
  CHILD_SHARE_LINK_BLOCKED: 'CHILD_SHARE_LINK_BLOCKED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  SHARE_LINK_UNAVAILABLE: 'SHARE_LINK_UNAVAILABLE',
  IMPERSONATION_TARGET_INVALID: 'IMPERSONATION_TARGET_INVALID',
  RATE_LIMITED: 'RATE_LIMITED',
  TENANT_SCOPE_VIOLATION: 'TENANT_SCOPE_VIOLATION',
  // Not part of the api-spec catalog (which only enumerates client-meaningful
  // codes) but required as GlobalExceptionFilter's fallback for anything
  // unhandled, per Task 0.10's "unhandled -> 500 INTERNAL_ERROR" requirement.
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  // Task 2.14 (arch §6.4) — missing/mismatched double-submit CSRF pair on
  // /auth/refresh and /auth/logout. Not in api §0.5's catalog table (added
  // there only implicitly, via §1's "403 FORBIDDEN (errorCode: CSRF_MISMATCH)"
  // prose) but is a distinct, client-meaningful code, so it belongs here.
  CSRF_MISMATCH: 'CSRF_MISMATCH',
  // Task 2.17/2.20 (api §1) — `410 Gone` for a token that was valid in
  // shape but has expired (distinct from `404 NOT_FOUND` for unknown/
  // already-used/wrong-purpose, both generic on purpose).
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Default errorCode for a given HTTP status when the thrown HttpException
 * didn't already carry an explicit `errorCode` in its response body. Several
 * catalog entries (ACCOUNT_INACTIVE, CHILD_CAPABILITY_DENIED,
 * TENANT_CONTEXT_INVALID, IMPERSONATION_NOT_ALLOWED,
 * CHILD_SHARE_LINK_BLOCKED, SHARE_LINK_UNAVAILABLE,
 * IMPERSONATION_TARGET_INVALID, TENANT_SCOPE_VIOLATION) share an HTTP status
 * with another code and can only be produced by the guard/service that
 * throws them attaching `errorCode` explicitly — this table is only the
 * fallback for the unambiguous cases (and for anything thrown generically).
 */
export const STATUS_TO_ERROR_CODE: Readonly<Partial<Record<number, ErrorCode>>> = {
  400: ERROR_CODES.VALIDATION_ERROR,
  401: ERROR_CODES.UNAUTHORIZED,
  403: ERROR_CODES.FORBIDDEN,
  404: ERROR_CODES.NOT_FOUND,
  409: ERROR_CODES.CONFLICT,
  429: ERROR_CODES.RATE_LIMITED,
  500: ERROR_CODES.INTERNAL_ERROR,
};
