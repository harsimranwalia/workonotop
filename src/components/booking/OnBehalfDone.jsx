'use client';

// What the admin sees when a booking for a customer has been made (ENG-013): the booking, whose account it is on, and the link to send the
// customer. The link is held in this component's props only. It is shown once: the server keeps a hash of it and cannot show it again.

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { formatMoney } from '@/components/booking/PriceBox';

function expiryText(instant) {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// `created` is { bookingId, bookingNumber, price, email, accountMatched, path, expiresAt }.
export default function OnBehalfDone({ created }) {
  const headingRef = useRef(null);
  const linkRef = useRef(null);
  const [copy, setCopy] = useState('idle');

  useEffect(() => {
    if (headingRef.current) headingRef.current.focus();
  }, []);

  const link = `${window.location.origin}${created.path}`;
  const expires = expiryText(created.expiresAt);
  const price = formatMoney(created.price);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopy('copied');
    } catch {
      setCopy('failed');
      if (linkRef.current) linkRef.current.select();
    }
  };

  return (
    <div className="max-w-2xl mx-auto bg-white rounded-[28px] shadow-lift border border-line overflow-hidden">
      <div className="px-5 sm:px-6 md:px-8 pt-6 pb-5 border-b border-line">
        <h2 ref={headingRef} tabIndex={-1} className="font-display text-xl sm:text-2xl font-semibold tracking-tight text-ink break-words focus:outline-none">
          Booking {created.bookingNumber} created
        </h2>
      </div>

      <div className="p-5 sm:p-6 md:p-8 space-y-5">
        <dl className="grid gap-2 text-sm sm:text-base">
          {price && (
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Price</dt>
              <dd className="font-semibold text-ink">{price}</dd>
            </div>
          )}
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Account</dt>
            <dd className="font-semibold text-ink text-right break-all">
              {created.accountMatched ? `On the account of ${created.email}` : 'No account: booked as a guest'}
            </dd>
          </div>
        </dl>

        <div>
          <label htmlFor="on-behalf-card-link" className="block text-sm font-semibold text-ink mb-1.5">
            Link for the customer to add their card
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              id="on-behalf-card-link"
              ref={linkRef}
              type="text"
              readOnly
              value={link}
              onFocus={(event) => event.target.select()}
              className="flex-1 min-w-0 p-3 border border-line rounded-xl text-sm text-ink bg-paper focus:outline-none focus:border-ink/40 focus:ring-4 focus:ring-brand-500/10"
            />
            <button
              type="button"
              onClick={copyLink}
              className="px-5 py-3 rounded-2xl bg-brand-500 text-white font-bold shadow-lg shadow-brand-600/20 transition hover:bg-brand-600 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/30"
            >
              {copy === 'copied' ? 'Copied' : 'Copy link'}
            </button>
          </div>
          <p role="status" className="mt-2 text-sm text-ink-soft">
            {copy === 'copied' && 'The link is copied.'}
            {copy === 'failed' && 'Copying is not available here. The link is selected: press Ctrl+C (Cmd+C on a Mac) to copy it.'}
          </p>
          {expires && <p className="mt-1 text-sm text-ink-soft">The link expires {expires}.</p>}
          <p className="mt-1 text-sm text-ink-soft">
            This link is shown once; to get another, open the booking and choose New link.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <Link
            href={`/admin/bookings/${created.bookingId}`}
            className="inline-flex items-center justify-center px-5 py-3 min-h-[52px] rounded-2xl bg-brand-500 text-white font-bold text-center shadow-lg shadow-brand-600/20 transition hover:bg-brand-600 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/30"
          >
            Open the booking
          </Link>
          <Link
            href="/admin/book"
            className="inline-flex items-center justify-center px-5 py-3 min-h-[52px] rounded-2xl border border-line bg-white text-ink font-bold text-center transition hover:border-ink/40 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/30"
          >
            Book for another customer
          </Link>
        </div>
      </div>
    </div>
  );
}
