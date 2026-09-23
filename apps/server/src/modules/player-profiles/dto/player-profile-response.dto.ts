import { Expose } from 'class-transformer';

// Task 5.1, extended in Task 5.2 (`trainerCount` on the list shape). One DTO
// covers both GET /player-profiles/:id (full row, no trainerCount) and GET
// /player-profiles (trainerCount populated, per api §4.3: "each entry
// includes a trainerCount summary only, not full trainer objects" — kept
// optional on one shared class rather than two near-identical DTOs).
// `warning` (Task 5.1, FR-030) is populated only by
// PlayerProfileService.createChildProfile's non-blocking duplicate-name/age
// branch.
export class PlayerProfileResponseDto {
  @Expose() id!: string;
  @Expose() accountUserId!: string;
  @Expose() childUserId!: string | null;
  @Expose() name!: string;
  @Expose() dateOfBirth!: Date;
  @Expose() gender!: string;
  @Expose() skillLevel!: string;
  @Expose() school!: string | null;
  @Expose() jerseyNumber!: string | null;
  @Expose() photoUrl!: string | null;
  @Expose() isSelf!: boolean;
  @Expose() allowChildTokenSpendWithoutApproval!: boolean;
  @Expose() emergencyContact!: Record<string, unknown> | null;
  @Expose() createdAt!: Date;
  @Expose() updatedAt!: Date;
  @Expose() trainerCount?: number;
  @Expose() warning?: string;
}
