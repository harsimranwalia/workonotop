// src/lib/notice-events.js
//
// Who is told, for each event that has a notice (ENG-018, ADR-018). One function for each kind in NOTICE_KINDS. A route does not read a contact, pick a
// channel or name a transport: after its COMMIT it hands the event its ids, `afterCommit(() => noticeX(execute, { ... }))`, and the event reads the rows,
// works out who is told by the rules below and calls sendNotice (src/lib/notices.js) once for each person. That is what keeps the rules in one place: a
// route that forgot them has nothing to forget.
//
// THE RULES (design, Approach 5):
//   customer  the BOOKING ROW's own customer_email and customer_phone (what was typed for this booking) and never the account's: an anonymous booking
//             POST honours a user_id from its body (ENG-004's residual R1), so an account's contact is not proof of who asked, and a booking with no
//             account (user_id NULL) is reached all the same. The recipient's `ref` is the booking's user_id (NULL for a guest): a pointer in the
//             record, not a contact.
//   provider  service_providers.email and .phone, and only while status = 'active' (sendNotice refuses the rest as not_active, by text and e-mail).
//   cleaner   a crew member's phone, and only a CHECKED number (isNumberChecked): sendNotice refuses the rest as unchecked or cannot_text. A cleaner has
//             no e-mail address on file, so a cleaner is only ever texted.
//   admin     every users row with role = 'admin' (their own e-mail and phone) and ADMIN_EMAIL when it is set, de-duplicated by lower-cased address.
//
// Every function is (execute, values, deps = {}) and answers an array with one entry for each person asked, { to, ref, sms, email }, the two being
// what sendNotice answered for that person (an outcome in NOTICE_OUTCOMES, 'duplicate', or null for a channel not asked). An empty array is "nobody to
// tell": a row that is not there, a link that is off, a job that is not open. None of them throws: whatever goes wrong is one 'Notice error: {code}'
// line (no number, address, name, body or link in it) and an empty array, so a route's response cannot be changed by a notice. Pass the pool's
// `execute` (src/lib/db.js), never a transaction's connection, and call after the COMMIT.
//   deps  { sendSMS, sendMail, appOrigin, env }: the first three go to sendNotice (a spec that records instead of sending); `env` is where ADMIN_EMAIL is
//         read (default process.env).
//
// noticeQuoteRequested(execute, { quoteRequestId })            the quote form: the customer by e-mail, and by text if a phone was typed (2 a day a number)
// noticeCardLink(execute, { bookingId, token })                an admin's on-behalf booking: the customer, the quote and /card/{token}. `token` is the raw
//                                                              token the route made, the one value that is not in a table (the table holds its hash)
// noticeBooked(execute, { bookingId, visits? })                a booking: the customer. A series is ONE notice, given the first visit's id
// noticeAssigned(execute, { bookingId, providerId })           the provider put on a job. Nothing is sent unless the booking is that provider's now
// noticeClaimed(execute, { bookingId, providerId })            a claim or an accept: the customer and the claimer. Same condition as noticeAssigned
// noticeJobLink(execute, { bookingId, memberIds? })            a job link: each cleaner on the crew now (or only memberIds), if the link is on, the job is
//                                                              open and the owning provider is active. The key holds the link's generation and the
//                                                              member's assigned_epoch, so it is sent once, again after a reissue and again for a member
//                                                              put on again
// noticeJobLinksOfMember(execute, { memberId })                a number that has just passed its check: noticeJobLink for each open job the member is on
//                                                              that has a link on
// noticeReport(execute, { reportId })                          an on-site report: the owning provider and each admin, never the sender, never the note
// noticeJobStarted(execute, { bookingId, startEpoch, workers, hours })   the customer, by text, for this start of the job (startEpoch, the second it
//                                                              began, makes a restart another notice); workers and hours are what the route parsed
// noticeJobFinished(execute, { bookingId })                    the customer. A booking with no account is a guest, who cannot approve, and is told the
//                                                              card on file is charged after AUTO_RELEASE_HOURS
// NOTICE_EVENTS -> kind -> function, frozen. e2e/notices-events.spec.js pins its keys equal to NOTICE_KINDS.
import { sendNotice } from './notices.js';
import { cleanLine } from './notice-templates.js';
import { assignedCrew } from './booking-crew.js';
import { isNumberChecked } from './crew-number-check.js';
import { JOB_LINK_OPEN_STATUSES } from './job-link-base.js';
import { REPORT_TYPES } from './job-reports.js';
import { LINK_TOKEN_PATTERN } from './link-token.js';
import { AUTO_RELEASE_HOURS } from './auto-release.js';

