// The "Quote requests" section at the top of the admin jobs page (ENG-012): the requests customers sent for jobs the price rule would not price,
// newest first, 20 at a time. It reads them (GET /api/quote-requests). A request with no booking has a "Book this" button, which opens the booking
// flow in the on-behalf mode (ENG-013) at the request's service, with the request's answers as the selections and its contact filled in; a request
// with a booking shows a link to that booking. It does not answer, price or clear a request, and it never mixes them into the job queue below it.
// With no requests it shows nothing, but a load that fails is always shown, because a quiet failure would hide a customer from the team.
'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { selectionsFromAnswers, startOnBehalf } from '@/lib/on-behalf';

// How many requests each call asks for. "Show more" asks for the next PAGE_SIZE after the ones already shown.
const PAGE_SIZE = 20;

const LOAD_FAILED_TEXT = "Couldn't load quote requests";
const BOOK_FAILED_TEXT = "Couldn't open the booking. Try again.";
const MORE_FAILED_TEXT = "Couldn't load more quote requests. The ones above are still shown.";
const LOADING_MORE_TEXT = 'Loading more quote requests...';
// Printed beside a pick whose answer sent the job to a quote. It is text, so it does not lean on colour and a screen reader reads it with the pick.
const FLAGGED_TEXT = 'Needs quote';

const EMAIL_MAX = 254;
// An address becomes a mailto: link only when it is plainly safe to put in one: a single @, a dot in the domain, and none of the characters that
// could end the address early or add a second recipient or a header (spaces, angle brackets, quotes, commas, semicolons, ? & % and the like).
// Anything else is shown as plain text.
const SAFE_EMAIL = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

const isObject = (value) => value !== null && typeof value === 'object';

// A field as text to show, or '' when it is missing or not text, so one odd row cannot crash the list.
const textOf = (value) => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');

function mailtoOf(email) {
  return email.length <= EMAIL_MAX && SAFE_EMAIL.test(email) ? `mailto:${email}` : null;
}

// A tel: link from the digits of a phone number, keeping a leading +. Spaces, brackets, dots and dashes are dropped; null when no digit is left.
function telOf(phone) {
  const digits = phone.replace(/\D/g, '');
  return digits ? `tel:${phone.startsWith('+') ? '+' : ''}${digits}` : null;
}

