// Task 5.7 (api §4.3 "GET /me/contexts", reproduced verbatim). Populates the
// trainer-context switcher — the data source a client validates its cached
// `X-Trainer-Context` value against (api §4.3 comment).
export class ContextEntryDto {
  playerProfileId!: string;
  playerProfileName!: string;
  isSelf!: boolean;
  trainerId!: string;
  trainerDisplayName!: string;
  logoUrl!: string | null;
  primaryColorHex!: string | null;
  connectedAt!: string;
}

export class ContextListResponseDto {
  contexts!: ContextEntryDto[];
}
