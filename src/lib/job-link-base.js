// src/lib/job-link-base.js
//
// What every part of the job link imports (ENG-015 design, Interfaces 6 to 10): the statuses in which a link works, the record of who did what at a
// link, and the adapter that lets the same library code run on the pool or inside a transaction. It is a separate file so that the others do not
// import each other in a ring: src/lib/job-link.js reads a cleaner's session from job-link-code.js and the ticks from job-checkin.js, and both of
// those write events. src/lib/job-link.js re-exports every name here, so the rest of the app imports them from there.
//
// JOB_LINK_OPEN_STATUSES -> the booking statuses in which a link works: the four in which a job's crew can still change. awaiting_approval,
//   completed, cancelled and disputed close the link. A status added to bookings later is closed until someone decides, as in booking-crew.js.
//   A ticket that needs the link longer widens this one list and the case that pins it.
// EVENT_KINDS, EVENT_DETAILS -> what an event may be and the short fixed codes its detail may hold. recordEvent throws on anything else, so a
//   number, a name or a code cannot be put into the record by a slip. ENG-016 adds six kinds (photo_added, check_out, timer_start, timer_pause,
//   timer_resume, over_quote) and four details: before and after (the type of a photo), last_out (a timer paused because the last cleaner left) and
//   removed (a check-out the system stamped after a cleaner was taken off the crew while checked in). check_out is always about a member; over_quote
//   and the timer_* kinds are about the job and carry the actor. No event holds a photo address, a number or a name.
//   ENG-017 adds one kind, report_added (an on-site report was sent), and five details, the report's type: no_answer, details_wrong, unhygienic,
//   add_items, cannot_complete. The event is about the job and carries the actor (a cleaner's id as crewMemberId), so it is not in ABOUT_A_MEMBER.
//   It holds no note and no photo address, as no event does. An admin's decision on a report is not an event: it is on the report's own row.
// executeOn(connection) -> an `execute(sql, params)` that runs on a connection a transaction owns and answers what src/lib/db.js's execute
//   answers (the rows, or the result header), so a library written for the pool runs unchanged inside a transaction.
// recordEvent(execute, link, { kind, actor, crewMemberId, location, detail }) -> nothing. `link` is { id, booking_id }. `actor` is { kind:
//   'cleaner' | 'provider' | 'admin' | 'visitor', ref } where ref is a crew member id, a provider id or a users.id and a visitor (someone who has
//   not signed in) has none. `crewMemberId` is the person the event is about; `location` is { latitude, longitude, accuracy_m } for a check-in.
//   The record holds ids and never a name or a number: a name is read through its id when shown.
// eventsFor(execute, bookingId) -> the last EVENT_LIST_LIMIT events of a job (100, since ENG-016: a busy job's first events must stay in the list),
//   newest first, with names resolved at read:
//   [{ id, kind, actor: { kind, name }, subject, detail, latitude, longitude, accuracy_m, created_at }]. `subject` is the name of the person the
//   event is about. A cleaner who has been erased (src/lib/crew-retention.js) shows as 'A former cleaner'. `created_at` is an ISO string, read as
//   UNIX_TIMESTAMP so that it does not depend on the zone of the server, the pool and the database agreeing.
// namesFor(execute, { providers, admins, cleaners }) -> { provider, admin, cleaner }, each a Map of id to name, and nameOf(names, kind, ref) ->
//   the name or null. displayName(name) is the rule for a cleaner: a name that was erased, or whose row is gone, shows as 'A former cleaner'.
import { CREW_CHANGE_STATUSES } from './booking-crew.js';

export const JOB_LINK_OPEN_STATUSES = Object.freeze([...CREW_CHANGE_STATUSES]);

export const EVENT_KINDS = Object.freeze([
  'link_created',
  'link_off',
  'link_reissued',
  'code_asked',
  'code_suppressed',
  'code_failed',
  'signed_in',
  'check_in',
  'photo_added',
  'check_out',
  'timer_start',
  'timer_pause',
  'timer_resume',
  'over_quote',
  'report_added',
]);

export const EVENT_DETAILS = Object.freeze([
  'no_match',
  'cannot_text',
  'not_checked',
  'cooldown',
  'number_cap',
  'provider_cap',
  'platform_cap',
  'sent',
  'not_sent',
  'before',
  'after',
  'last_out',
  'removed',
  'no_answer',
  'details_wrong',
  'unhygienic',
  'add_items',
  'cannot_complete',
]);

export const EVENT_LIST_LIMIT = 100;

