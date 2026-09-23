import type { Role, UserStatus } from '@prisma/client';
import { Exclude, Expose } from 'class-transformer';

// Task 3.1 (api §3 "GET /users"). One directory row — deliberately narrow
// (never passwordHash), enforced the same way MeResponseDto documents:
// `@Exclude()` at the class level + `@Expose()` per allowed field strips
// anything not explicitly listed even if a caller ever passed a raw `User`
// row straight through `plainToInstance`. UsersRepository.findAllPaginated
// additionally selects only these columns at the SQL level (api §3: "select
// is directory columns only, never passwordHash") — this DTO is the second,
// independent layer, not the only one.
@Exclude()
export class UserDirectoryRowDto {
  @Expose() id!: string;
  @Expose() email!: string;
  @Expose() role!: Role;
  @Expose() status!: UserStatus;
  @Expose() firstName!: string;
  @Expose() lastName!: string;
  @Expose() createdAt!: Date;
  @Expose() lastLoginAt!: Date | null;
}
