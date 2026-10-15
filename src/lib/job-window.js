// src/lib/job-window.js
//
// When a job's check-in opens and how far a phone is from the job (ENG-015 design, Interfaces 4). Everything here is pure: no database, no
// clock, no network. The caller passes in the instant to judge (the database's own clock as epoch seconds, read in the same statement as the
// booking, so JavaScript's clock decides nothing) and the booking's fields, and gets numbers back. The only import is src/lib/location.js,
// which has none, so a spec loads this file in plain Node.
//
// Constants (one-line changes, no migration):
//   CHECKIN_LEAD_MINUTES  60   check-in opens this long before the earliest booked slot of the job's first day. It never closes while the job
//                              is open: a late arrival must be able to check in.
//   AWAY_METRES           500  a check-in more than this far from the booking's address is flagged `away`. It is a flag and never a block:
//                              a phone's position indoors and in towers is routinely hundreds of metres off.
//   SLOT_STARTS                the hour each time slot starts. A case pins it against TIME_SLOTS in src/lib/when-and-where.js (which uses the
//                              @/ alias and so cannot be imported here) so a changed slot cannot drift silently.
//
// zoneFor({ cluster, city }) -> 'America/Vancouver' | 'America/Toronto'
//   A cluster key that starts VAN_ is Vancouver. Everything else, an unknown cluster included, is Toronto: the earlier instant, so a mistake
//   opens the window early (the position flag still catches it) and never locks a crew out at the door. bookings.cluster is used when it is
//   one of the keys in src/lib/location.js, else the city is looked up there.
// zonedInstant(date, hour, minute, zone) -> epoch seconds of that wall time in that zone, worked out with Intl.DateTimeFormat and no library.
//   date is 'YYYY-MM-DD'.
// windowOpensEpoch({ job_date, job_time_slot, cluster, city }) -> epoch seconds, or null when the job_date cannot be read
//   job_date is 'YYYY-MM-DD' (the SQL formats it; a Date from mysql2 is read by its local year, month and day, which is how mysql2 builds one).
//   job_time_slot is the booking's labels joined by ',', one per day, such as 'Oct 17: Morning & Afternoon'; the first label is the first day's
//   (src/lib/booking-input.js). The earliest slot it names, found without regard to case, sets the hour; a label that names none opens at 07:00,
//   which is the morning start less the lead. A job_date that cannot be read gives null, and a null window is open: a job nobody can read the
//   day of is not one to lock a crew out of, and the check-in is still stamped with its real time and position.
// windowState(nowEpoch, opensEpoch) -> { open, opens_epoch }
//   open is nowEpoch >= opensEpoch, so at opens - 1 it is closed and at opens it is open.
// opensLabel(opensEpoch, zone) -> '7:00 AM PDT on Sat, Oct 17', in the job's zone with its abbreviation, so a cleaner reads the job's own time
//   whatever zone the phone is in.
// windowView(booking, nowEpoch) -> { open, opens_at, opens_label, time_zone }, what the routes send to the page. opens_at is an ISO string
//   (null for a null window) and opens_label is '' for one.
// distanceMetres(from, to) -> whole metres between two { latitude, longitude } points (haversine). Numbers or numeric strings, since mysql2
//   answers a DECIMAL column as a string.
// awayFrom(job, location) -> { distance_m, away }: both null when the booking has no position to compare ("no position to compare", never "at
//   the address"); otherwise the distance and 1 when it is over AWAY_METRES, else 0.
// readLocation(location) -> { ok: true, latitude, longitude, accuracy_m } | { ok: false }
//   A finite latitude in [-90, 90] and longitude in [-180, 180] that are not exactly 0 and 0 (a phone that has no fix often says so), and an
//   accuracy that is a finite number in [0, 100000] or absent (null then). Strings, NaN, objects and anything else are refused.
import { CLUSTERS, getClusterFromCity } from './location.js';

export const CHECKIN_LEAD_MINUTES = 60;
export const AWAY_METRES = 500;
export const SLOT_STARTS = { morning: 8, afternoon: 12, evening: 16 };

const VANCOUVER = 'America/Vancouver';
const TORONTO = 'America/Toronto';
const EARTH_RADIUS_METRES = 6371008.8;
const MAX_ACCURACY_M = 100000;

export function zoneFor({ cluster, city } = {}) {
  const key = typeof cluster === 'string' && Object.hasOwn(CLUSTERS, cluster) ? cluster : getClusterFromCity(city);
  return key.startsWith('VAN_') ? VANCOUVER : TORONTO;
}

const formatters = new Map();

function wallClock(zone) {
  if (!formatters.has(zone)) {
    formatters.set(zone, new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    }));
  }
  return formatters.get(zone);
}

