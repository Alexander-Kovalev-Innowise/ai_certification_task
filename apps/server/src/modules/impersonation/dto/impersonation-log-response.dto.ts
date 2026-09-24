import { UserSummaryDto } from '../../auth/dto/auth-session-response.dto';

// Task 7.3 (api §2 "GET /impersonation/history"), reproduced verbatim.
export class ImpersonationLogResponseDto {
  id!: string;
  admin!: UserSummaryDto;
  target!: UserSummaryDto;
  startedAt!: Date;
  endedAt!: Date | null;
  durationSeconds!: number | null;
}
