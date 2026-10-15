'use client';

// The Timer card of the job link (ENG-016): the quoted time, the clock that counts it down for each cleaner who is checked in, and the buttons that start,
// pause and resume the job. The server works the clock out from its rows; the page counts the seconds between answers (useCountdown) and asks again every
// TIMER_POLL_SECONDS, so a cleaner who joins or leaves on another phone shows here within one poll, and every action's answer replaces the timer at once. A
// poll or an action that is answered 404 or 401 sends the page back to the step that answer calls for, and the clock stops with the card. The phone's
// position is required to start the job and sent with the other actions when the phone has it.

import { useEffect, useId, useRef, useState } from 'react';
import {
  BLOCKED_TEXT, CARD, CARD_HEADING, OFFLINE_TEXT, OPTIONAL_POSITION_WAIT_MS, OUTLINE, POSITION_TEXT, PRIMARY, REQUIRED_POSITION_WAIT_MS, TIMER_POLL_SECONDS, RING,
  callApi, clockFaceOf, clockOf, currentPosition, dataOf, durationOf, messageOf, postJson, timerOf, useCountdown,
} from './jobLinkKit';

const START_LOCATION_TEXT = "We need your phone's location to start the job. Allow location for this page and try again.";
const NOT_HERE_TEXT = BLOCKED_TEXT.not_here;
const START_OFF_TEXT = 'The job can not be started right now.';
const NOBODY_TEXT = 'Nobody is checked in.';
const UNREADABLE_TEXT = 'The timer can not be shown right now.';
const OFFLINE_CLOCK_TEXT = "Can't reach the server. The clock keeps counting here.";
const LOCATION_NOTE_TEXT = "We record your phone's location when you start, pause or resume the job, add a photo or check someone out. The office can see it.";
const OVER_TEXT = 'This job has used its quoted time. It is flagged for the office. Time past the quote is recorded and nothing extra is charged.';

const SAID = { start: 'Job started', pause: 'Job paused', resume: 'Job resumed' };
const FAILED = {
  start: "Couldn't start the job. Try again.",
  pause: "Couldn't pause the job. Try again.",
  resume: "Couldn't resume the job. Try again.",
};
const LABEL = { start: 'Start the job', pause: 'Pause the job', resume: 'Resume the job' };
const BUSY_LABEL = { start: 'Starting...', pause: 'Pausing...', resume: 'Resuming...' };

// The seconds after which a phone that has counted to 0 asks for the figure past the quote, before the next poll is due.
const SPENT_ASK_MS = 1500;

