import { IsEmail, IsPhoneNumber, IsString, MaxLength } from 'class-validator';

// Task 3.8 (api §4.1 "POST /trainers"), reproduced verbatim.
export class CreateTrainerDto {
  @IsString()
  @MaxLength(200)
  businessName!: string;

  @IsString()
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @MaxLength(100)
  lastName!: string;

  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsPhoneNumber()
  phone!: string;
}
