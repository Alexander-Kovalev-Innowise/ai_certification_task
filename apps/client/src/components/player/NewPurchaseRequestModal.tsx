'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { apiRequest } from '../../lib/api/apiClient';
import {
  purchaseRequestSchema,
  toAmountCents,
  type PurchaseRequestFormValues,
} from '../../lib/schemas/purchaseRequestSchema';

import type { PurchaseRequestRow } from './PurchaseRequestList';

export interface NewPurchaseRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (created: PurchaseRequestRow) => void;
}

const GENERIC_ERROR = 'Something went wrong sending your request. Please try again.';

// "New request" — a stand-in for the Epic-02/05 event checkout: until that
// flow exists, a child can create a purchase request by hand
// (`POST /me/purchase-requests`). USD (and tokens, unless the parent allowed
// token spending) waits for the parent's approval; allowed token spending is
// confirmed immediately.
export function NewPurchaseRequestModal({ isOpen, onClose, onCreated }: NewPurchaseRequestModalProps) {
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PurchaseRequestFormValues>({
    resolver: zodResolver(purchaseRequestSchema),
    mode: 'onTouched',
    defaultValues: { title: '', amount: '', paymentType: 'USD' },
  });

  if (!isOpen) {
    return null;
  }

  function handleClose() {
    reset();
    setFormError(null);
    onClose();
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const res = await apiRequest('/me/purchase-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: values.title,
        amountCents: toAmountCents(values.amount),
        currency: values.paymentType === 'USD' ? 'USD' : 'TOKENS',
        paymentType: values.paymentType,
      }),
    });
    if (!res.ok) {
      setFormError(GENERIC_ERROR);
      return;
    }
    const created = (await res.json()) as PurchaseRequestRow;
    reset();
    onCreated(created);
    onClose();
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-request-heading"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-lg"
    >
      <div className="max-h-full w-full max-w-[28rem] overflow-y-auto rounded-md border border-border-soft bg-surface-1 p-lg shadow-card-strong">
        <h2 id="new-request-heading" className="text-block-title font-semibold text-text-primary">
          New request
        </h2>
        <p className="mt-xs text-caption text-ink-muted">
          Stand-in for event checkout: ask your parent to approve a purchase. Your parent gets an email and has 48 hours to respond.
        </p>

        <form onSubmit={onSubmit} noValidate className="mt-md flex flex-col gap-md">
          <div className="flex flex-col gap-xxs">
            <label htmlFor="new-request-title" className="field-label">
              What is it for?
            </label>
            <input
              id="new-request-title"
              placeholder="Saturday skills clinic"
              autoComplete="off"
              className="w-full min-w-0"
              aria-invalid={!!errors.title}
              aria-describedby={errors.title ? 'new-request-title-error' : undefined}
              {...register('title')}
            />
            {errors.title && (
              <p id="new-request-title-error" role="alert" className="text-caption text-danger">
                {errors.title.message}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-md">
            <div className="flex min-w-0 flex-[1_1_11rem] flex-col gap-xxs">
              <label htmlFor="new-request-amount" className="field-label">
                Amount
              </label>
              <input
                id="new-request-amount"
                inputMode="decimal"
                placeholder="25.00"
                autoComplete="off"
                className="w-full min-w-0"
                aria-invalid={!!errors.amount}
                aria-describedby={errors.amount ? 'new-request-amount-error' : undefined}
                {...register('amount')}
              />
              {errors.amount && (
                <p id="new-request-amount-error" role="alert" className="text-caption text-danger">
                  {errors.amount.message}
                </p>
              )}
            </div>

            <div className="flex min-w-0 flex-[1_1_11rem] flex-col gap-xxs">
              <label htmlFor="new-request-payment-type" className="field-label">
                Pay with
              </label>
              <select id="new-request-payment-type" className="w-full min-w-0" {...register('paymentType')}>
                <option value="USD">USD</option>
                <option value="TOKENS">Tokens</option>
              </select>
            </div>
          </div>

          {formError && (
            <p role="alert" className="text-body text-danger">
              {formError}
            </p>
          )}

          <div className="mt-sm flex justify-end gap-sm">
            <button type="button" onClick={handleClose} className="btn btn-ghost">
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting} className="btn btn-primary">
              {isSubmitting ? 'Sending…' : 'Send request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
