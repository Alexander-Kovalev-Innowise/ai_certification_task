// Spec US-01.11: skill level is trainer-set and read-only for the player/parent.
// Mirrors the server's SkillLevel enum (prisma/schema.prisma).
export const SKILL_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'ELITE'] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

const LABELS: Record<SkillLevel, string> = {
  BEGINNER: 'Beginner',
  INTERMEDIATE: 'Intermediate',
  ADVANCED: 'Advanced',
  ELITE: 'Elite',
};

export function skillLevelLabel(value: string | null | undefined): string {
  return value && value in LABELS ? LABELS[value as SkillLevel] : '';
}
