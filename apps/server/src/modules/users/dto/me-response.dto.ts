import type { Role } from '@prisma/client';
import { Exclude, Expose } from 'class-transformer';

// Task 2.22 (api §3), reproduced verbatim. `@Exclude()` at the class level +
// `@Expose()` per allowed field means passwordHash (and anything else not
// explicitly listed) is stripped by class-transformer's `plainToInstance`
// even if the service ever passes the raw Prisma User row straight in —
// enforced at the DTO layer, not just by the repository's `select`.
@Exclude()
export class MeResponseDto {
  @Expose() id!: string;
  @Expose() email!: string;
  @Expose() role!: Role;
  @Expose() accountType!: 'ADULT' | 'CHILD';
  @Expose() firstName!: string;
  @Expose() lastName!: string;
  @Expose() phone!: string | null;
  @Expose() photoUrl!: string | null;
  @Expose() emailVerified!: boolean; // emailVerifiedAt !== null — informational only, arch §6.5
  @Expose() mustChangePassword!: boolean;
  @Expose() createdAt!: Date;
}