// The send time of a request, as a Date; null when the date is missing or cannot be read.
function sentAt(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// An id a request carries (its own, its service's, its booking's) as a positive whole number, or null when it is missing or is not one, so only a
// real id reaches the booking flow or an address.
function wholeIdOf(value) {
  const id = typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// A request's answers as an object. The route sends them parsed; text that carries JSON is parsed here, and anything else is no answers.
function answersOf(value) {
  let answers = value;
  if (typeof answers === 'string') {
    try {
      answers = JSON.parse(answers);
    } catch {
      return {};
    }
  }
  return isObject(answers) && !Array.isArray(answers) ? answers : {};
}

// The contact the booking flow fills in from a request. A single name is split at its first space: the first word is the first name and the rest
// is the last name. A part the request does not carry is ''.
function contactOf(row) {
  const name = textOf(row.customer_name).trim();
  const space = name.search(/\s/);
  return {
    first_name: space === -1 ? name : name.slice(0, space),
    last_name: space === -1 ? '' : name.slice(space).trim(),
    email: textOf(row.customer_email).trim(),
    phone: textOf(row.customer_phone).trim(),
  };
}

// One page of requests as the route answers it: { rows, total }. Throws when the call fails, when the session is not an admin (401 or 403) and when
// the answer is not the shape the route promises, so every kind of failure reaches the screen the same way.
async function fetchPage(offset, signal) {
  const res = await fetch(`/api/quote-requests?limit=${PAGE_SIZE}&offset=${offset}`, { signal });
  const body = await res.json();
  const total = Number(body?.total);
  if (!res.ok || !body?.success || !Array.isArray(body.data) || !Number.isFinite(total)) throw new Error('Failed to load quote requests');
  return { rows: body.data.filter(isObject), total };
}

const ringOf = (isDarkMode) => `focus:outline-none focus-visible:ring-2 ${isDarkMode ? 'focus-visible:ring-teal-400' : 'focus-visible:ring-teal-600'}`;

function ActionButton({ onClick, disabled, describedBy, isDarkMode, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-describedby={describedBy}
      className={`px-4 py-2 rounded-xl text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-offset-2 ${
        isDarkMode ? 'focus-visible:ring-offset-slate-950' : 'focus-visible:ring-offset-slate-50'
      } ${ringOf(isDarkMode)}`}
    >
      {children}
    </button>
  );
}

function ContactLink({ href, isDarkMode, children }) {
  return (
    <a
      href={href}
      className={`underline underline-offset-2 rounded ${isDarkMode ? 'text-teal-400 hover:text-teal-300' : 'text-teal-700 hover:text-teal-800'} ${ringOf(isDarkMode)}`}
    >
      {children}
    </a>
  );
}

// A labelled value in a request's list of details; `wide` spans both columns.
function Detail({ label, isDarkMode, wide, children }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className={`text-[10px] font-semibold uppercase tracking-wide mb-0.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>{label}</dt>
      <dd className={`text-sm break-words ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>{children}</dd>
    </div>
  );
}

// One answer the customer picked. A flagged one (the answer that sent the job to a quote) carries FLAGGED_TEXT as well as the amber colour.
function PickChip({ pick, isDarkMode }) {
  const label = textOf(pick.label) || textOf(pick.code) || 'Unnamed pick';
  const quantity = Number(pick.quantity);
  const flagged = pick.flagged === true;
  const look = flagged
    ? isDarkMode ? 'bg-amber-900/20 text-amber-400 ring-amber-800' : 'bg-amber-50 text-amber-700 ring-amber-200'
    : isDarkMode ? 'bg-slate-800 text-slate-200 ring-slate-700' : 'bg-slate-100 text-slate-700 ring-slate-200';
  return (
    <li className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ring-1 ${look}`}>
      <span>{quantity > 1 ? `${label} x ${quantity}` : label}</span>
      {flagged && <span className="pl-1.5 border-l border-current font-semibold">{FLAGGED_TEXT}</span>}
    </li>
  );
}

// The link to the booking made from a request. The text is the booking number, or the booking's id when the number is missing; it is a link only
// when the booking's id is a real one.
function BookedLink({ row, isDarkMode }) {
  const id = wholeIdOf(row.booking_id);
  const reference = textOf(row.booking_number).trim() || textOf(row.booking_id).trim();
  const label = reference ? `Booked #${reference}` : 'Booked';
  return (
    <p className="mt-4 text-sm font-semibold">
      {id === null ? (
        <span className={isDarkMode ? 'text-slate-200' : 'text-slate-700'}>{label}</span>
      ) : (
        <Link
          href={`/admin/bookings/${id}`}
          className={`underline underline-offset-2 rounded ${isDarkMode ? 'text-teal-400 hover:text-teal-300' : 'text-teal-700 hover:text-teal-800'} ${ringOf(isDarkMode)}`}
        >
          {label}
        </Link>
      )}
    </p>
  );
}

// "Book this": opens the booking flow in the on-behalf mode at the request's service, with the request's answers as the selections, its contact filled
// in and its id kept, so the booking is made against the request. The button is disabled once the flow is opening, so a second click cannot start it twice.
function BookThis({ row, serviceId, nameId, isDarkMode }) {
  const router = useRouter();
  const [phase, setPhase] = useState('idle');

  function open() {
    if (phase === 'opening') return;
    setPhase('opening');
    try {
      router.push(
        startOnBehalf({
          serviceId,
          serviceName: textOf(row.service_name).trim(),
          selections: selectionsFromAnswers(answersOf(row.answers)),
          contact: contactOf(row),
          quoteRequestId: wholeIdOf(row.id),
        })
      );
    } catch {
      setPhase('failed');
    }
  }

  return (
    <div className="mt-4 flex items-center gap-x-3 gap-y-2 flex-wrap">
      <ActionButton onClick={open} disabled={phase === 'opening'} describedBy={nameId} isDarkMode={isDarkMode}>
        {phase === 'opening' ? 'Opening...' : 'Book this'}
      </ActionButton>
      {phase === 'failed' && <p role="alert" className={`text-xs font-medium ${isDarkMode ? 'text-red-300' : 'text-red-700'}`}>{BOOK_FAILED_TEXT}</p>}
    </div>
  );
}

// What a request offers below its details: a link to its booking, or "Book this" when it has none. A request with neither a booking nor a usable
// service id shows nothing there.
function BookingAction({ row, nameId, isDarkMode }) {
  if (row.booking_id !== null && row.booking_id !== undefined) return <BookedLink row={row} isDarkMode={isDarkMode} />;
  const serviceId = wholeIdOf(row.service_id);
  return serviceId === null ? null : <BookThis row={row} serviceId={serviceId} nameId={nameId} isDarkMode={isDarkMode} />;
}

function RequestRow({ row, isDarkMode }) {
  const nameId = useId();
  const name = textOf(row.customer_name).trim() || 'Unnamed customer';
  const email = textOf(row.customer_email);
  const phone = textOf(row.customer_phone).trim();
  const address = textOf(row.address).trim();
  const service = textOf(row.service_name).trim();
  const message = textOf(row.message);
  const sent = sentAt(row.created_at);
  const picks = Array.isArray(row.picks) ? row.picks.filter(isObject) : [];
  const mailto = mailtoOf(email);
  const tel = phone ? telOf(phone) : null;

  return (
    <li data-testid="quote-request-row" className={`rounded-2xl border p-4 sm:p-5 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h3 id={nameId} className={`text-base font-semibold leading-tight break-words ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{name}</h3>
        <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
          {sent ? (
            <>
              Sent <time dateTime={sent.toISOString()}>{sent.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>
            </>
          ) : (
            'Date unknown'
          )}
        </p>
      </div>

      <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
        <Detail label="Email" isDarkMode={isDarkMode}>
          {mailto ? <ContactLink href={mailto} isDarkMode={isDarkMode}>{email}</ContactLink> : email || 'None'}
        </Detail>
        {phone && (
          <Detail label="Phone" isDarkMode={isDarkMode}>
            {tel ? <ContactLink href={tel} isDarkMode={isDarkMode}>{phone}</ContactLink> : phone}
          </Detail>
        )}
        {service && <Detail label="Service" isDarkMode={isDarkMode}>{service}</Detail>}
        {address && <Detail label="Address" isDarkMode={isDarkMode}>{address}</Detail>}
        <Detail label="Picks" wide isDarkMode={isDarkMode}>
          {picks.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {picks.map((pick, index) => (
                <PickChip key={index} pick={pick} isDarkMode={isDarkMode} />
              ))}
            </ul>
          ) : (
            'Not available'
          )}
        </Detail>
        <Detail label="Message" wide isDarkMode={isDarkMode}>
          <p className="whitespace-pre-wrap">{message || 'No message'}</p>
        </Detail>
      </dl>

      <BookingAction row={row} nameId={nameId} isDarkMode={isDarkMode} />
    </li>
  );
}

export default function QuoteRequests({ isDarkMode }) {
  const headingId = useId();
  // The requests shown so far, and how many the server counts in all. `total` stays null until the first page has arrived.
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(null);
  // The first load: whether it failed, whether a Retry of it is under way, and a counter whose change runs it again.
  const [loadFailed, setLoadFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The last "Show more": 'idle', 'loading' or 'failed'. `exhausted` is set once a page comes back short, so the button never offers an empty page.
  const [more, setMore] = useState('idle');
  const [exhausted, setExhausted] = useState(false);

  // The first page, on mount and again each time Retry changes `attempt`. The cleanup aborts the call, so a page that arrives late is dropped.
  useEffect(() => {
    const controller = new AbortController();
    fetchPage(0, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setRows(page.rows);
        setTotal(page.total);
        setExhausted(page.rows.length < PAGE_SIZE);
        setLoadFailed(false);
        setRetrying(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setLoadFailed(true);
        setRetrying(false);
      });
    return () => controller.abort();
  }, [attempt]);

  function retry() {
    setRetrying(true);
    setAttempt((n) => n + 1);
  }

  // The next page, after the rows already shown. A failure leaves those rows as they are and says so beside the button.
  async function showMore() {
    if (more === 'loading') return;
    setMore('loading');
    try {
      const page = await fetchPage(rows.length);
      // A request sent since the first page pushes the rows down by one, so a row can come back that is already shown; each is kept once.
      setRows((shown) => {
        const seen = new Set(shown.map((row) => row.id));
        return [...shown, ...page.rows.filter((row) => !seen.has(row.id))];
      });
      setTotal(page.total);
      setExhausted(page.rows.length < PAGE_SIZE);
      setMore('idle');
    } catch {
      setMore('failed');
    }
  }

  // Nothing while the first page is on its way and nothing when there are no requests. Only a failed load is shown without any.
  if (!loadFailed && !total) return null;

  const muted = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const failedText = isDarkMode ? 'text-red-300' : 'text-red-700';
  const hasMore = !exhausted && rows.length < total;

  return (
    <section aria-labelledby={headingId} data-testid="quote-requests" className="mt-6">
      <h2 id={headingId} className={`text-lg font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
        {loadFailed ? 'Quote requests' : `Quote requests (${total})`}
      </h2>

      {loadFailed ? (
        <div className={`mt-3 flex items-center justify-between gap-3 flex-wrap p-4 rounded-2xl border ${isDarkMode ? 'bg-red-900/20 border-red-800' : 'bg-red-50 border-red-200'}`}>
          <p role="alert" className={`text-sm font-medium ${failedText}`}>{LOAD_FAILED_TEXT}</p>
          <ActionButton onClick={retry} disabled={retrying} isDarkMode={isDarkMode}>Retry</ActionButton>
        </div>
      ) : (
        <>
          <ul className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
            {rows.map((row) => (
              <RequestRow key={row.id} row={row} isDarkMode={isDarkMode} />
            ))}
          </ul>

          {hasMore && (
            <div className="mt-4 flex items-center gap-x-3 gap-y-2 flex-wrap">
              <ActionButton onClick={showMore} disabled={more === 'loading'} isDarkMode={isDarkMode}>
                {more === 'failed' ? 'Retry' : 'Show more'}
              </ActionButton>
              <p role="status" aria-live="polite" className={`text-xs ${muted}`}>
                {more === 'loading' ? LOADING_MORE_TEXT : `Showing ${rows.length} of ${total}`}
              </p>
              {more === 'failed' && <p role="alert" className={`text-xs font-medium ${failedText}`}>{MORE_FAILED_TEXT}</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
