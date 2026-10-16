// src/lib/booking-crew.js
//
// A provider's crew list and the crew on each of their jobs (ENG-014 design). The three guarded routes under src/app/api/provider/ call it, and
// so do the three admin routes that reset a job. It is the only file under src/ that names booking_crew (a pin in e2e/provider-crew.spec.js
// fails a PR that breaks that), so every reader of a job's crew goes through assignedCrew().
//
// The reads (listCrew, assignedCrew) take `execute` from src/lib/db.js. The writes take a `connection`, inside the transaction the caller
// has open (inTransaction below opens it), and none of them catches: a failure rolls the whole save back and reaches the route, which
// answers a 409 for a lost race and a 500 for anything else. Every statement is prepared, with a `?` for every value a person typed, and the
// only text ever put into one is a run of `?` marks counted from a list of ids and the number CREW_MAX, which bounds the two reads.
//
// Who is on a job is read through the booking's CURRENT provider: assignedCrew() joins provider_crew_members.provider_id to
// bookings.provider_id. Six statements in five files write bookings.provider_id and booking_crew keeps no record of which round a row belongs
// to, so a row made under provider A is invisible the moment the job is B's, whatever wrote the column. The three writers that RESET a job
// (admin reassign, admin restart, and the clear path of PUT /api/bookings) also call clearBookingCrew in the transaction they already have;
// without that, A to B to A, or a restart and a re-claim, would bring A's old picks back as assigned with nobody told. A new writer of
// bookings.provider_id is reviewed against this list.
//
// Importing './phone.js' with its extension keeps the file loadable in plain Node, for a spec.
import { normalisePhone } from './phone.js';

export const CREW_MAX = 30;
export const NAME_MAX = 120;

// The statuses in which a job's crew may change. An allow-list: a status added to bookings later is refused here until someone decides.
export const CREW_CHANGE_STATUSES = ['pending', 'matching', 'confirmed', 'in_progress'];

export const CREW_MESSAGES = {
  duplicate: 'That number is already in your crew.',
  clash: 'Another entry already uses that number.',
  full: `Your crew is full (${CREW_MAX}). Remove someone to add another.`,
  memberNotFound: 'Crew member not found',
  jobNotFound: 'Job not found',
  ids: "Send crew_ids as a list of your crew members' ids.",
  ownCrew: 'Pick cleaners from your own crew list.',
  finished: 'This job is finished, so its crew can no longer change.',
  changed: 'Something changed while that saved. Try again.',
};

// MySQL's deadlock and lock-wait-timeout errors, and the duplicate-key error the unique key on (provider_id, phone) raises.
const DEADLOCK = 1213;
const LOCK_WAIT_TIMEOUT = 1205;
const DUPLICATE_KEY = 1062;

export function crewEditable(status) {
  return CREW_CHANGE_STATUSES.includes(status);
}

// The id in a path as a number, or null when it is not a positive whole number written as digits. Anything looser would reach SQL, where MySQL
// reads '5abc' as 5 and '1e3' as 1000. A null is the 404 of its kind.
export function idFromPath(raw) {
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

function hasControlCharacter(text) {
  for (const character of text) {
    const code = character.codePointAt(0);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) return true;
  }
  return false;
}

// -> { ok: true, name } (trimmed) | { ok: false, message }. The length is counted in characters, as the column counts them.
export function normaliseName(input) {
  const name = typeof input === 'string' ? input.trim() : '';
  if (name === '') return { ok: false, message: "Enter the cleaner's name." };
  if (hasControlCharacter(name)) return { ok: false, message: 'A name cannot have line breaks or other control characters.' };
  if (Array.from(name).length > NAME_MAX) return { ok: false, message: `A name can have at most ${NAME_MAX} characters.` };
  return { ok: true, name };
}

// The body of PUT /api/provider/jobs/[id]/crew -> { ok: true, ids } (duplicates collapsed) | { ok: false }. A list of at most CREW_MAX positive
// whole numbers, as numbers: a string of digits is not an id here. The length is checked before anything else is done with the list.
export function crewIdsOf(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false };
  const list = body.crew_ids;
  if (!Array.isArray(list) || list.length > CREW_MAX) return { ok: false };
  if (!list.every((id) => Number.isSafeInteger(id) && id > 0)) return { ok: false };
  return { ok: true, ids: [...new Set(list)] };
}

// The message of a 409 for an error that means another save got there first: a deadlock or a lock wait that timed out, and, when the caller
// gives the message for it, the duplicate key of a number that two requests added at once. Null for any other error.
export function raceMessage(error, duplicateMessage = null) {
  if (error?.errno === DEADLOCK || error?.errno === LOCK_WAIT_TIMEOUT) return CREW_MESSAGES.changed;
  if (error?.errno === DUPLICATE_KEY) return duplicateMessage;
  return null;
}

