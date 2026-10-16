'use client';

// The "On-site reports" section of the admin jobs page (ENG-017): the reports people on site sent from the job link that are waiting on the office, newest
// first, 20 at a time. It asks again every QUEUE_POLL_SECONDS while the tab is visible and when the tab comes back to the front, so a report is on an open page
// within one poll (the text to the admin team is ENG-018's). Four of the five reports are information, and the admin marks them handled. "Add more items" opens
// a dialog where the admin chooses extras from the booking's price list and charges the customer's card on file; the server prices the extras and refuses a total
// that is not the one shown (price_changed), so the sum drawn here is for the admin to read and the server's is the one that decides. With nothing waiting
// the section shows nothing, but a load that fails is always shown, because a quiet failure would hide a report from the team.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { OFFLINE_TEXT, SEND_TIMEOUT_MS, callApi, dataOf, isObject, postJson, reportOf, reportPlaceOf, stampOf, textOf } from '@/components/job/jobLinkKit';

export const QUEUE_POLL_SECONDS = 30;
// How many reports each call asks for, and the most the route answers to one call.
const PAGE_SIZE = 20;
const PAGE_MAX = 50;
const DECISION_NOTE_MAX = 500;
const QUANTITY_MAX = 99;
// The least a card can be charged; the server judges it too (below_minimum), this is only so the button says why it is off.
const MIN_CHARGE_CENTS = 50;

const STATUSES = ['open', 'handled', 'approved', 'declined'];
const CHARGES = ['none', 'pending', 'paid', 'failed'];

const LOAD_FAILED_TEXT = 'Reports could not be loaded. Try again.';
const MORE_FAILED_TEXT = "Couldn't load more reports.";
const NOTHING_TEXT = 'No reports to show.';
const PHOTO_GONE_TEXT = 'The photo has been removed.';
const DECIDE_FAILED_TEXT = "Couldn't save that. Check the report and try again.";
const CATALOGUE_FAILED_TEXT = 'The price list could not be loaded. Try again.';
const NO_ITEMS_TEXT = "This job's service has no extra items that can be charged here.";
const QUOTE_TEXT = 'Needs a quote — not chargeable here';
const MOST_TEXT = `The most that can be added is ${QUANTITY_MAX}.`;
const NO_TOTAL_TEXT = 'Choose at least one item to charge.';
const LOW_TOTAL_TEXT = 'The total must be at least $0.50 to be charged.';
const SHARE_TEXT = "The provider is not paid for these items by this action.";
const PENDING_TEXT = 'Charge not finished — try again';
const CHARGE_FAILED_TEXT = {
  declined: 'The card was declined. Nothing was charged.',
  action_required: 'The card needs the customer to confirm it. Nothing was charged.',
  no_payment_method: 'No card is on file for this customer. Nothing was charged.',
  cancelled_by_person: 'The payment the card came from was cancelled. Nothing was charged.',
  mismatch: 'The charge could not be confirmed. Check Stripe before trying again.',
};
const CHARGE_FAILED_OTHER_TEXT = 'The charge did not go through. Check Stripe before trying again.';

const ringOf = (dark) => `focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${dark ? 'focus-visible:ring-teal-400 focus-visible:ring-offset-slate-950' : 'focus-visible:ring-teal-600 focus-visible:ring-offset-white'}`;

const moneyOf = (cents) => `$${(cents / 100).toFixed(2)}`;

// A price as whole cents: dollars as a number or as text ("25.00"); null for anything else.
function centsOf(value) {
  const dollars = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof dollars === 'number' && Number.isFinite(dollars) && dollars >= 0 ? Math.round(dollars * 100) : null;
}

function lineOf(line) {
  return { label: textOf(line.label) || textOf(line.code), quantity: Number.isInteger(line.quantity) ? line.quantity : 0, cents: centsOf(line.amount) };
}

