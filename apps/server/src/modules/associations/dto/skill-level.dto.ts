import { SkillLevel } from '@prisma/client';
import { IsEnum } from 'class-validator';

// Spec US-01.11: skill level is read-only for the player — "trainer sets this".
export class SetSkillLevelDto {
  @IsEnum(SkillLevel)
  skillLevel!: SkillLevel;
}

export class SkillLevelResponseDto {
  playerProfileId!: string;
  skillLevel!: SkillLevel;
}
