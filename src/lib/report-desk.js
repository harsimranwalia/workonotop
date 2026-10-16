// src/lib/report-desk.js
//
// The office's side of the on-site reports (ENG-017 design, Interfaces 4; ADR-015, ADR-016): the queue of reports waiting on an admin, one report with its
// booking, and an admin's decision on it. Only an admin decides, and a decision is on the report's row (who, when, why) and not an event. This is
// admin-facing, so money words are allowed here, and it is the only file that reads or writes a report's decision and charge columns (src/lib/job-reports.js
// is the crew's side and never touches them). Nothing here sends a text, an e-mail or a push: the alert is ENG-018's.
//
// An *Add more items* report is the one that can cost the customer money, and nothing is charged unless an admin approves it. The approval prices the
// items on the server (priceExtras, src/lib/pricing-rules.js) and refuses unless the sum equals the one the admin was shown (`expectedCents`); records
// the approval; and only then, after that commit and outside any connection, takes the charge (collectAddedItems, src/lib/booking-payment.js): a
// PaymentIntent of its own on the card the customer has on file, never part of bookings.service_price, never a change to the booking's payment. The
// id of that PaymentIntent is saved on the report by compare-and-set before it is confirmed, so a crash between the two is a retry of the same intent.
//
// CHARGEABLE_STATUSES -> confirmed, in_progress, awaiting_approval, completed: the booking statuses in which an approval may charge. A booking that is
//   cancelled, disputed, pending or matching is refused ('status').
// DECISION_NOTE_MAX -> 500, the longest note on a decision; pinned to the column.
// REPORT_LIST_LIMIT -> { page: 20, max: 50 }: the queue's page, and the most a caller may ask for.
// DESK_MESSAGES -> the sentences a route sends, by reason in camel case (priceChanged for price_changed ...).
// queueFor(execute, { status, bookingId, before, limit }) -> { reports, open_count, next_before }
//   `status` is 'open' (the reports waiting on the office: status 'open', or status 'approved' whose charge is 'pending' or 'failed') or 'all';
//   `bookingId` narrows to one job; `before` is a report id, the page after it; `limit` defaults to the page and is held between 1 and the max.
//   Newest first by id. `open_count` is the count of the first definition whatever the filter; `next_before` is the last id returned when more remain.
// deskReport(execute, id) -> { id, type, label, status, note, photo, at, by: { kind, name }, away, distance_m, booking: { id, number, service, date, slot,
//   customer }, decision: { by, at, note } | null, added_items: null | { lines, cents, charge, reason, provider_share_cents } } | null
//   `customer` is the name only. `added_items` is null for the four information types; for *Add more items* it is { lines: [], cents: null, charge:
//   'none', reason: null, provider_share_cents: null } until approved. `provider_share_cents` is shown to the admin and paid to no one.
// deskDetail(execute, id) -> { report, catalogue } | null, where `catalogue` is the booking's service's extra items [{ code, label, amount, minutes,
//   quote_from }] (empty when the booking has no service).
// decideReport({ withConnection, execute, stripe, currency, id, admin, action, note, extras, expectedCents }) -> { ok: true, report } | { ok: false,
//   reason, report?, cents? }; action is handle, approve, decline or retry; admin is { id }. reason is one of action, note, not_found, decided, wrong_type,
//   status, extras, quote, price_changed (with cents), below_minimum, too_large, not_configured, unavailable, declined, action_required, no_payment_method,
//   cancelled_by_person, mismatch. `report` comes with decided and with every refusal that follows the approval being recorded.
//   handle   an open report that is not *Add more items* becomes 'handled'. decline: an open report of any type, or an approved one whose charge failed,
//            becomes 'declined'; nothing is sent to Stripe. approve: an open *Add more items* report on a chargeable booking, priced here, becomes
//            'approved' with its charge 'pending' and is then charged. retry: an approved report whose charge is 'failed' or 'pending' is charged again
//            for the lines and cents that were approved, not priced again; the saved PaymentIntent is continued, never a second one.
// cardSourceFor(execute, booking) -> { cardIntentId, card }: the booking's own payment, else its series' first payment when that is this customer's, else the card the
//   customer put on file from a link (src/lib/booking-card.js). None of the three is 'no_payment_method' at the charge.
// providerShareCents(cents, booking) -> whole cents: the sum less the booking's commission, to the cent.
import { collectAddedItems, paymentAmountCents } from './booking-payment.js';
import { cardOnFile } from './booking-card.js';
import { inTransaction } from './booking-crew.js';
import { commissionPercentOf } from './booking-price.js';
import { executeOn, namesFor, nameOf } from './job-link-base.js';
import { REPORT_TYPES } from './job-reports.js';
import { isShownAddress } from './job-photos.js';
import { loadPricing, priceExtras } from './pricing-rules.js';