// A report as the desk sends it (src/lib/report-desk.js): the link-facing parts, the booking it is about, the decision and the charge. Null when the answer
// is not that shape, so a report that cannot be read fails the load and is not left out of a list that looks complete.
function deskOf(value) {
  const base = reportOf(value);
  if (!base || !isObject(value.booking) || !Number.isInteger(value.booking.id) || !STATUSES.includes(value.status)) return null;
  const { booking } = value;
  const decision = isObject(value.decision) ? value.decision : null;
  const items = isObject(value.added_items) ? value.added_items : null;
  return {
    ...base,
    status: value.status,
    booking: {
      id: booking.id,
      number: textOf(booking.number),
      service: textOf(booking.service),
      date: textOf(booking.date),
      slot: textOf(booking.slot),
      customer: textOf(booking.customer),
    },
    decision: decision ? { by: textOf(decision.by), at: textOf(decision.at), note: textOf(decision.note) } : null,
    items: items
      ? {
          lines: Array.isArray(items.lines) ? items.lines.filter(isObject).map(lineOf) : [],
          cents: Number.isInteger(items.cents) ? items.cents : null,
          charge: CHARGES.includes(items.charge) ? items.charge : 'none',
          reason: textOf(items.reason),
          shareCents: Number.isInteger(items.provider_share_cents) ? items.provider_share_cents : null,
        }
      : null,
  };
}

// A page of the queue, or null when the answer is not the one the route promises.
function pageOf(result) {
  const data = dataOf(result);
  if (!data || !Array.isArray(data.reports) || !Number.isInteger(data.open_count)) return null;
  const reports = data.reports.map(deskOf);
  const nextBefore = data.next_before === null ? null : Number.isInteger(data.next_before) ? data.next_before : undefined;
  return reports.includes(null) || nextBefore === undefined ? null : { reports, openCount: data.open_count, nextBefore };
}

// The booking's extra items from the detail's price list, or null when any row cannot be read: a partial list would give a total nobody should trust.
function catalogueOf(value) {
  if (!Array.isArray(value)) return null;
  const items = value.map((one) => {
    const cents = isObject(one) ? centsOf(one.amount) : null;
    const quoteFrom = isObject(one) && Number.isInteger(one.quote_from) && one.quote_from >= 1 ? one.quote_from : null;
    return cents === null || textOf(one.code) === '' ? null : { code: one.code, label: textOf(one.label) || one.code, cents, quoteFrom };
  });
  return items.includes(null) ? null : items;
}

// A report is waiting on the office until it is decided, and an approved one until its charge is paid (the same rule as the server's open_count).
const waiting = (report) => report.status === 'open' || (report.status === 'approved' && report.items !== null && report.items.charge !== 'paid');

function statusOf(report) {
  if (report.status === 'open') return 'Waiting';
  if (report.status === 'handled') return 'Handled';
  if (report.status === 'declined') return 'Declined';
  const charge = report.items ? report.items.charge : 'none';
  return charge === 'paid' ? 'Charged' : charge === 'failed' ? 'Charge failed' : 'Charge not finished';
}

// What a decision's answer comes to. `report` is the report as it now stands when the answer carries one (a decision, "already decided", and a refusal that
// follows an approval being recorded), `done` is whether the decision was taken, `text` is what to tell the admin and `cents` is the server's sum when the
// total the admin was shown is not the one it prices.
function answerOf(result) {
  const data = dataOf(result);
  const report = deskOf(data ? data.report : result.body.report);
  if (data) return report ? { done: true, report, text: '', cents: null } : { done: false, report: null, text: DECIDE_FAILED_TEXT, cents: null };
  if (result.status === 0) return { done: false, report: null, text: OFFLINE_TEXT, cents: null };
  const said = textOf(result.body.message).trim();
  const shown = result.status < 500 || result.status === 503 ? said : '';
  return { done: false, report, text: shown || DECIDE_FAILED_TEXT, cents: Number.isInteger(result.body.cents) ? result.body.cents : null };
}

function Button({ onClick, off = false, describedBy, secondary = false, dark, children }) {
  const look = secondary
    ? dark ? 'border border-slate-600 text-slate-200 hover:bg-slate-800' : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
    : 'bg-teal-700 hover:bg-teal-800 text-white';
  return (
    <button
      type="button"
      aria-disabled={off || undefined}
      aria-describedby={off ? describedBy : undefined}
      onClick={() => { if (!off) onClick(); }}
      className={`min-h-[44px] px-4 rounded-xl text-sm font-semibold transition-colors aria-disabled:opacity-50 aria-disabled:cursor-not-allowed ${look} ${ringOf(dark)}`}
    >
      {children}
    </button>
  );
}

