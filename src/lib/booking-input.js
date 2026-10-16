// The booking fields that an admin's booking and the public booking work out the same way from what was typed: the dates and the times of
// the job, and the cluster of its city. This is a copy, made for src/app/api/admin/bookings/route.js, of what src/app/api/bookings/route.js
// does inline (the dates under "Extract single valid primary date", the cluster just before its transaction). The public route is not
// switched to this file, so a change to how one of the two reads these fields is made to both.
//
// normaliseJobDates(job_date, timing_constraints, job_time_slot)
//   job_date: what the booking screens send, an array of 'YYYY-MM-DD' days (one to three of them). A string of days joined by commas, or
//     one day as a string, is read the same way, and a time after a 'T' ('2026-10-20T00:00:00.000Z') is dropped.
//   timing_constraints: the customer's text, or anything falsy for none.
//   job_time_slot: what the screens send, an array of labels such as 'Oct 20: Morning & Afternoon' (one per day). One label as a
//     string is read the same way. The time is a third argument because the slot string is made here, with the dates, as the public route does.
//   Answers one of
//     { ok: true, primaryJobDate, timeSlotString, finalTimingConstraints }
//       primaryJobDate: the first day as 'YYYY-MM-DD', a real calendar day: the value of bookings.job_date.
//       timeSlotString: the labels joined by ',', 1 to 255 characters: the value of bookings.job_time_slot.
//       finalTimingConstraints: the text with the days that were chosen added after it as ' (Selected Dates: a, b)' (as 'Selected Dates: a, b'
//         when there is no text), or '' when there is neither. Store `finalTimingConstraints || null`, as the public route does.
//     { ok: false, message, field }
//       field is 'job_date', 'job_time_slot' or 'timing_constraints'; message is a sentence for whoever typed it and names no value.
//       A route answers 400 { success: false, message, field }.
//   It does not throw. Where the public route would hand the database a value it refuses (and answer 500) or store a value that means
//   nothing (no days at all, a time that is not text), this answers ok: false. It does not judge whether a day has passed: the public route
//   does not either.
//
// async clusterForCity(execute, city)
//   execute: the `execute(sql, params)` of '@/lib/db', which answers the rows, or a stand-in with that shape.
//   Answers the cluster as a string, never null: the cluster_key of the first active service area whose cities list the city (case and
//   the spaces around it do not matter), else 'UNKNOWN_CLUSTER'. A city that is not text is 'UNKNOWN_CLUSTER'. When the service_areas
//   query fails it falls back to the clusters built into src/lib/location.js, as the public route does. It does not throw.
import { getClusterFromCity } from './location.js';

// What getClusterFromCity answers for a city it does not know, and what bookings.cluster holds then.
const UNKNOWN_CLUSTER = 'UNKNOWN_CLUSTER';

// The width of bookings.job_time_slot.
const MAX_TIME_SLOT_LENGTH = 255;

const refuse = (field, message) => ({ ok: false, message, field });

// Whether `text` is a 'YYYY-MM-DD' that names a real day (not 2026-02-30), worked out in UTC so that no time zone plays a part.
function isRealDay(text) {
  const parts = typeof text === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(text) : null;
  if (!parts) return false;
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const when = new Date(Date.UTC(year, month - 1, day));
  return when.getUTCFullYear() === year && when.getUTCMonth() === month - 1 && when.getUTCDate() === day;
}

// The day of one chosen date: what comes before a 'T' when it is a timestamp, without the spaces around it; null when it is not text.
const dayOf = (chosen) => (typeof chosen === 'string' ? chosen.split('T')[0].trim() : null);

export function normaliseJobDates(job_date, timing_constraints, job_time_slot) {
  // A list of days is an array, or a string with commas in it; the booking's timing notes then name the days that were chosen.
  const isList = Array.isArray(job_date) || (typeof job_date === 'string' && job_date.includes(','));
  let chosenDays = [job_date];
  if (Array.isArray(job_date)) chosenDays = job_date;
  else if (isList) chosenDays = job_date.split(',').map((day) => day.trim()).filter(Boolean);
  if (chosenDays.length === 0 || !chosenDays.every((chosen) => isRealDay(dayOf(chosen)))) {
    return refuse('job_date', 'Choose a valid date for the job.');
  }
  const primaryJobDate = dayOf(chosenDays[0]);
  const allDatesString = isList ? chosenDays.join(', ') : '';

  const slots = Array.isArray(job_time_slot) ? job_time_slot : [job_time_slot];
  if (!slots.every((slot) => typeof slot === 'string')) return refuse('job_time_slot', 'Choose a time for the job.');
  const timeSlotString = slots.join(',');
  if (timeSlotString.trim() === '') return refuse('job_time_slot', 'Choose a time for the job.');
  if (timeSlotString.length > MAX_TIME_SLOT_LENGTH) return refuse('job_time_slot', 'The times chosen for the job are too long.');

  let finalTimingConstraints = timing_constraints || '';
  if (typeof finalTimingConstraints !== 'string') return refuse('timing_constraints', 'The timing notes must be text.');
  if (allDatesString && !finalTimingConstraints.includes(allDatesString)) {
    finalTimingConstraints = finalTimingConstraints
      ? `${finalTimingConstraints} (Selected Dates: ${allDatesString})`
      : `Selected Dates: ${allDatesString}`;
  }

  return { ok: true, primaryJobDate, timeSlotString, finalTimingConstraints };
}

export async function clusterForCity(execute, city) {
  if (typeof city !== 'string' || !city) return UNKNOWN_CLUSTER;
  try {
    const areas = await execute('SELECT cluster_key, cities FROM service_areas WHERE is_active = 1');
    const searchCity = city.toLowerCase().trim();
    for (const area of areas) {
      const citiesArray = Array.isArray(area.cities) ? area.cities : [];
      if (citiesArray.some((c) => c.toLowerCase().trim() === searchCity)) return area.cluster_key;
    }
    return UNKNOWN_CLUSTER;
  } catch (err) {
    console.error('Error fetching dynamic cluster mapping', err);
    return getClusterFromCity(city);
  }
}
