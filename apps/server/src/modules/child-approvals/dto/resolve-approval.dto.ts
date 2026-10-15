import { IsOptional, IsString, MaxLength } from 'class-validator';

// Task 5.13 (api §4.6 "POST /approvals/:id/approve" / "/deny"). `{ notes?: string }` — shared by both endpoints.
export class ResolveApprovalDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
