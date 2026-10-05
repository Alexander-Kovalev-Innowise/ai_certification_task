// US-01.09 "Use for planning: Suggest session times matching most players'
// availability". `label` is the ready-to-show "Mon 5:00-8:00 PM"; the client
// renders "<label> - <availableCount> out of <totalCount> players".
export class SuggestedTimeDto {
  dayOfWeek!: number;
  startTime!: number;
  endTime!: number;
  label!: string;
  availableCount!: number;
}

export class SuggestedTimesResponseDto {
  items!: SuggestedTimeDto[];
  // Every ACTIVE player on the roster (the "Y" in "X out of Y").
  totalCount!: number;
}
