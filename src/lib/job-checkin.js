// src/lib/job-checkin.js
//
// A crew ticks itself in at the job (ENG-015 design, Interfaces 8). One person with the phone can tick every cleaner who is on the job, so a crew of
// three is three taps of one phone and not three sign-ins. A tick is a row in job_checkins per cleaner per assignment, with the phone's position,
// how far that is from the address and whether it is far enough to flag; it never blocks (a phone's position indoors is hundreds of metres off) and
// it never starts a clock (that is ENG-016, which reads checkinsFor).
//
// ENG-016 adds the other end of a presence: checkOut() ends one cleaner's time on the job (job_checkins.checked_out_at, set once and final for that
// assignment, so a cleaner who comes back is added again by the provider, which is a new assignment and a new tick), and the last one out of a running
// job pauses its timer in the same transaction. presenceFor() is every presence of the job for the clock (src/lib/job-clock.js); reconcileRemoved()
// closes the presence of a cleaner who was taken off the crew while ticked in, because the crew's writers delete the assignment and leave no time.
// job-timer.js and this file call each other (the timer reads who is here, and the last check-out pauses the timer); every call is inside a function.
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
//   { ok: false, reason: 'checked_out' }  an id is a cleaner who has checked out of this job; nobody is ticked (a repeat tick of one who is still here
//     is "already", but a check-out is final for the assignment)
//   `link` is { id, booking_id, generation }. `access` is { kind: 'cleaner' | 'provider' | 'admin', ref, epoch? }: ref is the member's id, the
//   provider's id or the admin's users.id and, for a cleaner, epoch is the second they were put on the job, as sessionFromRequest answers it.
//   `location` is the body's { latitude, longitude, accuracy } as sent; this file validates it (src/lib/job-window.js, readLocation).
// checkOut({ withConnection, link, access, crewIds, location }) -> one of
//   { ok: true, checked_out: [ids], crew, timer }  `crew` is tickedView of the job after the check-out and `timer` is the TimerView (job-timer.js);
//     if that left nobody here on a running job, the job was paused in the same transaction (event timer_pause, detail last_out)
//   { ok: false, reason: 'ids' | 'closed' | 'access' | 'not_on_crew' | 'not_checked_in' }  the same lock, the same readCrewIds and the same
//     stillAllowed as checkIn; 'not_checked_in' is an id that is not here now, and nobody is checked out
// checkinsFor(execute, bookingId, crew, { withOut }) -> [{ crew_member_id, assignment_epoch, checked_in_at (ISO), checked_out_at (ISO or null),
//   by_kind, by_ref, latitude, longitude, accuracy_m, distance_m, away }] of the ticks that count: those whose member and assignment are on the crew
//   now and who have not checked out. A cleaner who was taken off the job and put back is a new assignment and is not ticked; a tick made under the
//   old one does not count and is kept as history. Its length is who is at the job. With `withOut` the ticks of cleaners who have checked out are
//   in the list too (the page shows when they left). `crew` is assignedCrew(…, { withAssignedAt: true }), read once by a caller that has it;
//   without it the function reads it.
// tickedView(crew, checkins) -> [{ id, name, checked_in, checked_in_at, checked_out_at }] for each member, names and ticks only: no number, no
//   coordinates. A member whose tick has a checked_out_at is not checked_in.
// presenceFor(execute, bookingId) -> [{ crew_member_id, assignment_epoch, from, to }] in epoch seconds for EVERY row of the job, a member since
//   removed included (the clock must not forget an hour a removed cleaner worked); `to` is null while the member is here.
// reconcileRemoved(execute, link, crew, actor) -> [crew member ids] it stamped. Every open check-in whose member and assignment are no longer on the
//   crew gets checked_out_at = NOW() and an event check_out with detail removed, written only for a row this call changed (`actor` is whoever
//   looked), so looks at the same moment do it once. `link` is { id, booking_id }.
// CHECKIN_MESSAGES, opensMessage(label) -> the sentences the check-in and check-out routes send for 'ids', 'location', 'not_on_crew', 'window',
//   'checked_out' and 'not_checked_in'.
import { CREW_MAX, assignedCrew, inTransaction } from './booking-crew.js';
import { JOB_LINK_OPEN_STATUSES, displayName, executeOn, recordEvent } from './job-link-base.js';
import { pauseTimer, timerFor } from './job-timer.js';
import { awayFrom, readLocation, windowView } from './job-window.js';

