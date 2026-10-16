// The "Crew on this job" panel of a provider's job page (ENG-014): the cleaners the provider has put on the job and, while the job's crew can be
// changed, a checkbox for each cleaner on their crew list to choose who goes. A save sends the whole set, and the panel takes the crew the route answers with
// as its state, so what is shown is what is stored. For a job the provider does not hold, the route answers 404 and the panel renders nothing. Nobody is
// texted when a crew is saved. Each cleaner on the list shows whether their number has been checked (ENG-015), because a job link texts a sign-in code
// only to a checked number; the check itself is done on the My Crew page.
'use client';

import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { formatPhone } from '@/lib/phone';
import { NumberChip, useNumberStates } from './CrewNumberCheck';

const CREW_PATH = '/api/provider/crew';
const SEND_TIMEOUT_MS = 20_000;

const LOADING_TEXT = 'Loading the crew...';
const LOAD_FAILED_TEXT = "Couldn't load the crew for this job.";
const OFFLINE_TEXT = "Couldn't reach the server. Check your connection and try again.";
const SAVE_FAILED_TEXT = "Couldn't save the crew. Try again.";
const SAVED_TEXT = 'Crew saved.';
const FINISHED_TEXT = 'This job is finished, so its crew can no longer change.';
const NO_CREW_TEXT = 'You have no cleaners listed yet.';
const NOBODY_TEXT = 'No cleaners were put on this job.';
const REMOVED_TEXT = '(no longer on your crew)';

const isObject = (value) => value !== null && typeof value === 'object';
const textOf = (value) => (typeof value === 'string' ? value : '');

// A member of an answer, or null when it is not the shape the route promises, so one odd answer cannot crash the panel.
function memberOf(value) {
  if (!isObject(value) || !Number.isInteger(value.id)) return null;
  return { id: value.id, name: textOf(value.name), phone: textOf(value.phone), removed: value.removed === true };
}

// A list of members, or null when the answer is not a list of them.
function membersOf(value) {
  if (!Array.isArray(value)) return null;
  const members = value.map(memberOf);
  return members.includes(null) ? null : members;
}

// One call to a route -> { status, body }: the HTTP status and the parsed JSON ({} when there is none), or status 0 when the call did not complete.
async function callApi(path, options = {}) {
  try {
    const res = await fetch(path, { cache: 'no-store', ...options });
    const body = await res.json().catch(() => null);
    return { status: res.status, body: isObject(body) ? body : {} };
  } catch {
    return { status: 0, body: {} };
  }
}

// The members that are on the crew list, as the ids the checkboxes hold. An assigned member who has left the list has no checkbox, and a save
// without them is what the route accepts.
function pickedIds(assigned, crew) {
  const listed = new Set(crew.map((member) => member.id));
  return new Set(assigned.filter((member) => listed.has(member.id)).map((member) => member.id));
}

const sameIds = (a, b) => a.size === b.size && [...a].every((id) => b.has(id));

// The job's crew, and for a job whose crew can be changed the provider's crew list too. Returns { status: 'absent' } for a job that is not theirs,
// { status: 'failed', offline } for anything else that is not an answer, and { status: 'ready', editable, assigned, crew } otherwise.
async function readPanel(jobPath, signal) {
  const own = await callApi(jobPath, { signal });
  if (own.status === 404) return { status: 'absent' };
  const data = own.body.data;
  const assigned = isObject(data) ? membersOf(data.crew) : null;
  if (own.status !== 200 || own.body.success !== true || !assigned) return { status: 'failed', offline: own.status === 0 };
  if (data.editable !== true) return { status: 'ready', editable: false, assigned, crew: [] };

  const list = await callApi(CREW_PATH, { signal });
  const crew = list.status === 200 && list.body.success === true && isObject(list.body.data) ? membersOf(list.body.data.crew) : null;
  if (!crew) return { status: 'failed', offline: list.status === 0 };
  return { status: 'ready', editable: true, assigned, crew };
}

const RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2';
// A button that is busy or has nothing to do is marked aria-disabled, not disabled, so keyboard focus stays on it while it is.
const BUTTON = `px-4 py-2 min-h-[44px] rounded-xl text-sm font-semibold transition-colors aria-disabled:opacity-50 aria-disabled:cursor-not-allowed ${RING}`;

function Readout({ members }) {
  if (members.length === 0) return <p className="mt-3 text-sm text-gray-700">{NOBODY_TEXT}</p>;
  return (
    <ul className="mt-3 divide-y divide-gray-100">
      {members.map((member) => (
        <li key={member.id} className="py-2">
          <p className="text-sm font-semibold text-gray-900 break-words">
            {member.name}
            {member.removed && <span className="ml-2 font-normal text-gray-600">{REMOVED_TEXT}</span>}
          </p>
          <p className="text-xs text-gray-600">{formatPhone(member.phone)}</p>
        </li>
      ))}
    </ul>
  );
}

