import { IsEmail, IsObject, IsOptional, IsPhoneNumber, IsString, IsUrl, MaxLength } from 'class-validator';

// Task 3.3 (api §3 "PATCH /users/:id"). Superset of UpdateMeDto — adds
// `email` (a Super Admin may correct a user's email; a self PATCH /me
// cannot). Deliberately **no `role` field** — BR-001's single-role-per-user
// invariant is enforced by AccountProvisioningService's construction path,
// not by a generic PATCH (api §3); the global ValidationPipe's
// `forbidNonWhitelisted: true` turns an attempted `role` in the body into a
// 400 VALIDATION_ERROR rather than silently dropping it.
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsPhoneNumber()
  phone?: string;

  @IsOptional()
  @IsUrl()
  photoUrl?: string;

  @IsOptional()
  @IsObject()
  notificationPrefs?: Record<string, boolean>;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;
}