// `view` is the page's read (timer, crew); `said` is the polite line the page keeps for a screen reader. `onTimer(timer)` puts a newer timer on the page,
// `onChanged` asks the page to read the link again (the photos' buttons follow the job's state, and the Crew card follows the timer's crew), `onOut` and
// `onInvalid` send the page back to the step the server's answer calls for, and `onSay(text)` sets the polite line.
export default function JobTimer({ base, view, said, onTimer, onChanged, onOut, onInvalid, onSay }) {
  const headingId = useId();
  const reasonId = useId();
  const { timer } = view;
  const { left, over } = useCountdown(timer);
  const [busy, setBusy] = useState(null);
  const [problem, setProblem] = useState('');
  const [offline, setOffline] = useState(false);
  const live = useRef(true);
  const askRef = useRef(null);
  const hereOnPage = view.crew.filter((member) => member.checkedIn).length;

  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  // One ask of the timer. It reads the latest props each time it is called, so the interval below always asks with the current ones.
  askRef.current = async () => {
    if (document.visibilityState !== 'visible') return undefined;
    const result = await callApi(`${base}/timer`);
    if (!live.current) return undefined;
    if (result.status === 404) return onInvalid();
    if (result.status === 401) return onOut();
    const data = dataOf(result);
    const next = data ? timerOf(data.timer) : null;
    if (!next) {
      if (result.status === 0) setOffline(true);
      return undefined;
    }
    setOffline(false);
    onTimer(next);
    // The Crew card reads from the page, the clock from this answer: when they disagree about who is here the page reads the link again.
    if (next.crewHere !== hereOnPage) onChanged();
    return undefined;
  };

  const watching = timer !== null;
  useEffect(() => {
    if (!watching) return undefined;
    const beat = setInterval(() => askRef.current(), TIMER_POLL_SECONDS * 1000);
    return () => clearInterval(beat);
  }, [base, watching]);

  // A phone that has counted its figure down to 0 asks once for how far past the quote the job is, rather than showing 0:00:00 until the next poll.
  const spent = timer?.state === 'running' && left === 0 && over === null;
  useEffect(() => {
    if (!spent) return undefined;
    const wait = setTimeout(() => askRef.current(), SPENT_ASK_MS);
    return () => clearTimeout(wait);
  }, [spent, timer]);

  const act = async (action) => {
    if (busy) return undefined;
    setBusy(action);
    setProblem('');
    const place = await currentPosition(action === 'start' ? REQUIRED_POSITION_WAIT_MS : OPTIONAL_POSITION_WAIT_MS);
    if (!live.current) return undefined;
    if (!place.ok && action === 'start') {
      setBusy(null);
      setProblem(place.denied ? START_LOCATION_TEXT : POSITION_TEXT);
      return undefined;
    }
    const body = place.ok ? { action, location: { latitude: place.latitude, longitude: place.longitude, accuracy: place.accuracy } } : { action };
    const result = await postJson(`${base}/timer`, body);
    if (!live.current) return undefined;
    setBusy(null);

    const data = dataOf(result);
    const next = data ? timerOf(data.timer) : null;
    if (next) {
      setOffline(false);
      onTimer(next);
      onSay(SAID[action]);
      if (action === 'start') onChanged();
      return undefined;
    }
    if (result.status === 401) return onOut();
    if (result.status === 404) return onInvalid();
    if (result.status === 0) {
      setProblem(OFFLINE_TEXT);
      return undefined;
    }
    // A 4xx is written to be shown as it stands (a second phone pressed Start first, the last cleaner left). It leaves the page behind the server, so it reads again.
    setProblem(messageOf(result) || FAILED[action]);
    if (result.status < 500) onChanged();
    return undefined;
  };

  if (!timer) {
    return (
      <section className={CARD} aria-labelledby={headingId}>
        <h2 id={headingId} className={CARD_HEADING}>Job timer</h2>
        <p className="mt-2 text-base text-gray-900">{UNREADABLE_TEXT}</p>
        <button type="button" onClick={onChanged} className={`${OUTLINE} mt-3`}>Try again</button>
      </section>
    );
  }

  const { state, can, crewHere } = timer;
  const isOver = over !== null;
  const quote = durationOf(timer.quoteMinutes * 60);
  const action = state === 'not_started' ? 'start' : state === 'running' ? 'pause' : 'resume';
  const allowed = can[action];
  const reason = action === 'start' ? BLOCKED_TEXT[timer.blocked] || START_OFF_TEXT : action === 'resume' && crewHere === 0 ? BLOCKED_TEXT.nobody_here : NOT_HERE_TEXT;
  const face = isOver ? `Over by ${clockFaceOf(over)}` : left === null ? '-' : clockFaceOf(left);

  return (
    <>
      {isOver && (
        <div role="status" className="flex gap-3 rounded-2xl border border-amber-400 bg-amber-50 p-4 text-amber-900">
          <span aria-hidden="true" className="text-xl leading-none">&#9888;</span>
          <p className="text-base font-medium">{OVER_TEXT}</p>
        </div>
      )}

      <section className={CARD} aria-labelledby={headingId}>
        <h2 id={headingId} className={CARD_HEADING}>Job timer</h2>

        {state === 'not_started' ? (
          <div className="mt-2 space-y-1 text-base text-gray-900">
            <p>Quoted time: {quote} for the job</p>
            <p>{crewHere > 0 ? `With ${crewHere} ${crewHere === 1 ? 'cleaner' : 'cleaners'} here that is ${durationOf(timer.clockSeconds)} each` : 'Check in who is here to see the time each cleaner has'}</p>
          </div>
        ) : (
          <>
            <div className="mt-3 rounded-xl border border-gray-300 px-4 py-5 text-center">
              <p role="timer" aria-live="off" className={`text-4xl font-bold tabular-nums ${isOver ? 'text-amber-900' : 'text-gray-900'}`}>
                {isOver && <span aria-hidden="true">&#9888; </span>}{face}
              </p>
              {!isOver && crewHere > 0 && <p className="mt-1 text-sm text-gray-700">{crewHere === 1 ? 'left for the cleaner here' : `left for each of the ${crewHere} cleaners here`}</p>}
              {crewHere === 0 && <p className="mt-1 text-sm font-medium text-gray-900">{NOBODY_TEXT}</p>}
              {state === 'paused' && <p className="mt-2 text-base font-bold text-gray-900"><span aria-hidden="true">&#10074;&#10074; </span>Paused</p>}
            </div>
            <p className="mt-3 text-base text-gray-900">Quoted {quote} &middot; {durationOf(timer.usedSeconds)} of crew time used</p>
          </>
        )}

        <button type="button" aria-disabled={!allowed || busy !== null || undefined} aria-describedby={allowed ? undefined : reasonId} onClick={() => allowed && act(action)}
          className={`${action === 'start' ? PRIMARY : OUTLINE} mt-4`}>{busy === action ? BUSY_LABEL[action] : LABEL[action]}</button>
        {!allowed && <p id={reasonId} className="mt-2 text-sm text-gray-700">{reason}</p>}

        {problem && <p role="alert" className="mt-3 text-sm font-medium text-red-700">{problem}</p>}
        {offline && <p className="mt-2 text-sm text-gray-700">{OFFLINE_CLOCK_TEXT}</p>}

        {timer.members.length > 0 && (
          <details className="mt-4 rounded-xl border border-gray-300">
            <summary className={`flex min-h-[48px] cursor-pointer items-center rounded-xl px-3 text-base font-semibold text-gray-900 ${RING}`}>Time worked by each cleaner</summary>
            <ul className="space-y-2 px-3 pb-3">
              {timer.members.map((member) => (
                <li key={member.id} className="flex flex-wrap items-baseline justify-between gap-x-3 text-base text-gray-900">
                  <span className="min-w-0 break-words">{member.name}</span>
                  <span className="font-semibold tabular-nums">{durationOf(member.workedSeconds)}</span>
                  {member.checkedOutAt && clockOf(member.checkedOutAt) && <span className="w-full text-sm text-gray-700">out at {clockOf(member.checkedOutAt)}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}

        <p role="status" aria-live="polite" className="mt-3 min-h-[1.25rem] text-sm font-medium text-green-800">{said}</p>
        <p className="mt-2 text-xs text-gray-600">{LOCATION_NOTE_TEXT}</p>
      </section>
    </>
  );
}
