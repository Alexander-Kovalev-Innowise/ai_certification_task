import type { Role, UserStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

const ROLES: Role[] = ['SUPER_ADMIN', 'TRAINER', 'COACH', 'PLAYER_PARENT'];
const STATUSES: UserStatus[] = ['ACTIVE', 'INACTIVE', 'DELETED'];

// Task 3.1 (api §3 "GET /users"). Query shape: `?limit&cursor&search?&role?&status?`.
// Not reproduced verbatim from api-designer-spec.md (it doesn't give this DTO
// a literal class body, only the query-string prose) — built here to match
// that prose plus the global ValidationPipe's `whitelist: true,
// forbidNonWhitelisted: true, transform: true`.
export class ListUsersQueryDto {
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
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(ROLES)
  role?: Role;

  @IsOptional()
  @IsIn(STATUSES)
  status?: UserStatus;
}