// Where an e-mail sends a provider and an admin. A text never carries a link of these (it says "Open the app", "Open Job Requests").
const PROVIDER_JOBS_PATH = '/provider/jobs';
const ADMIN_JOBS_PATH = '/admin/jobs';
// The most open jobs one number check texts about: a provider's crew is small, and a bound is a bound.
const MEMBER_JOBS_MAX = 50;
const VISITS_MAX = 400;

const codeOf = (error) => error?.code || error?.name || 'unknown';
const fail = (code) => Object.assign(new Error(code), { code });
const isId = (value) => Number.isSafeInteger(value) && value > 0;
const idOrNull = (value) => (isId(value) ? value : null);
const textOf = (value) => (typeof value === 'string' ? value : '');
// The first word of a typed name, cleaned: a greeting says "Hi Rhea," and not a whole line a stranger typed.
const firstName = (name) => cleanLine(name).split(' ')[0];
// A DECIMAL arrives from mysql2 as a string. What is not a number stays one that templateFor refuses.
const dollarsOf = (value) => (value === null || value === undefined ? Number.NaN : Number(value));

async function guarded(work) {
  try {
    return await work();
  } catch (error) {
    console.error(`Notice error: ${codeOf(error)}`);
    return [];
  }
}

// One notice for each of `who` ({ to, channels, values, path?, spendFor }), under `base` ({ kind, subject, bookingId }).
async function tell(execute, deps, base, who) {
  const told = [];
  for (const one of who) {
    const answer = await sendNotice(execute, { ...base, ...one }, deps);
    told.push({ to: one.to.kind, ref: one.to.ref ?? null, sms: answer.sms, email: answer.email });
  }
  return told;
}

// ---- the rows -------------------------------------------------------------------------------------------------------------------------------

const BOOKING_COLUMNS = `id, user_id, provider_id, booking_number, service_name, service_price, status,
  customer_first_name, customer_email, customer_phone, DATE_FORMAT(job_date, '%Y-%m-%d') AS job_day, job_time_slot`;

async function bookingOf(execute, bookingId) {
  if (!isId(bookingId)) throw fail('bad_notice_request');
  const rows = await execute(`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = ?`, [bookingId]);
  return rows[0] ?? null;
}

// The facts a message about a job may carry, whoever reads it. The customer's name is added only for the customer.
const factsOf = (booking) => ({ n: booking.booking_number, service: booking.service_name ?? undefined, date: booking.job_day, slot: booking.job_time_slot });
const customerValues = (booking) => ({ ...factsOf(booking), name: firstName(booking.customer_first_name) });

const customerOf = (booking) => ({
  kind: 'customer',
  ref: idOrNull(booking.user_id),
  phone: textOf(booking.customer_phone),
  email: textOf(booking.customer_email),
});

async function providerOf(execute, providerId) {
  if (!isId(providerId)) return null;
  const rows = await execute('SELECT id, email, phone, status FROM service_providers WHERE id = ?', [providerId]);
  const row = rows[0];
  return row ? { kind: 'provider', ref: row.id, phone: textOf(row.phone), email: textOf(row.email), active: row.status === 'active' } : null;
}

// The admin team: each admin user and ADMIN_EMAIL, one entry for each lower-cased address. The user's row comes first, so an address that is both
// keeps its id and its phone.
async function adminTeam(execute, env) {
  const rows = await execute("SELECT id, email, phone FROM users WHERE role = 'admin' ORDER BY id");
  const team = [];
  const seen = new Set();
  const add = (to) => {
    const marker = to.email.trim().toLowerCase();
    const mark = marker === '' ? `ref:${to.ref}` : marker;
    if (seen.has(mark)) return;
    seen.add(mark);
    team.push(to);
  };
  for (const row of rows) add({ kind: 'admin', ref: row.id, phone: textOf(row.phone), email: textOf(row.email) });
  const extra = textOf(env?.ADMIN_EMAIL).trim();
  if (extra !== '') add({ kind: 'admin', ref: null, phone: '', email: extra });
  return team;
}

// The booking's provider must still be the one the event is about: a notice that an assignment or a claim stands is not sent after it was undone.
const holds = (booking, provider) => booking !== null && provider !== null && booking.provider_id === provider.ref;

// ---- the events -----------------------------------------------------------------------------------------------------------------------------

export function noticeQuoteRequested(execute, { quoteRequestId } = {}, deps = {}) {
  return guarded(async () => {
    if (!isId(quoteRequestId)) throw fail('bad_notice_request');
    const rows = await execute('SELECT id, user_id, service_name, customer_name, customer_email, customer_phone FROM quote_requests WHERE id = ?', [quoteRequestId]);
    const row = rows[0];
    if (!row) return [];
    // The phone is optional on the form: with none typed there is no text to refuse, so no row says so.
    const typed = textOf(row.customer_phone).trim() !== '';
    return tell(execute, deps, { kind: 'quote_requested', subject: [row.id], bookingId: null }, [{
      to: { kind: 'customer', ref: idOrNull(row.user_id), phone: textOf(row.customer_phone), email: textOf(row.customer_email) },
      channels: typed ? ['sms', 'email'] : ['email'],
      values: { name: firstName(row.customer_name), service: row.service_name },
      spendFor: null,
    }]);
  });
}

