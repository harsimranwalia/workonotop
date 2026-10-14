// The entry to booking on a customer's behalf (ENG-013): the services a customer can book, as a list of buttons. Choosing one opens the on-behalf
// mode of the booking screens at that service, so the admin runs the same steps the customer would. The page books nothing itself: the admin layout
// checks the session before it renders the page, and every call the later steps make is checked again on the server.
'use client';

import { useEffect, useId, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { startOnBehalf } from '@/lib/on-behalf';
import { useAdminTheme } from '../layout';

// The filter appears when the list is longer than this; a short list is quicker to scan than to search.
const FILTER_AFTER = 8;

const LOADING_TEXT = 'Loading services…';
const EMPTY_TEXT = 'There are no services to book yet.';
const OFFLINE_TEXT = 'You are offline, so the services cannot be loaded. Reconnect, then choose Retry.';
const UNREACHABLE_TEXT = 'The services could not be loaded because the server did not answer. Check the connection, then choose Retry.';
const UNREADABLE_TEXT = 'The services could not be loaded because the server sent an answer this page cannot read. Choose Retry.';
const STORAGE_TEXT = 'The booking could not be started because this browser did not let the page save it. Allow site data for this page, then choose the service again.';
const serverErrorText = (status) => `The services could not be loaded because the server answered with an error (${status}). Choose Retry in a moment.`;

const isObject = (value) => value !== null && typeof value === 'object';

const textOf = (value) => (typeof value === 'string' ? value.trim() : '');

// One row of GET /api/services as a list entry, or null when it cannot start a booking: it needs a whole-number id and a name. The public list
// returns active services only; the flag is checked here as well, so a row with the flag off is never offered.
function entryOf(row) {
  if (!isObject(row) || !Number.isSafeInteger(row.id) || row.id <= 0) return null;
  if (row.is_active !== undefined && Number(row.is_active) !== 1) return null;
  const name = textOf(row.name);
  if (!name) return null;
  const category = textOf(row.category_name);
  return { id: row.id, name, category, haystack: `${name} ${category}`.toLowerCase() };
}

const byName = (a, b) =>
  a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }) ||
  a.category.localeCompare(b.category, 'en', { sensitivity: 'base' }) ||
  a.id - b.id;

// The bookable services sorted by name, as { entries }; or { text }, the sentence the screen shows, when the list cannot be had. A call that fails,
// an answer that is not JSON and an answer in the wrong shape each give a { text }, so none of them throws into the page.
async function fetchServices(signal) {
  let res;
  try {
    res = await fetch('/api/services', { cache: 'no-store', signal });
  } catch {
    return { text: navigator.onLine === false ? OFFLINE_TEXT : UNREACHABLE_TEXT };
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    // A body that is not JSON leaves `body` null, which the checks below report.
  }
  if (!res.ok) return { text: serverErrorText(res.status) };
  if (!isObject(body) || body.success !== true || !Array.isArray(body.data)) return { text: UNREADABLE_TEXT };
  return { entries: body.data.map(entryOf).filter(Boolean).sort(byName) };
}

const ringOf = (isDarkMode) =>
  `focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
    isDarkMode ? 'focus-visible:ring-teal-400 focus-visible:ring-offset-slate-950' : 'focus-visible:ring-teal-600 focus-visible:ring-offset-slate-50'
  }`;