export const CHARGEABLE_STATUSES = Object.freeze(['confirmed', 'in_progress', 'awaiting_approval', 'completed']);
export const DECISION_NOTE_MAX = 500;
export const REPORT_LIST_LIMIT = Object.freeze({ page: 20, max: 50 });

export const DESK_MESSAGES = Object.freeze({
  action: 'Invalid request.',
  note: `Keep the note to ${DECISION_NOTE_MAX} characters or fewer.`,
  notFound: 'Report not found.',
  decided: 'This report was already decided.',
  wrongType: 'That does not apply to this kind of report.',
  status: 'This job can not be charged in its current status.',
  extras: 'Pick at least one item from this service, each as a whole number.',
  quote: 'That much of an item needs a quote, so it can not be charged here.',
  priceChanged: 'The total changed since you opened this. Check the new total.',
  belowMinimum: 'The total is under $0.50, which a card can not be charged.',
  tooLarge: 'The total is more than a card can be charged.',
  declined: 'The card was declined. Nothing was charged.',
  actionRequired: 'The card needs the customer to confirm it. Nothing was charged.',
  noPaymentMethod: 'There is no card on file for this customer. Nothing was charged.',
  cancelledByPerson: 'The payment the card came from was cancelled. Nothing was charged.',
  mismatch: 'Stripe did not take the charge as asked. Look in Stripe before trying again.',
  unavailable: 'Stripe could not be reached. Try again in a minute.',
  notConfigured: 'Payments are not set up on this server.',
});

const ACTIONS = Object.freeze(['handle', 'approve', 'decline', 'retry']);
const CARD_SIDE = new Set(['declined', 'action_required', 'no_payment_method', 'cancelled_by_person', 'mismatch']);

// A report is waiting on the office until it is decided, and an approved one until its charge is paid.
const WAITING = "(r.status = 'open' OR (r.status = 'approved' AND r.charge_status IN ('pending', 'failed')))";

const DESK_SELECT = `SELECT r.id, r.booking_id, r.report_type, r.note, r.photo_url, r.reporter_kind, r.reporter_ref, r.status, r.distance_m, r.away,
         r.decided_by, r.decision_note, r.approved_lines, r.approved_cents, r.charge_status, r.charge_reason,
         UNIX_TIMESTAMP(r.created_at) AS created_epoch, UNIX_TIMESTAMP(r.decided_at) AS decided_epoch,
         b.booking_number, b.service_name, DATE_FORMAT(b.job_date, '%Y-%m-%d') AS job_date, b.job_time_slot, b.commission_percent,
         b.customer_first_name, b.customer_last_name
  FROM job_reports r JOIN bookings b ON b.id = r.booking_id`;

const refuse = (reason, more = {}) => ({ ok: false, reason, ...more });
const toIso = (epoch) => (epoch === null || epoch === undefined ? null : new Date(Number(epoch) * 1000).toISOString());
const whole = (value) => (value === null || value === undefined ? null : Number(value));
const positive = (value) => Number.isSafeInteger(value) && value > 0;

