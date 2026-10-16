// "My crew" (ENG-014): the provider's list of cleaners, a name and a mobile number each, with add, correct and remove. A number is stored and sent as
// E.164 by src/lib/phone.js; this page shows it the way a person reads it (formatPhone) and checks what is typed with the same normalisePhone the
// route uses, so a number the route would refuse is refused beside its field without a request. The route stays the authority: whatever it refuses
// is shown in its own words. A job link texts a sign-in code only to a number its owner has proved is theirs (ENG-015), so each cleaner shows the state of
// their number and a number that has not been checked can be checked from here. Nobody is texted when a cleaner is added, corrected or put on a job.
'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { formatPhone, normalisePhone, PHONE_HINT } from '@/lib/phone';
import { CheckNumber, NumberChip, useNumberStates } from '@/components/provider/CrewNumberCheck';

const CREW_PATH = '/api/provider/crew';
const DEFAULT_LIMIT = 30;
const SEND_TIMEOUT_MS = 20_000;

const NAME_MISSING_TEXT = "Enter the cleaner's name.";
const LOAD_FAILED_TEXT = "Couldn't load your crew. Try again.";
const OFFLINE_TEXT = "Couldn't reach the server. Check your connection and try again.";
const SAVE_FAILED_TEXT = "Couldn't save that. Try again.";
const SESSION_TEXT = 'Your session has ended. Sign in again to use your crew.';

const isObject = (value) => value !== null && typeof value === 'object';
const textOf = (value) => (typeof value === 'string' ? value : '');

// A member of an answer, or null when it is not the shape the route promises, so one odd answer cannot crash the page.
function memberOf(value) {
  if (!isObject(value) || !Number.isInteger(value.id)) return null;
  return { id: value.id, name: textOf(value.name), phone: textOf(value.phone) };
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id - b.id;

// One call to a crew route -> { status, body }: the HTTP status and the parsed JSON ({} when there is none), or status 0 when the call did not complete.
async function callApi(path, options = {}) {
  try {
    const res = await fetch(path, { cache: 'no-store', ...options });
    const body = await res.json().catch(() => null);
    return { status: res.status, body: isObject(body) ? body : {} };
  } catch {
    return { status: 0, body: {} };
  }
}

const sendJson = (method, path, data) =>
  callApi(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });

// What to tell the person about an answer that is not the success they asked for: the message of a refusal (a 4xx is written to be shown as it
// stands), else a sentence for what went wrong. A server fault's own message is for the log, not for them.
function refusalText(result) {
  if (result.status === 0) return OFFLINE_TEXT;
  if (result.status === 401 || result.status === 403) return SESSION_TEXT;
  const own = result.status >= 400 && result.status < 500 ? textOf(result.body.message).trim() : '';
  return own || SAVE_FAILED_TEXT;
}

// A refusal comes as a message and no field name, so the field it is about is read from its words: the name rule talks about the name and the number
// rules about the number or its country code. A message about neither (the crew is full, a save raced another) belongs to the form.
function fieldOf(message) {
  if (/\bname\b/i.test(message)) return 'name';
  if (/\b(number|country code)\b/i.test(message)) return 'phone';
  return null;
}

// The crew as the route lists it: { status: 'ready', crew, limit }, { status: 'ended' } for a session that is gone, and { status: 'failed', offline }
// for everything else, including a call that does not complete.
async function readCrew(signal) {
  const result = await callApi(CREW_PATH, { signal });
  if (result.status === 401 || result.status === 403) return { status: 'ended' };
  const data = result.body.data;
  if (result.status !== 200 || result.body.success !== true || !isObject(data) || !Array.isArray(data.crew)) {
    return { status: 'failed', offline: result.status === 0 };
  }
  const crew = data.crew.map(memberOf);
  if (crew.includes(null)) return { status: 'failed', offline: false };
  const limit = Number.isInteger(data.limit) && data.limit > 0 ? data.limit : DEFAULT_LIMIT;
  return { status: 'ready', crew, limit };
}

const RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2';
// A button that is busy or has nothing to do is marked aria-disabled, not disabled, so keyboard focus stays on it while it is.
const BUTTON = `px-4 py-2 min-h-[44px] rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:cursor-not-allowed ${RING}`;
const PRIMARY = `${BUTTON} bg-green-700 hover:bg-green-800 text-white`;
const OUTLINE = `${BUTTON} border border-gray-500 text-gray-700 hover:bg-gray-50`;
const DANGER = `${BUTTON} border border-red-700 text-red-700 hover:bg-red-50`;
const NOTICE = 'rounded-xl border px-4 py-3 text-sm font-medium';
const INPUT = 'w-full rounded-xl border px-3 py-2.5 text-base text-gray-900 disabled:bg-gray-100 disabled:text-gray-500 focus:outline-none focus:ring-2 focus:ring-green-700';

