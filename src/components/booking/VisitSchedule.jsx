// The visits of a booking that repeats, each with its date and the price the server worked out for that visit.
'use client';

import { dayLabel } from '@/lib/booking-answers';
import { isRepeating } from '@/lib/when-and-where';
import { formatMoney } from '@/components/booking/PriceBox';

const HEADING_ID = 'visit-schedule-heading';
const BUSY_STATUSES = ['loading', 'updating', 'stale_choices'];

// A visit is listed when it has a date and a price to show.
const listable = (visit) => (
  Boolean(visit) && typeof visit.date === 'string' && visit.price != null && visit.price !== '' && formatMoney(visit.price) !== ''
);

// `live` is what useLivePrice returns; its answers say whether the booking repeats. The list shows once the price is worked out and a status line
// shows until then. With no price (refused, too large, unavailable or failed) nothing shows: the price box says why. `className` places the section.
export default function VisitSchedule({ live, className = '' }) {
  const { frequency, date } = live.answers || {};
  if (!isRepeating(frequency) || typeof date !== 'string' || date === '') return null;

  const busy = BUSY_STATUSES.includes(live.status);
  // A visit keeps its own number, counted from the first, whichever visits are listed.
  const listed = (Array.isArray(live.visits) ? live.visits : [])
    .map((visit, index) => ({ visit, number: index + 1 }))
    .filter(({ visit }) => listable(visit));
  if (!busy && listed.length === 0) return null;

  return (
    <section
      data-testid="visit-schedule"
      aria-labelledby={HEADING_ID}
      aria-busy={busy}
      className={`rounded-xl sm:rounded-2xl border border-brand-100 bg-brand-50 p-3 sm:p-4 ${className}`.trim()}
    >
      <h3 id={HEADING_ID} className="font-semibold text-ink text-sm sm:text-base mb-2">Your visits</h3>
      {busy ? (
        <p role="status" aria-live="polite" aria-atomic="true" className="flex items-center text-xs sm:text-sm text-ink-soft font-medium">
          <span aria-hidden="true" className="mr-2 inline-block h-4 w-4 rounded-full border-2 border-brand-500 border-t-transparent motion-safe:animate-spin"></span>
          {live.status === 'loading' ? 'Working out your visits…' : 'Updating visits…'}
        </p>
      ) : (
        <ol role="list" className="divide-y divide-brand-100 text-xs sm:text-sm text-ink">
          {listed.map(({ visit, number }) => (
            <li key={number} data-testid="visit-line" className="py-1.5 first:pt-0 last:pb-0">
              {`Visit ${number} · ${dayLabel(visit.date, 'weekday')} · ${formatMoney(visit.price)}`}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
