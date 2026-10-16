// What the screens of the job link share (ENG-015): reading a route's answer, and the sentences about a time, a distance and a person's name. Each screen
// keeps its own states and its own look; this file holds only what four of them would otherwise copy.

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
