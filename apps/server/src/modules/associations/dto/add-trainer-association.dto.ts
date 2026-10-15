import { IsOptional, IsString, IsUUID } from 'class-validator';

// Task 5.8 (api §4.3 "POST /player-profiles/:id/trainers", FR-032 "Add
// Trainer"). Body `{shareLinkCode} | {trainerId}` (oneOf) — both fields are
// optional here (same "data-dependent required-ness lives in the service"
// convention RedeemShareLinkDto already established) because which one the
// caller must supply isn't knowable from the DTO shape alone.
export class AddTrainerAssociationDto {
  @IsOptional()
  @IsString()
  shareLinkCode?: string;

  @IsOptional()
  @IsUUID('4')
  trainerId?: string;
}
