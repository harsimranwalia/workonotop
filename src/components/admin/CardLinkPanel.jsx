// The "Card on file" panel of an admin booking's page (ENG-013): whether the customer has added a card through the booking's card link, the state
// the link is in, and a New link button that makes the link again. A booking not made on a customer's behalf has no card link, so for it the panel
// renders nothing. A new link is shown once, here: the server keeps only a hash of it and cannot show it again, so its address lives in this
// component's state only (never in storage, the address bar or a log) and goes when the page is left.
'use client';

import { useEffect, useId, useRef, useState } from 'react';

const LOADING_TEXT = 'Loading the card link...';
const LOAD_FAILED_TEXT = "Couldn't load the card link.";
const MAKE_FAILED_TEXT = "Couldn't make a new link. Try again.";
// Said for a 409 that carries no message of its own: the route refuses a booking that is completed, cancelled or disputed.
const REFUSED_TEXT = 'A new link cannot be made for a booking that is completed, cancelled or disputed.';
const CONFIRM_TEXT = 'This ends the current link. Make a new one?';
const SHOWN_ONCE_TEXT = 'This link is shown once; to get another, choose New link.';
const COPIED_TEXT = 'Copied';
const COPY_BY_HAND_TEXT = 'Press Ctrl+C to copy';

// The states a link can be in, as the route names them.
const STATES = ['ok', 'used', 'expired', 'closed', 'exhausted'];

const isObject = (value) => value !== null && typeof value === 'object';

// A field as text to show, or '' when it is missing or not text, so one odd answer cannot crash the panel.
const textOf = (value) => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');

const linkPath = (bookingId) => `/api/admin/bookings/${encodeURIComponent(bookingId)}/card-link`;

