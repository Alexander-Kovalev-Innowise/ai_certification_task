import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// Task 5.12 (api §4.6 "GET /approvals"). Query: `?status?=PENDING|APPROVED|
// DENIED|EXPIRED&limit&cursor`.
export class ListApprovalsQueryDto {
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'DENIED', 'EXPIRED'])
  status?: 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED';

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