export function providerShareCents(cents, booking) {
  return Math.round((cents * (100 - commissionPercentOf(booking))) / 100);
}

function linesOf(stored) {
  if (typeof stored !== 'string') return Array.isArray(stored) ? stored : [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // The column is written only by this library, so a value that does not parse is damage: the desk shows no lines and says so in the log.
    console.error('Error reading the approved lines of a report');
    return [];
  }
}

// Desk rows as the queue and the detail show them, with the names of the people read now.
async function shown(execute, rows) {
  const by = (kind) => rows.filter((row) => row.reporter_kind === kind).map((row) => row.reporter_ref);
  const names = await namesFor(execute, {
    providers: by('provider'),
    admins: [...by('admin'), ...rows.map((row) => row.decided_by)],
    cleaners: by('cleaner'),
  });
  return rows.map((row) => {
    const isItems = row.report_type === 'add_items';
    const cents = whole(row.approved_cents);
    return {
      id: Number(row.id),
      type: row.report_type,
      label: REPORT_TYPES.find((one) => one.code === row.report_type)?.label ?? '',
      status: row.status,
      note: row.note,
      photo: isShownAddress(row.photo_url) ? row.photo_url : null,
      at: toIso(row.created_epoch),
      by: { kind: row.reporter_kind, name: nameOf(names, row.reporter_kind, row.reporter_ref) },
      away: whole(row.away),
      distance_m: whole(row.distance_m),
      booking: {
        id: Number(row.booking_id),
        number: row.booking_number,
        service: row.service_name ?? '',
        date: row.job_date,
        slot: row.job_time_slot,
        customer: `${row.customer_first_name ?? ''} ${row.customer_last_name ?? ''}`.trim(),
      },
      decision:
        row.decided_by === null || row.decided_by === undefined
          ? null
          : { by: nameOf(names, 'admin', row.decided_by), at: toIso(row.decided_epoch), note: row.decision_note ?? '' },
      added_items: isItems
        ? {
            lines: linesOf(row.approved_lines),
            cents,
            charge: row.charge_status,
            reason: row.charge_reason ?? null,
            provider_share_cents: cents === null ? null : providerShareCents(cents, row),
          }
        : null,
    };
  });
}

export async function deskReport(execute, id) {
  if (!positive(id)) return null;
  const rows = await execute(`${DESK_SELECT} WHERE r.id = ?`, [id]);
  if (rows.length === 0) return null;
  const [report] = await shown(execute, rows);
  return report;
}

export async function deskDetail(execute, id) {
  const report = await deskReport(execute, id);
  if (!report) return null;
  const [row] = await execute('SELECT service_id FROM bookings WHERE id = ?', [report.booking.id]);
  const { items } = await loadPricing(execute, row ? row.service_id : null);
  const catalogue = items
    .filter((item) => item.kind === 'extra')
    .map((item) => ({ code: item.code, label: item.label, amount: Number(item.amount), minutes: Number(item.minutes), quote_from: whole(item.quote_from) }));
  return { report, catalogue };
}

export async function queueFor(execute, { status = 'open', bookingId = null, before = null, limit = REPORT_LIST_LIMIT.page } = {}) {
  const size = Math.min(Math.max(Number.isSafeInteger(limit) ? limit : REPORT_LIST_LIMIT.page, 1), REPORT_LIST_LIMIT.max);
  const where = [];
  const params = [];
  if (status !== 'all') where.push(WAITING);
  if (positive(bookingId)) {
    where.push('r.booking_id = ?');
    params.push(bookingId);
  }
  if (positive(before)) {
    where.push('r.id < ?');
    params.push(before);
  }
  const rows = await execute(`${DESK_SELECT}${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY r.id DESC LIMIT ${size + 1}`, params);
  const page = rows.slice(0, size);
  const [{ n }] = await execute(`SELECT COUNT(*) AS n FROM job_reports r WHERE ${WAITING}`);
  return {
    reports: await shown(execute, page),
    open_count: Number(n),
    next_before: rows.length > size ? Number(page[page.length - 1].id) : null,
  };
}

