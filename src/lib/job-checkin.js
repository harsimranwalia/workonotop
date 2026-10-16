// src/lib/job-checkin.js
//
// A crew ticks itself in at the job (ENG-015 design, Interfaces 8). One person with the phone can tick every cleaner who is on the job, so a crew of
// three is three taps of one phone and not three sign-ins. A tick is a row in job_checkins per cleaner per assignment, with the phone's position,
// how far that is from the address and whether it is far enough to flag; it never blocks (a phone's position indoors is hundreds of metres off) and
// it never starts a clock (that is ENG-016, which reads checkinsFor).
//
// checkIn() runs in ONE transaction that first locks the booking row, as ENG-014's crew PUT does, and then reads everything again inside the lock:
// the status, the link, the crew with the second each member was put on the job, and the database's clock. A reassign, a restart, a switch-off or
// a close that races a tick therefore happens wholly before it (and the tick is refused) or wholly after it (and the tick was true when made);
// no tick lands on a closed or changed job. The order of the refusals is the order of what is cheapest to say and least to reveal: the job is
// closed, the caller is no longer who they were, the window has not opened, the position is not usable, someone is not on the crew.
//
// The libraries here take `withConnection` (src/lib/db.js) and use the connection's own execute, which does not log: a duplicate key is an expected
// answer ("already"), and the pool's execute would print the whole error, whose message can echo a value.
//
// readCrewIds(value) -> { ok: true, ids } | { ok: false }: one to CREW_MAX positive integers, duplicates dropped, order kept. Numbers only: "5" is not 5.
// checkIn({ withConnection, link, access, crewIds, location }) -> one of
//   { ok: true, checked_in: [ids], already: [ids], away, distance_m, crew }  `away` is true, false, or null when the booking has no position to
//     compare; `distance_m` and `away` describe this request's position; `crew` is tickedView of the job after the ticks.
//   { ok: false, reason: 'ids' }       crewIds is not a usable list
//   { ok: false, reason: 'closed' }    the job is not open, or the link was switched off or reissued: the route answers its 404
//   { ok: false, reason: 'access' }    the caller is no longer who they were (a cleaner off the job, a provider it was taken from)
//   { ok: false, reason: 'window', opens_at, opens_label }
//   { ok: false, reason: 'location' }  the position is missing or not usable
//   { ok: false, reason: 'not_on_crew' }  an id is not on the crew now; nobody is ticked
//   `link` is { id, booking_id, generation }. `access` is { kind: 'cleaner' | 'provider' | 'admin', ref, epoch? }: ref is the member's id, the
//   provider's id or the admin's users.id and, for a cleaner, epoch is the second they were put on the job, as sessionFromRequest answers it.
//   `location` is the body's { latitude, longitude, accuracy } as sent; this file validates it (src/lib/job-window.js, readLocation).
// checkinsFor(execute, bookingId, crew) -> [{ crew_member_id, assignment_epoch, checked_in_at (ISO), by_kind, by_ref, latitude, longitude,
//   accuracy_m, distance_m, away }] of the ticks that count: those whose member and assignment are on the crew now. A cleaner who was taken off
//   the job and put back is a new assignment and is not ticked; a tick made under the old one does not count and is kept as history. This is the
//   function ENG-016 reads: its length is who is at the job. `crew` is assignedCrew(…, { withAssignedAt: true }), read once by a caller that has
//   it; without it the function reads it.
// tickedView(crew, checkins) -> [{ id, name, checked_in, checked_in_at }] for each member, names and ticks only: no number, no coordinates.
// CHECKIN_MESSAGES, opensMessage(label) -> the sentences the check-in route sends for 'ids', 'location', 'not_on_crew' and 'window'.
import { CREW_MAX, assignedCrew, inTransaction } from './booking-crew.js';
import { JOB_LINK_OPEN_STATUSES, displayName, executeOn, recordEvent } from './job-link-base.js';
import { awayFrom, readLocation, windowView } from './job-window.js';

const DUPLICATE_KEY = 1062;

export const CHECKIN_MESSAGES = {
  ids: 'Pick who is here.',
  location: "We need your phone's location to check in. Allow location for this page and try again.",
  notOnCrew: "Pick cleaners from this job's crew.",
};

export const opensMessage = (label) => `Check-in opens at ${label}.`;

export function readCrewIds(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > CREW_MAX) return { ok: false };
  if (!value.every((id) => Number.isSafeInteger(id) && id > 0)) return { ok: false };
  return { ok: true, ids: [...new Set(value)] };
}

const toIso = (epoch) => (epoch === null || epoch === undefined ? null : new Date(Number(epoch) * 1000).toISOString());
const toNumber = (value) => (value === null || value === undefined ? null : Number(value));

