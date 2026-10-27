// Shows the price the server worked out for the current answers, or why there is none yet.
'use client';

import Link from 'next/link';
import { ClipboardList, UserCheck, Wrench } from 'lucide-react';
import { dayLabel } from '@/lib/booking-answers';

export const HOURS_MESSAGE_ID = 'price-hours-message';

const money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });

export function formatMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? money.format(amount) : '';
}

const SLOT_NAMES = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };

// The sentences that say why there is no price. The page shows each one and the live region announces it, so each is written once.
const HOURS_SENTENCE = 'Enter the number of hours (for example 2 or 2.5) to see your price.';
const TOO_LARGE_SENTENCE = "That's more than we can book online. Please lower a quantity.";
const UNAVAILABLE_SENTENCE = "This service isn't available for booking right now.";
const FAILED_SENTENCE = "We couldn't update the price. Check your connection and try again.";
const QUOTE_SENTENCE = "This one needs a quote. We can't price it from a few taps.";

// What a screen reader is told when the price settles: the figure, or the sentence that says why there is none. Nothing while it is worked out.
function announcementOf(live) {
  if (live.status === 'priced') return `Price ${formatMoney(live.price)}`;
  if (live.status === 'quote') return QUOTE_SENTENCE;
  if (live.status === 'refused') return live.field === 'hours' ? HOURS_SENTENCE : live.message;
  if (live.status === 'too_large') return TOO_LARGE_SENTENCE;
  if (live.status === 'unavailable') return UNAVAILABLE_SENTENCE;
  if (live.status === 'failed') return FAILED_SENTENCE;
  return '';
}

function StateText({ live }) {
  const { status } = live;
  if (status === 'loading' || status === 'updating' || status === 'stale_choices') {
    return (
      <p className="flex items-center text-ink-soft font-medium">
        <span aria-hidden="true" className="mr-2 inline-block h-4 w-4 rounded-full border-2 border-brand-500 border-t-transparent motion-safe:animate-spin"></span>
        {status === 'loading' ? 'Working out your price…' : 'Updating price…'}
      </p>
    );
  }
  if (status === 'quote') {
    return <p data-testid="price-quote" className="text-brand-900 font-semibold">{QUOTE_SENTENCE}</p>;
  }
  if (status === 'refused') {
    return live.field === 'hours'
      ? <p id={HOURS_MESSAGE_ID} className="text-amber-800 font-medium">{HOURS_SENTENCE}</p>
      : <p className="text-amber-800 font-medium">{live.message}</p>;
  }
  if (status === 'too_large') {
    return <p className="text-amber-800 font-medium">{TOO_LARGE_SENTENCE}</p>;
  }
  if (status === 'unavailable') {
    return (
      <div>
        <p className="text-amber-800 font-medium">{UNAVAILABLE_SENTENCE}</p>
        <Link href="/services" className="mt-2 inline-block font-semibold text-brand-700 underline hover:text-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded">
          Browse services
        </Link>
      </div>
    );
  }
  if (status === 'failed') {
    return (
      <div>
        <p className="text-red-700 font-medium">{FAILED_SENTENCE}</p>
        <button
          type="button"
          onClick={live.retry}
          className="mt-3 px-4 py-2 rounded-2xl border border-line bg-white text-ink font-semibold transition hover:border-ink/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          Try again
        </button>
      </div>
    );
  }
  return null;
}

