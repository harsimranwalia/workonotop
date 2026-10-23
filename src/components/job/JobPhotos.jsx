'use client';

// The Photos card of the job link (ENG-016): the job's before and after photos with who took each and when, and the buttons that add one. A picture is
// shrunk on the phone first (shrinkPhoto) and sent with the phone's position when it has one; the picture stays in memory until the server has it, so a
// send that did not complete can be sent again without taking the photo again. What the buttons may do is what the server says (photo_can); the line
// under a button that is off says why.

import { useEffect, useId, useRef, useState } from 'react';
import {
  CARD, CARD_HEADING, NOTICE, OFFLINE_TEXT, OPTIONAL_POSITION_WAIT_MS, OUTLINE, PHOTOS_MAX_PER_TYPE, RING,
  clockOf, currentPosition, dataOf, messageOf, photosOf, postForm, shrinkPhoto, textOf,
} from './jobLinkKit';

const NO_BEFORE_HINT = 'Take a before photo of the rooms you will clean. The job can not start without one.';
const NOT_HERE_TEXT = 'Check in first, then add a photo.';
const STARTED_TEXT = 'The job has started, so more "before" photos can not be added.';
const NOT_STARTED_TEXT = 'Start the job before adding "after" photos.';
const NOT_READY_TEXT = 'This job is not ready for photos yet.';
const FULL_TEXT = 'This job has all the photos it can hold.';
const UNKNOWN_TEXT = 'Photos can not be added right now.';
const NOT_A_PHOTO_TEXT = 'That file is not a photo we can use. Take it again.';
const SEND_FAILED_TEXT = "Couldn't send that photo. Try again.";
const UNREADABLE_TEXT = 'The photos can not be shown right now.';

const TYPES = [
  { type: 'before', heading: 'Before', add: 'Add a before photo' },
  { type: 'after', heading: 'After', add: 'Add an after photo' },
];

// Why a button is off, in the order the server judges: the limit, the state of the job, then the cleaner who is not here. `full` is whether the type holds all the photos a job may have. `timer` may be
// null (its answer could not be read), in which case only the limit and the cleaner are known.
function reasonOf(type, full, timer) {
  if (full) return FULL_TEXT;
  if (!timer) return UNKNOWN_TEXT;
  const started = timer.state !== 'not_started';
  if (type === 'before' && started) return STARTED_TEXT;
  if (type === 'before' && timer.blocked === 'not_confirmed') return NOT_READY_TEXT;
  if (type === 'after' && !started) return NOT_STARTED_TEXT;
  return NOT_HERE_TEXT;
}

function Thumbnail({ photo, heading }) {
  const time = clockOf(photo.at);
  const caption = [photo.by, time].filter(Boolean).join(' · ');
  const alt = `${heading} photo${photo.by ? ` by ${photo.by}` : ''}${time ? `, ${time}` : ''}`;
  return (
    <li className="w-24 min-w-0">
      <a href={photo.url} target="_blank" rel="noopener noreferrer" className={`block rounded-lg ${RING}`}>
        <img src={photo.url} alt={alt} width="96" height="96" loading="lazy" decoding="async" className="h-24 w-24 rounded-lg border border-gray-300 object-cover" />
      </a>
      {caption && <p className="mt-1 text-xs text-gray-700 break-words">{caption}</p>}
    </li>
  );
}

