import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Task 3.7 (api §3 "DELETE /users/:id", FR-014/SEC-005). `reason` is
// required — it becomes part of the `UserDeletionLog` row for legal
// retention (arch §11.2 point 1), not merely audit-logged elsewhere.
export class GdprDeleteUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
