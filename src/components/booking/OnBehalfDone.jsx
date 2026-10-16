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
    <div className="max-w-2xl mx-auto bg-white rounded-xl sm:rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
      <div className="bg-gradient-to-r from-green-800 to-green-700 px-4 sm:px-6 py-4 sm:py-5">
        <h2 ref={headingRef} tabIndex={-1} className="text-lg sm:text-xl md:text-2xl font-bold text-white focus:outline-none">
          Booking {created.bookingNumber} created
        </h2>
      </div>

      <div className="p-4 sm:p-6 md:p-8 space-y-5">
        <dl className="grid gap-2 text-sm sm:text-base">
          {price && (
            <div className="flex justify-between gap-4">
              <dt className="text-gray-600">Price</dt>
              <dd className="font-semibold text-gray-900">{price}</dd>
            </div>
          )}
          <div className="flex justify-between gap-4">
            <dt className="text-gray-600">Account</dt>
            <dd className="font-semibold text-gray-900 text-right break-all">
              {created.accountMatched ? `On the account of ${created.email}` : 'No account: booked as a guest'}
            </dd>
          </div>
        </dl>

        <div>
          <label htmlFor="on-behalf-card-link" className="block text-sm font-semibold text-gray-800 mb-1">
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
              className="flex-1 min-w-0 p-3 border-2 border-gray-200 rounded-xl text-sm text-gray-800 bg-gray-50 focus:outline-none focus:border-green-700 focus:ring-2 focus:ring-green-700/30"
            />
            <button
              type="button"
              onClick={copyLink}
              className="px-5 py-3 rounded-xl bg-green-700 text-white font-bold hover:bg-green-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-green-700/40"
            >
              {copy === 'copied' ? 'Copied' : 'Copy link'}
            </button>
          </div>
          <p role="status" className="mt-2 text-sm text-gray-700">
            {copy === 'copied' && 'The link is copied.'}
            {copy === 'failed' && 'Copying is not available here. The link is selected: press Ctrl+C (Cmd+C on a Mac) to copy it.'}
          </p>
          {expires && <p className="mt-1 text-sm text-gray-700">The link expires {expires}.</p>}
          <p className="mt-1 text-sm text-gray-700">
            This link is shown once; to get another, open the booking and choose New link.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <Link
            href={`/admin/bookings/${created.bookingId}`}
            className="px-5 py-3 rounded-xl border-2 border-green-700 text-green-700 font-bold text-center hover:bg-green-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-green-700/40"
          >
            Open the booking
          </Link>
          <Link
            href="/admin/book"
            className="px-5 py-3 rounded-xl border-2 border-gray-300 text-gray-800 font-bold text-center hover:bg-gray-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-green-700/40"
          >
            Book for another customer
          </Link>
        </div>
      </div>
    </div>
  );
}
