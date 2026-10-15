// src/lib/job-timer.js
//
// The job timer on the job link (ENG-016 design, Interfaces 4). It is the provider's timer and not a second one: a start from the link makes the
// writes the provider's page makes (bookings.status and job_timer_status, a job_sessions stretch, a booking_time_logs line and a
// booking_status_history line), so the provider's page, the stop that ENG-017 moves to the link and every report keep working and show one state.
// Every boundary is written with the database's clock (NOW()) and read back as UNIX_TIMESTAMP, so the zone of the app never enters it. This is the
// only new file that names job_sessions.
//
// What a cleaner reads is worked out and not ticked: src/lib/job-clock.js is the rule, and this file feeds it the rows (the stretches of
// job_sessions and the presences of job_checkins, through presenceFor in src/lib/job-checkin.js). Nothing here runs every minute.
//
// The three actions run in ONE transaction that first locks the booking row, as checkIn does, read the job again inside the lock and judge on what
// the reconcile leaves. The reads take `execute` from src/lib/db.js. job-checkin.js and this file call each other (the last check-out pauses the
// timer, and the timer reads who is here); every call is inside a function, so neither needs the other while it is loading.
//
// LOCATION_REQUIRED -> the actions that are refused without a position: ['start'] (section W5 of the contract). Every other action records the
//   position when the phone sent a usable one and writes null when not. Tightening that later is one word.
// TIMER_MESSAGES -> the sentences the timer route sends, keyed by the reason that was refused: location, not_here, already_started,
//   not_confirmed, no_before_photos, nobody_here, not_running, not_paused.
// timerFor(execute, bookingId, { access }) -> the TimerView, read-only, or null when the booking is not there:
//   { state: 'not_started' | 'running' | 'paused', quote_minutes, crew_here, server_now, used_seconds, clock_seconds, over_seconds, over_quote_at,
//     per_member: [{ id, name, worked_seconds, checked_in_at, checked_out_at }], can: { start, pause, resume }, blocked }
//   `server_now` is the database's epoch second; `clock_seconds` is the time left for each cleaner here (null when nobody is); `over_seconds` is how
//   far past the quote each cleaner here is (null until the labour is used); `per_member` lists everyone who was ever here, a cleaner since taken off
//   the crew included, and its worked_seconds sum to used_seconds. `blocked` is the first of not_confirmed, no_before_photos, nobody_here and
//   not_here that stops a start now, null otherwise (and null once the job has started). `can.*` is false for a visitor (access null); a cleaner
//   who is not checked in can do none of the three.
// refreshTimer(execute, link, actor) -> the TimerView after the two things a look owes the record, each guarded so that looks at the same moment
//   do each once: every check-in whose member or assignment has left the crew is stamped checked out (an event check_out, detail removed, the actor
//   being whoever looked), and if that left nobody here on a running timer the stretch is closed and the timer paused (timer_pause, detail
//   last_out); then, when the labour left is below zero, bookings.over_quote_at is set where it is NULL and the over_quote event is written only
//   if this look changed the row. `link` is { id, booking_id }; `actor` is { kind, ref }.
// startJob, pauseJob, resumeJob({ withConnection, link, access, location }) -> { ok: true, timer } | { ok: false, reason }, reason one of closed,
//   access, not_here, already_started, not_confirmed, no_before_photos, nobody_here, location, not_running, not_paused. `closed` is a job that is no
//   longer open or a link that was switched off; `access` is a caller who is no longer who they were. A cleaner must be checked in to do any of the
//   three; a provider and an admin need not be, but a start and a resume need somebody here. A start needs the job confirmed and a before photo
//   (beforePhotoCount, the same function the provider's start calls) and the phone's position. The customer's "your professional has started" text
//   is NOT sent from the link: messages are ENG-018's.
// pauseTimer(execute, link, actor, { location, detail }) -> true when it paused a running timer, false when it was not running. Closes every
//   open stretch of the job, sets paused, writes a pause log line and the timer_pause event (detail 'last_out' when the last cleaner left). The
//   check-out of the last cleaner calls it too.
import { assignedCrew, inTransaction } from './booking-crew.js';
import { presenceFor, reconcileRemoved, stillAllowed } from './job-checkin.js';
import { clockView } from './job-clock.js';
import { JOB_LINK_OPEN_STATUSES, executeOn, namesFor, nameOf, recordEvent } from './job-link-base.js';
import { beforePhotoCount } from './job-photos.js';
import { readLocation } from './job-window.js';

export const LOCATION_REQUIRED = Object.freeze(['start']);

export const TIMER_MESSAGES = {
  location: "We need your phone's location to start the job. Allow location for this page and try again.",
  not_here: 'Check in first.',
  already_started: 'The job has already started.',
  not_confirmed: 'This job is not ready to start.',
  no_before_photos: 'Take a before photo first.',
  nobody_here: 'Check in who is here first.',
  not_running: 'The job is not running.',
  not_paused: 'The job is not paused.',
};

