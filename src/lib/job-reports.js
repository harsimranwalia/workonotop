// src/lib/job-reports.js
//
// The five on-site reports a crew sends from the job link (ENG-017 design, Interfaces 1; ADR-016): the customer did not answer, the job's details are
// wrong, the conditions are unhygienic, more items are wanted, the job can not be done. Each is a type, a note, one photo, who sent it and where they
// were. They go in job_reports and the office decides on them in src/lib/report-desk.js. Besides that file and src/lib/job-photo-retention.js this is
// the only file that names job_reports (a pin in e2e/job-reports.spec.js). This file is link-facing: it reads and writes a report's who, what and when and
// never a word of its money. The bytes are checked, cleaned and written by src/lib/job-photo-store.js, the only file that touches the disk; this file
// never does. Nothing here sends a text, an e-mail or a push: the alert is ENG-018's.
//
// saveReport() runs in ONE transaction that first locks the booking row, as addPhoto() in src/lib/job-photos.js does, and judges in the same order, so a
// start, a reassign, a check-out or a close that races a report happens wholly before it (and the report is refused) or wholly after it (and the report
// was true when sent). The file is written inside the lock, after every check has passed, and is removed again if anything after it throws, so a refusal
// or a failure leaves no file behind that a row does not name. A position that does not read is not a refusal.
//
// Logging: a disk failure logs its code as a fixed line (saveReport turns it into the 'store' answer); nothing here logs a token, a name, a note or a
// coordinate.
//
// REPORT_TYPES -> the closed set, in the contract's order: [{ code, label }] for no_answer 'Customer did not answer', details_wrong 'Job details are
//   incorrect', unhygienic 'Unhygienic conditions', add_items 'Add more items' and cannot_complete 'Unable to complete the job'. Pinned equal to the
//   kit's REPORT_CHOICES, to the table's ENUM and to the five report details of EVENT_DETAILS (src/lib/job-link-base.js).
// REPORT_NOTE_MAX -> 1000, the longest note in characters (code points); pinned to the column.
// REPORTS_MAX_PER_BOOKING -> 20, the reports one job may hold of any status: each holds a photo of up to PHOTO_MAX_BYTES.
// REPORT_MESSAGES -> the sentences a route sends. The key for a reason is the reason in camel case: type, note, photo, tooBig (too_big), image, notHere
//   (not_here), status, tooMany (too_many) and store. 'token', 'closed' and 'access' have no sentence here: the route answers a bad token as an
//   invalid request, and the other two as the photo route does (the 404 of a link that is not valid, and the sign-in message).
// saveReport({ withConnection, link, access, type, note, bytes, location, clientToken }) -> one of
//   { ok: true, report, again }     report is { id, type, label, note, photo, by: { kind, name }, at (ISO), seen }, as reportsFor shows it; `again` is
//                                   true when clientToken named a report that was already saved, which is answered and nothing more is written
//   { ok: false, reason }           reason is one of the twelve below, in the order they are judged
//   type       type is not one of REPORT_TYPES
//   note       the note, trimmed, is empty or longer than REPORT_NOTE_MAX characters
//   token      clientToken is given and is not 8 to 64 letters, digits and dashes
//   photo      no bytes
//   too_big    bytes is more than PHOTO_MAX_BYTES (the route has stopped reading by then; this is the second line)
//   image      bytes is not a JPEG, PNG or WebP by its first bytes, or is a JPEG that does not parse cleanly (src/lib/job-photo-store.js)
//              The six above are judged before a connection is taken. The rest are judged inside the lock, in this order:
//   closed     the booking is gone or has no provider, its status is not one of JOB_LINK_OPEN_STATUSES, or the link was switched off or reissued
//   access     the caller is not the one the route found (a cleaner off the job, a provider it was taken from), by stillAllowed()
//              -- then the replay: a clientToken that names a report of this job is answered as it was saved, whatever has changed since --
//   not_here   a cleaner who is not checked in now: a report from a house by someone who is not there is not evidence. A provider and an admin need not be
//   status     the booking is open but not confirmed or in progress: a job that is pending or matching is not yet one anyone is at
//   too_many   the job already holds REPORTS_MAX_PER_BOOKING reports
//   store      the disk refused the file; nothing was written to the database
//   `link` is { id, booking_id, generation }. `access` is { kind: 'cleaner' | 'provider' | 'admin', ref, epoch? }, as resolveAccess answers it.
//   `bytes` is a Buffer; it is cleaned of its Exif segment before it is stored. `location` is the body's { latitude, longitude, accuracy } as sent.
//   The report_added event holds the type as its detail, the sender as its actor (a cleaner as crewMemberId too) and the position if it read, and no note
//   and no photo address.
// reportsFor(execute, bookingId, { audit }) -> the job's reports in the shape above, newest first, at most REPORTS_MAX_PER_BOOKING, names resolved at read.
//   `audit` (the provider's and the admin's view only) adds `away` and `distance_m`. No key of it is a price, an amount, a charge or a decision: the
//   cleaner's page and the provider's panel see that a report was `seen`, never what the office decided or charged.
// reportCan(status, canSend, count) -> whether a report may be sent now, by the rules saveReport judges again inside its lock (not_here, status and
//   too_many), so the button is right before a refusal. `canSend` is false for a cleaner who is not checked in; `count` is the reports the job holds.
import { assignedCrew, inTransaction } from './booking-crew.js';
import { checkinsFor, stillAllowed } from './job-checkin.js';
import { JOB_LINK_OPEN_STATUSES, executeOn, namesFor, nameOf, recordEvent } from './job-link-base.js';
import { isShownAddress } from './job-photos.js';
import { PHOTO_MAX_BYTES, removePhoto, savePhoto, sniffImage, stripJpegMetadata } from './job-photo-store.js';
import { awayFrom, readLocation } from './job-window.js';