// `view` is the page's read (photos, photoCan, timer, crew). `onPhotos(photos)` puts the server's list on the page at once, `onChanged` asks the page to read
// the link again (the buttons and the timer's reasons follow the photos), `onOut` and `onInvalid` send the page back to the step the server's answer calls
// for, and `onSay(text)` is the polite line that tells a screen reader what happened.
export default function JobPhotos({ base, view, onPhotos, onChanged, onOut, onInvalid, onSay }) {
  const headingId = useId();
  const groupId = useId();
  const inputs = useRef({ before: null, after: null });
  const held = useRef(null);
  const live = useRef(true);
  const [sending, setSending] = useState(null);
  const [problem, setProblem] = useState(null);

  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  const { photos, photoCan, photoFull, timer } = view;

  // Sends the shrunk picture held in memory.
  const send = async () => {
    const mine = held.current;
    if (!mine || sending) return;
    setSending(mine.type);
    setProblem(null);
    const place = await currentPosition(OPTIONAL_POSITION_WAIT_MS);
    const form = new FormData();
    form.append('type', mine.type);
    form.append('photo', mine.blob, 'photo.jpg');
    if (place.ok) {
      form.append('latitude', String(place.latitude));
      form.append('longitude', String(place.longitude));
      form.append('accuracy', String(place.accuracy));
    }
    const result = await postForm(`${base}/photos`, form);
    if (!live.current) return;
    setSending(null);

    const data = dataOf(result);
    const list = data ? photosOf(data.photos) : null;
    if (list) {
      held.current = null;
      onPhotos(list);
      onSay('Photo added');
      onChanged();
      return;
    }
    if (result.status === 401) { held.current = null; onOut(); return; }
    if (result.status === 404) { held.current = null; onInvalid(); return; }
    // A send that did not complete, or a server that could not keep the photo, can be sent again; a refusal is about the photo or the job, so it is shown as
    // it stands and the page reads the link again.
    if (result.status === 0 || result.status >= 500) {
      setProblem({ type: mine.type, text: result.status === 0 ? OFFLINE_TEXT : textOf(result.body.message).trim() || SEND_FAILED_TEXT, retry: true });
      return;
    }
    held.current = null;
    setProblem({ type: mine.type, text: messageOf(result) || SEND_FAILED_TEXT, retry: false });
    if (result.status === 409) onChanged();
  };

  const picked = async (type, event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || sending) return;
    setSending(type);
    setProblem(null);
    const blob = await shrinkPhoto(file);
    if (!live.current) return;
    if (!blob) {
      setSending(null);
      setProblem({ type, text: NOT_A_PHOTO_TEXT, retry: false });
      return;
    }
    held.current = { type, blob };
    await send();
  };

  const add = (type, allowed) => {
    if (!allowed || sending) return;
    inputs.current[type]?.click();
  };

  if (!photos) {
    return (
      <section className={CARD} aria-labelledby={headingId}>
        <h2 id={headingId} className={CARD_HEADING}>Photos</h2>
        <p className="mt-2 text-base text-gray-900">{UNREADABLE_TEXT}</p>
        <button type="button" onClick={onChanged} className={`${OUTLINE} mt-3`}>Try again</button>
      </section>
    );
  }

  const countOf = (type) => photos.filter((photo) => photo.type === type).length;
  const started = timer ? timer.state !== 'not_started' : false;

  return (
    <section className={CARD} aria-labelledby={headingId}>
      <h2 id={headingId} className={CARD_HEADING}>Photos</h2>

      {countOf('before') === 0 && !started && <p className={`mt-2 ${NOTICE}`}>{NO_BEFORE_HINT}</p>}

      {TYPES.map(({ type, heading, add: label }) => {
        const mine = photos.filter((photo) => photo.type === type);
        const allowed = photoCan[type] === true;
        const busy = sending !== null;
        const reasonId = `${groupId}-${type}-reason`;
        const titleId = `${groupId}-${type}`;
        return (
          <div key={type} role="group" aria-labelledby={titleId} className="mt-5">
            <div className="flex items-baseline justify-between gap-3">
              <h3 id={titleId} className="text-base font-semibold text-gray-900">{heading}</h3>
              <p className="text-sm text-gray-700">{mine.length} of {PHOTOS_MAX_PER_TYPE}</p>
            </div>

            {(mine.length > 0 || sending === type) && (
              <ul className="mt-2 flex flex-wrap gap-3">
                {mine.map((photo) => <Thumbnail key={photo.id} photo={photo} heading={heading} />)}
                {sending === type && (
                  <li aria-busy="true" className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-gray-500 p-1 text-center text-xs text-gray-700">Sending...</li>
                )}
              </ul>
            )}

            <input ref={(node) => { inputs.current[type] = node; }} type="file" accept="image/*" capture="environment" data-photo-type={type}
              tabIndex={-1} aria-hidden="true" className="sr-only" onChange={(event) => picked(type, event)} />
            <button type="button" aria-disabled={!allowed || busy || undefined} aria-describedby={allowed ? undefined : reasonId} onClick={() => add(type, allowed)}
              className={`${OUTLINE} mt-3`}>{label}</button>
            {!allowed && <p id={reasonId} className="mt-2 text-sm text-gray-700">{reasonOf(type, photoFull[type] || mine.length >= PHOTOS_MAX_PER_TYPE, timer)}</p>}

            {problem?.type === type && (
              <div className="mt-2">
                <p role="alert" className="text-sm font-medium text-red-700">{problem.text}</p>
                {problem.retry && <button type="button" onClick={send} aria-disabled={busy || undefined} className={`${OUTLINE} mt-2`}>Try again</button>}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
