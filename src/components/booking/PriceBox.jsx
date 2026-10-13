// Shows the price the server worked out for the current answers, or why there is none yet.
'use client';

import Link from 'next/link';
import { dayLabel } from '@/lib/booking-answers';

export const HOURS_MESSAGE_ID = 'price-hours-message';

const money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });

export function formatMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? money.format(amount) : '';
}

const SLOT_NAMES = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };

function StateText({ live }) {
  const { status } = live;
  if (status === 'loading' || status === 'updating' || status === 'stale_choices') {
    return (
      <p className="flex items-center text-gray-700 font-medium">
        <span aria-hidden="true" className="mr-2 inline-block h-4 w-4 rounded-full border-2 border-green-600 border-t-transparent motion-safe:animate-spin"></span>
        {status === 'loading' ? 'Working out your price…' : 'Updating price…'}
      </p>
    );
  }
  if (status === 'refused') {
    return live.field === 'hours'
      ? <p id={HOURS_MESSAGE_ID} className="text-amber-800 font-medium">Enter the number of hours (for example 2 or 2.5) to see your price.</p>
      : <p className="text-amber-800 font-medium">{live.message}</p>;
  }
  if (status === 'too_large') {
    return <p className="text-amber-800 font-medium">That&apos;s more than we can book online. Please lower a quantity.</p>;
  }
  if (status === 'unavailable') {
    return (
      <div>
        <p className="text-amber-800 font-medium">This service isn&apos;t available for booking right now.</p>
        <Link href="/services" className="mt-2 inline-block font-semibold text-green-700 underline hover:text-green-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600 rounded">
          Browse services
        </Link>
      </div>
    );
  }
  if (status === 'failed') {
    return (
      <div>
        <p className="text-red-700 font-medium">We couldn&apos;t update the price. Check your connection and try again.</p>
        <button
          type="button"
          onClick={live.retry}
          className="mt-3 px-4 py-2 rounded-lg border-2 border-green-700 text-green-700 font-semibold hover:bg-green-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
        >
          Try again
        </button>
      </div>
    );
  }
  return null;
}

// `live` is what useLivePrice returns. The other props are labels and notes: none of them is added to the price.
export default function PriceBox({ live, serviceName, overtimeRate, weekendAmount = null, firstDate = null, dates = [], times = {}, proNote = false }) {
  const priced = live.status === 'priced';
  const busy = live.status === 'loading' || live.status === 'updating' || live.status === 'stale_choices';
  const showRate = Number(overtimeRate) > 0;

  return (
    <section aria-label="Your price" aria-busy={busy} className="bg-white lg:rounded-2xl lg:border-2 lg:border-green-100 overflow-hidden lg:shadow-xl">
      <div className="hidden lg:block bg-gradient-to-r from-green-800 to-green-700 px-6 py-5">
        <h3 className="text-xl font-bold text-white flex items-center">
          <span className="mr-2" aria-hidden="true">📋</span>
          Booking summary
        </h3>
      </div>

      <div className="px-4 py-3 lg:p-6">
        {serviceName && (
          <div className="hidden lg:flex items-start space-x-3 mb-5 pb-5 border-b border-gray-200">
            <div className="bg-green-100 rounded-xl p-3">
              <span className="text-2xl" aria-hidden="true">🔧</span>
            </div>
            <h4 className="font-bold text-gray-900">{serviceName}</h4>
          </div>
        )}

        {dates.length > 0 && (
          <div className="hidden lg:block mb-5 pb-5 border-b border-gray-200">
            <h4 className="font-semibold text-gray-800 mb-3">Your schedule</h4>
            <ul className="bg-green-50 rounded-lg p-3 flex flex-col gap-3">
              {dates.map((date) => (
                <li key={date}>
                  <span className="text-sm font-medium text-gray-700 block mb-1">{dayLabel(date, 'long')}</span>
                  <span className="flex flex-wrap gap-1.5">
                    {(times[date] || []).map((slot) => (
                      <span key={slot} className="px-2 py-0.5 bg-green-700 text-white text-xs font-medium rounded-full">
                        {SLOT_NAMES[slot] || slot}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="lg:bg-green-50 lg:rounded-xl lg:p-4 lg:border lg:border-green-200 min-h-[3rem]">
          {priced ? (
            <div>
              <p className="text-sm uppercase tracking-wider text-gray-600">Your price</p>
              <p data-testid="price-total" className="text-2xl lg:text-3xl font-extrabold text-green-800">{formatMoney(live.price)}</p>
              <ul className="hidden lg:block mt-3 space-y-1 text-sm text-gray-700">
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
            <div className="hidden lg:flex border-t border-green-200 mt-3 pt-3 justify-between items-center text-sm">
              <span className="text-gray-700">Additional</span>
              <span className="font-bold text-green-800">+{formatMoney(overtimeRate)}</span>
            </div>
          )}
        </div>

        {live.choicesChanged && (
          <p className="mt-3 text-sm text-amber-800 bg-amber-50 rounded-lg p-3">Some choices for this service have changed. Please check your answers.</p>
        )}
        {weekendAmount != null && (
          <p className="mt-3 text-sm text-gray-700">Weekend dates add {formatMoney(weekendAmount)}. Your price updates when you pick a date.</p>
        )}
        {firstDate && (
          <p className="mt-3 text-sm text-gray-700">Your price is for your first date, {dayLabel(firstDate, 'weekday')}.</p>
        )}

        <div className="hidden lg:block mt-5 text-xs text-gray-600 space-y-2">
          <p>You won&apos;t be charged until the job is complete</p>
          <p>Free cancellation up to 24 hours before</p>
        </div>

        {proNote && (
          <div className="hidden lg:block mt-5 pt-5 border-t border-gray-200">
            <div className="bg-gradient-to-br from-green-50 to-white rounded-xl p-4 border border-green-100">
              <h4 className="font-semibold text-gray-800 mb-2 flex items-center">
                <span className="text-xl mr-2" aria-hidden="true">👨‍🔧</span>
                Who is my pro?
              </h4>
              <p className="text-sm text-gray-600">
                WorkOnTap will match you with certified, background-checked pros in your area once you submit your job.
              </p>
            </div>
          </div>
        )}

        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {priced ? `Price ${formatMoney(live.price)}` : ''}
        </div>
      </div>
    </section>
  );
}
