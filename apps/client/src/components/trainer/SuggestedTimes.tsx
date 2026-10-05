'use client';

import { FILTER_CARD_CLASSNAME } from '../shared/filterCard';

// GET /trainers/me/players/suggested-times (spec US-01.09 "Suggest session
// times matching most players' availability") - already ranked and labelled
// by the server, so this only renders it.
export interface SuggestedTime {
  dayOfWeek: number;
  startTime: number;
  endTime: number;
  /** e.g. "Mon 5:00-8:00 PM" */
  label: string;
  availableCount: number;
}

export interface SuggestedTimesProps {
  items: SuggestedTime[];
  /** Active players on the roster (the "Y" in "X out of Y"). */
  totalCount: number;
  isError?: boolean;
}

// The roster page's own card (same card styling as the filter bar above it).
export function SuggestedTimes({ items, totalCount, isError = false }: SuggestedTimesProps) {
  return (
    <section aria-labelledby="suggested-times-heading" className={`flex flex-col gap-xs ${FILTER_CARD_CLASSNAME}`}>
      <h2 id="suggested-times-heading" className="text-body-lg font-semibold text-ink">
        Suggested times
      </h2>

      {isError ? (
        <p role="alert" className="text-body text-danger">
          Could not load suggested times. Please try again.
        </p>
      ) : items.length === 0 ? (
        <p className="text-body text-text-secondary">Suggested times appear once your players have set their availability.</p>
      ) : (
        <ul className="flex flex-col gap-xxs">
          {items.map((item) => (
            <li key={`${item.dayOfWeek}-${item.startTime}-${item.endTime}`} className="text-body text-text-secondary">
              <span className="font-semibold text-ink">{item.label}</span> - {item.availableCount} out of {totalCount} players
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