// Runs `work(connection)` in a transaction on a connection the caller owns (withConnection from src/lib/db.js). Commits when it returns, and
// rolls back and rethrows when it throws; a refusal that `work` returns has written nothing, so it commits nothing of consequence.
export async function inTransaction(connection, work) {
  await connection.beginTransaction();
  try {
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

function marks(list) {
  return list.map(() => '?').join(', ');
}

// ---- reads ----------------------------------------------------------------------------------------------------------------------------

// The provider's members who have not been removed: [{ id, name, phone }], by name then id.
export async function listCrew(execute, providerId) {
  const rows = await execute(
    `SELECT id, name, phone FROM provider_crew_members WHERE provider_id = ? AND removed_at IS NULL ORDER BY name, id LIMIT ${CREW_MAX}`,
    [providerId]
  );
  return rows.map(({ id, name, phone }) => ({ id, name, phone }));
}

// The members on a job: [{ id, name, phone, removed }], by name then id. Read through the booking's current provider (see the header), so a
// row made under another provider is not here. While the job's crew can still change a removed member is not here either; on a finished job
// they are, marked, so that who was on it stays answerable. It reads crew columns and the booking's status only, never the customer's contact.
export async function assignedCrew(execute, bookingId) {
  const rows = await execute(
    `SELECT m.id, m.name, m.phone, m.removed_at IS NOT NULL AS removed, b.status
     FROM booking_crew bc
     JOIN bookings b ON b.id = bc.booking_id
     JOIN provider_crew_members m ON m.id = bc.crew_member_id AND m.provider_id = b.provider_id
     WHERE bc.booking_id = ?
     ORDER BY m.name, m.id
     LIMIT ${CREW_MAX}`,
    [bookingId]
  );
  return rows
    .filter((row) => !row.removed || !crewEditable(row.status))
    .map((row) => ({ id: row.id, name: row.name, phone: row.phone, removed: Boolean(row.removed) }));
}

// ---- writes (inside the caller's transaction) ------------------------------------------------------------------------------------------

// `name` and `phone` are already normalised (normaliseName, normalisePhone), so a refusal is decided before any lock is taken. Locks the
// provider's row first, so two adds cannot both take the last place. A number on an active member is refused; a number on a removed member
// brings that row back, under the name just typed.
// -> { ok: true, member: { id, name, phone }, revived } | { ok: false, reason: 'duplicate' | 'full' }
export async function addMember(connection, providerId, name, phone) {
  await connection.execute('SELECT id FROM service_providers WHERE id = ? FOR UPDATE', [providerId]);
  const [[counted]] = await connection.execute(
    'SELECT COUNT(*) AS active FROM provider_crew_members WHERE provider_id = ? AND removed_at IS NULL',
    [providerId]
  );
  const [found] = await connection.execute(
    'SELECT id, removed_at FROM provider_crew_members WHERE provider_id = ? AND phone = ?',
    [providerId, phone]
  );
  if (found.length > 0 && found[0].removed_at === null) return { ok: false, reason: 'duplicate' };
  if (Number(counted.active) >= CREW_MAX) return { ok: false, reason: 'full' };

  if (found.length > 0) {
    await connection.execute('UPDATE provider_crew_members SET name = ?, removed_at = NULL WHERE id = ? AND provider_id = ?', [
      name,
      found[0].id,
      providerId,
    ]);
    return { ok: true, member: { id: found[0].id, name, phone }, revived: true };
  }
  const [inserted] = await connection.execute('INSERT INTO provider_crew_members (provider_id, name, phone) VALUES (?, ?, ?)', [
    providerId,
    name,
    phone,
  ]);
  return { ok: true, member: { id: inserted.insertId, name, phone }, revived: false };
}

// `changes` is { name?, phone? }, each already normalised, at least one. Only an active member of this provider's; anything else is the same
// refusal. A number on any other entry of the provider's, removed or not, is refused: the unique key counts removed rows.
// -> { ok: true, member: { id, name, phone } } | { ok: false, reason: 'not_found' | 'clash' }
export async function editMember(connection, providerId, memberId, changes) {
  const [members] = await connection.execute(
    'SELECT id, name, phone FROM provider_crew_members WHERE id = ? AND provider_id = ? AND removed_at IS NULL FOR UPDATE',
    [memberId, providerId]
  );
  if (members.length === 0) return { ok: false, reason: 'not_found' };

  const name = changes.name ?? members[0].name;
  const phone = changes.phone ?? members[0].phone;
  if (phone !== members[0].phone) {
    const [taken] = await connection.execute('SELECT id FROM provider_crew_members WHERE provider_id = ? AND phone = ? AND id <> ?', [
      providerId,
      phone,
      memberId,
    ]);
    if (taken.length > 0) return { ok: false, reason: 'clash' };
  }
  await connection.execute('UPDATE provider_crew_members SET name = ?, phone = ? WHERE id = ? AND provider_id = ?', [
    name,
    phone,
    memberId,
    providerId,
  ]);
  return { ok: true, member: { id: memberId, name, phone } };
}

// The soft delete, then the member off every job whose crew can still change. Rows on finished jobs stay, so who was on them stays answerable.
// -> { ok: true, taken_off_jobs } | { ok: false, reason: 'not_found' } (not this provider's, already removed, or missing: one refusal)
export async function removeMember(connection, providerId, memberId) {
  const [removed] = await connection.execute(
    'UPDATE provider_crew_members SET removed_at = NOW() WHERE id = ? AND provider_id = ? AND removed_at IS NULL',
    [memberId, providerId]
  );
  if (removed.affectedRows === 0) return { ok: false, reason: 'not_found' };

  const [taken] = await connection.execute(
    `DELETE bc FROM booking_crew bc
     JOIN bookings b ON b.id = bc.booking_id
     WHERE bc.crew_member_id = ? AND b.status IN (${marks(CREW_CHANGE_STATUSES)})`,
    [memberId, ...CREW_CHANGE_STATUSES]
  );
  return { ok: true, taken_off_jobs: taken.affectedRows };
}

// Replaces a job's crew with `memberIds` (a set, already checked by crewIdsOf). Locks the booking row first and re-checks that the job is still
// this provider's and its crew can still change, then locks the members named and checks every one is an active member of this provider's:
// a removal that races the save either finishes first (the member is then not found) or waits. Nothing is written until every check has
// passed. Rows not in the new set go, for any provider (a stale row of another provider is invisible but tidied away); the missing ones are added.
// `added` and `removed` are this provider's own members only: [{ id, name, phone }].
// -> { ok: true, crew, added, removed } | { ok: false, reason: 'no_job' | 'finished' | 'unknown_member' }
export async function setBookingCrew(connection, bookingId, providerId, memberIds) {
  const [jobs] = await connection.execute('SELECT provider_id, status FROM bookings WHERE id = ? FOR UPDATE', [bookingId]);
  if (jobs.length === 0 || Number(jobs[0].provider_id) !== providerId) return { ok: false, reason: 'no_job' };
  if (!crewEditable(jobs[0].status)) return { ok: false, reason: 'finished' };

  let members = [];
  if (memberIds.length > 0) {
    const [found] = await connection.execute(
      `SELECT id, name, phone FROM provider_crew_members
       WHERE provider_id = ? AND removed_at IS NULL AND id IN (${marks(memberIds)})
       ORDER BY name, id FOR UPDATE`,
      [providerId, ...memberIds]
    );
    if (found.length !== memberIds.length) return { ok: false, reason: 'unknown_member' };
    members = found.map(({ id, name, phone }) => ({ id, name, phone }));
  }

  const [held] = await connection.execute(
    `SELECT m.id, m.name, m.phone
     FROM booking_crew bc
     JOIN provider_crew_members m ON m.id = bc.crew_member_id
     WHERE bc.booking_id = ? AND m.provider_id = ?
     ORDER BY m.name, m.id
     FOR UPDATE`,
    [bookingId, providerId]
  );
  const heldIds = new Set(held.map((member) => member.id));
  const keptIds = new Set(members.map((member) => member.id));
  const added = members.filter((member) => !heldIds.has(member.id));
  const removed = held.map(({ id, name, phone }) => ({ id, name, phone })).filter((member) => !keptIds.has(member.id));

  if (members.length === 0) {
    await connection.execute('DELETE FROM booking_crew WHERE booking_id = ?', [bookingId]);
  } else {
    await connection.execute(`DELETE FROM booking_crew WHERE booking_id = ? AND crew_member_id NOT IN (${marks(members)})`, [
      bookingId,
      ...members.map((member) => member.id),
    ]);
  }
  if (added.length > 0) {
    await connection.execute(
      `INSERT INTO booking_crew (booking_id, crew_member_id) VALUES ${added.map(() => '(?, ?)').join(', ')}`,
      added.flatMap((member) => [bookingId, member.id])
    );
  }
  return { ok: true, crew: members.map((member) => ({ ...member, removed: false })), added, removed };
}

// A job's rows, all of them. The three writers that reset a job call it in the transaction they already have, before they move or clear the
// provider. It does not catch: a missing table is a deploy mistake (0007 goes before the code) and must show as a failure, not be swallowed.
export async function clearBookingCrew(connection, bookingId) {
  await connection.execute('DELETE FROM booking_crew WHERE booking_id = ?', [bookingId]);
}
