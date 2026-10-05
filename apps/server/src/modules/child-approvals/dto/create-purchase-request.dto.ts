import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

// POST /me/purchase-requests — the hook the future events/payments epics call
// when a child checks out. `trainerId` is informational today (which trainer
// the purchase is for); it is validated for shape only.
export class CreatePurchaseRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsInt()
  @Min(1)
  @Max(100_000_00)
  amountCents!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(8)
  currency!: string;

  @IsIn(['USD', 'TOKENS'])
  paymentType!: 'USD' | 'TOKENS';

  @IsOptional()
  @IsUUID('4')
  trainerId?: string;
}
