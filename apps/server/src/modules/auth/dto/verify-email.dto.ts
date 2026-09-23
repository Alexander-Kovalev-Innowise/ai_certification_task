import { IsNotEmpty, IsString } from 'class-validator';

// Task 2.18 (api §1).
export class VerifyEmailDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}