function NoteField({ id, value, onChange, off, dark }) {
  return (
    <div className="mt-3">
      <label htmlFor={id} className={`block text-sm font-semibold ${dark ? 'text-slate-200' : 'text-slate-700'}`}>Note for the record (optional)</label>
      <input
        id={id}
        type="text"
        value={value}
        maxLength={DECISION_NOTE_MAX}
        readOnly={off}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-1 w-full min-h-[44px] rounded-xl border px-3 text-sm ${dark ? 'bg-slate-950 border-slate-600 text-white' : 'bg-white border-slate-300 text-slate-900'} ${ringOf(dark)}`}
      />
    </div>
  );
}

function Photo({ report, dark }) {
  if (!report.photo) return <p className={`text-sm ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{PHOTO_GONE_TEXT}</p>;
  return (
    <a href={report.photo} target="_blank" rel="noopener noreferrer" className={`inline-block rounded-lg ${ringOf(dark)}`}>
      <img src={report.photo} alt={`Photo sent with the report: ${report.label}`} width="96" height="96" loading="lazy" decoding="async"
        className={`h-24 w-24 rounded-lg border object-cover ${dark ? 'border-slate-700' : 'border-slate-300'}`} />
    </a>
  );
}

// The extras of an add-more-items report, chosen from the booking's price list. Nothing is charged until the charge button is used; the sum drawn here is
// worked out from the list's unit prices and is sent as `expected_cents`, so a list that changed since it was loaded is refused by the server and shown again.
function ItemsDialog({ report, dark, onClose, onUpdate, onSay }) {
  const dialog = useRef(null);
  const titleRef = useRef(null);
  const busyNow = useRef(false);
  const titleId = useId();
  const noteId = useId();
  const reasonId = useId();
  const [attempt, setAttempt] = useState(0);
  const [detail, setDetail] = useState({ status: 'loading' });
  const [quantities, setQuantities] = useState({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  const [serverTotal, setServerTotal] = useState(null);

  // The effect runs twice in development (React's strict mode mounts, cleans up and mounts again). Closing the dialog in the clean-up would raise a late "close"
  // event on the listener the second run has added, and the card would drop the dialog it had just opened; so the clean-up only removes the listener, and a
  // dialog that is already open is not opened again.
  useEffect(() => {
    const element = dialog.current;
    if (!element.open) element.showModal();
    titleRef.current?.focus();
    const closed = () => onClose();
    element.addEventListener('close', closed);
    return () => element.removeEventListener('close', closed);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    callApi(`/api/admin/reports/${report.id}`, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      const data = dataOf(result);
      const catalogue = data ? catalogueOf(data.catalogue) : null;
      const current = data ? deskOf(data.report) : null;
      // A read after a price change that fails keeps the list on screen, so the server's total can be read and charged.
      setDetail((held) => (catalogue && current ? { status: 'ready', catalogue, report: current } : held.status === 'ready' ? held : { status: 'failed' }));
    });
    return () => controller.abort();
  }, [report.id, attempt]);

  // The Close a keyboard user may be standing on while the list loads is not the one that stays when it lands (the list brings its own), and the focus would fall to
  // the page behind the dialog; it goes back to the heading, where the dialog put it when it opened. A layout effect, so that nothing runs between the swap and the move.
  useLayoutEffect(() => {
    if (!dialog.current?.contains(document.activeElement)) titleRef.current?.focus();
  }, [detail.status]);

  const ready = detail.status === 'ready';
  const catalogue = ready ? detail.catalogue : [];
  const stillOpen = ready ? detail.report.status === 'open' : true;
  const maxOf = (item) => Math.min(QUANTITY_MAX, item.quoteFrom === null ? QUANTITY_MAX : item.quoteFrom - 1);
  const quantityOf = (item) => Math.min(quantities[item.code] ?? 0, maxOf(item));
  const worked = catalogue.reduce((sum, item) => sum + quantityOf(item) * item.cents, 0);
  const total = serverTotal ?? worked;
  const canCharge = ready && stillOpen && total >= MIN_CHARGE_CENTS;
  const reason = !stillOpen ? '' : total === 0 ? NO_TOTAL_TEXT : LOW_TOTAL_TEXT;

  const change = (item, step) => {
    if (busy) return;
    setQuantities((held) => ({ ...held, [item.code]: Math.max(0, Math.min(maxOf(item), (held[item.code] ?? 0) + step)) }));
    setServerTotal(null);
    setNotice('');
    setProblem('');
  };

  const decide = async (body) => {
    if (busyNow.current) return;
    busyNow.current = true;
    setBusy(true);
    setProblem('');
    const text = note.trim();
    const result = await postJson(`/api/admin/reports/${report.id}`, { ...body, ...(text ? { note: text } : {}) });
    busyNow.current = false;
    setBusy(false);
    const answer = answerOf(result);
    if (answer.report) {
      // The card shows the result (charged, declined, failed with the reason, or what the other admin did), so the dialog's work is over.
      onUpdate(answer.report);
      onSay(answer.done ? 'Saved' : answer.text);
      dialog.current?.close();
      return;
    }
    if (answer.cents !== null && result.status === 409) {
      setServerTotal(answer.cents);
      setNotice(`The price list changed since you opened this. The total is now ${moneyOf(answer.cents)}. Check it, then charge.`);
      setAttempt((n) => n + 1);
      return;
    }
    setProblem(answer.text);
  };

  const charge = () => {
    const extras = catalogue.map((item) => ({ code: item.code, quantity: quantityOf(item) })).filter((one) => one.quantity > 0);
    decide({ action: 'approve', extras, expected_cents: total });
  };

  const text = dark ? 'text-white' : 'text-slate-900';
  const muted = dark ? 'text-slate-400' : 'text-slate-600';

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => { if (busyNow.current) event.preventDefault(); }}
      className={`m-auto w-[calc(100vw-1.5rem)] max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border p-0 backdrop:bg-black/60 ${dark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'}`}
    >
      <div className="p-5">
        <h2 id={titleId} ref={titleRef} tabIndex={-1} className={`text-lg font-bold focus:outline-none ${text}`}>Add more items</h2>
        <p className={`mt-1 text-sm ${muted}`}>
          {`#${report.booking.number} · ${report.booking.service}`}{report.booking.customer ? ` · ${report.booking.customer}` : ''}
        </p>

        <div className="mt-3 flex items-start gap-3">
          <Photo report={report} dark={dark} />
          <p className={`min-w-0 text-sm whitespace-pre-wrap break-words ${dark ? 'text-slate-200' : 'text-slate-700'}`}>{report.note}</p>
        </div>

        {detail.status === 'loading' && <p role="status" className={`mt-5 text-sm ${muted}`}>Loading the price list...</p>}
        {detail.status === 'failed' && (
          <div className="mt-5">
            <p role="alert" className={`text-sm font-medium ${dark ? 'text-red-300' : 'text-red-700'}`}>{CATALOGUE_FAILED_TEXT}</p>
            <div className="mt-2"><Button secondary dark={dark} onClick={() => { setDetail({ status: 'loading' }); setAttempt((n) => n + 1); }}>Try again</Button></div>
          </div>
        )}

        {ready && !stillOpen && <p role="status" className={`mt-5 text-sm font-medium ${text}`}>This report was already decided. Close this to see what was done.</p>}
        {ready && stillOpen && catalogue.length === 0 && <p className={`mt-5 text-sm ${muted}`}>{NO_ITEMS_TEXT}</p>}

        {ready && stillOpen && catalogue.length > 0 && (
          <ul className={`mt-4 divide-y ${dark ? 'divide-slate-800' : 'divide-slate-200'}`}>
            {catalogue.map((item) => {
              const quantity = quantityOf(item);
              const atMax = quantity >= maxOf(item);
              return (
                <li key={item.code} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className={`min-w-0 text-sm font-semibold break-words ${text}`}>{`${item.label} — ${moneyOf(item.cents)} each`}</p>
                    <div role="group" aria-label={item.label} className="flex shrink-0 items-center gap-1">
                      <button type="button" aria-label={`One fewer ${item.label}`} aria-disabled={quantity === 0 || busy || undefined} onClick={() => change(item, -1)}
                        className={`h-11 w-11 rounded-xl border text-lg font-semibold aria-disabled:opacity-50 aria-disabled:cursor-not-allowed ${dark ? 'border-slate-600 text-slate-200' : 'border-slate-300 text-slate-700'} ${ringOf(dark)}`}>−</button>
                      <span className={`w-10 text-center text-base font-semibold ${text}`}>{quantity}</span>
                      <button type="button" aria-label={`One more ${item.label}`} aria-disabled={atMax || busy || undefined} onClick={() => change(item, 1)}
                        className={`h-11 w-11 rounded-xl border text-lg font-semibold aria-disabled:opacity-50 aria-disabled:cursor-not-allowed ${dark ? 'border-slate-600 text-slate-200' : 'border-slate-300 text-slate-700'} ${ringOf(dark)}`}>+</button>
                    </div>
                  </div>
                  {atMax && <p className={`mt-1 text-sm font-medium ${dark ? 'text-amber-300' : 'text-amber-800'}`}>{item.quoteFrom !== null && maxOf(item) === item.quoteFrom - 1 ? QUOTE_TEXT : MOST_TEXT}</p>}
                </li>
              );
            })}
          </ul>
        )}

        {ready && stillOpen && (
          <>
            <p role="status" className={`mt-3 text-base font-bold ${text}`}>{`Total ${moneyOf(total)}`}</p>
            <p className={`text-sm ${muted}`}>{SHARE_TEXT}</p>
            {notice && <p role="status" className={`mt-2 text-sm font-medium ${dark ? 'text-amber-300' : 'text-amber-800'}`}>{notice}</p>}
            <NoteField id={noteId} value={note} onChange={setNote} off={busy} dark={dark} />
            {problem && <p role="alert" className={`mt-3 text-sm font-medium ${dark ? 'text-red-300' : 'text-red-700'}`}>{problem}</p>}
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button off={!canCharge || busy} describedBy={canCharge ? undefined : reasonId} dark={dark} onClick={charge}>{busy ? 'Working…' : `Charge ${moneyOf(total)} to the card on file`}</Button>
              <Button secondary off={busy} dark={dark} onClick={() => decide({ action: 'decline' })}>Decline</Button>
              <Button secondary off={busy} dark={dark} onClick={() => dialog.current?.close()}>Close</Button>
            </div>
            {!canCharge && !busy && <p id={reasonId} className={`mt-2 text-sm ${muted}`}>{reason}</p>}
          </>
        )}

        {(!ready || !stillOpen) && (
          <div className="mt-5"><Button secondary off={busy} dark={dark} onClick={() => dialog.current?.close()}>Close</Button></div>
        )}
      </div>
    </dialog>
  );
}

