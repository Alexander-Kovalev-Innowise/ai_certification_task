import type { Role, UserStatus } from '@prisma/client';
import { Exclude, Expose } from 'class-transformer';

// Task 3.2 (api §3 "GET /users/:id"). MeResponseDto's shape plus
// status/lastLoginAt/deletedAt — an admin-only superset, still never
// passwordHash, enforced the same @Exclude()/@Expose() way as every other
// response DTO in this module.
@Exclude()
export class UserDetailResponseDto {
  @Expose() id!: string;
  @Expose() email!: string;
  @Expose() role!: Role;
  @Expose() accountType!: 'ADULT' | 'CHILD';
  @Expose() firstName!: string;
  @Expose() lastName!: string;
  @Expose() phone!: string | null;
  @Expose() photoUrl!: string | null;
  @Expose() emailVerified!: boolean;
  @Expose() mustChangePassword!: boolean;
  @Expose() createdAt!: Date;
  @Expose() status!: UserStatus;
  @Expose() lastLoginAt!: Date | null;
  @Expose() deletedAt!: Date | null;
}
