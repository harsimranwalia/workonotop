'use client';

// The "Job timer and photos" block of the job link's panels (ENG-016): the timer's state and clock, how long each cleaner has worked, and the photos taken.
// src/components/job/JobLinkManager.jsx reads them with the rest of the managed view and hands them in as the shapes of src/components/job/jobLinkKit.js
// (`timer` and `photos` are null when the answer did not hold them in the shape the routes promise). The panel does not poll, so the block says when the
// read was made and carries the panel's Refresh; between reads the clock of a running job is counted on the screen (useCountdown), and a new read starts
// the count again from its figures.
//   state   Not started, Running or Paused; Finished once the job is closed, because the timer's own state has no word for a job that is over
//   clock   what is left for each cleaner here, "-" with nobody here, "Over by" once the quote is used up; none for a finished job, which counts nothing
//   a part that could not be read is named in one sentence and the rest of the block is drawn
// Every colour comes from the look the panel passes in, so the panel's table of looks is the one place that is measured.

import { useId } from 'react';
import { clockFaceOf, clockOf, durationOf, stampOf, useCountdown } from './jobLinkKit';

const NOBODY_TEXT = 'Nobody is checked in.';
const SPENT_TEXT = 'The quoted time is up. Refresh to see how far over it is.';
const NO_PHOTOS_TEXT = 'No photos yet.';
const HERE_NOW_TEXT = 'here now';
const STATES = { not_started: 'Not started', running: 'Running', paused: 'Paused', closed: 'Finished' };
const COLUMNS = ['Cleaner', 'Here since', 'Out at', 'Time worked'];
const PHOTO_TYPES = [
  { type: 'before', heading: 'Before' },
  { type: 'after', heading: 'After' },
];

// The clock: what is left for each cleaner here, or how far over the quote each is. Only this part is drawn every second. A running clock that has counted
// down to 0 holds there, because how far over the quote the job is comes with the next read and the panel reads when it is asked to.
function Clock({ look, timer }) {
  const labelId = useId();
  const { left, over } = useCountdown(timer);
  const isOver = over !== null;
  const spent = timer.state === 'running' && left === 0 && !isOver;
  const here = timer.crewHere;
  const face = isOver ? `Over by ${clockFaceOf(over)}` : left === null ? '-' : clockFaceOf(left);
  const label = isOver || left === null ? '' : here === 1 ? 'left for the cleaner here' : `left for each of the ${here} cleaners here`;
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        {isOver && <span aria-hidden="true" className={`text-2xl leading-none ${look.warn}`}>&#9888;</span>}
        <p role="timer" aria-live="off" aria-labelledby={label ? labelId : undefined} className={`min-w-0 text-2xl font-bold tabular-nums ${isOver ? look.warn : look.strong}`}>{face}</p>
      </div>
      {label && <p id={labelId} className={`text-sm ${look.muted}`}>{label}</p>}
      {here === 0 && <p className={`mt-1 text-sm font-medium ${look.strong}`}>{NOBODY_TEXT}</p>}
      {spent && <p className={`mt-1 text-sm font-medium ${look.strong}`}>{SPENT_TEXT}</p>}
    </div>
  );
}