function ReportCard({ report, dark, onUpdate, onSay }) {
  const titleRef = useRef(null);
  const opener = useRef(null);
  const acted = useRef(false);
  const noteId = useId();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [dialog, setDialog] = useState(false);
  const { booking, items, decision } = report;
  const muted = dark ? 'text-slate-400' : 'text-slate-600';
  const body = dark ? 'text-slate-200' : 'text-slate-700';
  const money = report.type === 'add_items';

  // The card keeps its place when its report changes under it, so the focus goes to its title: the button that was used can be gone.
  useEffect(() => {
    if (acted.current) {
      acted.current = false;
      titleRef.current?.focus();
    }
  }, [report]);

  const decide = async (action) => {
    if (busy) return;
    setBusy(true);
    setProblem('');
    const text = note.trim();
    const result = await postJson(`/api/admin/reports/${report.id}`, { action, ...(text ? { note: text } : {}) });
    setBusy(false);
    const answer = answerOf(result);
    if (answer.report) {
      acted.current = true;
      onUpdate(answer.report);
      onSay(answer.done ? `${answer.report.label}: ${statusOf(answer.report).toLowerCase()}` : answer.text);
    }
    if (!answer.done && !(answer.report && answer.report.items && answer.report.items.charge === 'failed')) setProblem(answer.text);
  };

  const closeDialog = () => {
    setDialog(false);
    opener.current?.focus();
  };

  let outcome = null;
  if (report.status === 'handled' || report.status === 'declined') {
    outcome = `${report.status === 'handled' ? 'Handled' : 'Declined'} by ${decision ? decision.by : 'an admin'}${decision && stampOf(decision.at) ? `, ${stampOf(decision.at)}` : ''}`;
  } else if (report.status === 'approved' && items) {
    outcome = items.charge === 'paid'
      ? `Charged ${moneyOf(items.cents ?? 0)}${decision ? `. Approved by ${decision.by}${stampOf(decision.at) ? `, ${stampOf(decision.at)}` : ''}` : ''}`
      : items.charge === 'failed' ? CHARGE_FAILED_TEXT[items.reason] ?? CHARGE_FAILED_OTHER_TEXT : PENDING_TEXT;
  }
  const redo = report.status === 'approved' && items !== null && (items.charge === 'failed' || items.charge === 'pending');

  return (
    <li data-testid="on-site-report" data-report-id={report.id} className={`rounded-2xl border p-4 sm:p-5 ${dark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 ref={titleRef} tabIndex={-1} className={`text-base font-semibold focus:outline-none ${dark ? 'text-white' : 'text-slate-900'}`}>{report.label}</h3>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${dark ? 'bg-slate-800 text-slate-200 ring-slate-700' : 'bg-slate-100 text-slate-700 ring-slate-200'}`}>{statusOf(report)}</span>
      </div>

      <p className={`mt-2 text-sm ${body}`}>
        <Link href={`/admin/bookings/${booking.id}`} className={`font-semibold underline underline-offset-2 rounded ${dark ? 'text-teal-400 hover:text-teal-300' : 'text-teal-700 hover:text-teal-800'} ${ringOf(dark)}`}>
          {`#${booking.number} · ${booking.service} · ${booking.date}, ${booking.slot}`}
        </Link>
        {booking.customer ? ` · ${booking.customer}` : ''}
      </p>
      <p className={`mt-1 text-sm ${muted}`}>
        {report.by ? `${report.by} (${report.byKind}), ` : ''}<time dateTime={report.at}>{stampOf(report.at)}</time>
      </p>
      <p className={`text-sm ${report.away === true ? (dark ? 'text-amber-300' : 'text-amber-800') : muted}`}>{reportPlaceOf(report)}</p>

      <div className="mt-3 flex items-start gap-3">
        <Photo report={report} dark={dark} />
        <p className={`min-w-0 text-sm whitespace-pre-wrap break-words ${body}`}>{report.note}</p>
      </div>

      {items && items.lines.length > 0 && (
        <ul className={`mt-3 text-sm ${body}`}>
          {items.lines.map((line, index) => <li key={index}>{`${line.quantity} × ${line.label}${line.cents === null ? '' : ` — ${moneyOf(line.cents)}`}`}</li>)}
        </ul>
      )}

      {outcome && <p className={`mt-3 text-sm font-semibold ${report.items && report.items.charge === 'failed' ? (dark ? 'text-red-300' : 'text-red-700') : (dark ? 'text-white' : 'text-slate-900')}`}>{outcome}</p>}
      {decision && decision.note && <p className={`text-sm ${muted}`}>{decision.note}</p>}
      {report.status === 'approved' && items && items.shareCents !== null && (
        <p className={`text-sm ${muted}`}>{`The provider's share of this is ${moneyOf(items.shareCents)} — it is not paid by this action.`}</p>
      )}

      {report.status === 'open' && !money && (
        <>
          <NoteField id={noteId} value={note} onChange={setNote} off={busy} dark={dark} />
          <div className="mt-3"><Button off={busy} dark={dark} onClick={() => decide('handle')}>{busy ? 'Saving…' : 'Mark as handled'}</Button></div>
        </>
      )}
      {report.status === 'open' && money && (
        <div className="mt-3">
          <button
            type="button"
            ref={opener}
            onClick={() => setDialog(true)}
            className={`min-h-[44px] px-4 rounded-xl text-sm font-semibold bg-teal-700 hover:bg-teal-800 text-white ${ringOf(dark)}`}
          >
            Review the items
          </button>
        </div>
      )}
      {redo && (
        <>
          {items.charge === 'failed' && <NoteField id={noteId} value={note} onChange={setNote} off={busy} dark={dark} />}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Button off={busy} dark={dark} onClick={() => decide('retry')}>{busy ? 'Working…' : 'Try the charge again'}</Button>
            {items.charge === 'failed' && <Button secondary off={busy} dark={dark} onClick={() => decide('decline')}>Decline</Button>}
          </div>
        </>
      )}
      {problem && <p role="alert" className={`mt-3 text-sm font-medium ${dark ? 'text-red-300' : 'text-red-700'}`}>{problem}</p>}

      {dialog && <ItemsDialog report={report} dark={dark} onClose={closeDialog} onUpdate={(next) => { acted.current = true; onUpdate(next); }} onSay={onSay} />}
    </li>
  );
}

