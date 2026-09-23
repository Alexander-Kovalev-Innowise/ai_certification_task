import { IsEmail, IsIn, ValidateIf } from 'class-validator';

// Task 4.2 (api §4.4 "POST /share-links"), reproduced verbatim.
export class CreateShareLinkDto {
  @IsIn(['PLAYER_STATIC', 'COACH_UNIQUE'])
  type!: 'PLAYER_STATIC' | 'COACH_UNIQUE';

  @ValidateIf((o: CreateShareLinkDto) => o.type === 'COACH_UNIQUE')
  @IsEmail()
  targetEmail?: string;
}
