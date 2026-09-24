import { Type } from 'class-transformer';
import { IsISO8601, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

// Task 7.3 (api §2 "GET /impersonation/history"): `?limit&cursor&adminUserId?&targetUserId?&dateFrom?&dateTo?`.
// Not reproduced verbatim (the api spec doesn't give this DTO a literal
// class body, only the query-string prose) — built to match that prose the
// same way ListUsersQueryDto (Task 3.1) was.
export class ListImpersonationHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsUUID()
  adminUserId?: string;

  @IsOptional()
  @IsUUID()
  targetUserId?: string;

  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;
}