// Everyone who has been on the job, with the time each has worked. The wrapper holds the table inside the panel, so a narrow screen never scrolls the page.
function WorkedTable({ look, members }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full table-fixed text-left text-xs">
        <caption className={`pb-1 text-left text-xs font-semibold ${look.strong}`}>Time worked by each cleaner</caption>
        <colgroup>
          <col className="w-[31%]" />
          <col className="w-[23%]" />
          <col className="w-[23%]" />
          <col className="w-[23%]" />
        </colgroup>
        <thead>
          <tr className={look.muted}>
            {COLUMNS.map((name) => <th key={name} scope="col" className="py-1 pr-1.5 text-left font-semibold">{name}</th>)}
          </tr>
        </thead>
        <tbody className={`divide-y ${look.divider}`}>
          {members.map((member) => (
            <tr key={member.id} className={`align-top ${look.strong}`}>
              <th scope="row" className="py-1.5 pr-1.5 text-left font-semibold break-words">{member.name || 'A cleaner'}</th>
              <td className="py-1.5 pr-1.5 break-words">{clockOf(member.checkedInAt) || '-'}</td>
              <td className="py-1.5 pr-1.5 break-words">{member.checkedOutAt ? clockOf(member.checkedOutAt) || '-' : HERE_NOW_TEXT}</td>
              <td className="py-1.5 break-words">{durationOf(member.workedSeconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// One photo: a 96 px thumbnail that opens the full photo in a new tab, and who took it and when.
function Photo({ look, photo, heading }) {
  const time = clockOf(photo.at);
  const caption = [photo.by, time].filter(Boolean).join(' · ');
  const alt = `${heading} photo${photo.by ? ` by ${photo.by}` : ''}${time ? `, ${time}` : ''}`;
  return (
    <li className="w-24 min-w-0">
      <a href={photo.url} target="_blank" rel="noopener noreferrer" className={`block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${look.ring}`}>
        <img src={photo.url} alt={alt} width="96" height="96" loading="lazy" decoding="async" className={`h-24 w-24 rounded-lg border object-cover ${look.well}`} />
      </a>
      {caption && <p className={`mt-1 text-xs break-words ${look.muted}`}>{caption}</p>}
    </li>
  );
}

function PhotoGroup({ look, heading, photos }) {
  return (
    <div className="mt-3">
      <h4 className={`text-xs font-semibold ${look.strong}`}>{`${heading} (${photos.length})`}</h4>
      {photos.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-3">
          {photos.map((photo) => <Photo key={photo.id} look={look} photo={photo} heading={heading} />)}
        </ul>
      )}
    </div>
  );
}

// `look` is a row of the panel's LOOKS; `open` is whether the job is open (a closed job counts nothing, whatever its timer says); `timer` and
// `photos` are timerOf and photosOf of the answer; `asOf` is the moment the answer arrived; `refresh` is the panel's Refresh button.
export default function JobLinkRecord({ look, open, timer, photos, asOf, refresh }) {
  const missing = [timer ? '' : 'the job timer', photos ? '' : 'the photos'].filter(Boolean);
  const overStamp = timer ? stampOf(timer.overQuoteAt) : '';
  const readAt = clockOf(asOf);
  return (
    <div className="mt-4">
      <h3 className={`text-xs font-bold uppercase tracking-wide ${look.muted}`}>Job timer and photos</h3>

      {timer && (
        <div className="mt-2">
          <p className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${look.well} ${look.strong}`}>{STATES[open ? timer.state : 'closed']}</p>
          {open && <Clock look={look} timer={timer} />}
          <p className={`mt-2 text-sm ${look.muted}`}>{`Quoted ${durationOf(timer.quoteMinutes * 60)} · ${durationOf(timer.usedSeconds)} of crew time used`}</p>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {readAt && <p className={`text-xs ${look.muted}`}>{`As of ${readAt}`}</p>}
        {refresh}
      </div>

      {timer?.overQuoteAt && (
        <p className={`mt-3 inline-flex max-w-full items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold ${look.well} ${look.warn}`}>
          <span aria-hidden="true">&#9888;</span>
          <span>{overStamp ? `Over the quote since ${overStamp}` : 'Over the quote'}</span>
        </p>
      )}

      {timer && timer.members.length > 0 && <WorkedTable look={look} members={timer.members} />}

      {missing.length > 0 && <p className={`mt-3 text-sm font-medium ${look.strong}`}>{`Couldn't show ${missing.join(' or ')}.`}</p>}

      {photos && (
        <div>
          {PHOTO_TYPES.map(({ type, heading }) => <PhotoGroup key={type} look={look} heading={heading} photos={photos.filter((photo) => photo.type === type)} />)}
          {photos.length === 0 && <p className={`mt-2 text-sm ${look.muted}`}>{NO_PHOTOS_TEXT}</p>}
        </div>
      )}
    </div>
  );
}