export async function cardSourceFor(execute, booking) {
  if (booking.payment_intent_id) return { cardIntentId: booking.payment_intent_id, card: null };
  if (booking.series_visit > 1 && booking.series_id) {
    const [first] = await execute('SELECT payment_intent_id FROM bookings WHERE id = ? AND user_id = ?', [booking.series_id, booking.user_id]);
    if (first && first.payment_intent_id) return { cardIntentId: first.payment_intent_id, card: null };
  }
  return { cardIntentId: null, card: await cardOnFile(execute, booking) };
}

// The report and its booking, as the decisions read them before they lock anything.
async function reportWithBooking(execute, id) {
  const rows = await execute(
    `SELECT r.id, r.booking_id, r.report_type, r.status, r.charge_status, r.charge_intent_id, r.approved_cents,
            b.status AS booking_status, b.service_id, b.payment_intent_id, b.user_id, b.series_id, b.series_visit
     FROM job_reports r JOIN bookings b ON b.id = r.booking_id WHERE r.id = ?`,
    [id]
  );
  return rows[0] ?? null;
}

// The charge for an approved report, taken outside any connection, and what came of it written on the report. A guarded update that changes no row
// means another try finished first: the report is then read and returned as it is.
async function takeCharge({ execute, stripe, currency, report }) {
  const booking = {
    id: report.booking_id,
    user_id: report.user_id,
    payment_intent_id: report.payment_intent_id,
    series_id: report.series_id,
    series_visit: report.series_visit,
  };
  const source = await cardSourceFor(execute, booking);
  const result = await collectAddedItems(
    stripe,
    { id: report.id, booking_id: report.booking_id, cents: Number(report.approved_cents), charge_intent_id: report.charge_intent_id },
    {
      currency,
      ...source,
      saveIntentId: async (newId, oldId) => {
        const saved = await execute('UPDATE job_reports SET charge_intent_id = ? WHERE id = ? AND charge_intent_id <=> ?', [newId, report.id, oldId]);
        return saved.affectedRows > 0;
      },
      readIntentId: async () => {
        const [row] = await execute('SELECT charge_intent_id FROM job_reports WHERE id = ?', [report.id]);
        return row ? row.charge_intent_id : null;
      },
    }
  );

  if (result.ok) {
    await execute(
      "UPDATE job_reports SET charge_status = 'paid', charge_id = ?, charged_at = NOW(), charge_reason = NULL WHERE id = ? AND status = 'approved' AND charge_status = 'pending'",
      [result.chargeId, report.id]
    );
    return { ok: true, report: await deskReport(execute, report.id) };
  }
  // Stripe could not be reached, or there is no client: nothing is known, the report stays pending and a retry is safe.
  if (!CARD_SIDE.has(result.reason)) return refuse(result.reason, { report: await deskReport(execute, report.id) });
  await execute(
    "UPDATE job_reports SET charge_status = 'failed', charge_reason = ? WHERE id = ? AND status = 'approved' AND charge_status = 'pending'",
    [result.reason, report.id]
  );
  return refuse(result.reason, { report: await deskReport(execute, report.id) });
}

// handle and decline: one guarded change under the report's lock.
async function closeReport({ withConnection, id, admin, action, decisionNote }) {
  return withConnection((connection) =>
    inTransaction(connection, async () => {
      const run = executeOn(connection);
      const [report] = await run('SELECT id, report_type, status, charge_status FROM job_reports WHERE id = ? FOR UPDATE', [id]);
      if (!report) return refuse('not_found');
      if (action === 'handle' && report.report_type === 'add_items') return refuse('wrong_type');
      const can =
        action === 'handle'
          ? report.status === 'open'
          : report.status === 'open' || (report.status === 'approved' && report.charge_status === 'failed');
      if (!can) return refuse('decided', { report: await deskReport(run, id) });
      await run("UPDATE job_reports SET status = ?, decided_by = ?, decided_at = NOW(), decision_note = ? WHERE id = ?", [
        action === 'handle' ? 'handled' : 'declined',
        admin.id,
        decisionNote,
        id,
      ]);
      return { ok: true, report: await deskReport(run, id) };
    })
  );
}

