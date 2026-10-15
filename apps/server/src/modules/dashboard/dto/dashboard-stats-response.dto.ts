import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const DASHBOARD_UNITS = ['count', 'percent', 'hours'] as const;
export type DashboardUnit = (typeof DASHBOARD_UNITS)[number];

export const DASHBOARD_DELTA_PERIODS = ['week', 'month'] as const;
export type DashboardDeltaPeriod = (typeof DASHBOARD_DELTA_PERIODS)[number];

export const DASHBOARD_DELTA_DIRECTIONS = ['up', 'down', 'flat'] as const;
export type DashboardDeltaDirection = (typeof DASHBOARD_DELTA_DIRECTIONS)[number];

export const DASHBOARD_ROLES = ['SUPER_ADMIN', 'TRAINER', 'COACH', 'PLAYER_PARENT'] as const;
export type DashboardRole = (typeof DASHBOARD_ROLES)[number];

export class DashboardMetricDeltaDto {
  @ApiProperty({
    description: 'Absolute change versus the previous period (always >= 0; the sign is carried by `direction`)',
    example: 4,
  })
  value!: number;

  @ApiProperty({ enum: DASHBOARD_DELTA_PERIODS, description: 'Length of the compared period' })
  period!: DashboardDeltaPeriod;

  @ApiProperty({ enum: DASHBOARD_DELTA_DIRECTIONS })
  direction!: DashboardDeltaDirection;
}

export class DashboardMetricDto {
  @ApiProperty({ description: 'Stable machine key, e.g. `connected_players`', example: 'connected_players' })
  key!: string;

  @ApiProperty({ example: 'Connected players' })
  label!: string;

  @ApiProperty({ example: 12 })
  value!: number;

  @ApiPropertyOptional({ enum: DASHBOARD_UNITS, description: 'Defaults to `count` when omitted' })
  unit?: DashboardUnit;

  @ApiPropertyOptional({ description: 'Short human-readable context for the number' })
  hint?: string;

  @ApiPropertyOptional({ type: DashboardMetricDeltaDto })
  delta?: DashboardMetricDeltaDto;
}

export class DashboardSeriesPointDto {
  @ApiProperty({ description: 'UTC calendar day, YYYY-MM-DD', example: '2026-10-04' })
  date!: string;

  @ApiProperty({ example: 3 })
  value!: number;
}

export class DashboardSeriesDto {
  @ApiProperty({ example: 'new_users_daily' })
  key!: string;

  @ApiProperty({ example: 'New users per day' })
  label!: string;

  @ApiProperty({ type: [DashboardSeriesPointDto], description: 'One point per UTC day, oldest first, zero-filled' })
  points!: DashboardSeriesPointDto[];
}

export class DashboardStatsResponseDto {
  @ApiProperty({
    enum: DASHBOARD_ROLES,
    description: "The caller's EFFECTIVE role (an impersonated session sees the target's dashboard)",
  })
  role!: DashboardRole;

  @ApiProperty({ description: 'ISO-8601 timestamp the numbers were computed at' })
  generatedAt!: string;

  @ApiProperty({ type: [DashboardMetricDto] })
  metrics!: DashboardMetricDto[];

  @ApiPropertyOptional({ type: [DashboardSeriesDto] })
  series?: DashboardSeriesDto[];
}
