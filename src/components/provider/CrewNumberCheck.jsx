'use client';

// Whether a cleaner's number has been checked, and the check that proves it (ENG-015). A job link texts a sign-in code only to a number its owner has
// proved is theirs: the provider asks for a code to be texted to the number, the cleaner reads it out, and the provider types it in. The route knows three
// states of a number: 'checked', 'unchecked', and 'cannot_text' (not a Canadian number, which no text goes to, so a check would not help).
//   useNumberStates()   reads GET /api/provider/crew/numbers into { status, states: Map(id -> state), reload }
//   NumberChip          the state as a word on a coloured chip, for any list of cleaners
//   CheckNumber         the "Check this number" control for a number that is 'unchecked': ask for the code, then confirm it
// The code is typed into this component's state and sent in a request body; the number is the one stored for the cleaner and is never sent from
// here. Neither is kept in the address or in storage.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { formatPhone } from '@/lib/phone';
import { callApi, dataOf, isObject, messageOf, OFFLINE_TEXT, postJson, textOf } from '@/components/job/jobLinkKit';

const NUMBERS_PATH = '/api/provider/crew/numbers';
const CODE_WAIT_SECONDS = 60;

const ASK_FAILED_TEXT = "Couldn't send a code. Try again.";
const NOT_SENT_TEXT = "We couldn't send the text just now. Wait a minute, then try again.";
const CONFIRM_FAILED_TEXT = "Couldn't check that code. Try again.";
const CODE_MISSING_TEXT = 'Enter the 6-digit code.';
const SESSION_TEXT = 'Your session has ended. Sign in again to check numbers.';
const CHECK_HINT_TEXT = 'Text a code to this number so job links can reach this cleaner.';

const RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2';
const BUTTON = `px-4 py-2 min-h-[44px] rounded-xl text-sm font-semibold transition-colors aria-disabled:opacity-50 aria-disabled:cursor-not-allowed ${RING}`;
const PRIMARY = `${BUTTON} bg-green-700 hover:bg-green-800 text-white`;
const OUTLINE = `${BUTTON} border border-gray-500 text-gray-800 hover:bg-gray-50`;

const CHIPS = {
  checked: { text: 'Number checked', tone: 'bg-green-50 border-green-300 text-green-900' },
  unchecked: { text: "Number not checked \u2014 we can't text them yet", tone: 'bg-amber-50 border-amber-300 text-amber-900' },
  cannot_text: { text: "Can't text this number", tone: 'bg-gray-100 border-gray-400 text-gray-900' },
};

// The states of the caller's cleaners' numbers. A read that cannot be made leaves `states` empty and `status` 'failed', and the screens draw no chip.
export function useNumberStates() {
  const [read, setRead] = useState({ status: 'loading', states: new Map() });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    callApi(NUMBERS_PATH, { signal: controller.signal }).then((result) => {
      if (!current) return;
      const data = dataOf(result);
      const rows = data && Array.isArray(data.numbers) ? data.numbers.filter((row) => isObject(row) && Number.isInteger(row.id)) : null;
      if (!rows) {
        setRead((held) => ({ ...held, status: 'failed' }));
        return;
      }
      setRead({ status: 'ready', states: new Map(rows.map((row) => [row.id, textOf(row.number_state)])) });
    });
    return () => { current = false; controller.abort(); };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((count) => count + 1), []);
  return { ...read, reload };
}