export function noticeCardLink(execute, { bookingId, token } = {}, deps = {}) {
  return guarded(async () => {
    // The token goes into the link and nowhere else: it is checked here, and no message or log line holds it.
    if (typeof token !== 'string' || !LINK_TOKEN_PATTERN.test(token)) throw fail('bad_notice_value');
    const booking = await bookingOf(execute, bookingId);
    if (booking === null) return [];
    return tell(execute, deps, { kind: 'card_link', subject: [booking.id], bookingId: booking.id }, [{
      to: customerOf(booking),
      channels: ['sms', 'email'],
      values: { ...customerValues(booking), price: dollarsOf(booking.service_price) },
      path: `/card/${token}`,
      spendFor: null,
    }]);
  });
}

export function noticeBooked(execute, { bookingId, visits } = {}, deps = {}) {
  return guarded(async () => {
    const booking = await bookingOf(execute, bookingId);
    if (booking === null) return [];
    return tell(execute, deps, { kind: 'job_booked', subject: [booking.id], bookingId: booking.id }, [{
      to: customerOf(booking),
      channels: ['sms', 'email'],
      values: { ...customerValues(booking), visits: Number.isInteger(visits) && visits >= 1 && visits <= VISITS_MAX ? visits : undefined },
      spendFor: null,
    }]);
  });
}

export function noticeAssigned(execute, { bookingId, providerId } = {}, deps = {}) {
  return guarded(async () => {
    const booking = await bookingOf(execute, bookingId);
    const provider = await providerOf(execute, providerId);
    if (!holds(booking, provider)) return [];
    return tell(execute, deps, { kind: 'job_assigned', subject: [booking.id, provider.ref], bookingId: booking.id }, [{
      to: provider,
      channels: ['sms', 'email'],
      values: factsOf(booking),
      path: PROVIDER_JOBS_PATH,
      spendFor: null,
    }]);
  });
}

export function noticeClaimed(execute, { bookingId, providerId } = {}, deps = {}) {
  return guarded(async () => {
    const booking = await bookingOf(execute, bookingId);
    const provider = await providerOf(execute, providerId);
    if (!holds(booking, provider)) return [];
    // The claim is the provider's own action, so both texts count against the provider's day (spendFor): a provider cannot be made to spend more by anyone else.
    return tell(execute, deps, { kind: 'job_claimed', subject: [booking.id, provider.ref], bookingId: booking.id }, [
      { to: customerOf(booking), channels: ['sms', 'email'], values: { audience: 'customer', ...customerValues(booking) }, spendFor: provider.ref },
      { to: provider, channels: ['sms', 'email'], values: { audience: 'provider', ...factsOf(booking) }, path: PROVIDER_JOBS_PATH, spendFor: provider.ref },
    ]);
  });
}

export function noticeJobLink(execute, { bookingId, memberIds = null } = {}, deps = {}) {
  return guarded(async () => {
    if (memberIds !== null && !(Array.isArray(memberIds) && memberIds.every(isId))) throw fail('bad_notice_request');
    const booking = await bookingOf(execute, bookingId);
    if (booking === null || !isId(booking.provider_id) || !JOB_LINK_OPEN_STATUSES.includes(booking.status)) return [];
    const links = await execute('SELECT id, token, generation FROM job_links WHERE booking_id = ? AND off_at IS NULL', [booking.id]);
    const link = links[0];
    if (!link) return [];
    if (typeof link.token !== 'string' || !LINK_TOKEN_PATTERN.test(link.token)) throw fail('bad_notice_value');
    // The job's owner must be an active provider, and the text counts against the owner's day however the link came to be sent (a crew save, a check).
    const owner = await providerOf(execute, booking.provider_id);
    if (owner === null || !owner.active) return [];

    const crew = (await assignedCrew(execute, booking.id, { withAssignedAt: true })).filter((member) => !member.removed && (memberIds === null || memberIds.includes(member.id)));
    const told = [];
    for (const member of crew) {
      const checked = await isNumberChecked(execute, member);
      told.push(...await tell(execute, deps, { kind: 'job_link', subject: [link.id, link.generation, member.id, member.assigned_epoch], bookingId: booking.id }, [{
        to: { kind: 'cleaner', ref: member.id, phone: textOf(member.phone), email: '', checked },
        channels: ['sms'],
        values: { n: booking.booking_number },
        path: `/job/${link.token}`,
        spendFor: owner.ref,
      }]));
    }
    return told;
  });
}