const DUPLICATE_KEY = 1062;

export const CHECKIN_MESSAGES = {
  ids: 'Pick who is here.',
  location: "We need your phone's location to check in. Allow location for this page and try again.",
  notOnCrew: "Pick cleaners from this job's crew.",
  checkedOut: 'That cleaner has checked out of this job.',
  notCheckedIn: 'That cleaner is not checked in.',
};

export const opensMessage = (label) => `Check-in opens at ${label}.`;

export function readCrewIds(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > CREW_MAX) return { ok: false };
  if (!value.every((id) => Number.isSafeInteger(id) && id > 0)) return { ok: false };
  return { ok: true, ids: [...new Set(value)] };
}

const toIso = (epoch) => (epoch === null || epoch === undefined ? null : new Date(Number(epoch) * 1000).toISOString());
const toNumber = (value) => (value === null || value === undefined ? null : Number(value));

export async function checkinsFor(execute, bookingId, crew = null, { withOut = false } = {}) {
  const members = crew ?? (await assignedCrew(execute, bookingId, { withAssignedAt: true }));
  const epochOf = new Map(members.map((member) => [member.id, member.assigned_epoch]));
  const rows = await execute(
    `SELECT crew_member_id, assignment_epoch, UNIX_TIMESTAMP(checked_in_at) AS checked_in_epoch, UNIX_TIMESTAMP(checked_out_at) AS checked_out_epoch,
            by_kind, by_ref, latitude, longitude, accuracy_m, distance_m, away
     FROM job_checkins WHERE booking_id = ?${withOut ? '' : ' AND checked_out_at IS NULL'} ORDER BY checked_in_at, id`,
    [bookingId]
  );
  return rows
    .filter((row) => epochOf.get(row.crew_member_id) === Number(row.assignment_epoch))
    .map((row) => ({
      crew_member_id: row.crew_member_id,
      assignment_epoch: Number(row.assignment_epoch),
      checked_in_at: toIso(row.checked_in_epoch),
      checked_out_at: toIso(row.checked_out_epoch),
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
  return crew.map((member) => {
    const tick = ticks.get(member.id);
    return {
      id: member.id,
      name: displayName(member.name),
      checked_in: tick !== undefined && tick.checked_out_at === null,
      checked_in_at: tick?.checked_in_at ?? null,
      checked_out_at: tick?.checked_out_at ?? null,
    };
  });
}

// Every presence of the job, for the clock: the hour a cleaner worked stays in the sum after they are taken off the crew.
export async function presenceFor(execute, bookingId) {
  const rows = await execute(
    `SELECT crew_member_id, assignment_epoch, UNIX_TIMESTAMP(checked_in_at) AS from_epoch, UNIX_TIMESTAMP(checked_out_at) AS to_epoch
     FROM job_checkins WHERE booking_id = ? ORDER BY checked_in_at, id`,
    [bookingId]
  );
  return rows.map((row) => ({
    crew_member_id: row.crew_member_id,
    assignment_epoch: Number(row.assignment_epoch),
    from: Number(row.from_epoch),
    to: row.to_epoch === null ? null : Number(row.to_epoch),
  }));
}

// The crew's writers delete a cleaner's assignment and leave no time, so a cleaner taken off the job while ticked in is closed here, by whoever
// next looks. Each row is one UPDATE guarded by IS NULL and the event is written only when it changed the row, so looks at the same moment do it once.
export async function reconcileRemoved(execute, link, crew, actor) {
  const epochOf = new Map(crew.filter((member) => !member.removed).map((member) => [member.id, member.assigned_epoch]));
  const open = await execute('SELECT id, crew_member_id, assignment_epoch FROM job_checkins WHERE booking_id = ? AND checked_out_at IS NULL', [link.booking_id]);
  const stamped = [];
  for (const row of open) {
    if (epochOf.get(row.crew_member_id) === Number(row.assignment_epoch)) continue;
    const result = await execute('UPDATE job_checkins SET checked_out_at = NOW() WHERE id = ? AND checked_out_at IS NULL', [row.id]);
    if (result.affectedRows !== 1) continue;
    await recordEvent(execute, link, { kind: 'check_out', actor: { kind: actor.kind, ref: actor.ref }, crewMemberId: row.crew_member_id, detail: 'removed' });
    stamped.push(row.crew_member_id);
  }
  return stamped;
}

// Whether the caller is still who the route found them to be, judged inside the lock.
export function stillAllowed(access, booking, crew) {
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
      const existing = await run('SELECT crew_member_id, assignment_epoch, checked_out_at IS NOT NULL AS is_out FROM job_checkins WHERE booking_id = ?', [link.booking_id]);
      const ticked = new Set(existing.map((row) => `${row.crew_member_id}:${Number(row.assignment_epoch)}`));
      const out = new Set(existing.filter((row) => row.is_out).map((row) => `${row.crew_member_id}:${Number(row.assignment_epoch)}`));
      if (wanted.ids.some((id) => out.has(`${id}:${onCrew.get(id).assigned_epoch}`))) return { ok: false, reason: 'checked_out' };
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
        crew: tickedView(members, await checkinsFor(run, link.booking_id, members, { withOut: true })),
      };
    })
  );
}