function Field({ label, hint, error, inputRef, ...input }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-gray-800 mb-1">{label}</label>
      <input
        id={id}
        ref={inputRef}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
        className={`${INPUT} ${error ? 'border-red-700' : 'border-gray-500'}`}
        {...input}
      />
      {hint && <p id={hintId} className="mt-1 text-xs text-gray-600">{hint}</p>}
      {error && <p id={errorId} className="mt-1 text-sm font-medium text-red-700">{error}</p>}
    </div>
  );
}

// Checks what is typed the way the route will, in the order of the form. Returns { name, phone } messages, an empty object when both are fine.
function problemsWith(name, phone, only = {}) {
  const found = {};
  if (only.name !== false && !name.trim()) found.name = NAME_MISSING_TEXT;
  if (only.phone !== false) {
    const checked = normalisePhone(phone);
    if (!checked.ok) found.phone = checked.message;
  }
  return found;
}

function AddForm({ full, limit, onStart, onAdded }) {
  const headingId = useId();
  const fullId = useId();
  const nameRef = useRef(null);
  const phoneRef = useRef(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [problems, setProblems] = useState({});
  const [formError, setFormError] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (sending || full) return;
    setFormError('');
    const found = problemsWith(name, phone);
    setProblems(found);
    if (found.name) return nameRef.current?.focus();
    if (found.phone) return phoneRef.current?.focus();

    onStart();
    setSending(true);
    const result = await sendJson('POST', CREW_PATH, { name, phone });
    setSending(false);
    const member = result.status === 201 && result.body.success === true ? memberOf(result.body.data?.member) : null;
    if (member) {
      setName('');
      setPhone('');
      setProblems({});
      onAdded(member, result.body.data.revived === true);
      nameRef.current?.focus();
      return;
    }
    const message = refusalText(result);
    const field = result.status === 0 ? null : fieldOf(message);
    if (field) {
      setProblems({ [field]: message });
      (field === 'name' ? nameRef : phoneRef).current?.focus();
    } else {
      setFormError(message);
    }
  };

  return (
    <form aria-labelledby={headingId} onSubmit={submit} noValidate className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-4">
      <h2 id={headingId} className="font-bold text-gray-900">Add a cleaner</h2>
      <Field label="Name" name="name" type="text" autoComplete="off" value={name} inputRef={nameRef} disabled={full} readOnly={sending}
        onChange={(event) => setName(event.target.value)} error={problems.name} />
      <Field label="Mobile number" name="phone" type="tel" inputMode="tel" autoComplete="off" value={phone} inputRef={phoneRef} disabled={full} readOnly={sending}
        onChange={(event) => setPhone(event.target.value)} hint={PHONE_HINT} error={problems.phone} />
      {full && <p id={fullId} className="text-sm font-medium text-gray-800">Your crew is full ({limit}). Remove someone to add another.</p>}
      {formError && <p role="alert" className="text-sm font-medium text-red-700">{formError}</p>}
      <button type="submit" disabled={full} aria-disabled={sending || undefined} aria-describedby={full ? fullId : undefined} className={PRIMARY}>
        {sending ? 'Adding...' : 'Add cleaner'}
      </button>
    </form>
  );
}

