import type { AuthSession } from '../../stores/useAuthStore';
import type { AuthSessionResponseDto } from '../../types/auth';

// Shared by every Phase 11 form that receives an AuthSessionResponseDto
// (login, trainer-setup /register, anonymous ShareLink redeem branches) —
// factored out of each call site for two reasons: (1) avoids repeating the
// accessToken/user/expiresAt-from-expiresIn mapping in ~4 places, and (2)
// keeps the `Date.now()` call at module scope, outside any component's
// render function, which `eslint-plugin-react-hooks`'s `react-hooks/purity`
// rule (Task 11.1 lint finding) otherwise flags when called directly inside
// a component body — even from within a submit handler closure.
export function toAuthSession(dto: AuthSessionResponseDto, isImpersonating = false): AuthSession {
  return {
    accessToken: dto.accessToken,
    user: dto.user,
    expiresAt: Date.now() + dto.expiresIn * 1000,
    isImpersonating,
  };
}
