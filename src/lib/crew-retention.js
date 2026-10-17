// src/lib/crew-retention.js
//
// How long the job link keeps what it holds about people who are not users of the app (ENG-015 design, Interfaces 11; the first of the security
// conditions carried from ENG-014). A cleaner on a crew list has a name and a mobile number that they never gave to WorkOnTap, and the job link adds
// the number a code went to, a proof that the number is theirs, the position of their phone and a record of what they did. GET
// /api/cron/crew-retention runs this once a day behind the cron secret, as auto-release runs.
//
// runCrewRetention(execute) -> a summary of counts; it logs nothing and every statement is prepared. The steps, in this order:
//   (a) removed_members      members who were removed more than REMOVED_MEMBER_DAYS ago are ERASED;
//   (b) provider_deletion    every member of a provider whose status is 'deleted', or is 'pending_deletion' with deletion_requested_at more than
//                            DELETION_GRACE_HOURS ago (the 48 hours scripts/cleanup-deleted-accounts.js waits), is ERASED. database/schema.js
//                            defines neither that status nor that column, though the live database has both and the data-deletion route writes
//                            them, and a statement that names a missing column fails the whole run. So the step asks information_schema first and
//                            runs only the clauses the database has; with neither the step is skipped and the summary says 'not_in_schema';
//   (c) check_in_positions, event_positions   the latitude, longitude and accuracy of a check-in and of its event are set to NULL after
//                            LOCATION_DAYS. The distance and the away flag stay: they hold no position;
//   (d) codes, number_check_codes, stale_number_checks   a sign-in code and the session it bought are deleted EXPIRED_KEEP_DAYS after the later
//                            of the two expired; a number-check code that was never used likewise; and a number check for a number that is no
//                            longer the member's, once it is that old (it can prove nothing now, and holds a number);
//   (e) budget_rows          the counters of src/lib/sms-budget.js whose window began more than two days ago;
//   (f) notice_rows          the rows of notice_attempts (src/lib/notices.js) older than NOTICE_KEEP_DAYS. A row names ids and codes, never a number,
//                            an address or a word of a message, and a cleaner's row is one of them, so it ages out with the rest of what is held about
//                            people who are not users of the app.
// ERASE means ANONYMISE, so that history survives and no foreign key cascades it away: the name becomes ERASED_NAME, the number becomes 'x{id}'
// (not a number a text can go to, and unique, so the key on the provider and the number holds), removed_at is set if it was not, the member's
// number checks and sign-in codes are deleted, and the member is taken out of the job-link events that were about them (they read "a former
// cleaner" from then on). The job assignments are left alone: an anonymous row says only how many people were on a job. A check-in keeps its row and,
// until LOCATION_DAYS, its position. The member row is updated LAST, and its WHERE says it has not been erased, so a run that stops half way is
// finished by the next one, and a member who is put back on a crew (ENG-014's add revives a removed row) between two statements is left a member
// and loses only a proof they would have to give again.
import { ERASED_NAME } from './job-link-base.js';
import { pruneBudget } from './sms-budget.js';
import { pruneNotices } from './notices.js';

export const REMOVED_MEMBER_DAYS = 365;
export const LOCATION_DAYS = 365;
export const DELETION_GRACE_HOURS = 48;
export const EXPIRED_KEEP_DAYS = 7;

// A member whose number is still a number. An erased member's is 'x' and their id.
const NOT_ERASED = "m.phone <> CONCAT('x', m.id)";

async function erase(execute, condition, params) {
  const members = `SELECT m.id FROM provider_crew_members m WHERE ${condition}`;
  await execute(`DELETE FROM crew_number_checks WHERE crew_member_id IN (${members})`, params);
  await execute(`DELETE FROM job_link_codes WHERE crew_member_id IN (${members})`, params);
  await execute(`UPDATE job_link_events SET crew_member_id = NULL WHERE crew_member_id IN (${members})`, params);
  const result = await execute(
    `UPDATE provider_crew_members m SET m.name = ?, m.phone = CONCAT('x', m.id), m.removed_at = COALESCE(m.removed_at, NOW()) WHERE ${condition}`,
    [ERASED_NAME, ...params]
  );
  return result.affectedRows;
}

// Which of the two deletion clauses this database can run. A status counts only when the column is an enum that lists it.
async function deletionSupport(execute) {
  const columns = await execute(
    `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_providers' AND COLUMN_NAME IN ('status', 'deletion_requested_at')`
  );
  const status = columns.find((column) => column.name === 'status');
  const lists = (value) => typeof status?.type === 'string' && status.type.toLowerCase().startsWith('enum(') && status.type.includes(`'${value}'`);
  return { deleted: lists('deleted'), pending: lists('pending_deletion') && columns.some((column) => column.name === 'deletion_requested_at') };
}

async function eraseDeletedProviders(execute) {
  const { deleted, pending } = await deletionSupport(execute);
  if (!deleted && !pending) return 'not_in_schema';

  const clauses = [];
  const params = [];
  if (deleted) clauses.push("p.status = 'deleted'");
  if (pending) {
    clauses.push("(p.status = 'pending_deletion' AND p.deletion_requested_at < NOW() - INTERVAL ? HOUR)");
    params.push(DELETION_GRACE_HOURS);
  }
  return erase(execute, `m.provider_id IN (SELECT p.id FROM service_providers p WHERE ${clauses.join(' OR ')}) AND ${NOT_ERASED}`, params);
}

export async function runCrewRetention(execute) {
  const summary = {};

  summary.removed_members = await erase(execute, `m.removed_at IS NOT NULL AND m.removed_at < NOW() - INTERVAL ? DAY AND ${NOT_ERASED}`, [REMOVED_MEMBER_DAYS]);
  summary.provider_deletion = await eraseDeletedProviders(execute);

  const nullPosition = (table, when) =>
    execute(
      `UPDATE ${table} SET latitude = NULL, longitude = NULL, accuracy_m = NULL
       WHERE ${when} < NOW() - INTERVAL ? DAY AND (latitude IS NOT NULL OR longitude IS NOT NULL OR accuracy_m IS NOT NULL)`,
      [LOCATION_DAYS]
    );
  summary.check_in_positions = (await nullPosition('job_checkins', 'checked_in_at')).affectedRows;
  summary.event_positions = (await nullPosition('job_link_events', 'created_at')).affectedRows;

  summary.codes = (
    await execute(
      'DELETE FROM job_link_codes WHERE expires_at < NOW() - INTERVAL ? DAY AND (session_expires_at IS NULL OR session_expires_at < NOW() - INTERVAL ? DAY)',
      [EXPIRED_KEEP_DAYS, EXPIRED_KEEP_DAYS]
    )
  ).affectedRows;
  summary.number_check_codes = (
    await execute('DELETE FROM crew_number_checks WHERE used_at IS NULL AND expires_at < NOW() - INTERVAL ? DAY', [EXPIRED_KEEP_DAYS])
  ).affectedRows;
  summary.stale_number_checks = (
    await execute(
      `DELETE c FROM crew_number_checks c JOIN provider_crew_members m ON m.id = c.crew_member_id
       WHERE c.used_at IS NOT NULL AND c.phone <> m.phone AND c.created_at < NOW() - INTERVAL ? DAY`,
      [EXPIRED_KEEP_DAYS]
    )
  ).affectedRows;

  summary.budget_rows = await pruneBudget(execute);
  summary.notice_rows = await pruneNotices(execute);
  return summary;
}
