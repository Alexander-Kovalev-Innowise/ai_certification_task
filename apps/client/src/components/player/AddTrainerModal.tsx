'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { apiRequest } from '../../lib/api/apiClient';
import { parseApiErrorBody } from '../../lib/api/apiError';

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

type AddTrainerMode = 'code' | 'pick';

interface AddTrainerFormValues {
  mode: AddTrainerMode;
  shareLinkCode: string;
  trainerId: string;
}

const GENERIC_ERROR_MESSAGE = 'Something went wrong adding this trainer. Please try again.';

const INPUT_CLASSNAME =
  'rounded-sm border border-[var(--border-soft)] bg-[var(--surface-0)] p-sm text-body text-[var(--text-primary)] outline-none focus:border-[var(--brand-primary)]';

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
    formState: { isSubmitting },
  } = useForm<AddTrainerFormValues>({ defaultValues: { mode: 'code', shareLinkCode: '', trainerId: '' } });

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

    const body = values.mode === 'pick' ? { trainerId: values.trainerId } : { shareLinkCode: values.shareLinkCode.trim() };

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
      <div className="w-full max-w-md rounded-md border border-[var(--border-soft)] bg-[var(--surface-1)] p-lg shadow-card-strong">
        <h2 id="add-trainer-heading" className="text-block-title font-semibold text-[var(--text-primary)]">
          Add a trainer
        </h2>

        <form onSubmit={onSubmit} noValidate className="mt-md flex flex-col gap-md">
          <fieldset className="flex flex-col gap-xxs">
            <legend className="text-body text-[var(--text-secondary)]">How would you like to add a trainer?</legend>
            <label className="flex items-center gap-sm text-body text-[var(--text-primary)]">
              <input type="radio" value="code" {...register('mode')} />
              Enter a share link code
            </label>
            {availableTrainers.length > 0 && (
              <label className="flex items-center gap-sm text-body text-[var(--text-primary)]">
                <input type="radio" value="pick" {...register('mode')} />
                Pick from my trainers
              </label>
            )}
          </fieldset>

          {mode === 'code' ? (
            <div className="flex flex-col gap-xxs">
              <label htmlFor="add-trainer-code" className="text-body text-[var(--text-secondary)]">
                Share link code
              </label>
              <input id="add-trainer-code" className={INPUT_CLASSNAME} {...register('shareLinkCode', { required: mode === 'code' })} />
            </div>
          ) : (
            <div className="flex flex-col gap-xxs">
              <label htmlFor="add-trainer-picker" className="text-body text-[var(--text-secondary)]">
                Trainer
              </label>
              <select id="add-trainer-picker" className={INPUT_CLASSNAME} defaultValue="" {...register('trainerId', { required: mode === 'pick' })}>
                <option value="" disabled>
                  Select…
                </option>
                {availableTrainers.map((trainer) => (
                  <option key={trainer.id} value={trainer.id}>
                    {trainer.businessName}
                  </option>
                ))}
              </select>
            </div>
          )}

          {formError && (
            <p role="alert" className="text-body text-[var(--danger)]">
              {formError}
            </p>
          )}

          <div className="mt-sm flex justify-end gap-sm">
            <button type="button" onClick={handleClose} className="rounded-sm p-sm text-body text-[var(--text-secondary)]">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-sm bg-[var(--brand-primary)] p-sm text-body font-semibold text-[#0D0D0D] shadow-button-primary disabled:opacity-60"
            >
              {isSubmitting ? 'Adding…' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
