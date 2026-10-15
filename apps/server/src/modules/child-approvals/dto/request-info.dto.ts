import { IsString, MaxLength, MinLength } from 'class-validator';

// POST /approvals/:id/request-info — the guardian's question for the child.
export class RequestInfoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  message!: string;
}
