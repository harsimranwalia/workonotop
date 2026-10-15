// What the screens of the job link share (ENG-015): reading a route's answer, and the sentences about a time, a distance and a person's name. Each screen
// keeps its own states and its own look; this file holds only what four of them would otherwise copy. ENG-016 adds what the photos and the timer need on the
// page and in the two panels: the answers' shapes, the length of a time said two ways, the countdown, the phone's position and the photo shrinker.

import { useEffect, useState } from 'react';

export const isObject = (value) => value !== null && typeof value === 'object';

// A field as text to show, or '' when it is missing or not text, so one odd answer cannot crash a screen.
export const textOf = (value) => (typeof value === 'string' ? value : '');

export const SEND_TIMEOUT_MS = 20_000;
export const OFFLINE_TEXT = "Couldn't reach the server. Check your connection and try again.";

// One call to a route -> { status, body }: the HTTP status and the parsed JSON ({} when there is none), or status 0 when the call did not complete.
export async function callApi(path, options = {}) {
  try {
    const res = await fetch(path, { cache: 'no-store', ...options });
    const body = await res.json().catch(() => null);
    return { status: res.status, body: isObject(body) ? body : {} };
  } catch {
    return { status: 0, body: {} };
  }
}

export const postJson = (path, data, signal) =>
  callApi(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal: signal || AbortSignal.timeout(SEND_TIMEOUT_MS),
  });

// The data of an answer that succeeded, else null.
export const dataOf = (result) => (result.status === 200 && result.body.success === true && isObject(result.body.data) ? result.body.data : null);

// A refusal's own words (a 4xx is written to be shown as it stands), else ''.
export const messageOf = (result) => (result.status >= 400 && result.status < 500 ? textOf(result.body.message).trim() : '');