const readPage = (all, before, limit) =>
  callApi(`/api/admin/reports?status=${all ? 'all' : 'open'}&limit=${limit}${before ? `&before=${before}` : ''}`, { signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });

export default function OnSiteReports({ isDarkMode }) {
  const headingId = useId();
  const [page, setPage] = useState({ reports: [], openCount: 0, nextBefore: null });
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [trying, setTrying] = useState(false);
  const [all, setAll] = useState(false);
  const [more, setMore] = useState('idle');
  const [said, setSaid] = useState('');
  // What a call in flight needs to know when it lands: which list is on screen, how many reports it holds, and whether a newer call or a decision has made
  // its answer out of date.
  const latest = useRef({ all, page });
  latest.current = { all, page };
  const generation = useRef(0);
  const polling = useRef(false);

  const refresh = useCallback(async ({ wantAll, quiet }) => {
    if (quiet) {
      if (polling.current) return;
      polling.current = true;
    } else {
      generation.current += 1;
    }
    const mine = generation.current;
    const limit = quiet ? Math.min(PAGE_MAX, Math.max(PAGE_SIZE, latest.current.page.reports.length)) : PAGE_SIZE;
    const result = await readPage(wantAll, null, limit);
    if (quiet) polling.current = false;
    if (mine !== generation.current) return;
    const next = pageOf(result);
    // A poll that fails changes nothing on the screen: what is shown was true a moment ago, and the next poll asks again.
    if (!next) {
      if (!quiet) setFailed(true);
      setLoaded(true);
      setTrying(false);
      return;
    }
    // A poll never takes away the card the keyboard (or its open dialog) is in; the card stays until the focus leaves it, so the page does not move under the admin.
    const inCard = quiet ? document.activeElement?.closest?.('[data-report-id]') : null;
    const keep = inCard ? Number(inCard.dataset.reportId) : 0;
    setFailed(false);
    setLoaded(true);
    setTrying(false);
    setPage((held) => {
      // Reports older than the ones just read were loaded by "Show more"; they stay, and "Show more" goes on after them.
      const floor = next.reports.length > 0 ? next.reports[next.reports.length - 1].id : 0;
      const older = quiet && next.nextBefore !== null ? held.reports.filter((one) => one.id < floor) : [];
      const staying = held.reports.filter((one) => one.id === keep && !older.includes(one) && !next.reports.some((now) => now.id === one.id));
      return {
        reports: [...next.reports, ...staying].sort((a, b) => b.id - a.id).concat(older),
        openCount: next.openCount,
        nextBefore: older.length > 0 ? held.nextBefore : next.nextBefore,
      };
    });
  }, []);

  useEffect(() => {
    refresh({ wantAll: false, quiet: false });
  }, [refresh]);

  useEffect(() => {
    const again = () => {
      if (document.visibilityState === 'visible') refresh({ wantAll: latest.current.all, quiet: true });
    };
    const timer = setInterval(again, QUEUE_POLL_SECONDS * 1000);
    document.addEventListener('visibilitychange', again);
    window.addEventListener('focus', again);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', again);
      window.removeEventListener('focus', again);
    };
  }, [refresh]);

  const update = useCallback((report) => {
    generation.current += 1;
    setPage((held) => {
      const prior = held.reports.find((one) => one.id === report.id);
      const delta = (waiting(report) ? 1 : 0) - ((prior ? waiting(prior) : waiting(report)) ? 1 : 0);
      return { ...held, openCount: Math.max(0, held.openCount + delta), reports: held.reports.map((one) => (one.id === report.id ? report : one)) };
    });
  }, []);

  const retry = () => {
    setTrying(true);
    refresh({ wantAll: all, quiet: false });
  };

  const toggle = () => {
    const next = !all;
    setAll(next);
    setMore('idle');
    refresh({ wantAll: next, quiet: false });
  };

  const showMore = async () => {
    if (more === 'loading' || page.nextBefore === null) return;
    setMore('loading');
    const mine = generation.current;
    const result = await readPage(all, page.nextBefore, PAGE_SIZE);
    if (mine !== generation.current) {
      setMore('idle');
      return;
    }
    const next = pageOf(result);
    if (!next) {
      setMore('failed');
      return;
    }
    setPage((held) => {
      const seen = new Set(held.reports.map((one) => one.id));
      return { reports: [...held.reports, ...next.reports.filter((one) => !seen.has(one.id))], openCount: next.openCount, nextBefore: next.nextBefore };
    });
    setMore('idle');
  };

  // Nothing while the first read is on its way and nothing when no report is waiting (unless the admin asked to see the handled ones). Only a failed load
  // is shown without any.
  // A report that has just been decided stays on its card until the next read takes it out, so the section is there while it holds a card.
  if (!failed && (!loaded || (page.openCount === 0 && page.reports.length === 0 && !all))) return null;

  const dark = isDarkMode;
  const muted = dark ? 'text-slate-400' : 'text-slate-600';

  return (
    <section aria-labelledby={headingId} data-testid="on-site-reports" className="mt-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id={headingId} className={`text-lg font-bold ${dark ? 'text-white' : 'text-slate-900'}`}>On-site reports</h2>
        {!failed && (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${dark ? 'bg-amber-900/30 text-amber-300 ring-amber-800' : 'bg-amber-50 text-amber-800 ring-amber-200'}`}>{`${page.openCount} waiting`}</span>
        )}
        {!failed && (
          <button
            type="button"
            aria-pressed={all}
            onClick={toggle}
            className={`min-h-[44px] px-4 rounded-xl border text-sm font-semibold ${all ? (dark ? 'border-teal-400 text-teal-300' : 'border-teal-700 text-teal-800') : (dark ? 'border-slate-600 text-slate-200' : 'border-slate-300 text-slate-700')} ${ringOf(dark)}`}
          >
            Show handled
          </button>
        )}
      </div>
      <p role="status" className="sr-only">{said}</p>

      {failed ? (
        <div className={`mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 ${dark ? 'bg-red-900/20 border-red-800' : 'bg-red-50 border-red-200'}`}>
          <p role="alert" className={`text-sm font-medium ${dark ? 'text-red-300' : 'text-red-700'}`}>{LOAD_FAILED_TEXT}</p>
          <Button off={trying} dark={dark} onClick={retry}>Try again</Button>
        </div>
      ) : (
        <>
          {page.reports.length === 0 ? (
            <p className={`mt-3 text-sm ${muted}`}>{NOTHING_TEXT}</p>
          ) : (
            <ul className="mt-3 grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
              {page.reports.map((report) => <ReportCard key={report.id} report={report} dark={dark} onUpdate={update} onSay={setSaid} />)}
            </ul>
          )}
          {page.nextBefore !== null && (
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
              <Button secondary off={more === 'loading'} dark={dark} onClick={showMore}>{more === 'failed' ? 'Try again' : 'Show more'}</Button>
              <p role="status" className={`text-sm ${muted}`}>{more === 'loading' ? 'Loading more reports...' : `Showing ${page.reports.length}`}</p>
              {more === 'failed' && <p role="alert" className={`text-sm font-medium ${dark ? 'text-red-300' : 'text-red-700'}`}>{MORE_FAILED_TEXT}</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
