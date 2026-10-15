// src/lib/job-link.js
//
// The job link (ENG-015 design, Interfaces 9 and 10; ADR-011): the address /job/{token} that a crew opens on a phone, who may see the job through
// it, and what a provider and an admin can do to it. The token in the address is a locator and not a credential. It opens no field of the job by
// itself: a cleaner gets in with a texted code (src/lib/job-link-code.js), the job's own signed-in provider and any signed-in admin get in with
// their own session, and everyone else is told `access: 'none'` and nothing else. A link that does not exist, was switched off or reissued, or
// belongs to a job that is finished answers the same way for every one of those reasons (findJobLink answers null; the routes send one 404).
//
// This file is the only place the job page's fields are chosen. jobPage() builds the answer field by field from named columns, and a pin in
// e2e/job-link.spec.js scans every SELECT in this file for the words that would put a customer's contact, a price or a payment on a crew's phone.
// The booking is joined to nothing here: the crew and the check-ins come from src/lib/booking-crew.js and src/lib/job-checkin.js.
//
// Every name of src/lib/job-link-base.js is re-exported from here, so the rest of the app imports the job link from one file.
//
// The reads take `execute` from src/lib/db.js. The three writes take `withConnection` and run in one transaction that first locks the booking row,
// as ENG-014's crew PUT does, so create, switch off, reissue and a check-in on the same job are taken one at a time. None of them catches: a
// failure rolls the save back and reaches the route, which answers a 409 for a lost race (raceMessage in src/lib/booking-crew.js) and a 500 for
// anything else. Nothing here logs a token, a name, a number or a coordinate.
//
// findJobLink(execute, token) -> { id, booking_id, generation, provider_id } | null
//   null for a token that is not 43 characters of base64url, one that matches no link, a link that is switched off, and a job that is not in
//   JOB_LINK_OPEN_STATUSES. The token is compared in the column's ascii_bin collation, so a token that differs only in case is another token.
// resolveAccess(request, execute, link, crew) -> { kind: 'admin' | 'provider' | 'cleaner', ref, name, epoch? } | null
//   In this order: a signed-in admin; a signed-in provider who is the job's CURRENT provider; a cleaner with a session for this link. (Two calls
//   to callerFrom, not one with both roles: it stops at the first verified caller whose role is allowed, so a stranger's provider cookie would
//   hide an admin's Bearer.) `ref` is the users.id of the admin, the provider's id or the crew member's id; `epoch` is the cleaner's assignment
//   second, which checkIn judges again inside its lock. `crew` is assignedCrew(…, { withAssignedAt: true }), read once by the caller.
// jobPage(execute, link, access, crew) -> { access, you: { kind, name }, job, crew, window } | null
//   null when the job closed since findJobLink. `job` is { service_name, days, address: { line1, line2, city, postal_code }, details: {
//   description, instructions, timing_note, parking, elevator, pets, worker_count } }, text that is not there as '' and the three yes/no as
//   booleans. `crew` is tickedView of the members on the job now: id, name, checked_in, checked_in_at, never a number. `window` is windowView.
// linkView(row) -> { path, on, generation, created_at, off_at } | null; `path` is '/job/{token}', never a URL, and null for a link that is off (the
//   old token is dead and is not shown again).
// managedView(execute, { bookingId, providerId, audit }) -> null | { job_link, status_open, crew, window, checkins?, events? }
//   What the provider's panel and the admin's panel show. null when the booking is not there, or, with a providerId, is not that provider's (in any
//   status). `crew` is [{ id, name, number_state, checked_in, checked_in_at }] and number_state is 'checked' | 'unchecked' | 'cannot_text'. With
//   `audit` (the admin's) there are also `checkins` [{ crew_member_id, name, checked_in_at, by: { kind, name }, away, distance_m, accuracy_m }]
//   and `events` (eventsFor: the last EVENT_LIST_LIMIT, newest first), names resolved at read.
// createJobLink / switchOffLink / reissueLink({ withConnection, bookingId, providerId, actor, generation? }) -> { ok: true, job_link } | { ok: false, reason }
//   `providerId` is the caller's when a provider asks and null for an admin; `actor` is { kind: 'provider' | 'admin', ref }. Each is an event.
//   create: the job must be open ('finished'), have a provider and at least one cleaner who is not removed ('no_crew'); a link that is on is
//     returned as it is, with no event; one that is off is reissued. switchOff: sets off_at where it is null; idempotent; allowed on a finished job;
//     answers job_link null when there is none. reissue: needs the generation the panel last saw ('changed' when it is not the link's now, or there
//     is no link), and the job open ('finished'); a new token, generation + 1, off_at cleared, so every session made under the old one is dead.
//   reason 'not_found' is a booking that is not there or, for a provider, not theirs.
import { callerFrom } from './api-auth.js';
import { assignedCrew, inTransaction } from './booking-crew.js';
import { numberStates } from './crew-number-check.js';
import { checkinsFor, tickedView } from './job-checkin.js';
import { JOB_LINK_OPEN_STATUSES, displayName, eventsFor, executeOn, namesFor, nameOf, recordEvent } from './job-link-base.js';
import { sessionFromRequest } from './job-link-code.js';
import { LINK_TOKEN_PATTERN, newLinkToken } from './link-token.js';
import { windowView } from './job-window.js';