export const REPORT_TYPES = Object.freeze([
  Object.freeze({ code: 'no_answer', label: 'Customer did not answer' }),
  Object.freeze({ code: 'details_wrong', label: 'Job details are incorrect' }),
  Object.freeze({ code: 'unhygienic', label: 'Unhygienic conditions' }),
  Object.freeze({ code: 'add_items', label: 'Add more items' }),
  Object.freeze({ code: 'cannot_complete', label: 'Unable to complete the job' }),
]);

export const REPORT_NOTE_MAX = 1000;
export const REPORTS_MAX_PER_BOOKING = 20;

export const REPORT_MESSAGES = Object.freeze({
  type: 'Pick one of the five reports.',
  note: 'Write what you found, in 1 to 1,000 characters.',
  photo: 'Add a photo of it.',
  tooBig: 'That photo is too big. Take it again.',
  image: 'That file is not a photo we can use. Take it again.',
  notHere: 'Check in first, then send a report.',
  status: 'This job is not under way, so a report can not be sent.',
  tooMany: 'This job has all the reports it can hold.',
  store: 'Photos can not be saved right now. Try again in a minute.',
});

const TOKEN = /^[A-Za-z0-9-]{8,64}$/;
const REPORT_COLUMNS = 'id, report_type, note, photo_url, reporter_kind, reporter_ref, status, distance_m, away, UNIX_TIMESTAMP(created_at) AS created_epoch';

const refuse = (reason) => ({ ok: false, reason });
const toIso = (epoch) => (epoch === null || epoch === undefined ? null : new Date(Number(epoch) * 1000).toISOString());
const whole = (value) => (value === null || value === undefined ? null : Number(value));

// Report rows as the page and the panels show them, with the names of the people who sent them read now. A photo address the page may not link is not
// shown (the row keeps it). The row is shown to the job's crew and to the office in the same shape; `audit` adds where the sender was.
async function shown(execute, rows, { audit = false } = {}) {
  const by = (kind) => rows.filter((row) => row.reporter_kind === kind).map((row) => row.reporter_ref);
  const names = await namesFor(execute, { providers: by('provider'), admins: by('admin'), cleaners: by('cleaner') });
  return rows.map((row) => {
    const report = {
      id: Number(row.id),
      type: row.report_type,
      label: REPORT_TYPES.find((one) => one.code === row.report_type)?.label ?? '',
      note: row.note,
      photo: isShownAddress(row.photo_url) ? row.photo_url : null,
      by: { kind: row.reporter_kind, name: nameOf(names, row.reporter_kind, row.reporter_ref) },
      at: toIso(row.created_epoch),
      seen: row.status !== 'open',
    };
    if (audit) {
      report.away = whole(row.away);
      report.distance_m = whole(row.distance_m);
    }
    return report;
  });
}

export function reportCan(status, canSend, count) {
  return Boolean(canSend) && (status === 'confirmed' || status === 'in_progress') && count < REPORTS_MAX_PER_BOOKING;
}

