import { ApiProperty } from '@nestjs/swagger';

// GET /users/deletion-log row. Deliberately omits `dataBackupJson` (the full
// pre-anonymization snapshot) — the list is for "who was erased, by whom,
// why, when", not for re-exposing the erased data.
export class DeletionLogRowDto {
  @ApiProperty() id!: string;
  @ApiProperty() originalUserId!: string;
  @ApiProperty() originalEmail!: string;
  @ApiProperty() deletedBy!: string;
  @ApiProperty() reason!: string;
  @ApiProperty() deletedAt!: Date;
}