export function noticeJobLinksOfMember(execute, { memberId } = {}, deps = {}) {
  return guarded(async () => {
    if (!isId(memberId)) throw fail('bad_notice_request');
    const marks = JOB_LINK_OPEN_STATUSES.map(() => '?').join(', ');
    const jobs = await execute(
      `SELECT DISTINCT b.id
       FROM booking_crew bc
       JOIN provider_crew_members m ON m.id = bc.crew_member_id AND m.removed_at IS NULL
       JOIN bookings b ON b.id = bc.booking_id AND b.provider_id = m.provider_id
       JOIN job_links l ON l.booking_id = b.id AND l.off_at IS NULL
       WHERE bc.crew_member_id = ? AND b.status IN (${marks})
       ORDER BY b.id
       LIMIT ${MEMBER_JOBS_MAX}`,
      [memberId, ...JOB_LINK_OPEN_STATUSES]
    );
    const told = [];
    for (const job of jobs) told.push(...await noticeJobLink(execute, { bookingId: job.id, memberIds: [memberId] }, deps));
    return told;
  });
}

export function noticeReport(execute, { reportId } = {}, deps = {}) {
  return guarded(async () => {
    if (!isId(reportId)) throw fail('bad_notice_request');
    const reports = await execute('SELECT id, booking_id, report_type, reporter_kind, reporter_ref FROM job_reports WHERE id = ?', [reportId]);
    const report = reports[0];
    if (!report) return [];
    // The only words about the report are the fixed label of its type. The note and the photo address are never read.
    const label = REPORT_TYPES.find((one) => one.code === report.report_type)?.label;
    if (label === undefined) throw fail('bad_notice_value');
    const booking = await bookingOf(execute, report.booking_id);
    if (booking === null) return [];

    const values = { n: booking.booking_number, label };
    const who = [];
    // A report is not texted back to whoever sent it: a provider or an admin who sent it is skipped, and a cleaner's report tells both.
    const owner = await providerOf(execute, booking.provider_id);
    if (owner !== null && !(report.reporter_kind === 'provider' && report.reporter_ref === owner.ref)) {
      who.push({ to: owner, channels: ['sms', 'email'], values, path: PROVIDER_JOBS_PATH, spendFor: owner.ref });
    }
    for (const admin of await adminTeam(execute, deps.env ?? process.env)) {
      if (report.reporter_kind === 'admin' && admin.ref !== null && report.reporter_ref === admin.ref) continue;
      who.push({ to: admin, channels: ['sms', 'email'], values, path: ADMIN_JOBS_PATH, spendFor: owner?.ref ?? null });
    }
    return tell(execute, deps, { kind: 'report_added', subject: [report.id], bookingId: booking.id }, who);
  });
}

export function noticeJobStarted(execute, { bookingId, startEpoch, workers, hours } = {}, deps = {}) {
  return guarded(async () => {
    if (!Number.isSafeInteger(startEpoch) || startEpoch <= 0) throw fail('bad_notice_request');
    const booking = await bookingOf(execute, bookingId);
    if (booking === null) return [];
    // The start is the provider's action: the text counts against the provider's day. The customer of a start is told by text only; the job's start has
    // no e-mail, as it has none today.
    return tell(execute, deps, { kind: 'job_started', subject: [booking.id, startEpoch], bookingId: booking.id }, [{
      to: customerOf(booking),
      channels: ['sms'],
      values: { n: booking.booking_number, workers, hours, price: dollarsOf(booking.service_price) },
      spendFor: idOrNull(booking.provider_id),
    }]);
  });
}

export function noticeJobFinished(execute, { bookingId } = {}, deps = {}) {
  return guarded(async () => {
    const booking = await bookingOf(execute, bookingId);
    if (booking === null) return [];
    // A booking with no account is a guest: it cannot approve (the approve route is the signed-in owner's), and the sweep charges its card after its own
    // window, so that is what it is told. No price is named: the final price is not settled until the sweep or the customer closes the job.
    return tell(execute, deps, { kind: 'job_finished', subject: [booking.id], bookingId: booking.id }, [{
      to: customerOf(booking),
      channels: ['sms', 'email'],
      values: { n: booking.booking_number, name: firstName(booking.customer_first_name), service: booking.service_name ?? undefined, guest: !isId(booking.user_id), hours: AUTO_RELEASE_HOURS },
      spendFor: idOrNull(booking.provider_id),
    }]);
  });
}

export const NOTICE_EVENTS = Object.freeze({
  quote_requested: noticeQuoteRequested,
  card_link: noticeCardLink,
  job_booked: noticeBooked,
  job_assigned: noticeAssigned,
  job_claimed: noticeClaimed,
  job_link: noticeJobLink,
  report_added: noticeReport,
  job_started: noticeJobStarted,
  job_finished: noticeJobFinished,
});
