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