// An instant as the browser's locale writes a date and time, in the browser's time zone; '' when the value is missing or cannot be read.
function whenOf(instant) {
  if (!instant) return '';
  const date = new Date(instant);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

// The link's state in words. `when` is the written expiry, '' when the expiry cannot be read, so each sentence reads whole without it.
function linkWords(state, when) {
  switch (state) {
    case 'ok':
      return when ? `Link active until ${when}` : 'Link active';
    case 'used':
      return 'Card added through the link';
    case 'expired':
      return when ? `Link expired ${when}` : 'Link expired';
    case 'closed':
      return 'Link closed: the booking is finished';
    case 'exhausted':
      return 'Link used up: ten tries';
    default:
      return '';
  }
}

// "Visa •••• 4242 on file", or "No card yet". Stripe gives the brand in lowercase ("visa", "cartes_bancaires"); a card whose brand Stripe cannot
// name reads as "Card".
function cardWords(link) {
  if (!link.card_on_file) return 'No card yet';
  const brand = textOf(link.card_brand).replace(/_/g, ' ').trim();
  const name = brand && brand !== 'unknown' ? brand.charAt(0).toUpperCase() + brand.slice(1) : 'Card';
  const last4 = textOf(link.card_last4).trim();
  return last4 ? `${name} •••• ${last4} on file` : `${name} on file`;
}

// The link of a GET answer, or null when the answer is not the shape the route promises, so every kind of bad answer reaches the screen the same way.
function linkOf(value) {
  if (!isObject(value) || !STATES.includes(value.state)) return null;
  return {
    state: value.state,
    expires_at: value.expires_at,
    card_on_file: value.card_on_file === true,
    card_brand: value.card_brand,
    card_last4: value.card_last4,
  };
}

// One read of the booking's link: { status: 'absent' } for a booking with no card link (a 404), { status: 'ready', link } for an answer of the
// promised shape, and { status: 'failed' } for everything else, including a call that does not complete and a body that is not JSON.
async function readLink(bookingId, signal) {
  try {
    const res = await fetch(linkPath(bookingId), { cache: 'no-store', signal });
    if (res.status === 404) return { status: 'absent', link: null };
    const body = await res.json();
    const link = res.ok && body?.success === true ? linkOf(body.card_link) : null;
    return link ? { status: 'ready', link } : { status: 'failed', link: null };
  } catch {
    return { status: 'failed', link: null };
  }
}

// Asks the route for a new link. Answers { outcome: 'made', address, expires_at } with the full address of the link, { outcome: 'refused', message }
// for a booking the route will not make a link for (a 409), and { outcome: 'failed' } for every other result, including a call that does not complete.
async function requestNewLink(bookingId) {
  try {
    const res = await fetch(linkPath(bookingId), { method: 'POST', cache: 'no-store' });
    const body = await res.json().catch(() => null);
    if (res.status === 409) return { outcome: 'refused', message: textOf(body?.message).trim() || REFUSED_TEXT };
    const path = body?.card_link?.path;
    if (res.ok && body?.success === true && typeof path === 'string' && path.startsWith('/card/')) {
      return { outcome: 'made', address: `${window.location.origin}${path}`, expires_at: body.card_link.expires_at };
    }
    return { outcome: 'failed' };
  } catch {
    return { outcome: 'failed' };
  }
}

// The ring is offset by the colour of the card the buttons sit on.
const ringOf = (isDarkMode) =>
  `focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
    isDarkMode ? 'focus-visible:ring-teal-400 focus-visible:ring-offset-slate-900' : 'focus-visible:ring-teal-600 focus-visible:ring-offset-white'
  }`;

// `primary` is the filled button; without it the button is an outline. `buttonRef` and `describedBy` are for the focus moves and the description.
function Button({ onClick, disabled, isDarkMode, primary, buttonRef, describedBy, children }) {
  const look = primary
    ? 'text-white bg-teal-700 hover:bg-teal-800'
    : isDarkMode
      ? 'border border-slate-500 text-slate-200 hover:bg-slate-800'
      : 'border border-gray-500 text-gray-700 hover:bg-gray-50';
  return (
    <button
      type="button"
      ref={buttonRef}
      onClick={onClick}
      disabled={disabled}
      aria-describedby={describedBy}
      className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${look} ${ringOf(isDarkMode)}`}
    >
      {children}
    </button>
  );
}

function CardLinkBody({ bookingId, isDarkMode }) {
  const headingId = useId();
  const questionId = useId();
  const inputId = useId();
  const onceId = useId();

  // The last read of the link. `status` is 'loading' until the first answer, then 'ready' (with the link), 'absent' (no card link: nothing is drawn)
  // or 'failed'. `attempt` changes each time Retry runs the read again, and `retrying` is true while that read is under way.
  const [read, setRead] = useState({ status: 'loading', link: null });
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  // The New link button: 'idle', 'confirming' (asks first, because the current link stops working at once) or 'making' (the request is under way).
  const [phase, setPhase] = useState('idle');
  // The link just made, { address, expires_at }: component state only, so it is shown once and goes with the page. The message of a failed request
  // and the note of the last Copy are kept beside it.
  const [issued, setIssued] = useState(null);
  const [makeError, setMakeError] = useState('');
  const [copyNote, setCopyNote] = useState('');
  // Focus follows the screen: 'confirm' when the question opens, 'trigger' when it closes without a link and 'link' when a new link is drawn.
  const [focusOn, setFocusOn] = useState(null);

  const mounted = useRef(true);
  const making = useRef(false);
  const newLinkButton = useRef(null);
  const confirmButton = useRef(null);
  const linkInput = useRef(null);

  // Calls that finish after the panel has gone are dropped.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The first read, on mount and again each time Retry changes `attempt`. The cleanup aborts the call, so an answer that arrives late is dropped.
  useEffect(() => {
    const controller = new AbortController();
    readLink(bookingId, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setRead(result);
      setRetrying(false);
    });
    return () => controller.abort();
  }, [bookingId, attempt]);

  useEffect(() => {
    if (!focusOn) return;
    const targets = { confirm: confirmButton, trigger: newLinkButton, link: linkInput };
    targets[focusOn].current?.focus();
    setFocusOn(null);
  }, [focusOn]);

  function retry() {
    setRetrying(true);
    setAttempt((n) => n + 1);
  }

  // Reads the link again without clearing the panel, so the state line is current. When the read fails the panel stays as it is.
  async function refresh() {
    const result = await readLink(bookingId);
    if (mounted.current && result.status === 'ready') setRead(result);
  }

  function askToMake() {
    setMakeError('');
    setPhase('confirming');
    setFocusOn('confirm');
  }

  function cancel() {
    setPhase('idle');
    setFocusOn('trigger');
  }

  // The current link ends when the request is made, so the address on screen goes at the same time. A link that is made is drawn with the state line
  // set from the answer (a new link is active, with its tries unspent) and then read again, so a failed second read leaves a line that is true.
  async function makeLink() {
    if (making.current) return;
    making.current = true;
    setPhase('making');
    setMakeError('');
    setCopyNote('');
    setIssued(null);
    const result = await requestNewLink(bookingId);
    making.current = false;
    if (!mounted.current) return;
    setPhase('idle');
    if (result.outcome === 'made') {
      setIssued({ address: result.address, expires_at: result.expires_at });
      setRead((shown) => (shown.link ? { status: 'ready', link: { ...shown.link, state: 'ok', expires_at: result.expires_at } } : shown));
      setFocusOn('link');
      refresh();
      return;
    }
    setMakeError(result.outcome === 'refused' ? result.message : MAKE_FAILED_TEXT);
    setFocusOn('trigger');
    if (result.outcome === 'refused') refresh();
  }

  // Copies the address. Where the clipboard is missing or refuses, the address is selected so the keyboard can copy it.
  async function copy() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.address);
      if (mounted.current) setCopyNote(COPIED_TEXT);
    } catch {
      if (!mounted.current) return;
      linkInput.current?.focus();
      linkInput.current?.select();
      setCopyNote(COPY_BY_HAND_TEXT);
    }
  }

  if (read.status === 'absent') return null;

  const muted = isDarkMode ? 'text-slate-400' : 'text-gray-500';
  const strong = isDarkMode ? 'text-white' : 'text-gray-900';
  const failedText = isDarkMode ? 'text-red-300' : 'text-red-700';

  if (read.status === 'loading') {
    return <p role="status" className={`text-sm ${muted}`}>{LOADING_TEXT}</p>;
  }

  const link = read.link;
  const issuedWhen = issued ? whenOf(issued.expires_at) : '';

  return (
    <section
      aria-labelledby={headingId}
      data-testid="card-link-panel"
      className={`rounded-xl shadow-sm border p-4 sm:p-5 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-gray-200'}`}
    >
      <h2 id={headingId} className={`text-base font-semibold mb-4 ${strong}`}>Card on file</h2>

      {read.status === 'failed' ? (
        <div className={`flex items-center justify-between gap-3 flex-wrap p-3 rounded-xl border ${isDarkMode ? 'bg-red-900/20 border-red-800' : 'bg-red-50 border-red-200'}`}>
          <p role="alert" className={`text-sm font-medium ${failedText}`}>{LOAD_FAILED_TEXT}</p>
          <Button primary onClick={retry} disabled={retrying} isDarkMode={isDarkMode}>{retrying ? 'Retrying...' : 'Retry'}</Button>
        </div>
      ) : (
        <>
          <div>
            <p data-testid="card-link-card" className={`text-sm font-medium ${strong}`}>{cardWords(link)}</p>
            <p data-testid="card-link-state" className={`mt-1 text-sm ${muted}`}>{linkWords(link.state, whenOf(link.expires_at))}</p>
          </div>

          <div className="mt-4">
            {phase === 'idle' ? (
              <Button buttonRef={newLinkButton} onClick={askToMake} isDarkMode={isDarkMode}>New link</Button>
            ) : (
              <div
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && phase === 'confirming') cancel();
                }}
              >
                <p id={questionId} className={`text-sm ${strong}`}>{CONFIRM_TEXT}</p>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <Button primary buttonRef={confirmButton} onClick={makeLink} disabled={phase === 'making'} describedBy={questionId} isDarkMode={isDarkMode}>
                    {phase === 'making' ? 'Making...' : 'Make new link'}
                  </Button>
                  <Button onClick={cancel} disabled={phase === 'making'} isDarkMode={isDarkMode}>Cancel</Button>
                </div>
              </div>
            )}
            {makeError && <p role="alert" className={`mt-3 text-sm font-medium ${failedText}`}>{makeError}</p>}
          </div>

          {issued && (
            <div
              data-testid="card-link-issued"
              className={`mt-4 rounded-xl border p-3 sm:p-4 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-gray-50 border-gray-100'}`}
            >
              <label htmlFor={inputId} className={`block text-xs font-medium mb-1 ${muted}`}>Card link</label>
              <input
                id={inputId}
                ref={linkInput}
                type="text"
                readOnly
                value={issued.address}
                onFocus={(event) => event.target.select()}
                aria-describedby={onceId}
                spellCheck={false}
                autoComplete="off"
                className={`w-full px-3 py-2 rounded-lg border text-sm font-mono focus:outline-none focus:ring-2 ${
                  isDarkMode ? 'bg-slate-900 text-white border-slate-500 focus:ring-teal-400' : 'bg-white text-gray-900 border-gray-500 focus:ring-teal-600'
                }`}
              />
              <div className="mt-2 flex items-center gap-3 flex-wrap">
                <Button primary onClick={copy} isDarkMode={isDarkMode}>Copy</Button>
                <p role="status" className={`text-xs ${muted}`}>{copyNote}</p>
              </div>
              {issuedWhen && <p className={`mt-2 text-xs ${muted}`}>Works until {issuedWhen}</p>}
              <p id={onceId} className={`mt-1 text-xs ${muted}`}>{SHOWN_ONCE_TEXT}</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// `bookingId` is the booking's id as the page's address carries it. The key gives a different booking a fresh panel, so a link made for one
// booking is never drawn on another.
export default function CardLinkPanel({ bookingId, isDarkMode }) {
  return <CardLinkBody key={bookingId} bookingId={bookingId} isDarkMode={isDarkMode} />;
}
