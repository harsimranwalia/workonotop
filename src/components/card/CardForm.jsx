'use client';

// The card page of a card link (ENG-013). It reads the link (GET /api/card/{token}), asks for a card entry (POST .../setup), lets Stripe's own field take the
// card number, then names the SetupIntent to the server (POST .../confirm), which believes only Stripe's answer. The card number never reaches this server.
// Nothing is charged here: the one charge is taken when the job is done. The token is read from the address once and kept in the page's props; it is not written
// to storage, to the title or to the console. A return from a bank's own authentication page brings the SetupIntent id in the query; it is confirmed and the query is
// cleared from the address. A reload is handed the same card entry (the server keeps it), and a confirm that fails at Stripe asks for a new one (ENG-013 F7).

import { useCallback, useEffect, useRef, useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { dayLabel } from '@/lib/booking-answers';
import { formatMoney } from '@/components/booking/PriceBox';

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const SETUP_INTENT_ID = /^seti_[A-Za-z0-9_]+$/;

const INVALID_TEXT = "This link isn't valid or has expired. Ask WorkOnTap for a new one.";
const UNAVAILABLE_TEXT = 'Card entry is not available right now. Please try again shortly.';
const FAILED_TEXT = 'Something went wrong. Check your connection, then try again.';
const NOT_SAVED_TEXT = 'This card could not be saved. Please try another card.';

const FOCUS = 'focus:outline-none focus-visible:ring-4 focus-visible:ring-green-700/40';

let stripePromise = null;
function stripeClient() {
  if (!stripePromise) stripePromise = loadStripe(PUBLISHABLE_KEY);
  return stripePromise;
}

// The SetupIntent id a bank's page returns to this address with, taken out of the address at once: the query also holds the intent's client secret.
function takeReturnedSetupIntent() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('setup_intent');
  if (params.has('setup_intent') || params.has('setup_intent_client_secret') || params.has('redirect_status')) {
    window.history.replaceState(null, '', window.location.pathname);
  }
  return id && SETUP_INTENT_ID.test(id) ? id : null;
}

// The price as money, or '' when the link carries none: formatMoney reads null as zero, and a card page never says the job costs $0.00.
function priceText(booking) {
  return booking && typeof booking.price === 'number' && Number.isFinite(booking.price) ? formatMoney(booking.price) : '';
}

function cardWords(card) {
  if (!card || typeof card !== 'object') return 'Your card';
  const brand = typeof card.brand === 'string' ? card.brand.replace(/_/g, ' ').trim() : '';
  const name = brand && brand !== 'unknown' ? brand.charAt(0).toUpperCase() + brand.slice(1) : 'Card';
  return typeof card.last4 === 'string' && card.last4 ? `${name} •••• ${card.last4}` : name;
}

async function sendJson(path, body) {
  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    console.error('The card request could not be sent:', error?.name);
    return { status: 0, data: null };
  }
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

function Spinner() {
  return (
    <svg aria-hidden="true" className="motion-safe:animate-spin h-5 w-5 text-gray-700" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
  );
}