export * from './job-link-base.js';

export const LINK_MESSAGES = {
  notValid: 'This link is not valid.',
  finished: 'This job is finished, so its link can no longer change.',
  noCrew: 'Add a cleaner to this job first.',
  changed: 'Someone just changed this link. Reload and try again.',
};

const isOpen = (status) => JOB_LINK_OPEN_STATUSES.includes(status);
const iso = (epoch) => (epoch === null || epoch === undefined ? null : new Date(Number(epoch) * 1000).toISOString());
const text = (value) => (typeof value === 'string' ? value : '');

// ---- finding a link, and who is asking ------------------------------------------------------------------------------------------------

export async function findJobLink(execute, token) {
  if (typeof token !== 'string' || !LINK_TOKEN_PATTERN.test(token)) return null;
  const rows = await execute(
    `SELECT l.id, l.booking_id, l.generation, b.provider_id, b.status
     FROM job_links l JOIN bookings b ON b.id = l.booking_id
     WHERE l.token = ? AND l.off_at IS NULL
     LIMIT 1`,
    [token]
  );
  const row = rows[0];
  if (!row || !isOpen(row.status)) return null;
  return { id: row.id, booking_id: row.booking_id, generation: row.generation, provider_id: row.provider_id };
}

export async function resolveAccess(request, execute, link, crew) {
  const admin = await callerFrom(request, ['admin']);
  if (admin) {
    const names = await namesFor(execute, { admins: [admin.id] });
    return { kind: 'admin', ref: admin.id, name: nameOf(names, 'admin', admin.id) ?? '' };
  }
  const provider = await callerFrom(request, ['provider']);
  if (provider && link.provider_id !== null && provider.id === link.provider_id) {
    const names = await namesFor(execute, { providers: [provider.id] });
    return { kind: 'provider', ref: provider.id, name: nameOf(names, 'provider', provider.id) ?? '' };
  }
  const cleaner = await sessionFromRequest(request, execute, link, crew);
  if (cleaner) return { kind: 'cleaner', ref: cleaner.id, name: displayName(cleaner.name), epoch: cleaner.epoch };
  return null;
}

// ---- what the page shows --------------------------------------------------------------------------------------------------------------

