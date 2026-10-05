'use client';

// api §4.3 GET /player-profiles/:id/trainers — `{ trainerId, businessName,
// logoUrl, connectedAt, status }[]`, reproduced verbatim (the real backend
// type is `TrainerRowForProfile`, apps/server/.../player-profiles.repository.ts).
export interface TrainerAssociationRow {
  trainerId: string;
  businessName: string;
  logoUrl: string | null;
  connectedAt: string;
  status: string;
}

export interface TrainerAssociationListProps {
  trainers: TrainerAssociationRow[];
  /** `false` for a `typ: CHILD` session — `MANAGE_TRAINER_ASSOCIATIONS` is CHILD-denied (FR-051, api §4.3). */
  canManage: boolean;
  onAddTrainer: () => void;
  onRemoveTrainer: (trainer: TrainerAssociationRow) => void;
}

// fe §4.6 — TrainerAssociationList: `/profiles/[id]`'s per-child trainer
// list with dates (api §4.3, FR-032). Purely presentational — the actual
// add/remove flows (`AddTrainerModal`/`RemoveTrainerConfirmModal`) are Task
// 14.5; this component only calls back up to the page when a trigger fires.
// Task 14.4.
export function TrainerAssociationList({ trainers, canManage, onAddTrainer, onRemoveTrainer }: TrainerAssociationListProps) {
  return (
    <div className="flex flex-col gap-md">
      <div className="flex items-center justify-between">
        <h2 className="text-body-lg font-semibold text-text-primary">Trainers</h2>
        {canManage && (
          <button
            type="button"
            onClick={onAddTrainer}
            className="btn btn-secondary btn-sm"
          >
            Add Trainer
          </button>
        )}
      </div>

      {trainers.length === 0 ? (
        <p role="status" className="text-body text-text-secondary">
          No trainers yet — add one to get started.
        </p>
      ) : (
        <div role="table" aria-label="Trainer associations" className="rounded-md border border-border-soft">
          {trainers.map((trainer) => (
            <div
              key={trainer.trainerId}
              role="row"
              aria-label={trainer.businessName}
              className="flex items-center gap-md border-b border-border-soft/40 p-md text-body text-text-primary last:border-b-0"
            >
              <span className="flex-1 truncate">{trainer.businessName}</span>
              <span className="text-caption text-text-secondary">Connected {new Date(trainer.connectedAt).toLocaleDateString()}</span>
              <span className="text-caption text-text-secondary">{trainer.status}</span>
              {canManage && (
                <button
                  type="button"
                  onClick={() => onRemoveTrainer(trainer)}
                  className="btn btn-secondary btn-danger-outline btn-sm"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