const NOTES = {
  start: 'Started from the job link',
  pause: 'Paused from the job link',
  resume: 'Resumed from the job link',
  last_out: 'Paused: the last cleaner checked out',
};

const iso = (epoch) => (epoch === null || epoch === undefined ? null : new Date(Number(epoch) * 1000).toISOString());
const place = (where) => (where.ok ? { latitude: where.latitude, longitude: where.longitude, accuracy_m: where.accuracy_m } : null);

// ---- the view -------------------------------------------------------------------------------------------------------------------------

export async function timerFor(execute, bookingId, { access = null } = {}) {
  const bookings = await execute(
    `SELECT status, job_timer_status, standard_duration_minutes, UNIX_TIMESTAMP(over_quote_at) AS over_epoch, UNIX_TIMESTAMP() AS now_epoch
     FROM bookings WHERE id = ?`,
    [bookingId]
  );
  const booking = bookings[0];
  if (!booking) return null;
  const now = Number(booking.now_epoch);

  // A job that has not started has done no labour, whatever a run it was restarted or reassigned from left in job_sessions.
  const begun = !['pending', 'matching', 'confirmed'].includes(booking.status);
  const stretches = begun
    ? await execute('SELECT UNIX_TIMESTAMP(clock_in) AS from_epoch, UNIX_TIMESTAMP(clock_out) AS to_epoch FROM job_sessions WHERE booking_id = ? ORDER BY clock_in, id', [bookingId])
    : [];
  const presences = await presenceFor(execute, bookingId);
  const clock = clockView({
    quote_minutes: booking.standard_duration_minutes === null ? null : Number(booking.standard_duration_minutes),
    sessions: stretches.map((row) => ({ from: Number(row.from_epoch), to: row.to_epoch === null ? null : Number(row.to_epoch) })),
    presence: presences.map((row) => ({ member: row.crew_member_id, from: row.from, to: row.to })),
    now,
  });

  const ids = [...new Set(presences.map((row) => row.crew_member_id))];
  const names = await namesFor(execute, { cleaners: ids });
  const latest = new Map(presences.map((row) => [row.crew_member_id, row]));
  const perMember = ids.map((id) => ({
    id,
    name: nameOf(names, 'cleaner', id),
    worked_seconds: clock.per_member[id] ?? 0,
    checked_in_at: iso(latest.get(id).from),
    checked_out_at: iso(latest.get(id).to),
  }));

  const state = booking.status !== 'in_progress' ? 'not_started' : booking.job_timer_status === 'running' ? 'running' : 'paused';
  const cleaner = access?.kind === 'cleaner';
  const youAreHere = !cleaner || perMember.some((member) => member.id === access.ref && member.checked_out_at === null);

  let blocked = null;
  if (state === 'not_started') {
    if (booking.status !== 'confirmed') blocked = 'not_confirmed';
    else if ((await beforePhotoCount(execute, bookingId)) === 0) blocked = 'no_before_photos';
    else if (clock.crew_here === 0) blocked = 'nobody_here';
    else if (!youAreHere) blocked = 'not_here';
  }
  const allowed = access !== null;

  return {
    state,
    quote_minutes: clock.quote_seconds / 60,
    crew_here: clock.crew_here,
    server_now: now,
    used_seconds: clock.used_seconds,
    clock_seconds: clock.clock_seconds,
    over_seconds: clock.over_seconds,
    over_quote_at: iso(booking.over_epoch),
    per_member: perMember,
    can: {
      start: allowed && state === 'not_started' && blocked === null,
      pause: allowed && state === 'running' && youAreHere,
      resume: allowed && state === 'paused' && clock.crew_here > 0 && youAreHere,
    },
    blocked,
  };
}

// ---- the writes the clock rests on ----------------------------------------------------------------------------------------------------

export async function pauseTimer(execute, link, actor, { location = null, detail = null } = {}) {
  const flipped = await execute(
    "UPDATE bookings SET job_timer_status = 'paused', updated_at = NOW() WHERE id = ? AND status = 'in_progress' AND job_timer_status = 'running'",
    [link.booking_id]
  );
  if (flipped.affectedRows !== 1) return false;
  await execute(
    'UPDATE job_sessions SET clock_out = NOW(), session_duration_minutes = TIMESTAMPDIFF(MINUTE, clock_in, NOW()) WHERE booking_id = ? AND clock_out IS NULL',
    [link.booking_id]
  );
  await execute("INSERT INTO booking_time_logs (booking_id, action, timestamp, notes) VALUES (?, 'pause', NOW(), ?)", [link.booking_id, detail === 'last_out' ? NOTES.last_out : NOTES.pause]);
  await recordEvent(execute, link, { kind: 'timer_pause', actor, location, detail });
  return true;
}