function Summary({ booking }) {
  const date = booking && typeof booking.job_date === 'string' ? dayLabel(booking.job_date, 'long') : '';
  const slot = booking && typeof booking.job_time_slot === 'string' ? booking.job_time_slot.trim() : '';
  const rows = [
    ['Service', booking && typeof booking.service_name === 'string' ? booking.service_name : ''],
    ['Date', date],
    ['Time', slot],
    ['Price', priceText(booking)],
  ].filter(([, value]) => value);
  if (rows.length === 0) return null;
  return (
    <dl className="mb-5 grid gap-2 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm sm:text-base">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4">
          <dt className="text-gray-700">{label}</dt>
          <dd className="font-semibold text-right text-gray-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// The card field and the button. `onSaved(card)` is called when the server has the card; `onFailure(kind, text)` when the entry cannot go on, with
// 'retry' and Stripe's words when the confirm failed and the page should start a new entry.
function CardEntry({ confirmPath, onSaved, onFailure }) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!stripe || !elements || busy.current) return;
    busy.current = true;
    setProcessing(true);
    setError('');

    const result = await stripe.confirmSetup({
      elements,
      redirect: 'if_required',
      confirmParams: { return_url: `${window.location.origin}${window.location.pathname}` },
    });
    if (result.error) {
      if (result.error.type === 'validation_error') {
        // Stripe.js refused the fields before anything was sent (an incomplete card number, say): the entry is as it was, so the form stays as it is.
        setError(result.error.message || NOT_SAVED_TEXT);
      } else {
        // The confirm reached Stripe and failed. Whoever holds this client secret can confirm the same SetupIntent again and this server never sees it,
        // so the page asks for a new entry instead: the server reads the failure on the old one and spends one of the link's tries on the next.
        onFailure('retry', result.error.message || NOT_SAVED_TEXT);
        return;
      }
    } else if (result.setupIntent && result.setupIntent.status === 'succeeded') {
      const saved = await sendJson(confirmPath, { setup_intent_id: result.setupIntent.id });
      if (saved.status === 200 && saved.data && saved.data.success === true) {
        onSaved(saved.data.card);
        return;
      }
      if (saved.status === 409) {
        onFailure('onfile');
        return;
      }
      if (saved.status === 404) {
        onFailure('invalid');
        return;
      }
      if (saved.status === 503) {
        onFailure('unavailable');
        return;
      }
      setError(saved.status === 400 ? NOT_SAVED_TEXT : FAILED_TEXT);
    } else {
      setError(NOT_SAVED_TEXT);
    }
    busy.current = false;
    setProcessing(false);
  };

  return (
    <form onSubmit={submit} aria-busy={processing}>
      <PaymentElement />
      {error && (
        <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      <p role="status" className="sr-only">{processing ? 'Saving your card' : ''}</p>
      <button
        type="submit"
        disabled={!stripe || !elements || processing}
        className={`mt-5 w-full py-3 sm:py-4 rounded-xl font-bold text-base sm:text-lg shadow-lg flex items-center justify-center gap-3 ${FOCUS}
          ${!stripe || !elements || processing ? 'bg-gray-300 text-gray-700 cursor-not-allowed' : 'bg-green-700 text-white hover:bg-green-800'}`}
      >
        {processing ? (<><Spinner />Saving card...</>) : 'Save card'}
      </button>
    </form>
  );
}

export default function CardForm({ token }) {
  // 'loading' | 'ready' | 'saved' | 'onfile' | 'invalid' | 'unavailable' | 'failed'
  const [view, setView] = useState('loading');
  const [booking, setBooking] = useState(null);
  const [card, setCard] = useState(null);
  const [clientSecret, setClientSecret] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const headingRef = useRef(null);
  // The id taken from the address on the first run of the effect; a second run of it (the development build runs effects twice) finds the address already clean.
  const returned = useRef(undefined);

  useEffect(() => {
    let alive = true;
    const base = `/api/card/${encodeURIComponent(token)}`;
    if (returned.current === undefined) returned.current = takeReturnedSetupIntent();

    async function load() {
      setView('loading');
      let res;
      try {
        res = await fetch(base, { cache: 'no-store' });
      } catch (error) {
        console.error('The card link could not be read:', error?.name);
        if (alive) setView('failed');
        return;
      }
      const data = await res.json().catch(() => null);
      if (!alive) return;
      if (res.status === 404) return setView('invalid');
      if (res.status !== 200 || !data || data.success !== true) return setView('failed');
      setBooking(data.booking || null);
      if (data.state === 'used') {
        setCard(data.card || null);
        return setView('onfile');
      }
      if (!PUBLISHABLE_KEY) return setView('unavailable');

      if (returned.current) {
        const id = returned.current;
        returned.current = null;
        const saved = await sendJson(`${base}/confirm`, { setup_intent_id: id });
        if (!alive) return;
        if (saved.status === 200 && saved.data && saved.data.success === true) {
          setCard(saved.data.card || null);
          return setView('saved');
        }
        if (saved.status === 409) {
          setAttempt((n) => n + 1);
          return;
        }
        setNotice(NOT_SAVED_TEXT);
      }

      const started = await sendJson(`${base}/setup`);
      if (!alive) return;
      if (started.status === 200 && started.data && typeof started.data.client_secret === 'string') {
        setClientSecret(started.data.client_secret);
        return setView('ready');
      }
      if (started.status === 404) return setView('invalid');
      if (started.status === 409) {
        setAttempt((n) => n + 1);
        return;
      }
      setView(started.status === 503 ? 'unavailable' : 'failed');
    }

    load();
    return () => {
      alive = false;
    };
  }, [token, attempt]);

  // A finished or failed screen takes focus, so a keyboard or screen reader user lands on what happened.
  useEffect(() => {
    if (view !== 'loading' && view !== 'ready' && headingRef.current) headingRef.current.focus();
  }, [view]);

  const finish = useCallback((next, text) => {
    if (next === 'onfile') {
      setAttempt((n) => n + 1);
    } else if (next === 'retry') {
      setNotice(text || NOT_SAVED_TEXT);
      setAttempt((n) => n + 1);
    } else {
      setView(next);
    }
  }, []);
  const saved = useCallback((savedCard) => {
    setCard(savedCard || null);
    setView('saved');
  }, []);

  const base = `/api/card/${encodeURIComponent(token)}`;
  const price = priceText(booking);
  const heading = (text) => (
    <h2 ref={headingRef} tabIndex={-1} className="text-xl sm:text-2xl font-bold text-gray-900 mb-3 focus:outline-none">{text}</h2>
  );

  let body;
  if (view === 'loading') {
    body = (
      <p role="status" className="flex items-center gap-3 text-gray-800">
        <Spinner />
        Loading your booking...
      </p>
    );
  } else if (view === 'invalid') {
    body = (
      <>
        {heading('This link cannot be used')}
        <p className="text-gray-800">{INVALID_TEXT}</p>
      </>
    );
  } else if (view === 'unavailable' || view === 'failed') {
    body = (
      <>
        {heading(view === 'unavailable' ? 'Card entry is not available' : 'Something went wrong')}
        <p className="text-gray-800">{view === 'unavailable' ? UNAVAILABLE_TEXT : FAILED_TEXT}</p>
        <button type="button" onClick={() => setAttempt((n) => n + 1)} className={`mt-4 px-5 py-3 rounded-xl border-2 border-green-700 text-green-800 font-bold hover:bg-green-50 ${FOCUS}`}>
          Try again
        </button>
      </>
    );
  } else if (view === 'onfile' || view === 'saved') {
    body = (
      <>
        {heading(view === 'saved' ? 'Your card is saved' : 'A card is already on file')}
        <Summary booking={booking} />
        <p className="text-gray-800">
          <strong className="font-semibold text-gray-900">{cardWords(card)}</strong> is on file for this booking.
          {price ? ` ${price} is charged to it when the job is done.` : ' The price of the job is charged to it when the job is done.'} Nothing else is needed. You can close this page.
        </p>
      </>
    );
  } else {
    body = (
      <>
        <Summary booking={booking} />
        <p className="mb-5 text-gray-800">
          Nothing is charged now. {price ? `${price} is` : 'The price of the job is'} charged to this card when the job is done.
        </p>
        {notice && (
          <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {notice}
          </div>
        )}
        <Elements stripe={stripeClient()} options={{ clientSecret }}>
          <CardEntry confirmPath={`${base}/confirm`} onSaved={saved} onFailure={finish} />
        </Elements>
      </>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-lg rounded-2xl border border-gray-100 bg-white p-5 sm:p-8 shadow-lg">
        <h1 className="mb-5 text-sm font-semibold uppercase tracking-wide text-green-800">WorkOnTap: add your card</h1>
        {body}
      </div>
    </main>
  );
}