function EditForm({ member, onSaved, onCancel, onGone }) {
  const [name, setName] = useState(member.name);
  const [phone, setPhone] = useState(formatPhone(member.phone));
  const [problems, setProblems] = useState({});
  const [formError, setFormError] = useState('');
  const [sending, setSending] = useState(false);
  const nameRef = useRef(null);
  const phoneRef = useRef(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  const nameChanged = name.trim() !== member.name;
  const phoneChanged = phone.trim() !== formatPhone(member.phone);

  const submit = async (event) => {
    event.preventDefault();
    if (sending || (!nameChanged && !phoneChanged)) return;
    setFormError('');
    const found = problemsWith(name, phone, { name: nameChanged, phone: phoneChanged });
    setProblems(found);
    if (found.name) return nameRef.current?.focus();
    if (found.phone) return phoneRef.current?.focus();

    // Only what changed goes: a number sent again unchanged would be read again for nothing.
    const changes = {};
    if (nameChanged) changes.name = name;
    if (phoneChanged) changes.phone = phone;
    setSending(true);
    const result = await sendJson('PATCH', `${CREW_PATH}/${member.id}`, changes);
    setSending(false);
    const saved = result.status === 200 && result.body.success === true ? memberOf(result.body.data?.member) : null;
    if (saved) return onSaved(saved);
    if (result.status === 404) return onGone(refusalText(result));
    const message = refusalText(result);
    const field = result.status === 0 ? null : fieldOf(message);
    if (field) {
      setProblems({ [field]: message });
      (field === 'name' ? nameRef : phoneRef).current?.focus();
    } else {
      setFormError(message);
    }
  };

  return (
    <form aria-label={`Edit ${member.name}`} onSubmit={submit} noValidate className="space-y-3">
      <Field label="Name" name="name" type="text" autoComplete="off" value={name} inputRef={nameRef} readOnly={sending}
        onChange={(event) => setName(event.target.value)} error={problems.name} />
      <Field label="Mobile number" name="phone" type="tel" inputMode="tel" autoComplete="off" value={phone} inputRef={phoneRef} readOnly={sending}
        onChange={(event) => setPhone(event.target.value)} hint={PHONE_HINT} error={problems.phone} />
      {formError && <p role="alert" className="text-sm font-medium text-red-700">{formError}</p>}
      <div className="flex gap-2">
        <button type="submit" aria-disabled={sending || (!nameChanged && !phoneChanged) || undefined} className={PRIMARY}>{sending ? 'Saving...' : 'Save'}</button>
        <button type="button" onClick={() => { if (!sending) onCancel(); }} aria-disabled={sending || undefined} className={OUTLINE}>Cancel</button>
      </div>
    </form>
  );
}

function RemoveQuestion({ member, busy, onConfirm, onKeep }) {
  const questionId = useId();
  const keepRef = useRef(null);
  useEffect(() => { keepRef.current?.focus(); }, []);
  return (
    <div role="group" aria-labelledby={questionId} className="mt-3 rounded-xl bg-red-50 border border-red-200 p-3">
      <p id={questionId} className="text-sm text-gray-900">Remove {member.name} from your crew? They are taken off any job that is not finished.</p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => { if (!busy) onConfirm(); }} aria-disabled={busy || undefined} className={DANGER}>{busy ? 'Removing...' : 'Yes, remove'}</button>
        <button type="button" ref={keepRef} onClick={() => { if (!busy) onKeep(); }} aria-disabled={busy || undefined} className={OUTLINE}>Keep</button>
      </div>
    </div>
  );
}