export async function jobPage(execute, link, access, crew) {
  const rows = await execute(
    `SELECT status, service_name, job_time_slot, address_line1, address_line2, city, postal_code, job_description, instructions,
            timing_constraints, parking_access, elevator_access, has_pets, worker_count, cluster,
            DATE_FORMAT(job_date, '%Y-%m-%d') AS job_date, UNIX_TIMESTAMP() AS now_epoch
     FROM bookings WHERE id = ?`,
    [link.booking_id]
  );
  const row = rows[0];
  if (!row || !isOpen(row.status)) return null;

  const members = crew.filter((member) => !member.removed);
  const ticks = await checkinsFor(execute, link.booking_id, crew);
  return {
    access: access.kind,
    you: { kind: access.kind, name: access.name },
    job: {
      service_name: text(row.service_name),
      days: text(row.job_time_slot)
        .split(',')
        .map((label) => label.trim())
        .filter((label) => label !== ''),
      address: { line1: text(row.address_line1), line2: text(row.address_line2), city: text(row.city), postal_code: text(row.postal_code) },
      details: {
        description: text(row.job_description),
        instructions: text(row.instructions),
        timing_note: text(row.timing_constraints),
        parking: Boolean(row.parking_access),
        elevator: Boolean(row.elevator_access),
        pets: Boolean(row.has_pets),
        worker_count: Number(row.worker_count) > 0 ? Number(row.worker_count) : 1,
      },
    },
    crew: tickedView(members, ticks),
    window: windowView(row, Number(row.now_epoch)),
  };
}

// ---- the link row, and the panels' view of it -----------------------------------------------------------------------------------------

async function linkRow(execute, bookingId, lock = false) {
  const rows = await execute(
    `SELECT id, token, generation, off_at IS NULL AS is_on, UNIX_TIMESTAMP(created_at) AS created_epoch, UNIX_TIMESTAMP(off_at) AS off_epoch
     FROM job_links WHERE booking_id = ?${lock ? ' FOR UPDATE' : ''}`,
    [bookingId]
  );
  return rows[0] ?? null;
}

export function linkView(row) {
  if (!row) return null;
  const on = Boolean(row.is_on);
  return { path: on ? `/job/${row.token}` : null, on, generation: row.generation, created_at: iso(row.created_epoch), off_at: iso(row.off_epoch) };
}

export async function managedView(execute, { bookingId, providerId = null, audit = false }) {
  const bookings = await execute(
    `SELECT status, provider_id, cluster, city, job_time_slot, DATE_FORMAT(job_date, '%Y-%m-%d') AS job_date, UNIX_TIMESTAMP() AS now_epoch
     FROM bookings WHERE id = ?`,
    [bookingId]
  );
  const booking = bookings[0];
  if (!booking || (providerId !== null && booking.provider_id !== providerId)) return null;

  const [link, crew] = await Promise.all([linkRow(execute, bookingId), assignedCrew(execute, bookingId, { withAssignedAt: true })]);
  const members = crew.filter((member) => !member.removed);
  const [states, ticks] = await Promise.all([numberStates(execute, members), checkinsFor(execute, bookingId, crew)]);
  const stateOf = new Map(states.map((state) => [state.id, state.number_state]));

  const view = {
    job_link: linkView(link),
    status_open: isOpen(booking.status),
    crew: tickedView(members, ticks).map((member) => ({
      id: member.id,
      name: member.name,
      number_state: stateOf.get(member.id) ?? 'unchecked',
      checked_in: member.checked_in,
      checked_in_at: member.checked_in_at,
    })),
    window: windowView(booking, Number(booking.now_epoch)),
  };
  if (!audit) return view;

  const by = (kind) => ticks.filter((tick) => tick.by_kind === kind).map((tick) => tick.by_ref);
  const names = await namesFor(execute, { providers: by('provider'), admins: by('admin'), cleaners: by('cleaner') });
  const nameOfMember = new Map(crew.map((member) => [member.id, displayName(member.name)]));
  return {
    ...view,
    checkins: ticks.map((tick) => ({
      crew_member_id: tick.crew_member_id,
      name: nameOfMember.get(tick.crew_member_id) ?? displayName(null),
      checked_in_at: tick.checked_in_at,
      by: { kind: tick.by_kind, name: nameOf(names, tick.by_kind, tick.by_ref) },
      away: tick.away,
      distance_m: tick.distance_m,
      accuracy_m: tick.accuracy_m,
    })),
    events: await eventsFor(execute, bookingId),
  };
}