export async function checkOut({ withConnection, link, access, crewIds, location }) {
  const wanted = readCrewIds(crewIds);
  if (!wanted.ok) return { ok: false, reason: 'ids' };

  return withConnection((connection) =>
    inTransaction(connection, async () => {
      const run = executeOn(connection);

      const [booking] = await run('SELECT status, provider_id FROM bookings WHERE id = ? FOR UPDATE', [link.booking_id]);
      const live = booking
        ? await run('SELECT id FROM job_links WHERE id = ? AND booking_id = ? AND generation = ? AND off_at IS NULL', [link.id, link.booking_id, link.generation])
        : [];
      if (!booking || live.length === 0 || !JOB_LINK_OPEN_STATUSES.includes(booking.status)) return { ok: false, reason: 'closed' };

      const crew = await assignedCrew(run, link.booking_id, { withAssignedAt: true });
      if (!stillAllowed(access, booking, crew)) return { ok: false, reason: 'access' };

      const actor = { kind: access.kind, ref: access.ref };
      await reconcileRemoved(run, link, crew, actor);

      const onCrew = new Map(crew.filter((member) => !member.removed).map((member) => [member.id, member]));
      if (!wanted.ids.every((id) => onCrew.has(id))) return { ok: false, reason: 'not_on_crew' };

      const here = await run('SELECT crew_member_id, assignment_epoch FROM job_checkins WHERE booking_id = ? AND checked_out_at IS NULL', [link.booking_id]);
      const hereNow = new Set(here.map((row) => `${row.crew_member_id}:${Number(row.assignment_epoch)}`));
      if (!wanted.ids.every((id) => hereNow.has(`${id}:${onCrew.get(id).assigned_epoch}`))) return { ok: false, reason: 'not_checked_in' };

      const where = readLocation(location);
      const position = where.ok ? { latitude: where.latitude, longitude: where.longitude, accuracy_m: where.accuracy_m } : null;
      const checkedOut = [];
      for (const id of wanted.ids) {
        const result = await run(
          'UPDATE job_checkins SET checked_out_at = NOW() WHERE booking_id = ? AND crew_member_id = ? AND assignment_epoch = ? AND checked_out_at IS NULL',
          [link.booking_id, id, onCrew.get(id).assigned_epoch]
        );
        if (result.affectedRows !== 1) continue;
        await recordEvent(run, link, { kind: 'check_out', actor, crewMemberId: id, location: position });
        checkedOut.push(id);
      }

      if (here.length === checkedOut.length) await pauseTimer(run, link, actor, { location: position, detail: 'last_out' });

      const members = crew.filter((member) => !member.removed);
      return {
        ok: true,
        checked_out: checkedOut,
        crew: tickedView(members, await checkinsFor(run, link.booking_id, members, { withOut: true })),
        timer: await timerFor(run, link.booking_id, { access }),
      };
    })
  );
}