// An instant as the clock time of the browser's zone ("8:02 AM"), or '' when the value is missing or cannot be read.
export function clockOf(instant) {
  if (!instant) return '';
  const date = new Date(instant);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// An instant as the browser writes a date and a time, in the browser's zone; '' when it cannot be read.
export function stampOf(instant) {
  if (!instant) return '';
  const date = new Date(instant);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

// A distance in metres as a person says it: "about 640 m" under a kilometre (to the nearest ten), "about 2.1 km" over it. '' for no figure.
export function distanceOf(metres) {
  if (typeof metres !== 'number' || !Number.isFinite(metres) || metres < 0) return '';
  if (metres < 1000) return `about ${Math.max(10, Math.round(metres / 10) * 10)} m`;
  return `about ${(metres / 1000).toFixed(1)} km`;
}

// A list of names as a sentence part: "Ann", "Ann and Bea", "Ann, Bea and Cy".
export function namesOf(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// A crew member of an answer, or null when it is not the shape the route promises.
export function crewMemberOf(value) {
  if (!isObject(value) || !Number.isInteger(value.id)) return null;
  return {
    id: value.id,
    name: textOf(value.name),
    numberState: textOf(value.number_state),
    checkedIn: value.checked_in === true,
    checkedInAt: textOf(value.checked_in_at),
    checkedOutAt: textOf(value.checked_out_at),
  };
}

// A list of crew members, or null when the answer is not a list of them.
export function crewOf(value) {
  if (!Array.isArray(value)) return null;
  const crew = value.map(crewMemberOf);
  return crew.includes(null) ? null : crew;
}

// The check-in window of an answer: { open, opensLabel }. A window that cannot be read is treated as closed, so no control invites a press the route
// would refuse.
export function windowOf(value) {
  if (!isObject(value)) return { open: false, opensLabel: '' };
  return { open: value.open === true, opensLabel: textOf(value.opens_label) };
}

// ---- the look the cards of the page share ----

export const RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2';
// A button that is busy or has nothing to do is marked aria-disabled, not disabled, so keyboard focus stays on it while it is.
export const BUTTON = `w-full sm:w-auto px-5 py-3 min-h-[48px] rounded-xl text-base font-semibold transition-colors aria-disabled:opacity-50 aria-disabled:cursor-not-allowed ${RING}`;
export const PRIMARY = `${BUTTON} bg-green-700 hover:bg-green-800 text-white`;
export const OUTLINE = `${BUTTON} border border-gray-500 text-gray-800 hover:bg-gray-50`;
export const CARD = 'rounded-2xl border border-gray-200 bg-white p-5 shadow-sm';
export const CARD_HEADING = 'text-sm font-bold uppercase tracking-wide text-gray-700';
export const NOTICE = 'rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm font-medium text-amber-900';

export const POSITION_TEXT = 'We could not get your location. Try again somewhere with a clearer view of the sky.';

// ---- the photos and the timer (ENG-016) ----

// PHOTOS_MAX_PER_TYPE is the server's limit (src/lib/job-photos.js) as the "3 of 20" shows it, and BLOCKED_TEXT the sentences of TIMER_MESSAGES
// (src/lib/job-timer.js) for the reasons a start is held back; a case reads both files and pins them equal.
export const PHOTOS_MAX_PER_TYPE = 20;
export const PHOTO_LONG_EDGE_PX = 1600;
export const PHOTO_JPEG_QUALITY = 0.8;
export const PHOTO_SEND_TIMEOUT_MS = 60_000;
export const TIMER_POLL_SECONDS = 30;
// A start and a check-in are refused without the phone's position, so they wait for it; a photo, a pause, a resume and a check-out send it when the phone
// has it within this wait and go without it when not.
export const REQUIRED_POSITION_WAIT_MS = 20_000;
export const OPTIONAL_POSITION_WAIT_MS = 8_000;

export const BLOCKED_TEXT = {
  not_confirmed: 'This job is not ready to start.',
  no_before_photos: 'Take a before photo first.',
  nobody_here: 'Check in who is here first.',
  not_here: 'Check in first.',
};

const TIMER_STATES = ['not_started', 'running', 'paused'];
const finiteOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

// The multipart twin of postJson: the browser writes the content type and its boundary.
export const postForm = (path, form, signal) =>
  callApi(path, { method: 'POST', body: form, signal: signal || AbortSignal.timeout(PHOTO_SEND_TIMEOUT_MS) });

// The phone's position, once, as accurately as it can within `waitMs`: { ok: true, latitude, longitude, accuracy } or { ok: false, denied }.
export function currentPosition(waitMs = REQUIRED_POSITION_WAIT_MS) {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({ ok: false, denied: false });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ ok: true, latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }),
      (error) => resolve({ ok: false, denied: error?.code === 1 }),
      { enableHighAccuracy: true, timeout: waitMs, maximumAge: 0 }
    );
  });
}

// A length of time as a person says it, in whole minutes rounded down: "45 min", "2 h", "4 h 12 min", "2 h 05 min". '' for no figure.
export function durationOf(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '';
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')} min`;
}