// ---- the three writes -----------------------------------------------------------------------------------------------------------------

// The booking row, locked, or null when it is not there or is another provider's. Ownership is judged here, inside the lock, as well as by the route.
async function lockJob(run, bookingId, providerId) {
  const rows = await run('SELECT status, provider_id FROM bookings WHERE id = ? FOR UPDATE', [bookingId]);
  const booking = rows[0];
  if (!booking || (providerId !== null && booking.provider_id !== providerId)) return null;
  return booking;
}

const eventLink = (row, bookingId) => ({ id: row.id, booking_id: bookingId });

export async function createJobLink({ withConnection, bookingId, providerId = null, actor }) {
  return withConnection((connection) =>
    inTransaction(connection, async () => {
      const run = executeOn(connection);
      const booking = await lockJob(run, bookingId, providerId);
      if (!booking) return { ok: false, reason: 'not_found' };
      if (!isOpen(booking.status)) return { ok: false, reason: 'finished' };
      const crew = booking.provider_id === null ? [] : await assignedCrew(run, bookingId);
      if (!crew.some((member) => !member.removed)) return { ok: false, reason: 'no_crew' };

      const existing = await linkRow(run, bookingId, true);
      if (existing && existing.is_on) return { ok: true, job_link: linkView(existing) };
      if (existing) {
        await run('UPDATE job_links SET token = ?, generation = generation + 1, off_at = NULL WHERE id = ?', [newLinkToken(), existing.id]);
        await recordEvent(run, eventLink(existing, bookingId), { kind: 'link_reissued', actor });
      } else {
        const made = await run('INSERT INTO job_links (booking_id, token) VALUES (?, ?)', [bookingId, newLinkToken()]);
        await recordEvent(run, { id: made.insertId, booking_id: bookingId }, { kind: 'link_created', actor });
      }
      return { ok: true, job_link: linkView(await linkRow(run, bookingId)) };
    })
  );
}

export async function switchOffLink({ withConnection, bookingId, providerId = null, actor }) {
  return withConnection((connection) =>
    inTransaction(connection, async () => {
      const run = executeOn(connection);
      if (!(await lockJob(run, bookingId, providerId))) return { ok: false, reason: 'not_found' };

      const existing = await linkRow(run, bookingId, true);
      if (!existing) return { ok: true, job_link: null };
      if (existing.is_on) {
        await run('UPDATE job_links SET off_at = NOW() WHERE id = ? AND off_at IS NULL', [existing.id]);
        await recordEvent(run, eventLink(existing, bookingId), { kind: 'link_off', actor });
      }
      return { ok: true, job_link: linkView(await linkRow(run, bookingId)) };
    })
  );
}

export async function reissueLink({ withConnection, bookingId, providerId = null, actor, generation }) {
  return withConnection((connection) =>
    inTransaction(connection, async () => {
      const run = executeOn(connection);
      const booking = await lockJob(run, bookingId, providerId);
      if (!booking) return { ok: false, reason: 'not_found' };
      if (!isOpen(booking.status)) return { ok: false, reason: 'finished' };

      const existing = await linkRow(run, bookingId, true);
      if (!existing || !Number.isSafeInteger(generation) || existing.generation !== generation) return { ok: false, reason: 'changed' };

      await run('UPDATE job_links SET token = ?, generation = generation + 1, off_at = NULL WHERE id = ? AND generation = ?', [
        newLinkToken(),
        existing.id,
        generation,
      ]);
      await recordEvent(run, eventLink(existing, bookingId), { kind: 'link_reissued', actor });
      return { ok: true, job_link: linkView(await linkRow(run, bookingId)) };
    })
  );
}
