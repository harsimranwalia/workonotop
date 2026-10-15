'use client';

// The page of a job link (ENG-015), /job/{token}. It asks the server who is looking (GET /api/job/{token}) and draws what the answer allows: nothing but a
// way in for a visitor with no access, and for a cleaner who has entered a code, the job's provider or an admin, the job, its crew and the check-in.
//   invalid      the link is switched off, replaced, finished or was never a link: one sentence, the same for every cause
//   not in       a mobile number, then the six-digit code texted to it; the page cannot tell whether the number was on the job
//   signed in    the days, the address, the details, the crew with who is checked in and out, the tick list that checks people in, and below the
//                crew the job's photos (JobPhotos.jsx) and its timer (JobTimer.jsx)
// A cleaner's session is a cookie the server sets and the page never reads: after every action, when the tab comes back to the front and, while the timer
// is on the page, every TIMER_POLL_SECONDS the page asks again, so a person taken off the crew, or a link switched off, is seen at the next of those. The
// number typed here lives in this component's state only (never in storage or the address), and the page shows nothing the server did not send.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { PHONE_HINT } from '@/lib/phone';
import {
  CARD, CARD_HEADING, NOTICE, OFFLINE_TEXT, OPTIONAL_POSITION_WAIT_MS, OUTLINE, POSITION_TEXT, PRIMARY, RING,
  callApi, clockOf, crewOf, currentPosition, dataOf, distanceOf, isObject, messageOf, namesOf, photoCanOf, photosOf, postJson, textOf, timerOf, windowOf,
} from './jobLinkKit';
import JobPhotos from './JobPhotos';
import JobTimer from './JobTimer';

const CODE_WAIT_SECONDS = 60;
const REFRESH_GAP_MS = 1000;

const OPENING_TEXT = 'Opening your job...';
const INVALID_TEXT = 'This link is not valid.';
const INVALID_MORE_TEXT = 'It may have been switched off or replaced, or the job may be finished. Ask your provider for the current link.';
const LOAD_FAILED_TEXT = "Couldn't open this job.";
const NUMBER_MISSING_TEXT = 'Enter your mobile number.';
const CODE_MISSING_TEXT = 'Enter the 6-digit code from the text.';
const ASK_FAILED_TEXT = "Couldn't send a code. Try again.";
const VERIFY_FAILED_TEXT = "Couldn't check that code. Try again.";
const TOO_MANY_TEXT = 'Too many tries on this link. Try again in a while, or ask your provider.';
const NO_SESSION_TEXT = "The code was right, but this browser did not keep the sign-in. Allow cookies for this page, then try again.";
const CODE_SENT_TEXT = 'If that number is on this job, a code is on its way. It lasts 10 minutes.';
const NO_CODE_TEXT = 'No code after five minutes? Ask your provider to check that your number is verified.';
const PROVIDER_ADMIN_TEXT = 'Provider or WorkOnTap admin? Sign in to your account in this browser, then reload this page.';
const NO_CREW_TEXT = 'No cleaners are assigned to this job yet.';
const LOCATION_NOTE_TEXT = "We record your phone's location when you check in. The office can see if it is not at the job address.";
const PERMISSION_TEXT = "We need your location to check in. Allow location for this page in your phone's settings, then try again.";
const CHECK_IN_FAILED_TEXT = "Couldn't check them in. Try again.";
const CHECK_OUT_FAILED_TEXT = "Couldn't check them out. Try again.";
const ALL_IN_TEXT = 'Everyone on the crew is checked in.';
const LATE_TEXT = 'Someone arriving late? Tick them and check them in the same way.';
// How long the polite line stays on the page after an action.
const SAID_FOR_MS = 8000;

const KINDS = ['cleaner', 'provider', 'admin'];
const KIND_NOTE = { cleaner: '', provider: ' (provider)', admin: ' (admin)' };

