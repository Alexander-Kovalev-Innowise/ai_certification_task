import { purchaseRequestSchema, toAmountCents } from './purchaseRequestSchema';

describe('purchaseRequestSchema', () => {
  it('accepts a title, a positive amount and a payment type', () => {
    expect(purchaseRequestSchema.safeParse({ title: 'Clinic', amount: '12.50', paymentType: 'USD' }).success).toBe(true);
  });

  it.each(['', '0', '-5', 'abc', '1.234', '1000000'])('rejects the amount %j', (amount) => {
    expect(purchaseRequestSchema.safeParse({ title: 'Clinic', amount, paymentType: 'USD' }).success).toBe(false);
  });

  it('requires a title and a known payment type', () => {
    expect(purchaseRequestSchema.safeParse({ title: '  ', amount: '5', paymentType: 'USD' }).success).toBe(false);
    expect(purchaseRequestSchema.safeParse({ title: 'x', amount: '5', paymentType: 'EUR' }).success).toBe(false);
  });

  it('converts an amount to cents without float drift', () => {
    expect(toAmountCents('12.50')).toBe(1250);
    expect(toAmountCents('0.29')).toBe(29);
    expect(toAmountCents('19.99')).toBe(1999);
  });
});
