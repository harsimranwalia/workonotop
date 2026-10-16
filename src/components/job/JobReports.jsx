'use client';

// The Reports card of the job link (ENG-017): the five reports a person on site can send to the office, each with a note and a photo, and the reports already
// sent for this job. A tap on one of the five opens the form for it under the buttons. The picture is shrunk on the phone first (shrinkPhoto) and kept in
// memory until the server has the report, and every try at sending carries the same client_token until the report changes, so a send that did not complete
// can be made again without taking the photo again and without a second report when the first one did get there. The phone's position goes with the report
// when the phone has it and never holds the send back. What the buttons may do is what the server says (report_can); the line under them says why they are off.

import { useEffect, useId, useRef, useState } from 'react';
import {
  CARD, CARD_HEADING, OFFLINE_TEXT, OPTIONAL_POSITION_WAIT_MS, OUTLINE, PRIMARY, REPORTS_MAX_PER_BOOKING, REPORT_CHOICES, REPORT_NOTE_MAX, RING,
  currentPosition, dataOf, messageOf, newToken, postForm, reportsOf, shrinkPhoto, stampOf, textOf,
} from './jobLinkKit';

const INTRO_TEXT = 'Something wrong on site? Tell the office. Every report needs a note and a photo.';
const NOT_HERE_TEXT = 'Check in first, then send a report.';
const NOT_UNDER_WAY_TEXT = 'This job is not under way, so a report can not be sent.';
const FULL_TEXT = 'This job has all the reports it can hold.';
const UNREADABLE_TEXT = 'The reports can not be shown right now.';
const NONE_YET_TEXT = 'Nothing has been reported on this job. If something is wrong, choose a report above.';
const NOT_A_PHOTO_TEXT = 'That file is not a photo we can use. Take it again.';
const SEND_FAILED_TEXT = "Couldn't send that report. Try again.";
const SENT_TEXT = 'Report sent. The office has it.';
const LOCATION_ON_TEXT = 'Your location is sent with this report.';
const LOCATION_OFF_TEXT = 'Your location is off, so this report will not say where you were.';

const TYPE_BUTTON = `w-full px-4 py-3 min-h-[48px] rounded-xl border text-left text-base font-semibold transition-colors aria-disabled:opacity-50 aria-disabled:cursor-not-allowed ${RING}`;
const TYPE_CHOSEN = 'border-2 border-green-700 bg-green-50 text-green-900';
const TYPE_PLAIN = 'border-gray-500 text-gray-800 hover:bg-gray-50';
const NOTE_FIELD = 'mt-1 w-full rounded-xl border border-gray-500 px-3 py-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-700 read-only:bg-gray-50';

// Why the buttons are off, in the order the server judges: the limit, then the cleaner who is not here. A page that is not under way is the third reason, and it
// is the one a provider or an admin meets, since they are never "not here".
function reasonOf(view) {
  if (view.reports && view.reports.length >= REPORTS_MAX_PER_BOOKING) return FULL_TEXT;
  return view.access === 'cleaner' ? NOT_HERE_TEXT : NOT_UNDER_WAY_TEXT;
}

function Sent({ report }) {
  const firstLine = report.note.split('\n')[0].trim();
  return (
    <li className="rounded-xl border border-gray-200 px-3 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 text-base font-semibold text-gray-900">{report.label}</p>
        <p className="shrink-0 text-sm text-gray-700">{report.seen ? 'Seen by the office' : 'Sent'}</p>
      </div>
      <p className="text-sm text-gray-700">{[stampOf(report.at), report.by].filter(Boolean).join(' · ')}</p>
      {firstLine && <p className="mt-1 text-sm text-gray-900 break-words">{firstLine}</p>}
    </li>
  );
}