export default function JobCrewPanel({ bookingId }) {
  const headingId = useId();
  const jobPath = `/api/provider/jobs/${encodeURIComponent(bookingId)}/crew`;
  const [view, setView] = useState({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(null);
  const numbers = useNumberStates();

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    readPanel(jobPath, controller.signal).then((next) => {
      if (!current) return;
      setView(next);
      if (next.status === 'ready' && next.editable) setPicked(pickedIds(next.assigned, next.crew));
    });
    return () => { current = false; controller.abort(); };
  }, [jobPath, attempt]);

  // Retry from a panel that failed to load shows the loading line again; a re-read after a refused save keeps the checkboxes up while it runs.
  const retry = () => {
    setView({ status: 'loading' });
    setAttempt((count) => count + 1);
  };
  const reread = () => setAttempt((count) => count + 1);

  if (view.status === 'absent') return null;

  const editable = view.status === 'ready' && view.editable;
  const savedIds = editable ? pickedIds(view.assigned, view.crew) : new Set();
  const differs = editable && !sameIds(picked, savedIds);

  const toggle = (id) => {
    setNote(null);
    setPicked((held) => {
      const next = new Set(held);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async (event) => {
    event.preventDefault();
    if (saving || !differs) return;
    setSaving(true);
    setNote(null);
    const result = await callApi(jobPath, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ crew_ids: [...picked] }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    setSaving(false);

    const saved = result.status === 200 && result.body.success === true && isObject(result.body.data) ? membersOf(result.body.data.crew) : null;
    if (saved) {
      setView((held) => (held.status === 'ready' ? { ...held, assigned: saved } : held));
      setPicked(pickedIds(saved, view.crew));
      setNote({ kind: 'ok', text: SAVED_TEXT });
      return;
    }
    if (result.status === 0) return setNote({ kind: 'error', text: OFFLINE_TEXT });
    // A 4xx is written to be shown as it stands. A refusal that says the lists have moved on (the job finished, a cleaner was removed in another
    // tab, a save lost a race) is followed by a fresh read, so the checkboxes match what is stored.
    const own = result.status >= 400 && result.status < 500 ? textOf(result.body.message).trim() : '';
    setNote({ kind: 'error', text: own || SAVE_FAILED_TEXT });
    if (result.status === 400 || result.status === 409) reread();
  };

  return (
    <section aria-labelledby={headingId} className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
      <h2 id={headingId} className="font-bold text-gray-900 text-sm">Crew on this job</h2>

      {view.status === 'loading' && <p role="status" className="mt-3 text-sm text-gray-600">{LOADING_TEXT}</p>}

      {view.status === 'failed' && (
        <div role="alert" className="mt-3">
          <p className="text-sm font-medium text-red-800">{view.offline ? OFFLINE_TEXT : LOAD_FAILED_TEXT}</p>
          <button type="button" onClick={retry} className={`${BUTTON} mt-3 bg-green-700 hover:bg-green-800 text-white`}>Retry</button>
        </div>
      )}

      {view.status === 'ready' && !view.editable && (
        <>
          <p className="mt-2 text-xs text-gray-600">{FINISHED_TEXT}</p>
          <Readout members={view.assigned} />
        </>
      )}

      {editable && view.crew.length === 0 && (
        <div className="mt-3">
          <p className="text-sm text-gray-700">{NO_CREW_TEXT}</p>
          <Link href="/provider/crew" className={`mt-2 inline-block text-sm font-semibold text-green-700 underline rounded ${RING}`}>Add cleaners in My Crew</Link>
        </div>
      )}

      {editable && view.crew.length > 0 && (
        <form onSubmit={save} className="mt-3 space-y-3">
          <fieldset className="space-y-2">
            <legend className="sr-only">Choose the cleaners for this job</legend>
            {view.crew.map((member) => (
              <label key={member.id} className="flex items-start gap-3 rounded-xl border border-gray-200 px-3 py-2.5 min-h-[44px] cursor-pointer">
                <input type="checkbox" checked={picked.has(member.id)} onChange={() => { if (!saving) toggle(member.id); }}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-green-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-gray-900 break-words">{member.name}</span>
                  <span className="block text-xs text-gray-600">{formatPhone(member.phone)}</span>
                  {numbers.states.has(member.id) && <span className="mt-1 block"><NumberChip state={numbers.states.get(member.id)} /></span>}
                </span>
              </label>
            ))}
          </fieldset>
          {view.crew.some((member) => numbers.states.get(member.id) === 'unchecked') && (
            <p className="text-xs text-gray-700">
              A job link texts a code only to a checked number.{' '}
              <Link href="/provider/crew" className={`font-semibold text-green-800 underline rounded ${RING}`}>Check numbers in My Crew</Link>
            </p>
          )}
          <button type="submit" aria-disabled={saving || !differs || undefined} className={`${BUTTON} bg-green-700 hover:bg-green-800 text-white`}>
            {saving ? 'Saving...' : 'Save crew'}
          </button>
        </form>
      )}

      <p role="status" className={note?.kind === 'ok' ? 'mt-3 text-sm font-medium text-green-800' : 'sr-only'}>{note?.kind === 'ok' ? note.text : ''}</p>
      {note?.kind === 'error' && <p role="alert" className="mt-3 text-sm font-medium text-red-700">{note.text}</p>}
    </section>
  );
}
