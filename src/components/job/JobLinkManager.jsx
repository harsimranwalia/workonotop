'use client';

// The job link of one job, for the people who manage it (ENG-015): the provider whose job it is, and an admin. One component draws both; the two panels
// that use it (src/components/provider/JobLinkPanel.jsx, src/components/admin/JobLinkAdminPanel.jsx) only say which routes to ask and which look to wear.
//   no link       "No link yet." and a button that makes one (held back, with the reason, while the job has nobody on its crew)
//   link on       the address in a read-only field, copy, open, switch off, issue a new link; each cleaner's number state and whether they have checked in
//   link off      "This link is switched off." and a button that brings it back as a new link
//   job finished  a sentence, and the crew as it was
// The link is a locator, not a credential: showing it to the person who manages the job is the point. What the panel shows is what the route answers;
// switching off and issuing a new link are asked about first, and a new link is sent with the generation this panel last saw so that two people acting at
// once do not each end up holding a link the other has ended.

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { callApi, clockOf, crewOf, dataOf, distanceOf, isObject, messageOf, OFFLINE_TEXT, postJson, stampOf, textOf, windowOf } from './jobLinkKit';
import { NumberChip } from '@/components/provider/CrewNumberCheck';

const LOADING_TEXT = 'Loading the job link...';
const LOAD_FAILED_TEXT = "Couldn't load the job link.";
const CHANGE_FAILED_TEXT = "Couldn't change the link. Try again.";
const SESSION_TEXT = 'Your session has ended. Sign in again to manage this link.';
const NO_LINK_TEXT = 'No link yet.';
const NO_CREW_TEXT = 'Add a cleaner to this job first.';
const OFF_TEXT = 'This link is switched off.';
const FINISHED_TEXT = 'This job is finished, so the link has stopped working.';
const SEND_TEXT = 'Send this link to your crew. Each cleaner gets a code by text when they open it, and you can open it yourself without a code while you are signed in.';
const OFF_QUESTION = 'Switch off the link? It stops working at once.';
const NEW_QUESTION = 'Issue a new link? The current link stops working at once and everyone signed in through it will need a new code.';
const COPY_FAILED_TEXT = 'Select the link and copy it.';
const NO_CHECKINS_TEXT = 'Nobody has checked in.';
const NO_EVENTS_TEXT = 'Nothing has happened on this link yet.';

// The look of each use. `button` is an outline button, `primary` the filled one; every colour pair is AA on its ground.
const LOOKS = {
  provider: {
    card: 'bg-white border-gray-200', strong: 'text-gray-900', muted: 'text-gray-600', well: 'bg-gray-50 border-gray-200', divider: 'divide-gray-100',
    ring: 'focus-visible:ring-green-700 focus-visible:ring-offset-white', field: 'bg-white text-gray-900 border-gray-500',
    button: 'border border-gray-500 text-gray-800 hover:bg-gray-50', primary: 'bg-green-700 hover:bg-green-800 text-white',
    ok: 'text-green-800', bad: 'text-red-700', warn: 'text-amber-900', anchor: 'text-green-800',
  },
  light: {
    card: 'bg-white border-gray-200', strong: 'text-gray-900', muted: 'text-gray-600', well: 'bg-gray-50 border-gray-100', divider: 'divide-gray-100',
    ring: 'focus-visible:ring-teal-600 focus-visible:ring-offset-white', field: 'bg-white text-gray-900 border-gray-500',
    button: 'border border-gray-500 text-gray-800 hover:bg-gray-50', primary: 'bg-teal-700 hover:bg-teal-800 text-white',
    ok: 'text-green-800', bad: 'text-red-700', warn: 'text-amber-800', anchor: 'text-teal-800',
  },
  dark: {
    card: 'bg-slate-900 border-slate-800', strong: 'text-white', muted: 'text-slate-400', well: 'bg-slate-800 border-slate-700', divider: 'divide-slate-800',
    ring: 'focus-visible:ring-teal-400 focus-visible:ring-offset-slate-900', field: 'bg-slate-900 text-white border-slate-500',
    button: 'border border-slate-500 text-slate-200 hover:bg-slate-800', primary: 'bg-teal-600 hover:bg-teal-500 text-white',
    ok: 'text-green-300', bad: 'text-red-300', warn: 'text-amber-300', anchor: 'text-teal-300',
  },
};

const WHO = { provider: 'The provider', admin: 'An admin', cleaner: 'A cleaner', visitor: 'Someone' };
const SUPPRESSED = {
  cannot_text: 'not a Canadian number',
  not_checked: 'number not checked',
  cooldown: 'asked for again too soon',
  number_cap: 'too many codes for this number today',
  provider_cap: 'daily text limit reached',
};

