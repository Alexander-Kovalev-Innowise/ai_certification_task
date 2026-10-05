import { z } from 'zod';

// POST /me/purchase-requests — `{ title, amountCents, currency, paymentType }`.
// The form collects a human amount ("12.50"); `toAmountCents` converts it for
// the request body.
export const PAYMENT_TYPES = ['USD', 'TOKENS'] as const;
export type PurchasePaymentType = (typeof PAYMENT_TYPES)[number];

const AMOUNT_PATTERN = /^\d{1,6}(\.\d{1,2})?$/;

export const purchaseRequestSchema = z.object({
  title: z.string().trim().min(1, 'Describe what you want to buy.').max(200, 'Title must be 200 characters or fewer.'),
  amount: z
    .string()
    .trim()
    .min(1, 'Amount is required.')
    .regex(AMOUNT_PATTERN, 'Enter an amount like 12.50.')
    .refine((value) => Number(value) > 0, 'Amount must be greater than zero.'),
  paymentType: z.enum(PAYMENT_TYPES, { message: 'Select how you want to pay.' }),
});

export type PurchaseRequestFormValues = z.infer<typeof purchaseRequestSchema>;

export function toAmountCents(amount: string): number {
  return Math.round(Number(amount) * 100);
}