// `live` is what useLivePrice returns. The other props are labels and notes: none of them is added to the price. A job that needs a quote has no
// price and is not booked, so the notes about a price, a charge, a cancellation or a pro are left out while it is on screen.
export default function PriceBox({ live, serviceName, overtimeRate, weekendAmount = null, firstDate = null, dates = [], times = {}, proNote = false }) {
  const priced = live.status === 'priced';
  const quote = live.status === 'quote';
  const busy = live.status === 'loading' || live.status === 'updating' || live.status === 'stale_choices';
  const showRate = !quote && Number(overtimeRate) > 0;

  return (
    <section aria-label="Your price" aria-busy={busy} className="bg-white lg:rounded-[28px] lg:border lg:border-line overflow-hidden lg:shadow-lift">
      <div className="hidden lg:block px-6 pt-6 pb-5 border-b border-line">
        <h3 className="font-display text-2xl font-semibold tracking-tight text-ink flex items-center">
          <ClipboardList className="mr-2.5 h-5 w-5 text-brand-600" aria-hidden="true" />
          Booking summary
        </h3>
      </div>

      <div className="px-4 py-3 lg:p-6">
        {serviceName && (
          <div className="hidden lg:flex items-center space-x-3 mb-5 pb-5 border-b border-line">
            <div className="shrink-0 bg-brand-50 border border-brand-100 rounded-2xl p-3">
              <Wrench className="h-5 w-5 text-brand-600" aria-hidden="true" />
            </div>
            <h4 className="font-semibold text-ink leading-snug">{serviceName}</h4>
          </div>
        )}

        {dates.length > 0 && (
          <div className="hidden lg:block mb-5 pb-5 border-b border-line">
            <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted mb-3">Your schedule</h4>
            <ul className="bg-paper border border-line rounded-2xl p-3.5 flex flex-col gap-3">
              {dates.map((date) => (
                <li key={date}>
                  <span className="text-sm font-medium text-ink block mb-1.5">{dayLabel(date, 'long')}</span>
                  <span className="flex flex-wrap gap-1.5">
                    {(times[date] || []).map((slot) => (
                      <span key={slot} className="px-2.5 py-0.5 bg-brand-50 border border-brand-100 text-brand-700 text-xs font-semibold rounded-full">
                        {SLOT_NAMES[slot] || slot}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="lg:bg-brand-50 lg:rounded-2xl lg:p-4 lg:border lg:border-brand-100 min-h-[3rem]">
          {priced ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">Your price</p>
              <p data-testid="price-total" className="font-display text-2xl lg:text-4xl font-semibold tracking-tight text-ink">{formatMoney(live.price)}</p>
              <ul className="hidden lg:block mt-3 space-y-1.5 text-sm text-ink-soft">
                {live.lines.map((line, index) => (
                  <li key={`${line.kind}-${line.code}-${index}`} data-testid="price-line" className="flex justify-between gap-3">
                    <span>{line.label}{Number(line.quantity) > 1 ? ` × ${line.quantity}` : ''}</span>
                    <span className="font-medium">{formatMoney(line.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <StateText live={live} />
          )}

          {showRate && (
            <div className="hidden lg:flex border-t border-brand-100 mt-3 pt-3 justify-between items-center text-sm">
              <span className="text-ink-soft">Additional</span>
              <span className="font-bold text-brand-700">+{formatMoney(overtimeRate)}</span>
            </div>
          )}
        </div>

        {live.choicesChanged && (
          <p className="mt-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-2xl p-3">Some choices for this service have changed. Please check your answers.</p>
        )}
        {!quote && weekendAmount != null && (
          <p className="mt-3 text-sm text-ink-soft">Weekend dates add {formatMoney(weekendAmount)}. Your price updates when you pick a date.</p>
        )}
        {!quote && firstDate && (
          <p className="mt-3 text-sm text-ink-soft">Your price is for your first date, {dayLabel(firstDate, 'weekday')}.</p>
        )}

        {!quote && (
          <div className="hidden lg:block mt-5 text-xs text-ink-muted space-y-2">
            <p>You won&apos;t be charged until the job is complete</p>
            <p>Free cancellation up to 24 hours before</p>
          </div>
        )}

        {proNote && !quote && (
          <div className="hidden lg:block mt-5 pt-5 border-t border-line">
            <div className="bg-paper rounded-2xl p-4 border border-line">
              <h4 className="font-semibold text-ink mb-2 flex items-center">
                <UserCheck className="h-5 w-5 mr-2 text-brand-600" aria-hidden="true" />
                Who is my pro?
              </h4>
              <p className="text-sm text-ink-muted leading-relaxed">
                WorkOnTap will match you with certified, background-checked pros in your area once you submit your job.
              </p>
            </div>
          </div>
        )}

        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {announcementOf(live)}
        </div>
      </div>
    </section>
  );
}