// A button on a crew row sits beside the name when there is room and under it when there is not.
const LEAVE = `px-4 py-2 min-h-[48px] rounded-xl border border-gray-500 text-base font-semibold text-gray-800 hover:bg-gray-50 transition-colors aria-disabled:opacity-50 ${RING}`;
const INPUT = 'w-full rounded-xl border border-gray-500 px-3 py-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-700';

// The answer for a person who is let in, in the shape the screens use, or null when the answer is not the one the route promises.
function viewOf(data) {
  const crew = crewOf(data.crew);
  const { job, you } = data;
  if (!KINDS.includes(data.access) || !isObject(you) || !isObject(job) || !isObject(job.address) || !isObject(job.details) || !Array.isArray(job.days) || !crew) {
    return null;
  }
  const { address, details } = job;
  return {
    access: data.access,
    name: textOf(you.name),
    service: textOf(job.service_name),
    days: job.days.filter((day) => typeof day === 'string' && day.trim() !== ''),
    address: [textOf(address.line1), textOf(address.line2), [textOf(address.city), textOf(address.postal_code)].filter(Boolean).join(' ')].filter(Boolean),
    description: textOf(details.description),
    instructions: textOf(details.instructions),
    timingNote: textOf(details.timing_note),
    parking: details.parking === true,
    elevator: details.elevator === true,
    pets: details.pets === true,
    workers: Number.isInteger(details.worker_count) && details.worker_count > 0 ? details.worker_count : 0,
    crew,
    window: windowOf(data.window),
    // null when the answer's own figures cannot be read: the card says so and offers to read again
    timer: timerOf(data.timer),
    photos: photosOf(data.photos),
    photoCan: photoCanOf(data.photo_can),
  };
}

// What a read of the link says: { status: 'invalid' } for the one answer every dead link gets, { status: 'none' } for a visitor with no way in,
// { status: 'in', view } for a person who is let in, and { status: 'failed', offline } for anything else, including a call that does not complete.
function readOf(result) {
  if (result.status === 404) return { status: 'invalid' };
  const data = dataOf(result);
  if (!data) return { status: 'failed', offline: result.status === 0 };
  if (data.access === 'none') return { status: 'none' };
  const view = viewOf(data);
  return view ? { status: 'in', view } : { status: 'failed', offline: false };
}

function Frame({ children }) {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 sm:py-10">
      <div className="mx-auto max-w-lg space-y-4">
        <p className="text-sm font-semibold uppercase tracking-wide text-green-800">WorkOnTap</p>
        {children}
      </div>
    </main>
  );
}

function Spinner() {
  return <div aria-hidden="true" className="w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />;
}

