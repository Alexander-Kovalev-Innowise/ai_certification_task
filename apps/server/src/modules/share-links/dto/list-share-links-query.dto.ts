import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// Task 4.4 (api §4.4 "GET /trainers/:id/share-links"). Query shape:
// `?limit&cursor` — same keyset-pagination convention as
// ListUsersQueryDto (users/dto/list-users-query.dto.ts), narrower here
// since this endpoint has no `search`/`role`/`status` filters of its own.
export class ListShareLinksQueryDto {
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