export default function BookForACustomer() {
  const router = useRouter();
  const { isDarkMode } = useAdminTheme();
  const filterId = useId();
  // 'idle' until the load begins, so the status line is in the page, empty, before it takes its first text. A live region announces changes to the
  // text it holds, and a region that appears already holding text is often not announced.
  const [status, setStatus] = useState('idle');
  const [entries, setEntries] = useState([]);
  // The sentence for the last failed load. It stays while Retry runs and clears when a load succeeds.
  const [errorText, setErrorText] = useState('');
  // A counter whose change runs the load again; Retry bumps it.
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [startError, setStartError] = useState('');
  const [openingId, setOpeningId] = useState(null);
  // Pending from the choice until the booking screen takes over, so a second click cannot start a second navigation.
  const [isOpening, startOpening] = useTransition();

  // The services, on mount and again each time Retry changes `attempt`. The cleanup aborts the call, so an answer that arrives late is dropped.
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    fetchServices(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.entries) {
          setEntries(result.entries);
          setErrorText('');
          setStatus('ready');
        } else {
          setErrorText(result.text);
          setStatus('error');
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.error('The services list could not be built:', error);
        setErrorText(UNREADABLE_TEXT);
        setStatus('error');
      });
    return () => controller.abort();
  }, [attempt]);

  const filterShown = status === 'ready' && entries.length > FILTER_AFTER;
  const needle = filterShown ? query.trim().toLowerCase() : '';
  // Every word typed must appear in the service's name or category, in any order.
  const matches = useMemo(() => {
    if (!needle) return entries;
    const terms = needle.split(/\s+/);
    return entries.filter((entry) => terms.every((term) => entry.haystack.includes(term)));
  }, [entries, needle]);

  // Opens the on-behalf mode at the service and goes to the first booking step. Storing the mode fails when the browser blocks storage; the failure
  // is reported here, because the booking steps would open as a customer's own with nothing to say that the mode had been asked for.
  function choose(entry) {
    if (isOpening) return;
    setStartError('');
    let next;
    try {
      next = startOnBehalf({ serviceId: entry.id, serviceName: entry.name });
    } catch (error) {
      console.error('The booking flow could not be saved:', error);
      setStartError(STORAGE_TEXT);
      return;
    }
    setOpeningId(entry.id);
    startOpening(() => {
      router.push(next);
    });
  }

  const ready = status === 'ready';
  const noneShown = ready && matches.length === 0;
  const openingName = isOpening ? entries.find((entry) => entry.id === openingId)?.name : undefined;
  let statusText = '';
  if (openingName) statusText = `Opening the booking steps for ${openingName}…`;
  else if (status === 'loading') statusText = LOADING_TEXT;
  else if (ready && entries.length === 0) statusText = EMPTY_TEXT;
  else if (noneShown) statusText = `No service matches "${query.trim()}".`;
  else if (ready && needle) statusText = `Showing ${matches.length} of ${entries.length} services`;
  else if (ready) statusText = `${entries.length} ${entries.length === 1 ? 'service' : 'services'}`;

  const muted = isDarkMode ? 'text-slate-400' : 'text-gray-600';
  const failedText = isDarkMode ? 'text-red-300' : 'text-red-700';
  // The status line is read aloud whatever it looks like: a quiet count above the list, a panel when there is nothing to list, and out of sight
  // (yet present in the page) while it holds no text.
  let statusClass = 'sr-only';
  if (statusText && noneShown) {
    statusClass = `mt-6 p-6 text-center break-words rounded-2xl border border-dashed ${isDarkMode ? 'border-slate-600 text-slate-300' : 'border-slate-400 text-slate-600'}`;
  } else if (statusText) {
    statusClass = `mt-4 flex items-center gap-2 text-sm ${muted}`;
  }

  return (
    <div className="max-w-3xl">
      <h2 className={`text-2xl sm:text-3xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Book for a customer</h2>
      <p className={`mt-2 ${muted}`}>
        Choose the service the customer asked for. You then run the same booking steps they would, and give them a link to add their card.
      </p>

      {filterShown && (
        <div className="mt-6">
          <label htmlFor={filterId} className={`block text-sm font-medium mb-1 ${isDarkMode ? 'text-slate-400' : 'text-gray-700'}`}>
            Find a service
          </label>
          <input
            id={filterId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name or category"
            autoComplete="off"
            className={`w-full px-4 py-2 text-base rounded-lg border border-slate-500 ${
              isDarkMode ? 'bg-slate-800 text-white placeholder-slate-400' : 'bg-white text-gray-900 placeholder-slate-500'
            } ${ringOf(isDarkMode)}`}
          />
        </div>
      )}

      <p role="status" aria-live="polite" aria-atomic="true" className={statusClass}>
        {status === 'loading' && (
          <span
            aria-hidden="true"
            className={`inline-block h-4 w-4 rounded-full border-2 border-t-transparent motion-safe:animate-spin ${isDarkMode ? 'border-teal-400' : 'border-teal-600'}`}
          />
        )}
        {statusText}
      </p>

      {errorText && (
        <div className={`mt-4 flex items-center justify-between gap-3 flex-wrap p-4 rounded-2xl border ${isDarkMode ? 'bg-red-900/20 border-red-800' : 'bg-red-50 border-red-200'}`}>
          {/* The key remounts the sentence each time the status changes, so every failure arrives as a new alert and is announced even when its text repeats. */}
          <p key={status} role={status === 'error' ? 'alert' : undefined} className={`text-sm font-medium ${failedText}`}>
            {errorText}
          </p>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            disabled={status === 'loading'}
            className={`px-4 py-2 rounded-xl text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${ringOf(isDarkMode)}`}
          >
            {status === 'loading' ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}

      {startError && (
        <p role="alert" className={`mt-4 text-sm font-medium ${failedText}`}>
          {startError}
        </p>
      )}

      {/* One service per row as a full-width button: its name, its category when it has one, and a chevron that assistive technology skips. The chosen
          service says "Opening…" and the others are disabled until the booking screen takes over. */}
      {ready && matches.length > 0 && (
        <ul aria-label="Services" className="mt-4 space-y-2">
          {matches.map((entry) => {
            const opening = isOpening && openingId === entry.id;
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => choose(entry)}
                  disabled={isOpening}
                  aria-busy={opening || undefined}
                  className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-left transition-colors disabled:cursor-not-allowed ${
                    isOpening && !opening ? 'disabled:opacity-60' : ''
                  } ${
                    isDarkMode
                      ? 'bg-slate-900 border-slate-800 text-white enabled:hover:bg-slate-800'
                      : 'bg-white border-slate-200 text-gray-900 enabled:hover:bg-teal-50 enabled:hover:border-teal-600'
                  } ${ringOf(isDarkMode)}`}
                >
                  <span className="min-w-0">
                    <span className="block font-medium break-words">{entry.name}</span>
                    {entry.category && (
                      <span className={`block text-sm break-words ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>{entry.category}</span>
                    )}
                  </span>
                  {opening ? (
                    <span className={`shrink-0 text-sm font-medium ${isDarkMode ? 'text-teal-300' : 'text-teal-800'}`}>Opening…</span>
                  ) : (
                    <svg
                      aria-hidden="true"
                      className={`w-5 h-5 shrink-0 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