// The two steps of getting in: the mobile number, then the code texted to it. Whatever the number was, the answer to the first step is the same, so the
// second step opens after any accepted number and says only that a code is on its way if the number is on the job.
function SignIn({ base, onSignedIn, onInvalid }) {
  const phoneId = useId();
  const phoneHintId = useId();
  const codeId = useId();
  const [step, setStep] = useState('number');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [waitUntil, setWaitUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const phoneRef = useRef(null);
  const codeRef = useRef(null);

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (step !== 'code') return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [step]);

  const waitLeft = Math.max(0, Math.ceil((waitUntil - now) / 1000));

  // Asks for a code. A route answer of 200 is the same whether or not the number is on the job, so it is the only thing the page can learn here.
  const ask = async () => {
    if (busy) return;
    if (phone.trim() === '') {
      setProblem(NUMBER_MISSING_TEXT);
      phoneRef.current?.focus();
      return;
    }
    setBusy(true);
    setProblem('');
    const result = await postJson(`${base}/code`, { phone: phone.trim() });
    setBusy(false);
    if (result.status === 404) return onInvalid();
    if (dataOf(result)?.requested === true) {
      setCode('');
      setStep('code');
      setNow(Date.now());
      setWaitUntil(Date.now() + CODE_WAIT_SECONDS * 1000);
      return undefined;
    }
    setProblem(result.status === 429 ? TOO_MANY_TEXT : result.status === 0 ? OFFLINE_TEXT : messageOf(result) || ASK_FAILED_TEXT);
    return undefined;
  };

  const askAgain = async () => {
    if (busy || waitLeft > 0) return;
    setBusy(true);
    setProblem('');
    const result = await postJson(`${base}/code`, { phone: phone.trim() });
    setBusy(false);
    if (result.status === 404) return onInvalid();
    if (dataOf(result)?.requested === true) {
      setNow(Date.now());
      setWaitUntil(Date.now() + CODE_WAIT_SECONDS * 1000);
      codeRef.current?.focus();
      return undefined;
    }
    setProblem(result.status === 429 ? TOO_MANY_TEXT : result.status === 0 ? OFFLINE_TEXT : messageOf(result) || ASK_FAILED_TEXT);
    return undefined;
  };

  const open = async (event) => {
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
    const result = await postJson(`${base}/verify`, { phone: phone.trim(), code: digits });
    if (result.status === 404) {
      setBusy(false);
      return onInvalid();
    }
    if (dataOf(result)?.signed_in === true) {
      // The cookie is the server's: the page asks again and draws what the answer allows. An answer of no access means this browser kept nothing.
      const after = await onSignedIn();
      setBusy(false);
      if (after === 'none') setProblem(NO_SESSION_TEXT);
      else if (after === 'failed') setProblem(OFFLINE_TEXT);
      return undefined;
    }
    setBusy(false);
    setProblem(result.status === 429 ? TOO_MANY_TEXT : result.status === 0 ? OFFLINE_TEXT : messageOf(result) || VERIFY_FAILED_TEXT);
    return undefined;
  };

  const problemLine = problem && (
    <p role="alert" className="mt-3 text-sm font-medium text-red-700">{problem}</p>
  );

  if (step === 'number') {
    return (
      <section className={CARD} aria-labelledby={`${phoneId}-heading`}>
        <h1 id={`${phoneId}-heading`} className="text-xl font-bold text-gray-900">Open your job.</h1>
        <p className="mt-2 text-sm text-gray-700">Enter the mobile number your provider has for you and we will text you a code.</p>
        <form onSubmit={(event) => { event.preventDefault(); ask(); }} className="mt-4" noValidate>
          <label htmlFor={phoneId} className="block text-sm font-semibold text-gray-900">Mobile number</label>
          <input id={phoneId} ref={phoneRef} type="tel" inputMode="tel" autoComplete="tel" value={phone} aria-describedby={phoneHintId}
            aria-invalid={problem ? true : undefined} onChange={(event) => { setPhone(event.target.value); setProblem(''); }} className={`${INPUT} mt-1`} />
          <p id={phoneHintId} className="mt-1 text-xs text-gray-600">{PHONE_HINT}</p>
          {problemLine}
          <button type="submit" aria-disabled={busy || undefined} className={`${PRIMARY} mt-4`}>{busy ? 'Sending...' : 'Text me a code'}</button>
        </form>
        <p className="mt-5 text-xs text-gray-600">{PROVIDER_ADMIN_TEXT}</p>
      </section>
    );
  }

  return (
    <section className={CARD} aria-labelledby={`${codeId}-heading`}>
      <h1 id={`${codeId}-heading`} className="text-xl font-bold text-gray-900">Enter your code.</h1>
      <p role="status" className="mt-2 text-sm text-gray-700">{CODE_SENT_TEXT}</p>
      <form onSubmit={open} className="mt-4" noValidate>
        <label htmlFor={codeId} className="block text-sm font-semibold text-gray-900">6-digit code</label>
        <input id={codeId} ref={codeRef} type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code}
          aria-invalid={problem ? true : undefined} onChange={(event) => { setCode(event.target.value); setProblem(''); }} className={`${INPUT} mt-1 tracking-widest`} />
        {problemLine}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <button type="submit" aria-disabled={busy || undefined} className={PRIMARY}>{busy ? 'Checking...' : 'Open the job'}</button>
          <button type="button" aria-disabled={busy || waitLeft > 0 || undefined} onClick={askAgain} className={OUTLINE}>
            {waitLeft > 0 ? `Ask for a new code (${waitLeft})` : 'Ask for a new code'}
          </button>
        </div>
      </form>
      <button type="button" onClick={() => { setStep('number'); setProblem(''); setTimeout(() => phoneRef.current?.focus(), 0); }}
        className={`mt-4 inline-flex items-center min-h-[48px] text-sm font-semibold text-green-800 underline rounded ${RING}`}>Use a different number</button>
      <p className="mt-4 text-xs text-gray-600">{NO_CODE_TEXT}</p>
    </section>
  );
}