// Stamp the check-ins of cleaners who have left the crew; if that took the last person away from a running job, pause it.
async function reconcile(execute, link, crew, actor) {
  const stamped = await reconcileRemoved(execute, link, crew, actor);
  if (stamped.length === 0) return;
  const presences = await presenceFor(execute, link.booking_id);
  if (presences.every((row) => row.to !== null)) await pauseTimer(execute, link, actor, { detail: 'last_out' });
}

export async function refreshTimer(execute, link, actor) {
  const crew = await assignedCrew(execute, link.booking_id, { withAssignedAt: true });
  await reconcile(execute, link, crew, actor);

  const view = await timerFor(execute, link.booking_id, { access: actor });
  if (view === null || view.over_seconds === null || view.over_quote_at !== null) return view;
  const flagged = await execute('UPDATE bookings SET over_quote_at = NOW() WHERE id = ? AND over_quote_at IS NULL', [link.booking_id]);
  if (flagged.affectedRows === 1) await recordEvent(execute, link, { kind: 'over_quote', actor });
  return timerFor(execute, link.booking_id, { access: actor });
}

// ---- the three actions ----------------------------------------------------------------------------------------------------------------

// The reason an action is refused on the state the lock found, or null. A start is judged by the view's own `blocked`, in the order it names.
function refusalFor(action, view, notHere) {
  if (action === 'start') return view.state === 'not_started' ? view.blocked : 'already_started';
  if (action === 'pause') {
    if (notHere) return 'not_here';
    return view.state === 'running' ? null : 'not_running';
  }
  if (view.state !== 'paused') return 'not_paused';
  if (view.crew_here === 0) return 'nobody_here';
  return notHere ? 'not_here' : null;
}

async function act(action, { withConnection, link, access, location }) {
  return withConnection((connection) =>
    inTransaction(connection, async () => {
      const run = executeOn(connection);

      const [booking] = await run('SELECT status, provider_id FROM bookings WHERE id = ? FOR UPDATE', [link.booking_id]);
      const live = booking
        ? await run('SELECT id FROM job_links WHERE id = ? AND booking_id = ? AND generation = ? AND off_at IS NULL', [link.id, link.booking_id, link.generation])
        : [];
      if (!booking || booking.provider_id === null || live.length === 0 || !JOB_LINK_OPEN_STATUSES.includes(booking.status)) return { ok: false, reason: 'closed' };

      const crew = await assignedCrew(run, link.booking_id, { withAssignedAt: true });
      if (!stillAllowed(access, booking, crew)) return { ok: false, reason: 'access' };

      const actor = { kind: access.kind, ref: access.ref };
      await reconcile(run, link, crew, actor);
      const where = readLocation(location);
      const before = await timerFor(run, link.booking_id, { access });
      const notHere = access.kind === 'cleaner' && !before.per_member.some((member) => member.id === access.ref && member.checked_out_at === null);
      const refusal = refusalFor(action, before, notHere) ?? (LOCATION_REQUIRED.includes(action) && !where.ok ? 'location' : null);
      if (refusal !== null) return { ok: false, reason: refusal };

      if (action === 'start') {
        await run("UPDATE bookings SET status = 'in_progress', start_time = NOW(), job_timer_status = 'running', updated_at = NOW() WHERE id = ?", [link.booking_id]);
        // A stretch that a restarted run left open is closed as an empty one, so that it cannot run beside this run's own.
        await run('UPDATE job_sessions SET clock_out = clock_in WHERE booking_id = ? AND clock_out IS NULL', [link.booking_id]);
        await run('INSERT INTO job_sessions (booking_id, provider_id, clock_in) VALUES (?, ?, NOW())', [link.booking_id, booking.provider_id]);
        await run("INSERT INTO booking_time_logs (booking_id, action, timestamp, notes) VALUES (?, 'start', NOW(), ?)", [link.booking_id, NOTES.start]);
        await run("INSERT INTO booking_status_history (booking_id, status, notes) VALUES (?, 'in_progress', ?)", [link.booking_id, NOTES.start]);
        await recordEvent(run, link, { kind: 'timer_start', actor, location: place(where) });
      } else if (action === 'pause') {
        await pauseTimer(run, link, actor, { location: place(where) });
      } else {
        await run("UPDATE bookings SET job_timer_status = 'running', updated_at = NOW() WHERE id = ?", [link.booking_id]);
        await run('INSERT INTO job_sessions (booking_id, provider_id, clock_in) VALUES (?, ?, NOW())', [link.booking_id, booking.provider_id]);
        await run("INSERT INTO booking_time_logs (booking_id, action, timestamp, notes) VALUES (?, 'resume', NOW(), ?)", [link.booking_id, NOTES.resume]);
        await recordEvent(run, link, { kind: 'timer_resume', actor, location: place(where) });
      }
      return { ok: true, timer: await timerFor(run, link.booking_id, { access }) };
    })
  );
}

export function startJob(request) {
  return act('start', request);
}

export function pauseJob(request) {
  return act('pause', request);
}

export function resumeJob(request) {
  return act('resume', request);
}
