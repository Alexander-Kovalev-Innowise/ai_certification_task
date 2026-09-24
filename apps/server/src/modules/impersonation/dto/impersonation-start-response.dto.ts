import { UserSummaryDto } from '../../auth/dto/auth-session-response.dto';

// Task 7.1 (api §2 "POST /impersonation/start"), reproduced verbatim.
// Deliberately no `refreshToken` field — arch §10/ADR-03's "no refresh
// token issued" is what makes the 60-minute cap structurally unextendable.
export class ImpersonationStartResponseDto {
  accessToken!: string;
  expiresIn!: number;
  impersonationLogId!: string;
  target!: UserSummaryDto;
}
