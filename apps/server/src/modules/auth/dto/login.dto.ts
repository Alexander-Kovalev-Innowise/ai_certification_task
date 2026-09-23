import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Task 2.13 (api §1), reproduced verbatim.
export class LoginDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
