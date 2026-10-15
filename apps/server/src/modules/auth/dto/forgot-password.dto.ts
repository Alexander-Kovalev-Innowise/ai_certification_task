import { IsEmail } from 'class-validator';

// Task 2.16 (api §1).
export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}