function Facts({ view }) {
  const facts = [
    view.parking && 'Parking: yes',
    view.elevator && 'Elevator: yes',
    view.pets && 'Pets: yes',
    view.workers > 0 && `Cleaners needed: ${view.workers}`,
  ].filter(Boolean);
  const wording = [
    view.description && ['Description', view.description],
    view.instructions && ['Instructions', view.instructions],
    view.timingNote && ['Timing', view.timingNote],
  ].filter(Boolean);
  if (facts.length === 0 && wording.length === 0) return null;
  return (
    <section className={CARD} aria-labelledby="details-heading">
      <h2 id="details-heading" className="text-sm font-bold uppercase tracking-wide text-gray-700">Details</h2>
      <dl className="mt-2 space-y-2">
        {wording.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-semibold text-gray-600">{label}</dt>
            <dd className="text-base text-gray-900 whitespace-pre-line break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {facts.length > 0 && (
        <ul className="mt-3 space-y-1 text-base text-gray-900">
          {facts.map((fact) => <li key={fact}>{fact}</li>)}
        </ul>
      )}
    </section>
  );
}

// The job for a person who is let in, with the crew, the check-in and out, the photos and the timer. `onChanged` asks the page to read the link again;
// `onPatch` puts newer parts of the read (the timer, the photos) on the page at once; `onOut` and `onInvalid` send the page back to the step the server's
// answer calls for.
function JobView({ view, base, onChanged, onPatch, onOut, onInvalid }) {
  const crewHeadingId = useId();
  const confirmId = useId();
  const crewHeadingRef = useRef(null);
  const stayRef = useRef(null);
  const outButtons = useRef(new Map());
  const restore = useRef(null);
  const saying = useRef(null);
  const [ticked, setTicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [leaving, setLeaving] = useState(null);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [leaveNote, setLeaveNote] = useState('');
  const [said, setSaid] = useState({ text: '', count: 0 });

  const here = view.crew.filter((member) => member.checkedIn);
  const gone = view.crew.filter((member) => !member.checkedIn && member.checkedOutAt);
  const waiting = view.crew.filter((member) => !member.checkedIn && !member.checkedOutAt);
  const chosen = waiting.filter((member) => ticked.has(member.id));
  const open = view.window.open;
  const closedText = view.window.opensLabel ? `Check-in opens at ${view.window.opensLabel}.` : 'Check-in has not opened yet.';

  // The polite line a screen reader announces after an action. The count changes the line's text each time, so the same words twice in a row are announced twice.
  const say = (text) => {
    clearTimeout(saying.current);
    setSaid((held) => ({ text, count: held.count + 1 }));
    saying.current = setTimeout(() => setSaid((held) => ({ text: '', count: held.count })), SAID_FOR_MS);
  };
  useEffect(() => () => clearTimeout(saying.current), []);

  // The confirm opens with focus on "Stay", and when it closes without a check-out focus goes back to the button that opened it.
  useEffect(() => {
    if (leaving !== null) stayRef.current?.focus();
    else if (restore.current !== null) {
      outButtons.current.get(restore.current)?.focus();
      restore.current = null;
    }
  }, [leaving]);

  const toggle = (id) => {
    setNote(null);
    setTicked((held) => {
      const next = new Set(held);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const checkIn = async (event) => {
    event.preventDefault();
    if (busy || !open || chosen.length === 0) return undefined;
    setBusy(true);
    setNote(null);
    const place = await currentPosition();
    if (!place.ok) {
      setBusy(false);
      setNote({ kind: 'error', text: place.denied ? PERMISSION_TEXT : POSITION_TEXT });
      return undefined;
    }
    const ids = chosen.map((member) => member.id);
    const names = chosen.map((member) => member.name);
    const result = await postJson(`${base}/check-in`, { crew_ids: ids, location: { latitude: place.latitude, longitude: place.longitude, accuracy: place.accuracy } });
    setBusy(false);

    const data = dataOf(result);
    if (data) {
      const nowIn = Array.isArray(data.checked_in) ? names.filter((_, index) => data.checked_in.includes(ids[index])) : names;
      setTicked(new Set());
      setNote({
        kind: 'ok',
        text: nowIn.length > 0 ? `Checked in: ${namesOf(nowIn)}.` : `Already checked in: ${namesOf(names)}.`,
        away: data.away === true ? distanceOf(data.distance_m) : null,
      });
      onChanged();
      return undefined;
    }
    if (result.status === 401) return onOut();
    if (result.status === 404) return onInvalid();
    if (result.status === 0) {
      setNote({ kind: 'error', text: OFFLINE_TEXT });
      return undefined;
    }
    // A 4xx is written to be shown as it stands (the opening time, a crew that changed). Each of them leaves the page behind the server, so it reads again.
    setNote({ kind: 'error', text: messageOf(result) || CHECK_IN_FAILED_TEXT });
    onChanged();
    return undefined;
  };

  const leave = (member) => {
    setNote(null);
    setLeaveNote('');
    setLeaving(member.id);
  };

  const stay = (member) => {
    restore.current = member.id;
    setLeaveNote('');
    setLeaving(null);
  };

  // A check-out is final for this job, so it is asked for twice. The phone's position goes with it when the phone has one within a short wait.
  const checkOut = async (member) => {
    if (leaveBusy) return undefined;
    setLeaveBusy(true);
    setLeaveNote('');
    const place = await currentPosition(OPTIONAL_POSITION_WAIT_MS);
    const body = { crew_ids: [member.id] };
    if (place.ok) body.location = { latitude: place.latitude, longitude: place.longitude, accuracy: place.accuracy };
    const result = await postJson(`${base}/check-out`, body);
    setLeaveBusy(false);

    const data = dataOf(result);
    if (data) {
      setLeaving(null);
      setNote({ kind: 'ok', text: `Checked out: ${member.name}.` });
      say('Cleaner checked out');
      const timer = timerOf(data.timer);
      if (timer) onPatch({ timer });
      onChanged();
      crewHeadingRef.current?.focus();
      return undefined;
    }
    if (result.status === 401) return onOut();
    if (result.status === 404) return onInvalid();
    if (result.status === 0 || result.status >= 500) {
      setLeaveNote(result.status === 0 ? OFFLINE_TEXT : CHECK_OUT_FAILED_TEXT);
      return undefined;
    }
    setLeaving(null);
    setNote({ kind: 'error', text: messageOf(result) || CHECK_OUT_FAILED_TEXT });
    onChanged();
    return undefined;
  };

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold text-gray-900 break-words">{view.service || 'Your job'}</h1>
        <p className="mt-1 text-sm text-gray-700">Signed in as {view.name}{KIND_NOTE[view.access]}</p>
      </div>

      <section className={CARD} aria-labelledby="when-heading">
        <h2 id="when-heading" className={CARD_HEADING}>When</h2>
        {view.days.length === 0 ? <p className="mt-2 text-base text-gray-900">No day is set for this job yet.</p> : (
          <ul className="mt-2 space-y-1 text-base text-gray-900">
            {view.days.map((day) => <li key={day}>{day}</li>)}
          </ul>
        )}
      </section>

      <section className={CARD} aria-labelledby="where-heading">
        <h2 id="where-heading" className={CARD_HEADING}>Where</h2>
        {view.address.length === 0 ? <p className="mt-2 text-base text-gray-900">No address is set for this job yet.</p> : (
          <p className="mt-2 text-base text-gray-900">
            {view.address.map((line, index) => <span key={`${index}-${line}`} className="block break-words">{line}</span>)}
          </p>
        )}
      </section>

      <Facts view={view} />

      <section className={CARD} aria-labelledby={crewHeadingId}>
        <h2 id={crewHeadingId} ref={crewHeadingRef} tabIndex={-1} className={`${CARD_HEADING} focus:outline-none`}>Crew</h2>

        {view.crew.length === 0 && <p className="mt-2 text-base text-gray-900">{NO_CREW_TEXT}</p>}

        {here.length > 0 && (
          <ul className="mt-2 space-y-2">
            {here.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 text-base text-gray-900">
                <span className="min-w-0 flex-1 basis-40 break-words">
                  <span aria-hidden="true" className="mr-2 text-green-700">&#10003;</span>
                  {member.name}
                  <span className="text-sm text-gray-600">, checked in{member.checkedInAt && clockOf(member.checkedInAt) ? ` ${clockOf(member.checkedInAt)}` : ''}</span>
                </span>
                {leaving !== member.id ? (
                  <button type="button" aria-label={`Check out ${member.name}`} onClick={() => leave(member)}
                    ref={(node) => { if (node) outButtons.current.set(member.id, node); else outButtons.current.delete(member.id); }}
                    className={LEAVE}>Check out</button>
                ) : (
                  <div role="group" aria-labelledby={confirmId} onKeyDown={(event) => { if (event.key === 'Escape') stay(member); }}
                    className="w-full rounded-xl border border-amber-300 bg-amber-50 p-3">
                    <p id={confirmId} className="text-base text-amber-900 break-words">Check out {member.name}? They can not check in again on this job.</p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <button type="button" ref={stayRef} onClick={() => stay(member)} className={OUTLINE}>Stay</button>
                      <button type="button" aria-disabled={leaveBusy || undefined} onClick={() => checkOut(member)} className={PRIMARY}>{leaveBusy ? 'Checking out...' : 'Check out'}</button>
                    </div>
                    {leaveNote && <p role="alert" className="mt-2 text-sm font-medium text-red-700">{leaveNote}</p>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {gone.length > 0 && (
          <ul className="mt-2 space-y-2">
            {gone.map((member) => (
              <li key={member.id} className="text-base text-gray-900 break-words">
                {member.name}
                <span className="block text-sm text-gray-600">{clockOf(member.checkedOutAt) ? `Checked out at ${clockOf(member.checkedOutAt)}` : 'Checked out'}</span>
              </li>
            ))}
          </ul>
        )}

        {!open && view.crew.length > 0 && <p className={`mt-3 ${NOTICE}`}>{closedText}</p>}

        {waiting.length > 0 && (
          <form onSubmit={checkIn} className="mt-3 space-y-3" noValidate>
            <fieldset disabled={!open} className="min-w-0 space-y-2">
              <legend className="text-sm font-semibold text-gray-900">Tick everyone who is here</legend>
              {waiting.map((member) => (
                <label key={member.id} className="flex items-center gap-3 rounded-xl border border-gray-300 px-3 py-2.5 min-h-[48px] cursor-pointer has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                  <input type="checkbox" checked={ticked.has(member.id)} onChange={() => { if (!busy) toggle(member.id); }}
                    className="h-6 w-6 shrink-0 accent-green-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700" />
                  <span className="min-w-0 text-base text-gray-900 break-words">{member.name}</span>
                </label>
              ))}
            </fieldset>
            <button type="submit" aria-disabled={busy || !open || chosen.length === 0 || undefined} className={PRIMARY}>
              {busy ? 'Checking in...' : `Check in ${chosen.length}`}
            </button>
            <p className="text-xs text-gray-600">{LOCATION_NOTE_TEXT}</p>
          </form>
        )}

        <div role="status" className="mt-3 space-y-2">
          {note?.kind === 'ok' && <p className="text-sm font-medium text-green-800">{note.text}</p>}
          {note?.kind === 'ok' && note.away && <p className="text-sm font-medium text-amber-900">Your phone puts you {note.away} from the job address. The office can see this.</p>}
          {view.crew.length > 0 && waiting.length === 0 && gone.length === 0 && <p className="text-sm font-medium text-green-800">{ALL_IN_TEXT}</p>}
          {here.length > 0 && waiting.length > 0 && <p className="text-sm text-gray-700">{LATE_TEXT}</p>}
        </div>
        {note?.kind === 'error' && <p role="alert" className="mt-3 text-sm font-medium text-red-700">{note.text}</p>}
      </section>

      <JobPhotos base={base} view={view} onPhotos={(photos) => onPatch({ photos })} onChanged={onChanged} onOut={onOut} onInvalid={onInvalid} onSay={say} />
      <JobTimer base={base} view={view} said={said.count % 2 === 0 ? said.text : `${said.text} `} onTimer={(timer) => onPatch({ timer })} onChanged={onChanged}
        onOut={onOut} onInvalid={onInvalid} onSay={say} />
    </>
  );
}

export default function JobLink({ token }) {
  const base = `/api/job/${encodeURIComponent(token)}`;
  const [read, setRead] = useState({ status: 'loading' });
  const live = useRef(true);
  const lastRead = useRef(0);

  // Reads the link. `quiet` keeps what is on the page while the read runs and keeps it when the read cannot be made; it returns the status read, so a
  // caller can tell whether a sign-in took.
  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setRead({ status: 'loading' });
    lastRead.current = Date.now();
    const next = readOf(await callApi(base));
    if (!live.current) return 'gone';
    setRead((held) => (quiet && next.status === 'failed' && (held.status === 'in' || held.status === 'none') ? held : next));
    return next.status;
  }, [base]);

  useEffect(() => {
    live.current = true;
    load();
    return () => { live.current = false; };
  }, [load]);

  // A tab that comes back to the front asks again; the page does not poll.
  useEffect(() => {
    const again = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastRead.current < REFRESH_GAP_MS) return;
      load({ quiet: true });
    };
    document.addEventListener('visibilitychange', again);
    window.addEventListener('focus', again);
    return () => {
      document.removeEventListener('visibilitychange', again);
      window.removeEventListener('focus', again);
    };
  }, [load]);

  const invalid = () => setRead({ status: 'invalid' });
  const signedIn = () => load({ quiet: true });
  // Puts newer parts of the read (the timer, the photos) on the page without a read of the whole link.
  const patch = useCallback((part) => {
    setRead((held) => (held.status === 'in' ? { ...held, view: { ...held.view, ...part } } : held));
  }, []);

  if (read.status === 'loading') {
    return (
      <Frame>
        <div role="status" className="flex items-center justify-center gap-3 py-10">
          <Spinner />
          <span className="text-base text-gray-700">{OPENING_TEXT}</span>
        </div>
      </Frame>
    );
  }

  if (read.status === 'invalid') {
    return (
      <Frame>
        <section className={CARD}>
          <h1 className="text-xl font-bold text-gray-900">{INVALID_TEXT}</h1>
          <p className="mt-2 text-sm text-gray-700">{INVALID_MORE_TEXT}</p>
        </section>
      </Frame>
    );
  }

  if (read.status === 'failed') {
    return (
      <Frame>
        <div role="alert" className={CARD}>
          <p className="text-base font-medium text-red-800">{read.offline ? OFFLINE_TEXT : LOAD_FAILED_TEXT}</p>
          <button type="button" onClick={() => load()} className={`${PRIMARY} mt-4`}>Try again</button>
        </div>
      </Frame>
    );
  }

  if (read.status === 'none') {
    return (
      <Frame>
        <SignIn base={base} onSignedIn={signedIn} onInvalid={invalid} />
      </Frame>
    );
  }

  return (
    <Frame>
      <JobView view={read.view} base={base} onChanged={() => load({ quiet: true })} onPatch={patch} onOut={() => load({ quiet: true })} onInvalid={invalid} />
    </Frame>
  );
}
