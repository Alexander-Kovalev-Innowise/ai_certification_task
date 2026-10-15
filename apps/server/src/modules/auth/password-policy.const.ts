// api §0.10 (resolved 2026-09-22, project owner confirmed), verbatim.
// Minimum length is 8, enforced separately via @MinLength(8) — no
// special-character requirement.
export const PASSWORD_POLICY = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;
