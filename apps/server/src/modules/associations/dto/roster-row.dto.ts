// Task 5.10 (api §4.3 "GET /trainers/:id/players", FR-070's minimal roster —
// gap-fill, api §8.8). Deliberately `{player, age, availabilitySummary}`
// only, no notes/tags/pipeline (arch §18: "no dashboard, no aggregation" —
// not a full CRM).
export class RosterRowDto {
  playerProfileId!: string;
  name!: string;
  age!: number;
  availabilitySummary!: string;
}

// US-01.09 "Best Times": the roster page carries the counts behind the
// "Players available at this time: X out of Y" line. `totalCount` = every
// ACTIVE player on the roster; `availableCount` = those with an available
// slot matching the active day/time filter (equal to `totalCount` when no
// filter is active). Both span ALL pages, not just the returned one.
export class RosterPageDto {
  items!: RosterRowDto[];
  nextCursor!: string | null;
  hasMore!: boolean;
  availableCount!: number;
  totalCount!: number;
}
