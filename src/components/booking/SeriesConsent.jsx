// The line that tells a customer how a booking that repeats is paid. The confirm step and the payment step both show it, so its text is written once.
'use client';

import { isRepeating } from '@/lib/when-and-where';

const CONSENT_TEXT = 'Your card is held for the first visit now. Each visit is charged to this card when it is done, for the price shown for that visit.';

// `answers` are the booking's answers: the line shows when they hold a frequency and nothing shows for a booking of one visit. `className` places the line on the page.
export default function SeriesConsent({ answers, className = '' }) {
  if (!isRepeating(answers?.frequency)) return null;

  return (
    <p data-testid="series-consent" className={`text-xs sm:text-sm text-gray-700 ${className}`.trim()}>
      {CONSENT_TEXT}
    </p>
  );
}
