import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

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

  // Epic-02 stand-in: events do not exist yet, so the client sends a generated
  // `eventId` plus this human label ("U12 drill - Tue 12 Oct, 18:00-19:30").
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sessionLabel?: string;
}

// Response shape, verbatim from api §4.5: `201 { id, eventId, coachId, trainerId, reason, createdAt }`.
export class CoachOverrideResponseDto {
  id!: string;
  eventId!: string;
  coachId!: string;
  trainerId!: string;
  reason!: string;
  sessionLabel!: string | null;
  createdAt!: Date;
}

// US-01.10 coach-side acknowledgement: the coach's own list of overrides.
export class CoachOverrideNoticeDto {
  id!: string;
  eventId!: string;
  reason!: string;
  sessionLabel!: string | null;
  trainerBusinessName!: string;
  createdAt!: Date;
  acknowledgedAt!: Date | null;
}