export default function ProviderCrewPage() {
  const [view, setView] = useState({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [removingId, setRemovingId] = useState(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [refocusEdit, setRefocusEdit] = useState(null);
  const headingRef = useRef(null);
  const listHeadingId = useId();
  const numbers = useNumberStates();

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    readCrew(controller.signal).then((next) => { if (current) setView(next); });
    return () => { current = false; controller.abort(); };
  }, [attempt]);

  // After an editor closes, focus goes back to the Edit button of its row.
  useEffect(() => {
    if (refocusEdit === null) return;
    document.getElementById(`edit-${refocusEdit}`)?.focus();
    setRefocusEdit(null);
  }, [refocusEdit]);

  const reload = () => {
    setView({ status: 'loading' });
    setAttempt((count) => count + 1);
  };

  const crew = view.status === 'ready' ? view.crew : [];
  const limit = view.status === 'ready' ? view.limit : DEFAULT_LIMIT;
  const withMembers = (change) => setView((held) => (held.status === 'ready' ? { ...held, crew: change(held.crew).sort(byName) } : held));
  const describe = (member) => `${member.name}, ${formatPhone(member.phone)}`;

  const added = (member, revived) => {
    withMembers((held) => [...held, member]);
    numbers.reload();
    setNotice({ kind: 'ok', text: `Added ${describe(member)}.${revived ? ' This number was on your crew before.' : ''}` });
  };

  const saved = (member) => {
    withMembers((held) => held.map((entry) => (entry.id === member.id ? member : entry)));
    numbers.reload();
    setNotice({ kind: 'ok', text: `Saved ${describe(member)}.` });
    setEditingId(null);
    setRefocusEdit(member.id);
  };

  // The entry is gone from the route's side (removed in another tab): say so and read the list again.
  const gone = (message) => {
    setEditingId(null);
    setRemovingId(null);
    setNotice({ kind: 'error', text: message });
    reload();
  };

  // The code was right: the number is checked, so the chip is read again, and focus goes to the row's Edit button because the control it was on is gone.
  const checked = (member) => {
    numbers.reload();
    setNotice({ kind: 'ok', text: `Checked ${describe(member)}.` });
    setRefocusEdit(member.id);
  };

  const remove = async (member) => {
    if (removeBusy) return;
    setRemoveBusy(true);
    const result = await callApi(`${CREW_PATH}/${member.id}`, { method: 'DELETE', signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
    setRemoveBusy(false);
    if (result.status === 200 && result.body.success === true) {
      const taken = Number(result.body.data?.taken_off_jobs) || 0;
      withMembers((held) => held.filter((entry) => entry.id !== member.id));
      setRemovingId(null);
      setNotice({ kind: 'ok', text: `${member.name} is no longer on your crew.${taken > 0 ? ` Taken off ${taken} ${taken === 1 ? 'job' : 'jobs'}.` : ''}` });
      headingRef.current?.focus();
    } else if (result.status === 404) {
      gone(refusalText(result));
    } else {
      setNotice({ kind: 'error', text: refusalText(result) });
    }
  };

  const full = view.status === 'ready' && crew.length >= limit;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold text-gray-900 focus:outline-none">My crew</h1>
        <p className="mt-1 text-sm text-gray-600">The cleaners you send to jobs, with a mobile number for each.</p>
      </div>

      {/* The success line lives in a status region that is always on the page, so a screen reader announces the text when it appears. */}
      <p role="status" className={notice?.kind === 'ok' ? `${NOTICE} bg-green-50 border-green-200 text-green-900` : 'sr-only'}>{notice?.kind === 'ok' ? notice.text : ''}</p>
      {notice?.kind === 'error' && <p role="alert" className={`${NOTICE} bg-red-50 border-red-200 text-red-800`}>{notice.text}</p>}

      {view.status === 'loading' && (
        <div role="status" className="flex items-center gap-3 py-8 justify-center">
          <div aria-hidden="true" className="w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
          <span className="text-sm text-gray-600">Loading your crew...</span>
        </div>
      )}

      {view.status === 'ended' && (
        <div role="alert" className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-800">
          {SESSION_TEXT} <a href="/provider/login" className="font-semibold text-green-700 underline">Sign in</a>
        </div>
      )}

      {view.status === 'failed' && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-white p-5">
          <p className="text-sm font-medium text-red-800">{view.offline ? OFFLINE_TEXT : LOAD_FAILED_TEXT}</p>
          <button type="button" onClick={reload} className={`${PRIMARY} mt-3`}>Retry</button>
        </div>
      )}

      {view.status === 'ready' && (
        <>
          <section aria-labelledby={listHeadingId} className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id={listHeadingId} className="font-bold text-gray-900">Your cleaners</h2>
              <p className="text-sm text-gray-600">{crew.length} of {limit}</p>
            </div>
            {numbers.status === 'failed' && (
              <p role="status" className="mt-3 text-sm text-gray-700">
                Couldn&apos;t load which numbers are checked.{' '}
                <button type="button" onClick={numbers.reload} className={`font-semibold text-green-800 underline rounded ${RING}`}>Try again</button>
              </p>
            )}
            {crew.length === 0 ? (
              <p className="mt-3 text-sm text-gray-700">No cleaners yet. Add the people you send to jobs.</p>
            ) : (
              <ul className="mt-2 divide-y divide-gray-100">
                {crew.map((member) => (
                  <li key={member.id} className="py-3">
                    {editingId === member.id ? (
                      <EditForm member={member} onSaved={saved} onCancel={() => { setEditingId(null); setRefocusEdit(member.id); }} onGone={gone} />
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-900 break-words">{member.name}</p>
                          <p className="text-sm text-gray-600">{formatPhone(member.phone)}</p>
                          {numbers.states.has(member.id) && <p className="mt-1"><NumberChip state={numbers.states.get(member.id)} /></p>}
                        </div>
                        <div className="flex gap-2">
                          <button type="button" id={`edit-${member.id}`} aria-label={`Edit ${member.name}`} className={OUTLINE}
                            onClick={() => { setNotice(null); setRemovingId(null); setEditingId(member.id); }}>Edit</button>
                          <button type="button" aria-label={`Remove ${member.name}`} className={OUTLINE}
                            onClick={() => { setNotice(null); setEditingId(null); setRemovingId(member.id); }}>Remove</button>
                        </div>
                      </div>
                    )}
                    {editingId !== member.id && numbers.states.get(member.id) === 'cannot_text' && (
                      <p className="mt-2 text-xs text-gray-700">
                        We can&apos;t text this number, so it can&apos;t be checked. You can check {member.name} in yourself from the job link. If the number is wrong, use Edit.
                      </p>
                    )}
                    {editingId !== member.id && numbers.states.get(member.id) === 'unchecked' && (
                      <CheckNumber member={member} onChecked={checked} onGone={gone} />
                    )}
                    {removingId === member.id && (
                      <RemoveQuestion member={member} busy={removeBusy} onConfirm={() => remove(member)} onKeep={() => setRemovingId(null)} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <AddForm full={full} limit={limit} onStart={() => setNotice(null)} onAdded={added} />
        </>
      )}
    </div>
  );
}
