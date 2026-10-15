import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// GET /users/deletion-log — `?limit&cursor` (keyset on (deletedAt, id) DESC, same shape as impersonation history).
export class ListDeletionLogQueryDto {
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
