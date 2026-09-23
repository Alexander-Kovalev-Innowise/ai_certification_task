import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

// Task 4.11 (api §4.2 "POST /coaches/invite"), reproduced verbatim
// ({email, name?, message?}).
export class InviteCoachDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}

// Task 4.11 (api §4.2 response shape) — `status: 'PENDING'` is a
// coach-invitation-lifecycle status (FR-060's "trainer can view invitation
// status"), unrelated to the underlying `ShareLink`'s own ACTIVE/EXPIRED/
// REVOKED `status` enum (arch §9.1) — a fresh invite is always PENDING from
// the coach's point of view regardless of the link's own field.
export class InviteCoachResponseDto {
  shareLinkCode!: string;
  expiresAt!: Date | null;
  status!: 'PENDING';
}
