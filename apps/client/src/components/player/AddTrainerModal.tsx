'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { apiRequest } from '../../lib/api/apiClient';
import { parseApiErrorBody } from '../../lib/api/apiError';
import { addTrainerSchema, type AddTrainerFormValues } from '../../lib/schemas/addTrainerSchema';

import type { AvailableTrainerOption } from './ChildProfileForm';

// api §4.3 POST /player-profiles/:id/trainers — response body verified
// against the real AssociationsService.addTrainerAssociation (not the
// spec's `TrainerAssociationRow`-shaped guess): `{id, trainerId,
// playerProfileId, status, connectedAt, alreadyConnected}` — no
// `businessName`, so the caller must re-fetch `GET
// .../trainers` (TrainerAssociationList's data source) to display it,
// rather than building a display row straight from this response.
export interface AddTrainerAssociationResult {
  id: string;
  trainerId: string;
  playerProfileId: string;
  status: string;
  connectedAt: string;
  alreadyConnected: boolean;
}

export interface AddTrainerModalProps {
  isOpen: boolean;
  profileId: string;
  /** FR-032 option B — "My Trainers" picker, the family's already-connected trainers. */
  availableTrainers: AvailableTrainerOption[];
  onClose: () => void;
  onAdded: (result: AddTrainerAssociationResult) => void;
}

const GENERIC_ERROR_MESSAGE = 'Something went wrong adding this trainer. Please try again.';

const INPUT_CLASSNAME =
  'w-full min-w-0';

// fe §4.6 — AddTrainerModal: `/profiles/[id]`'s "Add Trainer" trigger
// (`TrainerAssociationList`, Task 14.4). FR-032 option A (manual ShareLink
// code entry) vs. option B ("My Trainers" picker) — oneOf, mirroring
// `AddTrainerAssociationDto`. Task 14.5.
export function AddTrainerModal({ isOpen, profileId, availableTrainers, onClose, onAdded }: AddTrainerModalProps) {
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<AddTrainerFormValues>({
    resolver: zodResolver(addTrainerSchema),
    mode: 'onTouched',
    defaultValues: { mode: 'code', shareLinkCode: '', trainerId: '' },
  });

  const mode = watch('mode');

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

    const body = values.mode === 'pick' ? { trainerId: values.trainerId } : { shareLinkCode: values.shareLinkCode };

    const res = await apiRequest(`/player-profiles/${profileId}/trainers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      await parseApiErrorBody(res);
      setFormError(GENERIC_ERROR_MESSAGE);
      return;
    }

    const result = (await res.json()) as AddTrainerAssociationResult;
    reset();
    setFormError(null);
    onAdded(result);
    onClose();
  });

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="add-trainer-heading" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-lg">
      <div className="w-full max-w-[28rem] rounded-md border border-border-soft bg-surface-1 p-lg shadow-card-strong">
        <h2 id="add-trainer-heading" className="text-block-title font-semibold text-text-primary">
          Add a trainer
        </h2>

        <form onSubmit={onSubmit} noValidate className="mt-md flex flex-col gap-md">
          <fieldset className="flex flex-col gap-xxs">
            <legend className="text-body text-text-secondary">How would you like to add a trainer?</legend>
            <label className="flex items-center gap-sm text-body text-text-primary">
              <input type="radio" value="code" {...register('mode')} />
              Enter a share link code
            </label>
            {availableTrainers.length > 0 && (
              <label className="flex items-center gap-sm text-body text-text-primary">
                <input type="radio" value="pick" {...register('mode')} />
                Pick from my trainers
              </label>
            )}
          </fieldset>

          {mode === 'code' ? (
            <div className="flex flex-col gap-xxs">
              <label htmlFor="add-trainer-code" className="field-label">
                Share link code
              </label>
              <input
                id="add-trainer-code"
                placeholder="e.g. aB3dE5fG7hJ9kL1m"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                className={INPUT_CLASSNAME}
                aria-invalid={!!errors.shareLinkCode}
                aria-describedby={errors.shareLinkCode ? 'add-trainer-code-error' : undefined}
                {...register('shareLinkCode')}
              />
              {errors.shareLinkCode && (
                <p id="add-trainer-code-error" role="alert" className="text-caption text-danger">
                  {errors.shareLinkCode.message}
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-xxs">
              <label htmlFor="add-trainer-picker" className="field-label">
                Trainer
              </label>
              <select
                id="add-trainer-picker"
                className={INPUT_CLASSNAME}
                defaultValue=""
                aria-invalid={!!errors.trainerId}
                aria-describedby={errors.trainerId ? 'add-trainer-picker-error' : undefined}
                {...register('trainerId')}
              >
                <option value="" disabled>
                  Select…
                </option>
                {availableTrainers.map((trainer) => (
                  <option key={trainer.id} value={trainer.id}>
                    {trainer.businessName}
                  </option>
                ))}
              </select>
              {errors.trainerId && (
                <p id="add-trainer-picker-error" role="alert" className="text-caption text-danger">
                  {errors.trainerId.message}
                </p>
              )}
            </div>
          )}

          {formError && (
            <p role="alert" className="text-body text-danger">
              {formError}
            </p>
          )}

          <div className="mt-sm flex justify-end gap-sm">
            <button type="button" onClick={handleClose} className="btn btn-ghost">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn btn-primary"
            >
              {isSubmitting ? 'Adding…' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
