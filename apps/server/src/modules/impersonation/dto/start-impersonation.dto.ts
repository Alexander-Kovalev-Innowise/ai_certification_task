import { IsUUID } from 'class-validator';

// Task 7.1 (api §2 "POST /impersonation/start"), reproduced verbatim.
export class StartImpersonationDto {
  @IsUUID()
  targetUserId!: string;
}
