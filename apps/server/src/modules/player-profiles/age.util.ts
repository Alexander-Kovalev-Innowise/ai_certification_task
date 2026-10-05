/** Players younger than this must be registered and managed by a parent/guardian account (Epic-01 business rule). */
export const ADULT_AGE = 18;

/** Whole years between `dateOfBirth` and `now`, calendar-correct (not a naive `/365` division). */
export function calculateAge(dateOfBirth: Date, now: Date = new Date()): number {
  let age = now.getFullYear() - dateOfBirth.getFullYear();
  const monthDiff = now.getMonth() - dateOfBirth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dateOfBirth.getDate())) {
    age -= 1;
  }
  return age;
}