// Seconds on a clock face: "1:59:07".
export function clockFaceOf(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const pad = (part) => String(part).padStart(2, '0');
  return `${Math.floor(total / 3600)}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

// One cleaner's time on the job, from the timer's answer, or null when it is not the shape the route promises.
function workerOf(value) {
  if (!isObject(value) || !Number.isInteger(value.id)) return null;
  return {
    id: value.id,
    name: textOf(value.name),
    workedSeconds: Math.max(0, finiteOrNull(value.worked_seconds) ?? 0),
    checkedInAt: textOf(value.checked_in_at),
    checkedOutAt: textOf(value.checked_out_at),
  };
}

// The timer of an answer in the shape the screens use, or null when it is not the one the routes promise. `clockSeconds` is the time left for each cleaner
// here (null when nobody is here) and `overSeconds` the time past the quote for each (null until the quote is used up).
export function timerOf(value) {
  if (!isObject(value) || !TIMER_STATES.includes(value.state) || !isObject(value.can) || !Array.isArray(value.per_member)) return null;
  const members = value.per_member.map(workerOf);
  if (members.includes(null)) return null;
  return {
    state: value.state,
    quoteMinutes: Math.max(0, finiteOrNull(value.quote_minutes) ?? 0),
    crewHere: Number.isInteger(value.crew_here) && value.crew_here > 0 ? value.crew_here : 0,
    usedSeconds: Math.max(0, finiteOrNull(value.used_seconds) ?? 0),
    clockSeconds: finiteOrNull(value.clock_seconds),
    overSeconds: finiteOrNull(value.over_seconds),
    overQuoteAt: textOf(value.over_quote_at),
    members,
    can: { start: value.can.start === true, pause: value.can.pause === true, resume: value.can.resume === true },
    blocked: Object.hasOwn(BLOCKED_TEXT, value.blocked) ? value.blocked : '',
  };
}

// A web address the page may put in a link or a picture: a path of this site or an https address, never a script.
const safeAddress = (url) => /^\/(?!\/)/.test(url) || /^https:\/\//i.test(url);

// One photo of an answer, or null when it is not the shape the routes promise. `by` is '' for a photo the provider's own page took.
export function photoOf(value) {
  if (!isObject(value) || !Number.isInteger(value.id) || (value.type !== 'before' && value.type !== 'after') || !safeAddress(textOf(value.url))) return null;
  return { id: value.id, type: value.type, url: value.url, by: textOf(isObject(value.taken_by) ? value.taken_by.name : ''), at: textOf(value.taken_at) };
}

// The photos of an answer, or null when the answer is not a list of them.
export function photosOf(value) {
  if (!Array.isArray(value)) return null;
  const photos = value.map(photoOf);
  return photos.includes(null) ? null : photos;
}

// Whether a photo of each kind may be added now, as the server judges it. Anything that cannot be read is "no", so no button invites a press the route would refuse.
export function photoCanOf(value) {
  return { before: isObject(value) && value.before === true, after: isObject(value) && value.after === true };
}

// The clock of a timer, counted on the phone between asks: { left, over } in whole seconds. While the job runs, `left` falls by the seconds since the answer
// arrived, measured on the monotonic clock so that a wrong phone clock moves nothing, and stops at 0 until the next answer says how far over it is; `over` then
// rises. Paused, or not started, the answer's own figures stand. `left` is null when nobody is here. A new answer starts the count again from its figures.
export function useCountdown(timer) {
  const [anchor, setAnchor] = useState(() => ({ timer, at: performance.now() }));
  const [, setBeat] = useState(0);
  if (anchor.timer !== timer) setAnchor({ timer, at: performance.now() });
  const running = timer?.state === 'running';

  useEffect(() => {
    if (!running) return undefined;
    const beat = setInterval(() => setBeat((count) => count + 1), 1000);
    return () => clearInterval(beat);
  }, [running]);

  if (!timer) return { left: null, over: null };
  const elapsed = running ? Math.max(0, Math.floor((performance.now() - anchor.at) / 1000)) : 0;
  if (!running) return { left: timer.clockSeconds, over: timer.overSeconds };
  if (timer.overSeconds !== null) return { left: 0, over: timer.overSeconds + elapsed };
  if (timer.clockSeconds === null) return { left: null, over: null };
  return { left: Math.max(0, timer.clockSeconds - elapsed), over: null };
}

// A picture from the camera or the file picker, read by the browser. Resolves to null when the file is not a picture it can read.
function loadPicture(file) {
  return new Promise((resolve) => {
    const address = URL.createObjectURL(file);
    const picture = new Image();
    picture.onload = () => {
      URL.revokeObjectURL(address);
      resolve(picture);
    };
    picture.onerror = () => {
      URL.revokeObjectURL(address);
      resolve(null);
    };
    picture.src = address;
  });
}

// A picture as a JPEG whose longest side is at most PHOTO_LONG_EDGE_PX, drawn on a canvas. That leaves the camera's metadata behind and draws the picture the
// way it is held (the server cuts the orientation out with the rest). Resolves to a Blob, or null when the file is not a picture the browser can read.
export async function shrinkPhoto(file) {
  const picture = await loadPicture(file);
  if (!picture || !picture.naturalWidth || !picture.naturalHeight) return null;
  const scale = Math.min(1, PHOTO_LONG_EDGE_PX / Math.max(picture.naturalWidth, picture.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(picture, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', PHOTO_JPEG_QUALITY));
}
