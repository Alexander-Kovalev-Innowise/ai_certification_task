import { IsEmail, IsIn, IsInt, IsOptional, IsPhoneNumber, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export const CAMP_GENDERS = ['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'] as const;
export const CAMP_SOURCES = ['CAMP', 'EVALUATION'] as const;
export type CampSource = (typeof CAMP_SOURCES)[number];
export type CampGender = (typeof CAMP_GENDERS)[number];

// Body of the public `POST /camp-conversions` - the stand-in for the Epic-08 camp/evaluation form's submission.
export class CreateCampConversionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  shareLinkCode!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  parentFirstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  parentLastName!: string;

  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsPhoneNumber()
  phone!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  playerName!: string;

  @IsInt()
  @Min(1)
  @Max(99)
  playerAge!: number;

  @IsIn(CAMP_GENDERS)
  playerGender!: CampGender;

  @IsOptional()
  @IsIn(CAMP_SOURCES)
  source?: CampSource;

  // Opaque id of the submission in the camp system (Epic-08); stored as-is, never interpreted here.
  @IsOptional()
  @IsString()
  @MaxLength(128)
  submissionRef?: string;
}