export async function saveReport({ withConnection, link, access, type, note, bytes, location, clientToken = null }) {
  if (!REPORT_TYPES.some((one) => one.code === type)) return refuse('type');
  const text = typeof note === 'string' ? note.trim() : '';
  const length = [...text].length;
  if (length < 1 || length > REPORT_NOTE_MAX) return refuse('note');
  if (clientToken !== null && clientToken !== undefined && !(typeof clientToken === 'string' && TOKEN.test(clientToken))) return refuse('token');
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return refuse('photo');
  if (bytes.length > PHOTO_MAX_BYTES) return refuse('too_big');
  const kind = sniffImage(bytes);
  const clean = kind === null ? null : stripJpegMetadata(bytes);
  if (clean === null) return refuse('image');
  const token = clientToken ?? null;

  let saved = null;
  try {
    return await withConnection((connection) =>
      inTransaction(connection, async () => {
        const run = executeOn(connection);

        const [booking] = await run('SELECT status, provider_id, latitude, longitude FROM bookings WHERE id = ? FOR UPDATE', [link.booking_id]);
        const live = booking
          ? await run('SELECT id FROM job_links WHERE id = ? AND booking_id = ? AND generation = ? AND off_at IS NULL', [link.id, link.booking_id, link.generation])
          : [];
        if (!booking || live.length === 0 || booking.provider_id === null || !JOB_LINK_OPEN_STATUSES.includes(booking.status)) return refuse('closed');

        const crew = await assignedCrew(run, link.booking_id, { withAssignedAt: true });
        if (!access || !stillAllowed(access, booking, crew)) return refuse('access');

        // A retry of a send that was saved: answered as it was saved, whatever has changed since, and nothing more is written.
        if (token !== null) {
          const again = await run(`SELECT ${REPORT_COLUMNS} FROM job_reports WHERE booking_id = ? AND client_token = ?`, [link.booking_id, token]);
          if (again.length > 0) {
            const [report] = await shown(run, again);
            return { ok: true, report, again: true };
          }
        }

        if (access.kind === 'cleaner') {
          const here = await checkinsFor(run, link.booking_id, crew.filter((member) => !member.removed));
          if (!here.some((tick) => tick.crew_member_id === access.ref)) return refuse('not_here');
        }
        if (booking.status !== 'confirmed' && booking.status !== 'in_progress') return refuse('status');

        const [{ n }] = await run('SELECT COUNT(*) AS n FROM job_reports WHERE booking_id = ?', [link.booking_id]);
        if (Number(n) >= REPORTS_MAX_PER_BOOKING) return refuse('too_many');

        try {
          saved = await savePhoto(clean, kind.ext);
        } catch (error) {
          console.error('Error storing a report photo:', error?.code || error?.name);
          return refuse('store');
        }

        const where = readLocation(location);
        const { distance_m, away } = where.ok ? awayFrom(booking, where) : { distance_m: null, away: null };
        const inserted = await run(
          `INSERT INTO job_reports (booking_id, link_id, report_type, note, photo_url, client_token, reporter_kind, reporter_ref, distance_m, away)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [link.booking_id, link.id, type, text, saved.url, token, access.kind, access.ref, distance_m, away]
        );

        await recordEvent(run, link, {
          kind: 'report_added',
          actor: { kind: access.kind, ref: access.ref },
          crewMemberId: access.kind === 'cleaner' ? access.ref : null,
          location: where.ok ? { latitude: where.latitude, longitude: where.longitude, accuracy_m: where.accuracy_m } : null,
          detail: type,
        });

        const rows = await run(`SELECT ${REPORT_COLUMNS} FROM job_reports WHERE id = ?`, [inserted.insertId]);
        const [report] = await shown(run, rows);
        return { ok: true, report, again: false };
      })
    );
  } catch (error) {
    // The file was written and the transaction did not finish: the row it would have named is not there, so neither should the file be.
    // A remove that fails leaves a file no row names, which the orphan sweep takes after 24 hours; its code alone is logged so that it is known.
    if (saved !== null) await removePhoto(saved.url).catch((error) => console.error('Error removing a report photo whose row was not saved:', error?.code || error?.name));
    throw error;
  }
}

export async function reportsFor(execute, bookingId, { audit = false } = {}) {
  const rows = await execute(
    `SELECT ${REPORT_COLUMNS} FROM job_reports WHERE booking_id = ? ORDER BY id DESC LIMIT ${REPORTS_MAX_PER_BOOKING}`,
    [bookingId]
  );
  return shown(execute, rows, { audit });
}