// How far the zone's clock is ahead of UTC at an instant, in milliseconds.
function offsetMs(instantMs, zone) {
  const parts = wallClock(zone).formatToParts(new Date(instantMs));
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  const shown = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return shown - Math.floor(instantMs / 1000) * 1000;
}

// 'YYYY-MM-DD' -> { year, month, day } for a real calendar day, else null.
function dayParts(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof date === 'string' ? date : '');
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function zonedInstant(date, hour, minute, zone) {
  const day = dayParts(date);
  if (!day) throw new Error('zonedInstant: date must be a real YYYY-MM-DD');
  const wall = Date.UTC(day.year, day.month - 1, day.day, hour, minute);
  // The offset at the wall time read as UTC is a guess; the offset at the instant that guess gives is the right one, also across a change of clocks.
  const guess = wall - offsetMs(wall, zone);
  return Math.floor((wall - offsetMs(guess, zone)) / 1000);
}

// What job_date is as 'YYYY-MM-DD', or null.
function dayText(jobDate) {
  if (jobDate instanceof Date) {
    if (Number.isNaN(jobDate.getTime())) return null;
    const pad = (n) => String(n).padStart(2, '0');
    return `${jobDate.getFullYear()}-${pad(jobDate.getMonth() + 1)}-${pad(jobDate.getDate())}`;
  }
  if (typeof jobDate !== 'string') return null;
  const text = jobDate.trim().slice(0, 10);
  return dayParts(text) ? text : null;
}

// The earliest start hour among the slots the first label names, else the morning start.
function startHour(jobTimeSlot) {
  const first = typeof jobTimeSlot === 'string' ? jobTimeSlot.split(',')[0] : '';
  const named = Object.keys(SLOT_STARTS).filter((slot) => new RegExp(`\\b${slot}\\b`, 'i').test(first));
  return named.length === 0 ? SLOT_STARTS.morning : Math.min(...named.map((slot) => SLOT_STARTS[slot]));
}

export function windowOpensEpoch({ job_date, job_time_slot, cluster, city } = {}) {
  const date = dayText(job_date);
  if (date === null) return null;
  return zonedInstant(date, startHour(job_time_slot), 0, zoneFor({ cluster, city })) - CHECKIN_LEAD_MINUTES * 60;
}

export function windowState(nowEpoch, opensEpoch) {
  return { open: opensEpoch === null || opensEpoch === undefined || nowEpoch >= opensEpoch, opens_epoch: opensEpoch ?? null };
}

export function opensLabel(opensEpoch, zone) {
  const at = new Date(opensEpoch * 1000);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' }).format(at);
  const day = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric' }).format(at);
  // Recent ICU puts a narrow no-break space before AM and PM; a label is read and compared as plain text.
  return `${time} on ${day}`.replace(/[  ]/g, ' ');
}

export function windowView(booking, nowEpoch) {
  const zone = zoneFor(booking ?? {});
  const opens = windowOpensEpoch(booking ?? {});
  const { open } = windowState(nowEpoch, opens);
  return {
    open,
    opens_at: opens === null ? null : new Date(opens * 1000).toISOString(),
    opens_label: opens === null ? '' : opensLabel(opens, zone),
    time_zone: zone,
  };
}

export function distanceMetres(from, to) {
  const radians = (degrees) => (Number(degrees) * Math.PI) / 180;
  const dLat = radians(to.latitude) - radians(from.latitude);
  const dLon = radians(to.longitude) - radians(from.longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(a))));
}

// A booking's latitude and longitude as numbers, or null when it has no usable position (NULL columns, text, out of range).
function jobPosition(job) {
  if (!job) return null;
  const latitude = job.latitude === null || job.latitude === undefined || job.latitude === '' ? NaN : Number(job.latitude);
  const longitude = job.longitude === null || job.longitude === undefined || job.longitude === '' ? NaN : Number(job.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

export function awayFrom(job, location) {
  const position = jobPosition(job);
  if (position === null) return { distance_m: null, away: null };
  const distance = distanceMetres(position, location);
  return { distance_m: distance, away: distance > AWAY_METRES ? 1 : 0 };
}

export function readLocation(location) {
  if (!location || typeof location !== 'object' || Array.isArray(location)) return { ok: false };
  const { latitude, longitude, accuracy } = location;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return { ok: false };
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { ok: false };
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return { ok: false };
  if (latitude === 0 && longitude === 0) return { ok: false };
  let accuracy_m = null;
  if (accuracy !== undefined) {
    if (typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > MAX_ACCURACY_M) return { ok: false };
    accuracy_m = Math.round(accuracy);
  }
  // The columns hold eight decimals, a centimetre or so.
  return { ok: true, latitude: Number(latitude.toFixed(8)), longitude: Number(longitude.toFixed(8)), accuracy_m };
}