export function NumberChip({ state }) {
  const chip = CHIPS[state];
  if (!chip) return null;
  return <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${chip.tone}`}>{chip.text}</span>;
}

// The control for a number whose state is 'unchecked'. `onChecked` is told when the code was right; `onGone` is told, with the route's words, when the
// cleaner has left the provider's crew.
export function CheckNumber({ member, onChecked, onGone }) {
  const codeId = useId();
  const path = `/api/provider/crew/${member.id}/number-check`;
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [waitUntil, setWaitUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const codeRef = useRef(null);

  useEffect(() => {
    if (open) codeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open]);

  const waitLeft = Math.max(0, Math.ceil((waitUntil - now) / 1000));

  // What to say about a refusal or a call that did not complete. A 4xx is written to be shown as it stands.
  const problemOf = (result, plain) => {
    if (result.status === 0) return OFFLINE_TEXT;
    if (result.status === 401 || result.status === 403) return SESSION_TEXT;
    return messageOf(result) || plain;
  };

  const ask = async () => {
    if (busy || (open && waitLeft > 0)) return;
    setBusy(true);
    setProblem('');
    const result = await postJson(path, { action: 'ask' });
    setBusy(false);
    if (result.status === 404) return onGone(problemOf(result, ASK_FAILED_TEXT));
    const data = dataOf(result);
    if (data?.asked === true && data.sent === true) {
      setCode('');
      setNow(Date.now());
      setWaitUntil(Date.now() + CODE_WAIT_SECONDS * 1000);
      setOpen(true);
      return undefined;
    }
    setProblem(data?.asked === true ? NOT_SENT_TEXT : problemOf(result, ASK_FAILED_TEXT));
    return undefined;
  };

  const confirm = async (event) => {
    event.preventDefault();
    if (busy) return undefined;
    const digits = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(digits)) {
      setProblem(CODE_MISSING_TEXT);
      codeRef.current?.focus();
      return undefined;
    }
    setBusy(true);
    setProblem('');
    const result = await postJson(path, { action: 'confirm', code: digits });
    setBusy(false);
    if (result.status === 404) return onGone(problemOf(result, CONFIRM_FAILED_TEXT));
    if (dataOf(result)?.checked === true) return onChecked(member);
    setProblem(problemOf(result, CONFIRM_FAILED_TEXT));
    codeRef.current?.focus();
    return undefined;
  };

  const cancel = () => {
    setOpen(false);
    setProblem('');
    setCode('');
    setTimeout(() => document.getElementById(`check-${member.id}`)?.focus(), 0);
  };

  if (!open) {
    return (
      <div className="mt-2">
        <button type="button" id={`check-${member.id}`} aria-label={`Check ${member.name}'s number`} aria-disabled={busy || undefined} onClick={ask} className={OUTLINE}>
          {busy ? 'Sending...' : 'Check this number'}
        </button>
        <p className="mt-1 text-xs text-gray-700">{CHECK_HINT_TEXT}</p>
        {problem && <p role="alert" className="mt-2 text-sm font-medium text-red-700">{problem}</p>}
      </div>
    );
  }

  return (
    <form onSubmit={confirm} className="mt-2 rounded-xl border border-gray-300 bg-gray-50 p-3" noValidate>
      <label htmlFor={codeId} className="block text-sm font-semibold text-gray-900">6-digit code from {member.name}</label>
      <p id={`${codeId}-hint`} className="mt-1 text-xs text-gray-700">
        We texted a code to {formatPhone(member.phone)}. Ask {member.name} to read it out, then type it here. It lasts 10 minutes.
      </p>
      <input id={codeId} ref={codeRef} type="text" inputMode="numeric" autoComplete="off" maxLength={8} value={code} aria-describedby={`${codeId}-hint`}
        aria-invalid={problem ? true : undefined} onChange={(event) => { setCode(event.target.value); setProblem(''); }}
        className="mt-2 w-full max-w-[12rem] rounded-xl border border-gray-500 px-3 py-2 text-base tracking-widest text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-700" />
      {problem && <p role="alert" className="mt-2 text-sm font-medium text-red-700">{problem}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" aria-disabled={busy || undefined} className={PRIMARY}>{busy ? 'Checking...' : 'Confirm'}</button>
        <button type="button" aria-disabled={busy || waitLeft > 0 || undefined} onClick={ask} className={OUTLINE}>
          {waitLeft > 0 ? `Send a new code (${waitLeft})` : 'Send a new code'}
        </button>
        <button type="button" onClick={cancel} className={OUTLINE}>Cancel</button>
      </div>
    </form>
  );
}