export async function checkinsFor(execute, bookingId, crew = null) {
  const members = crew ?? (await assignedCrew(execute, bookingId, { withAssignedAt: true }));
  const epochOf = new Map(members.map((member) => [member.id, member.assigned_epoch]));
  const rows = await execute(
    `SELECT crew_member_id, assignment_epoch, UNIX_TIMESTAMP(checked_in_at) AS checked_in_epoch, by_kind, by_ref, latitude, longitude, accuracy_m, distance_m, away
     FROM job_checkins WHERE booking_id = ? ORDER BY checked_in_at, id`,
    [bookingId]
  );
  return rows
    .filter((row) => epochOf.get(row.crew_member_id) === Number(row.assignment_epoch))
    .map((row) => ({
      crew_member_id: row.crew_member_id,
      assignment_epoch: Number(row.assignment_epoch),
      checked_in_at: toIso(row.checked_in_epoch),
      by_kind: row.by_kind,
      by_ref: row.by_ref,
      latitude: toNumber(row.latitude),
      longitude: toNumber(row.longitude),
      accuracy_m: toNumber(row.accuracy_m),
      distance_m: toNumber(row.distance_m),
      away: row.away === null ? null : row.away === 1,
    }));
}

export function tickedView(crew, checkins) {
  const ticks = new Map(checkins.map((tick) => [tick.crew_member_id, tick]));
  return crew.map((member) => ({
    id: member.id,
    name: displayName(member.name),
    checked_in: ticks.has(member.id),
    checked_in_at: ticks.get(member.id)?.checked_in_at ?? null,
  }));
}

// Whether the caller is still who the route found them to be, judged inside the lock.
function stillAllowed(access, booking, crew) {
  if (access.kind === 'admin') return true;
  if (access.kind === 'provider') return booking.provider_id === access.ref;
  if (access.kind === 'cleaner') return crew.some((member) => !member.removed && member.id === access.ref && member.assigned_epoch === access.epoch);
  return false;
}

export async function checkIn({ withConnection, link, access, crewIds, location }) {
  const wanted = readCrewIds(crewIds);
  if (!wanted.ok) return { ok: false, reason: 'ids' };

  return withConnection((connection) =>
    inTransaction(connection, async () => {
      const run = executeOn(connection);

      const [booking] = await run(
        `SELECT status, provider_id, DATE_FORMAT(job_date, '%Y-%m-%d') AS job_date, job_time_slot, cluster, city, latitude, longitude, UNIX_TIMESTAMP() AS now_epoch
         FROM bookings WHERE id = ? FOR UPDATE`,
        [link.booking_id]
      );
      const live = booking
        ? await run('SELECT id FROM job_links WHERE id = ? AND booking_id = ? AND generation = ? AND off_at IS NULL', [link.id, link.booking_id, link.generation])
        : [];
      if (!booking || live.length === 0 || !JOB_LINK_OPEN_STATUSES.includes(booking.status)) return { ok: false, reason: 'closed' };

      const crew = await assignedCrew(run, link.booking_id, { withAssignedAt: true });
      if (!stillAllowed(access, booking, crew)) return { ok: false, reason: 'access' };

      const window = windowView(booking, Number(booking.now_epoch));
      if (!window.open) return { ok: false, reason: 'window', opens_at: window.opens_at, opens_label: window.opens_label };

      const where = readLocation(location);
      if (!where.ok) return { ok: false, reason: 'location' };

      const onCrew = new Map(crew.filter((member) => !member.removed).map((member) => [member.id, member]));
      if (!wanted.ids.every((id) => onCrew.has(id))) return { ok: false, reason: 'not_on_crew' };

      const { distance_m, away } = awayFrom(booking, where);
      const existing = await run('SELECT crew_member_id, assignment_epoch FROM job_checkins WHERE booking_id = ?', [link.booking_id]);
      const ticked = new Set(existing.map((row) => `${row.crew_member_id}:${Number(row.assignment_epoch)}`));
      const checkedIn = [];
      const already = [];

      for (const id of wanted.ids) {
        const member = onCrew.get(id);
        if (ticked.has(`${id}:${member.assigned_epoch}`)) {
          already.push(id);
          continue;
        }
        try {
          await run(
            `INSERT INTO job_checkins (booking_id, crew_member_id, assignment_epoch, by_kind, by_ref, latitude, longitude, accuracy_m, distance_m, away)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [link.booking_id, id, member.assigned_epoch, access.kind, access.ref, where.latitude, where.longitude, where.accuracy_m, distance_m, away]
          );
        } catch (error) {
          if (error?.errno === DUPLICATE_KEY) {
            already.push(id);
            continue;
          }
          throw error;
        }
        await recordEvent(run, link, {
          kind: 'check_in',
          actor: { kind: access.kind, ref: access.ref },
          crewMemberId: id,
          location: { latitude: where.latitude, longitude: where.longitude, accuracy_m: where.accuracy_m },
        });
        checkedIn.push(id);
      }

      const members = crew.filter((member) => !member.removed);
      return {
        ok: true,
        checked_in: checkedIn,
        already,
        away: away === null ? null : away === 1,
        distance_m,
        crew: tickedView(members, await checkinsFor(run, link.booking_id, members)),
      };
    })
  );
}
