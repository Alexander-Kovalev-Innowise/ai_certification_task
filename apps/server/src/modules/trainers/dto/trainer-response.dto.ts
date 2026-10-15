import { Exclude, Expose } from 'class-transformer';

// api §4.1 documents two different response shapes under the literal same
// name "TrainerResponseDto": POST /trainers's ("id, userId, businessName,
// email, status: 'Active', createdAt") vs GET/PATCH /trainers/:id's ("id,
// userId, businessName, address, website, description, logoUrl,
// primaryColorHex, createdAt") — an inconsistency in the spec itself, not
// introduced here. Resolved as two distinct classes in this one file (Task
// 3.8's file list names only this one file, singular): TrainerResponseDto
// is the richer GET/PATCH profile shape (Task 3.9); TrainerCreatedResponseDto
// below is POST /trainers's narrower creation-confirmation shape (Task 3.8).
// Stripe/subscription/fee columns (Epic-05 stubs) are omitted from both
// entirely, never exposed as null (api §4.1).
@Exclude()
export class TrainerResponseDto {
  @Expose() id!: string;
  @Expose() userId!: string;
  @Expose() businessName!: string;
  @Expose() address!: string | null;
  @Expose() website!: string | null;
  @Expose() description!: string | null;
  @Expose() logoUrl!: string | null;
  @Expose() primaryColorHex!: string | null;
  @Expose() createdAt!: Date;
}

@Exclude()
export class TrainerCreatedResponseDto {
  @Expose() id!: string;
  @Expose() userId!: string;
  @Expose() businessName!: string;
  @Expose() email!: string;
  @Expose() status!: 'Active';
  @Expose() createdAt!: Date;
}