// What src/lib/crew-retention.js stores as the name of a cleaner it erased, and how that shows.
export const ERASED_NAME = 'Former cleaner';
const ERASED_SHOWN = 'A former cleaner';

const ACTOR_KINDS = Object.freeze(['cleaner', 'provider', 'admin', 'visitor']);

// Events about a person who is always known: a code that was asked for a number nobody has (detail no_match) is the one that is not.
const ABOUT_A_MEMBER = new Set(['code_suppressed', 'code_failed', 'signed_in', 'check_in', 'check_out']);

export function executeOn(connection) {
  return async (sql, params = []) => {
    const [result] = await connection.execute(sql, params);
    return result;
  };
}

export async function recordEvent(execute, link, { kind, actor, crewMemberId = null, location = null, detail = null }) {
  if (!EVENT_KINDS.includes(kind)) throw new Error('recordEvent: not an event kind');
  if (detail !== null && !EVENT_DETAILS.includes(detail)) throw new Error('recordEvent: not an event detail');
  if (!actor || !ACTOR_KINDS.includes(actor.kind)) throw new Error('recordEvent: not an actor kind');
  const ref = actor.kind === 'visitor' ? null : actor.ref;
  if (actor.kind !== 'visitor' && !Number.isSafeInteger(ref)) throw new Error('recordEvent: an actor needs an id');
  await execute(
    `INSERT INTO job_link_events (link_id, booking_id, kind, actor_kind, actor_ref, crew_member_id, latitude, longitude, accuracy_m, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [link.id, link.booking_id, kind, actor.kind, ref, crewMemberId, location?.latitude ?? null, location?.longitude ?? null, location?.accuracy_m ?? null, detail]
  );
}

export function displayName(name) {
  return typeof name !== 'string' || name === ERASED_NAME ? ERASED_SHOWN : name;
}

async function namesOf(execute, select, ids) {
  const wanted = [...new Set(ids)].filter((id) => Number.isSafeInteger(id));
  if (wanted.length === 0) return new Map();
  const rows = await execute(`${select} WHERE id IN (${wanted.map(() => '?').join(', ')})`, wanted);
  return new Map(rows.map((row) => [row.id, row.name]));
}

export async function namesFor(execute, { providers = [], admins = [], cleaners = [] } = {}) {
  const [provider, admin, cleaner] = await Promise.all([
    namesOf(execute, 'SELECT id, name FROM service_providers', providers),
    namesOf(execute, "SELECT id, TRIM(CONCAT(first_name, ' ', last_name)) AS name FROM users", admins),
    namesOf(execute, 'SELECT id, name FROM provider_crew_members', cleaners),
  ]);
  return { provider, admin, cleaner };
}

export function nameOf(names, kind, ref) {
  if (kind === 'visitor' || ref === null || ref === undefined) return null;
  const name = names[kind]?.get(ref) ?? null;
  return kind === 'cleaner' ? displayName(name) : name;
}

function subjectOf(row, names) {
  if (row.crew_member_id !== null) return nameOf(names, 'cleaner', row.crew_member_id);
  const aboutAMember = ABOUT_A_MEMBER.has(row.kind) || (row.kind === 'code_asked' && row.detail !== 'no_match');
  return aboutAMember ? ERASED_SHOWN : null;
}

const number = (value) => (value === null || value === undefined ? null : Number(value));

export async function eventsFor(execute, bookingId) {
  const rows = await execute(
    `SELECT id, kind, actor_kind, actor_ref, crew_member_id, latitude, longitude, accuracy_m, detail, UNIX_TIMESTAMP(created_at) AS created_epoch
     FROM job_link_events WHERE booking_id = ? ORDER BY id DESC LIMIT ${EVENT_LIST_LIMIT}`,
    [bookingId]
  );
  const of = (kind) => rows.filter((row) => row.actor_kind === kind).map((row) => row.actor_ref);
  const names = await namesFor(execute, {
    providers: of('provider'),
    admins: of('admin'),
    cleaners: [...of('cleaner'), ...rows.map((row) => row.crew_member_id)],
  });
  return rows.map((row) => ({
    id: Number(row.id),
    kind: row.kind,
    actor: { kind: row.actor_kind, name: nameOf(names, row.actor_kind, row.actor_ref) },
    subject: subjectOf(row, names),
    detail: row.detail,
    latitude: number(row.latitude),
    longitude: number(row.longitude),
    accuracy_m: number(row.accuracy_m),
    created_at: new Date(Number(row.created_epoch) * 1000).toISOString(),
  }));
}