// A tick of the check-in list, or null when it is not the shape the route promises.
function checkinOf(value) {
  if (!isObject(value) || !Number.isInteger(value.crew_member_id)) return null;
  const by = isObject(value.by) ? value.by : {};
  return {
    id: value.crew_member_id,
    name: textOf(value.name),
    at: textOf(value.checked_in_at),
    by: textOf(by.name) || WHO[by.kind] || '',
    away: value.away === true ? true : value.away === false ? false : null,
    distance: value.distance_m,
  };
}

// A line of the activity list, or null when it is not the shape the route promises.
function eventOf(value) {
  if (!isObject(value) || !Number.isInteger(value.id) || typeof value.kind !== 'string') return null;
  const actor = isObject(value.actor) ? value.actor : {};
  return {
    id: value.id,
    kind: value.kind,
    who: textOf(actor.name) || WHO[actor.kind] || 'Someone',
    subject: textOf(value.subject),
    detail: textOf(value.detail),
    at: textOf(value.created_at),
  };
}

// An activity line in plain words.
function sayEvent(event) {
  const { who, subject, detail } = event;
  switch (event.kind) {
    case 'link_created': return `${who} made the link`;
    case 'link_off': return `${who} switched the link off`;
    case 'link_reissued': return `${who} issued a new link`;
    case 'signed_in': return `${subject || who} signed in`;
    case 'check_in': return `${subject || 'A cleaner'} was checked in by ${who}`;
    case 'code_failed': return `${subject || 'A cleaner'} typed a wrong code`;
    case 'code_suppressed': return `Code not sent${subject ? ` to ${subject}` : ''}: ${SUPPRESSED[detail] || 'not allowed'}`;
    case 'code_asked':
      if (detail === 'no_match') return 'A code was asked for a number that is not on this job';
      return `${detail === 'not_sent' ? 'A code could not be sent to' : 'A code was texted to'} ${subject || 'a cleaner'}`;
    default: return `${who} did something on this link`;
  }
}

// The managed view of an answer, or null when it is not the shape the routes promise.
function managedOf(data) {
  const crew = crewOf(data.crew);
  const link = data.job_link;
  const linkOk = link === null || (isObject(link) && typeof link.on === 'boolean' && Number.isInteger(link.generation));
  if (!crew || !linkOk) return null;
  return {
    link: link && { path: typeof link.path === 'string' && link.path.startsWith('/') ? link.path : null, on: link.on, generation: link.generation },
    open: data.status_open === true,
    crew,
    window: windowOf(data.window),
    checkins: Array.isArray(data.checkins) ? data.checkins.map(checkinOf).filter(Boolean) : null,
    events: Array.isArray(data.events) ? data.events.map(eventOf).filter(Boolean) : null,
  };
}

function Button({ look, primary, onClick, busy, buttonRef, describedBy, children, ...rest }) {
  return (
    <button type="button" ref={buttonRef} onClick={onClick} aria-disabled={busy || undefined} aria-describedby={describedBy} {...rest}
      className={`px-4 py-2 min-h-[44px] rounded-xl text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed ${primary ? look.primary : look.button} ${look.ring}`}>
      {children}
    </button>
  );
}