// `view` is the page's read (reports, reportCan, access). `onReports(reports)` puts the server's list on the page at once, `onChanged` asks the page to read
// the link again (the buttons follow the reports and the check-in), `onOut` and `onInvalid` send the page back to the step the server's answer calls for,
// and `onSay(text)` is the polite line that tells a screen reader what happened.
export default function JobReports({ base, view, onReports, onChanged, onOut, onInvalid, onSay }) {
  const headingId = useId();
  const reasonId = useId();
  const formId = useId();
  const formHeadingId = useId();
  const noteId = useId();
  const countId = useId();
  const missingId = useId();
  const typeButtons = useRef({});
  const noteField = useRef(null);
  const fileField = useRef(null);
  const photoHeld = useRef(null);
  const token = useRef(null);
  const live = useRef(true);
  const [choice, setChoice] = useState(null);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState(null);
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState(null);
  const [sentLine, setSentLine] = useState('');
  const [locationOff, setLocationOff] = useState(false);
  const formOpen = choice !== null;

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (photoHeld.current) URL.revokeObjectURL(photoHeld.current.url);
    };
  }, []);

  // The first field of a form that has just opened, or been switched to another report, takes the focus.
  useEffect(() => {
    if (choice) noteField.current?.focus();
  }, [choice]);

  // Whether the browser has been told to refuse the phone's position, so that the line under the send button can say so before the send. A browser that can
  // not say is taken to be asking for it, as it will on the send.
  useEffect(() => {
    if (!formOpen || typeof navigator === 'undefined' || !navigator.permissions?.query) return undefined;
    let status = null;
    let gone = false;
    const sync = () => { if (!gone && status) setLocationOff(status.state === 'denied'); };
    navigator.permissions.query({ name: 'geolocation' }).then(
      (found) => {
        if (gone) return;
        status = found;
        found.addEventListener('change', sync);
        sync();
      },
      () => { if (!gone) setLocationOff(false); }
    );
    return () => {
      gone = true;
      status?.removeEventListener('change', sync);
    };
  }, [formOpen]);

  const { reports, reportCan: allowed } = view;
  const text = note.trim();
  const ready = allowed && text !== '' && photo !== null;
  const busy = sending || checking;
  const missing = text === '' ? (photo === null ? 'Write a note and add a photo to send this.' : 'Write a note to send this.') : photo === null ? 'Add a photo to send this.' : '';
  const chosen = REPORT_CHOICES.find((one) => one.code === choice);

  const dropPhoto = () => {
    if (photoHeld.current) URL.revokeObjectURL(photoHeld.current.url);
    photoHeld.current = null;
    token.current = null;
    setPhoto(null);
  };

  const discard = () => {
    dropPhoto();
    setChoice(null);
    setNote('');
    setProblem(null);
  };

  const choose = (code) => {
    if (!allowed || sending) return;
    if (choice === code) {
      noteField.current?.focus();
      return;
    }
    // Another report is another try: the id of the one before it must not hand back a report of a different kind.
    token.current = null;
    setChoice(code);
    setSentLine('');
    setProblem(null);
  };

  const changeNote = (event) => {
    token.current = null;
    setNote(event.target.value);
    setProblem(null);
  };

  const picked = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busy) return;
    setChecking(true);
    setProblem(null);
    const blob = await shrinkPhoto(file);
    if (!live.current) return;
    setChecking(false);
    if (!blob) {
      setProblem({ text: NOT_A_PHOTO_TEXT, retry: false });
      return;
    }
    if (photoHeld.current) URL.revokeObjectURL(photoHeld.current.url);
    const held = { blob, url: URL.createObjectURL(blob) };
    photoHeld.current = held;
    token.current = null;
    setPhoto(held);
  };

  const send = async () => {
    if (!ready || busy) return;
    setSending(true);
    setProblem(null);
    const place = await currentPosition(OPTIONAL_POSITION_WAIT_MS);
    if (!live.current) return;
    if (!place.ok && place.denied) setLocationOff(true);
    token.current ??= newToken();
    const form = new FormData();
    form.append('type', choice);
    form.append('note', text);
    form.append('photo', photo.blob, 'photo.jpg');
    form.append('client_token', token.current);
    if (place.ok) {
      form.append('latitude', String(place.latitude));
      form.append('longitude', String(place.longitude));
      form.append('accuracy', String(place.accuracy));
    }
    const result = await postForm(`${base}/reports`, form);
    if (!live.current) return;
    setSending(false);

    const data = dataOf(result);
    const list = data ? reportsOf(data.reports) : null;
    if (list) {
      const sentChoice = choice;
      discard();
      setSentLine(SENT_TEXT);
      onReports(list);
      onSay('Report sent');
      onChanged();
      typeButtons.current[sentChoice]?.focus();
      return;
    }
    if (result.status === 401) { onOut(); return; }
    if (result.status === 404) { onInvalid(); return; }
    // A send that did not complete, a server that could not keep the report, or an answer that cannot be read can be sent again with the same id: if the
    // report did get there, the server hands it back and saves nothing twice. A refusal is about the report or the job, so it is shown as it stands.
    if (result.status === 0 || result.status >= 500 || result.status === 200) {
      setProblem({ text: result.status === 0 ? OFFLINE_TEXT : textOf(result.body.message).trim() || SEND_FAILED_TEXT, retry: true });
      return;
    }
    const message = messageOf(result) || SEND_FAILED_TEXT;
    if (result.status === 413 || (result.status === 400 && /photo/i.test(message))) dropPhoto();
    setProblem({ text: message, retry: false });
    if (result.status === 409) onChanged();
  };

  const submit = (event) => {
    event.preventDefault();
    send();
  };

  const escape = (event) => {
    if (event.key === 'Escape' && !busy) {
      event.stopPropagation();
      const sentChoice = choice;
      discard();
      typeButtons.current[sentChoice]?.focus();
    }
  };

  return (
    <section className={CARD} aria-labelledby={headingId}>
      <h2 id={headingId} className={CARD_HEADING}>Reports</h2>
      <p className="mt-2 text-sm text-gray-700">{INTRO_TEXT}</p>

      <div role="group" aria-labelledby={headingId} className="mt-3 grid gap-2">
        {REPORT_CHOICES.map(({ code, label }) => (
          <button key={code} type="button" ref={(node) => { typeButtons.current[code] = node; }} aria-pressed={choice === code} aria-disabled={!allowed || sending || undefined}
            aria-describedby={allowed ? undefined : reasonId} onClick={() => choose(code)} className={`${TYPE_BUTTON} ${choice === code ? TYPE_CHOSEN : TYPE_PLAIN}`}>{label}</button>
        ))}
      </div>
      {!allowed && <p id={reasonId} className="mt-2 text-sm text-gray-700">{reasonOf(view)}</p>}

      {formOpen && (
        <form id={formId} aria-labelledby={formHeadingId} onSubmit={submit} onKeyDown={escape} noValidate className="mt-4 rounded-xl border border-gray-300 p-4">
          <h3 id={formHeadingId} className="text-base font-bold text-gray-900">{chosen.label}</h3>

          <label htmlFor={noteId} className="mt-3 block text-base font-semibold text-gray-900">
            {choice === 'add_items' ? 'What needs to be added, and where?' : 'What did you find?'}
          </label>
          <textarea ref={noteField} id={noteId} rows={4} maxLength={REPORT_NOTE_MAX} value={note} readOnly={sending} aria-describedby={countId} onChange={changeNote} className={NOTE_FIELD} />
          <p id={countId} className="mt-1 text-right text-sm text-gray-700">{[...note].length} / {REPORT_NOTE_MAX}</p>

          <div className="mt-3">
            <p className="text-base font-semibold text-gray-900">Photo</p>
            <input ref={fileField} type="file" accept="image/*" capture="environment" data-report-photo="true" tabIndex={-1} aria-hidden="true" className="sr-only" onChange={picked} />
            {photo && (
              <img src={photo.url} alt="The photo for this report" width="160" height="160" className="mt-2 h-40 w-40 rounded-lg border border-gray-300 object-cover" />
            )}
            <button type="button" aria-disabled={busy || undefined} onClick={() => { if (!busy) fileField.current?.click(); }} className={`${OUTLINE} mt-2`}>
              {photo ? 'Take it again' : 'Take a photo'}
            </button>
            {checking && <p role="status" className="mt-2 text-sm text-gray-700">Getting the photo ready...</p>}
          </div>

          <p className="mt-4 text-sm text-gray-700">{locationOff ? LOCATION_OFF_TEXT : LOCATION_ON_TEXT}</p>

          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button type="submit" aria-disabled={!ready || busy || undefined} aria-busy={sending || undefined} aria-describedby={ready ? undefined : missingId} className={PRIMARY}>
              {sending ? 'Sending…' : 'Send the report'}
            </button>
            <button type="button" aria-disabled={busy || undefined} onClick={() => { if (!busy) { const sentChoice = choice; discard(); typeButtons.current[sentChoice]?.focus(); } }} className={OUTLINE}>Cancel</button>
          </div>
          {!ready && !sending && <p id={missingId} className="mt-2 text-sm text-gray-700">{allowed ? missing : reasonOf(view)}</p>}

          {problem && (
            <div className="mt-2">
              <p role="alert" className="text-sm font-medium text-red-700">{problem.text}</p>
              {problem.retry && <button type="button" onClick={send} aria-disabled={busy || undefined} className={`${OUTLINE} mt-2`}>Try again</button>}
            </div>
          )}
        </form>
      )}

      <p role="status" className={sentLine ? 'mt-3 text-sm font-medium text-green-800' : 'sr-only'}>{sentLine}</p>

      {reports === null ? (
        <div className="mt-5">
          <p className="text-base text-gray-900">{UNREADABLE_TEXT}</p>
          <button type="button" onClick={onChanged} className={`${OUTLINE} mt-3`}>Try again</button>
        </div>
      ) : (
        <div className="mt-5">
          <h3 className="text-base font-semibold text-gray-900">Sent for this job</h3>
          {reports.length === 0 ? (
            <p className="mt-2 text-sm text-gray-700">{NONE_YET_TEXT}</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {reports.map((report) => <Sent key={report.id} report={report} />)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