export async function decideReport({ withConnection, execute, stripe, currency = 'cad', id, admin, action, note, extras, expectedCents }) {
  if (!ACTIONS.includes(action)) return refuse('action');
  const decisionNote = note === undefined || note === null ? '' : typeof note === 'string' ? note.trim() : null;
  if (decisionNote === null || [...decisionNote].length > DECISION_NOTE_MAX) return refuse('note');
  if (!positive(id)) return refuse('not_found');

  if (action === 'handle' || action === 'decline') return closeReport({ withConnection, id, admin, action, decisionNote });

  const report = await reportWithBooking(execute, id);
  if (!report) return refuse('not_found');
  if (report.report_type !== 'add_items') return refuse('wrong_type');

  if (action === 'retry') {
    if (report.status !== 'approved' || (report.charge_status !== 'failed' && report.charge_status !== 'pending')) {
      return refuse('decided', { report: await deskReport(execute, id) });
    }
    if (!CHARGEABLE_STATUSES.includes(report.booking_status)) return refuse('status', { report: await deskReport(execute, id) });
    if (!stripe) return refuse('not_configured', { report: await deskReport(execute, id) });
    // A failed charge goes back to pending, once: of two retries at once, one moves it and the other finds it already pending and carries on.
    await execute(
      "UPDATE job_reports SET charge_status = 'pending', charge_reason = NULL WHERE id = ? AND status = 'approved' AND charge_status = 'failed'",
      [id]
    );
    const fresh = await reportWithBooking(execute, id);
    if (!fresh || fresh.status !== 'approved' || fresh.charge_status !== 'pending') return refuse('decided', { report: await deskReport(execute, id) });
    return takeCharge({ execute, stripe, currency, report: fresh });
  }

  // approve
  if (report.status !== 'open') return refuse('decided', { report: await deskReport(execute, id) });
  if (!CHARGEABLE_STATUSES.includes(report.booking_status)) return refuse('status');
  // Judged before anything is recorded, so a server with no payment key writes nothing.
  if (!stripe) return refuse('not_configured');

  const { service, items } = await loadPricing(execute, report.service_id);
  if (!service) return refuse('extras');
  const priced = priceExtras(service, items, extras);
  if (!priced.ok) return refuse(priced.reason === 'service' ? 'extras' : priced.reason);
  const bound = paymentAmountCents(priced.cents / 100);
  if (!bound.ok) return refuse(bound.reason);
  if (!Number.isInteger(expectedCents) || expectedCents !== priced.cents) return refuse('price_changed', { cents: priced.cents });

  const recorded = await withConnection((connection) =>
    inTransaction(connection, async () => {
      const run = executeOn(connection);
      const [current] = await run('SELECT status FROM job_reports WHERE id = ? FOR UPDATE', [id]);
      if (!current || current.status !== 'open') return false;
      await run(
        `UPDATE job_reports SET status = 'approved', charge_status = 'pending', approved_lines = ?, approved_cents = ?,
                decided_by = ?, decided_at = NOW(), decision_note = ?
         WHERE id = ?`,
        [JSON.stringify(priced.lines.map(({ code, label, quantity, amount }) => ({ code, label, quantity, amount }))), priced.cents, admin.id, decisionNote, id]
      );
      return true;
    })
  );
  if (!recorded) return refuse('decided', { report: await deskReport(execute, id) });

  const fresh = await reportWithBooking(execute, id);
  return takeCharge({ execute, stripe, currency, report: fresh });
}
