import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

// Task 6.3 (api §4.5 "POST /coaches/:id/availability/override", verbatim
// from api-designer-spec.md §4.5). `eventId` is an opaque FK with no DB
// relation yet (Epic-02 forward reference, G-09) — `CoachAvailabilityOverride.eventId`
// is a bare `String @db.Uuid`, so `@IsUUID()` here is the only shape check
// this field gets.
export class CreateOverrideDto {
  @IsUUID()
  eventId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

// Response shape, verbatim from api §4.5: `201 { id, eventId, coachId, trainerId, reason, createdAt }`.
export class CoachOverrideResponseDto {
  id!: string;
  eventId!: string;
  coachId!: string;
  trainerId!: string;
  reason!: string;
  createdAt!: Date;
}
