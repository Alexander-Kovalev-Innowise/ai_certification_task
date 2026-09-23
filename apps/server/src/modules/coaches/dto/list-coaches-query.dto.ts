import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// Task 4.12 (api §4.2 "GET /trainers/:id/coaches"). Query shape:
// `?status?=PENDING|ACTIVE&limit&cursor` — filters on the underlying
// `CoachProfile.status` (not the roster's own derived `invitationStatus`;
// see coach-roster-row.dto.ts's comment on the distinction).
export class ListCoachesQueryDto {
  @IsOptional()
  @IsIn(['PENDING', 'ACTIVE'])
  status?: 'PENDING' | 'ACTIVE';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @IsOptional()
  @IsString()
  cursor?: string;
}
