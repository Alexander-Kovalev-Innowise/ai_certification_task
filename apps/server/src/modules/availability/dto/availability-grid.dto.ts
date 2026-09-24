import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, Max, Min, ValidateNested } from 'class-validator';

// Task 5.11 (api §4.5 "PUT /player-profiles/:id/availability", FR-090).
// `startTime`/`endTime` are range-validated here (0-1440); the
// `startTime < endTime` cross-field check needs both values at once and
// isn't expressible as a single-field decorator, so AvailabilityService
// checks it (same "data-dependent validation lives in the service"
// convention PlayerProfileService's age check already established).
export class AvailabilitySlotDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @IsInt()
  @Min(0)
  @Max(1440)
  startTime!: number;

  @IsInt()
  @Min(0)
  @Max(1440)
  endTime!: number;

  @IsBoolean()
  isAvailable!: boolean;
}

// Task 5.11. Full-replace body — `PUT`, not `PATCH` (weekly grid semantics).
export class SetAvailabilityDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AvailabilitySlotDto)
  slots!: AvailabilitySlotDto[];
}

export class AvailabilitySlotResponseDto {
  dayOfWeek!: number;
  startTime!: number;
  endTime!: number;
  isAvailable!: boolean;
}

export class AvailabilityGridResponseDto {
  playerProfileId!: string;
  slots!: AvailabilitySlotResponseDto[];
}

// Task 6.1 (api §4.5 "GET/PUT /coaches/:id/availability", FR-062 "My
// Times"). Same slot shape as the player pair (`AvailabilitySlotResponseDto`
// above) — only the wrapper id field differs, since `Availability` rows are
// keyed by exactly one of `playerProfileId`/`coachProfileId` depending on
// `subjectType` (schema.prisma).
export class CoachAvailabilityGridResponseDto {
  coachProfileId!: string;
  slots!: AvailabilitySlotResponseDto[];
}

// Task 6.2 (api §4.5 "GET /coaches/:id/availability/check", *added*).
// Query-string values arrive as strings — `@Type(() => Number)` coerces
// before the `@IsInt`/`@Min`/`@Max` decorators run, same convention
// `ListRosterQueryDto` (associations module) already established for
// numeric query params.
export class ConflictCheckQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1440)
  startTime!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1440)
  endTime!: number;
}

export class ConflictCheckResponseDto {
  hasConflict!: boolean;
}
