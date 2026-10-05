'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { apiRequest } from '../../lib/api/apiClient';
import { parseApiErrorBody } from '../../lib/api/apiError';
import { updateTrainerBusinessSchema, type UpdateTrainerBusinessFormValues } from '../../lib/schemas/updateTrainerBusinessSchema';
import { toast } from '../../lib/toast/toast';
import { Card, CardHeader } from '../shared/Card';

export interface TrainerBusinessValues {
  businessName: string;
  address: string | null;
  website: string | null;
  description: string | null;
}

export interface TrainerBusinessFormProps {
  trainerId: string;
  initial: TrainerBusinessValues;
  onSaved?: (updated: TrainerBusinessValues) => void;
}

const GENERIC_SAVE_ERROR = "Business details couldn't be saved. Please try again.";

// `PATCH /trainers/:id` (api §4.1, FR-080) — the trainer's own business
// details. Empty optional fields are sent as `null` so they can be cleared.
export function TrainerBusinessForm({ trainerId, initial, onSaved }: TrainerBusinessFormProps) {
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UpdateTrainerBusinessFormValues>({
    resolver: zodResolver(updateTrainerBusinessSchema),
    mode: 'onTouched',
    defaultValues: {
      businessName: initial.businessName,
      address: initial.address ?? '',
      website: initial.website ?? '',
      description: initial.description ?? '',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    const res = await apiRequest(`/trainers/${trainerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessName: values.businessName.trim(),
        address: values.address.trim() || null,
        website: values.website.trim() || null,
        description: values.description.trim() || null,
      }),
    });

    if (!res.ok) {
      await parseApiErrorBody(res);
      setFormError(GENERIC_SAVE_ERROR);
      return;
    }

    const updated = (await res.json()) as TrainerBusinessValues;
    toast.success('Business details saved.');
    onSaved?.(updated);
  });

  return (
    <Card aria-labelledby="trainer-business-heading">
      <CardHeader title={<span id="trainer-business-heading">Business</span>} titleAs="h2" subtitle="Shown to your players and coaches." />

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-md">
        <div className="flex flex-col gap-xxs">
          <label htmlFor="trainer-business-name" className="field-label">
            Business name
          </label>
          <input
            id="trainer-business-name"
            placeholder="Acme Tennis Academy"
            autoComplete="organization"
            className="w-full min-w-0"
            aria-invalid={!!errors.businessName}
            aria-describedby={errors.businessName ? 'trainer-business-name-error' : undefined}
            {...register('businessName')}
          />
          {errors.businessName && (
            <p id="trainer-business-name-error" role="alert" className="text-caption text-danger">
              {errors.businessName.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-xxs">
          <label htmlFor="trainer-business-address" className="field-label">
            Address
          </label>
          <input
            id="trainer-business-address"
            placeholder="123 Main St, Springfield"
            autoComplete="street-address"
            className="w-full min-w-0"
            aria-invalid={!!errors.address}
            aria-describedby={errors.address ? 'trainer-business-address-error' : undefined}
            {...register('address')}
          />
          {errors.address && (
            <p id="trainer-business-address-error" role="alert" className="text-caption text-danger">
              {errors.address.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-xxs">
          <label htmlFor="trainer-business-website" className="field-label">
            Website
          </label>
          <input
            id="trainer-business-website"
            type="url"
            inputMode="url"
            placeholder="https://www.acme-tennis.com"
            autoComplete="url"
            className="w-full min-w-0"
            aria-invalid={!!errors.website}
            aria-describedby={errors.website ? 'trainer-business-website-error' : undefined}
            {...register('website')}
          />
          {errors.website && (
            <p id="trainer-business-website-error" role="alert" className="text-caption text-danger">
              {errors.website.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-xxs">
          <label htmlFor="trainer-business-description" className="field-label">
            Description
          </label>
          <textarea
            id="trainer-business-description"
            rows={4}
            placeholder="Tell players what you teach and how you work."
            className="w-full min-w-0"
            aria-invalid={!!errors.description}
            aria-describedby={errors.description ? 'trainer-business-description-error' : undefined}
            {...register('description')}
          />
          {errors.description && (
            <p id="trainer-business-description-error" role="alert" className="text-caption text-danger">
              {errors.description.message}
            </p>
          )}
        </div>

        {formError && (
          <p role="alert" className="text-body text-danger">
            {formError}
          </p>
        )}

        <div className="mt-sm flex justify-end">
          <button type="submit" disabled={isSubmitting} className="btn btn-primary">
            {isSubmitting ? 'Saving…' : 'Save business details'}
          </button>
        </div>
      </form>
    </Card>
  );
}