// `path` is the route for the job's link; `kind` is 'provider' or 'admin'; `look` names a row of LOOKS; `title` is the panel's heading.
export default function JobLinkManager({ path, kind, look: lookName, title }) {
  const look = LOOKS[lookName];
  const headingId = useId();
  const questionId = useId();
  const fieldId = useId();
  const [view, setView] = useState({ status: 'loading' });
  const [asking, setAsking] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const headingRef = useRef(null);
  const fieldRef = useRef(null);
  const keepRef = useRef(null);
  const live = useRef(true);

  // Reads the managed view: { status: 'absent' } for a job that is not there for this caller, { status: 'ended' } for a session that is gone,
  // { status: 'failed', offline } for anything else that is not an answer, and { status: 'ready', ...view } otherwise.
  const read = useCallback(async (signal) => {
    const result = await callApi(path, { signal });
    if (result.status === 404) return { status: 'absent' };
    if (result.status === 401 || result.status === 403) return { status: 'ended' };
    const data = dataOf(result);
    const managed = data ? managedOf(data) : null;
    return managed ? { status: 'ready', ...managed } : { status: 'failed', offline: result.status === 0 };
  }, [path]);

  useEffect(() => {
    live.current = true;
    const controller = new AbortController();
    read(controller.signal).then((next) => { if (live.current) setView(next); });
    return () => { live.current = false; controller.abort(); };
  }, [read]);

  useEffect(() => {
    if (asking) keepRef.current?.focus();
  }, [asking]);

  const retry = () => {
    setView({ status: 'loading' });
    read().then((next) => { if (live.current) setView(next); });
  };

  // After a change the view is read again, keeping the one on the screen if that read cannot be made.
  const refresh = async () => {
    const next = await read();
    if (live.current && next.status !== 'failed') setView(next);
  };

  const change = async (action, done) => {
    if (busy || view.status !== 'ready') return;
    setBusy(true);
    setNote(null);
    const result = await postJson(path, action === 'reissue' ? { action, generation: view.link?.generation } : { action });
    setBusy(false);
    if (!live.current) return;
    if (dataOf(result)) {
      setAsking(null);
      setNote({ kind: 'ok', text: done });
      await refresh();
      headingRef.current?.focus();
      return;
    }
    setAsking(null);
    if (result.status === 404) return setView({ status: 'absent' });
    setNote({ kind: 'error', text: result.status === 0 ? OFFLINE_TEXT : result.status === 401 || result.status === 403 ? SESSION_TEXT : messageOf(result) || CHANGE_FAILED_TEXT });
    // A refusal that says the job moved on (finished, a crew change, a link changed by someone else) is followed by a fresh read.
    if (result.status === 409) await refresh();
  };

  const copy = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      setNote({ kind: 'ok', text: 'Link copied.' });
    } catch {
      fieldRef.current?.select();
      setNote({ kind: 'error', text: COPY_FAILED_TEXT });
    }
  };

  if (view.status === 'absent' && kind === 'provider') return null;

  const ready = view.status === 'ready';
  const url = ready && view.link?.on && view.link.path ? `${window.location.origin}${view.link.path}` : '';
  const canChange = ready && view.open;

  return (
    <section aria-labelledby={headingId} className={`rounded-2xl border p-5 shadow-sm ${look.card}`}>
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className={`font-bold text-sm focus:outline-none ${look.strong}`}>{title}</h2>

      {view.status === 'loading' && <p role="status" className={`mt-3 text-sm ${look.muted}`}>{LOADING_TEXT}</p>}

      {view.status === 'absent' && <p role="alert" className={`mt-3 text-sm font-medium ${look.bad}`}>Booking not found.</p>}

      {view.status === 'ended' && <p role="alert" className={`mt-3 text-sm font-medium ${look.bad}`}>{SESSION_TEXT}</p>}

      {view.status === 'failed' && (
        <div role="alert" className="mt-3">
          <p className={`text-sm font-medium ${look.bad}`}>{view.offline ? OFFLINE_TEXT : LOAD_FAILED_TEXT}</p>
          <div className="mt-3"><Button look={look} primary onClick={retry}>Retry</Button></div>
        </div>
      )}

      {ready && !view.open && <p className={`mt-3 text-sm ${look.muted}`}>{view.link ? FINISHED_TEXT : 'This job is finished, so it has no link.'}</p>}

      {canChange && view.link === null && (
        <div className="mt-3">
          <p className={`text-sm ${look.strong}`}>{NO_LINK_TEXT}</p>
          <div className="mt-3">
            <Button look={look} primary busy={busy || view.crew.length === 0} describedBy={view.crew.length === 0 ? questionId : undefined}
              onClick={() => { if (view.crew.length > 0) change('create', 'Link created.'); }}>
              {busy ? 'Making...' : 'Create link'}
            </Button>
          </div>
          {view.crew.length === 0 && <p id={questionId} className={`mt-2 text-sm ${look.muted}`}>{NO_CREW_TEXT}</p>}
        </div>
      )}

      {canChange && view.link && !view.link.on && (
        <div className="mt-3">
          <p className={`text-sm ${look.strong}`}>{OFF_TEXT}</p>
          <div className="mt-3">
            <Button look={look} primary busy={busy || view.crew.length === 0} describedBy={view.crew.length === 0 ? questionId : undefined}
              onClick={() => { if (view.crew.length > 0) change('create', 'New link issued.'); }}>
              {busy ? 'Making...' : 'Issue a new link'}
            </Button>
          </div>
          {view.crew.length === 0 && <p id={questionId} className={`mt-2 text-sm ${look.muted}`}>{NO_CREW_TEXT}</p>}
        </div>
      )}

      {canChange && view.link?.on && (
        <div className="mt-3">
          <label htmlFor={fieldId} className={`block text-xs font-semibold ${look.muted}`}>Link for your crew</label>
          <input id={fieldId} ref={fieldRef} readOnly value={url} onFocus={(event) => event.target.select()}
            className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${look.field} ${lookName === 'dark' ? 'focus:ring-teal-400' : lookName === 'light' ? 'focus:ring-teal-600' : 'focus:ring-green-700'}`} />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button look={look} primary onClick={() => copy(url)}>Copy link</Button>
            <a href={url} target="_blank" rel="noopener noreferrer"
              className={`inline-flex items-center px-4 py-2 min-h-[44px] rounded-xl text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${look.button} ${look.ring}`}>Open</a>
            <Button look={look} busy={busy} onClick={() => setAsking('off')}>Switch off</Button>
            <Button look={look} busy={busy} onClick={() => setAsking('reissue')}>Issue a new link</Button>
          </div>
          <p className={`mt-3 text-xs ${look.muted}`}>{SEND_TEXT}</p>

          {asking && (
            <div role="group" aria-labelledby={questionId} className={`mt-3 rounded-xl border p-3 ${look.well}`}>
              <p id={questionId} className={`text-sm font-semibold ${look.strong}`}>{asking === 'off' ? OFF_QUESTION : NEW_QUESTION}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button look={look} primary busy={busy} describedBy={questionId}
                  onClick={() => change(asking === 'off' ? 'off' : 'reissue', asking === 'off' ? 'Link switched off.' : 'New link issued. Send it to your crew.')}>
                  {asking === 'off' ? 'Switch off' : 'Issue a new link'}
                </Button>
                <Button look={look} buttonRef={keepRef} onClick={() => setAsking(null)}>{asking === 'off' ? 'Keep it on' : 'Keep this link'}</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {ready && view.link && view.open && (
        <p className={`mt-3 text-xs ${look.muted}`}>{view.window.open ? 'Check-in is open.' : `Check-in opens at ${view.window.opensLabel || 'a time not yet set'}.`}</p>
      )}

      {ready && view.link && (
        <div className="mt-3">
          {view.crew.length === 0 ? (
            <p className={`text-sm ${look.muted}`}>No cleaners are assigned to this job.</p>
          ) : (
            <ul className={`divide-y ${look.divider}`}>
              {view.crew.map((member) => (
                <li key={member.id} className="py-2">
                  <p className={`text-sm font-semibold break-words ${look.strong}`}>{member.name}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <NumberChip state={member.numberState} />
                    <span className={`text-xs ${member.checkedIn ? look.ok : look.muted}`}>
                      {member.checkedIn ? `Checked in${clockOf(member.checkedInAt) ? ` ${clockOf(member.checkedInAt)}` : ''}` : 'Not checked in'}
                    </span>
                  </p>
                  {kind === 'provider' && member.numberState === 'unchecked' && (
                    <p className="mt-1 text-xs">
                      <Link href="/provider/crew" className={`font-semibold underline rounded ${look.anchor}`}>Check this number in My Crew</Link>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {ready && view.checkins && view.link && (
        <div className="mt-4">
          <h3 className={`text-xs font-bold uppercase tracking-wide ${look.muted}`}>Check-ins</h3>
          {view.checkins.length === 0 ? <p className={`mt-1 text-sm ${look.muted}`}>{NO_CHECKINS_TEXT}</p> : (
            <ul className={`mt-1 divide-y ${look.divider}`}>
              {view.checkins.map((tick) => (
                <li key={tick.id} className="py-2 text-sm">
                  <span className={`font-semibold ${look.strong}`}>{tick.name}</span>
                  <span className={look.muted}>{stampOf(tick.at) ? `, ${stampOf(tick.at)}` : ''}{tick.by ? `, by ${tick.by}` : ''}</span>
                  <span className={`block text-xs font-medium ${tick.away === true ? look.warn : look.muted}`}>
                    {tick.away === true
                      ? `Not at the address — ${distanceOf(tick.distance) || 'some distance'} away`
                      : tick.away === false ? 'At the address' : 'No position to compare'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {ready && view.events && view.link && (
        <div className="mt-4">
          <h3 className={`text-xs font-bold uppercase tracking-wide ${look.muted}`}>Recent activity</h3>
          {view.events.length === 0 ? <p className={`mt-1 text-sm ${look.muted}`}>{NO_EVENTS_TEXT}</p> : (
            <ul className={`mt-1 divide-y ${look.divider}`}>
              {view.events.map((event) => (
                <li key={event.id} className="py-1.5 text-sm">
                  <span className={look.strong}>{sayEvent(event)}</span>
                  {stampOf(event.at) && <span className={`block text-xs ${look.muted}`}>{stampOf(event.at)}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p role="status" className={note?.kind === 'ok' ? `mt-3 text-sm font-medium ${look.ok}` : 'sr-only'}>{note?.kind === 'ok' ? note.text : ''}</p>
      {note?.kind === 'error' && <p role="alert" className={`mt-3 text-sm font-medium ${look.bad}`}>{note.text}</p>}
    </section>
  );
}
