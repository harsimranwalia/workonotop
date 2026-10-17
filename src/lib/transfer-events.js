// What a Stripe transfer event does to a provider payout (ENG-027, ADR-017). The webhook route calls recordTransferEvent for the four
// transfer events it knows; the library finds the payout the transfer was made for, moves it forward once, and writes one line to the
// booking's history. Plain Node: no '@/' import, and the connection is a parameter, so the cases that need a real database can call it
// without the route.
//
// The rules, each answering a way the old handlers went wrong:
//   - A payout is found by its transfer id and nothing else. The old match also took every payout of the booking, and a payout with no
//     transfer id (the transfer call failed) can never equal a bound id, so it is out of reach.
//   - The payout rows are read with no lock and then locked one at a time by primary key. stripe_transfer_id has no index, so an UPDATE
//     that searches by it scans the table and locks the gap where every new payout row goes.
//   - A payout moves forward only, from the status found under the lock: nothing leaves 'failed', and a second delivery of an event, or
//     the same transfer reported by two events, finds a status that forbids the move and writes nothing.
//   - No balance is touched. The approval route credits the provider's stored available balance when it writes the payout row and
//     nothing credits the stored pending balance, so moving money between the two here would count it twice.
//   - An event that finds no payout is told apart by the transfer itself: one made for a payout carries metadata.provider_id (the
//     approval route and the checkout handler set it and write the row), one made for something else does not. The first is 'retry' (the
//     event beat its row; Stripe sends it again), the second 'unmatched'.
//   - A database error rolls back and is thrown, so the route answers 500 and Stripe sends the event again.

import { inTransaction } from './booking-crew.js';

export const EVENT_KIND = {
  'transfer.created': 'paid',
  'transfer.paid': 'paid',
  'transfer.reversed': 'reversed',
  'transfer.failed': 'failed',
};

// The statuses a payout may be moved from, by the status it moves to. Nothing is ever moved out of 'failed'.
const MOVE_FROM = {
  paid: ['pending', 'processing'],
  failed: ['pending', 'processing', 'paid'],
};

const isCents = (value) => typeof value === 'number' && Number.isFinite(value);

const money = (cents) => (isCents(cents) ? `$${(cents / 100).toFixed(2)}` : 'an unknown amount');

// 'full', 'partial' or 'none' for a transfer carried by a transfer.reversed event. `reversed` is true only when the whole transfer is
// reversed; `amount_reversed` is the cumulative amount reversed so far, in cents. Anything that is not a number reverses nothing.
export function reversalOf(transfer) {
  if (transfer?.reversed === true) return 'full';
  const { amount, amount_reversed: reversed } = transfer ?? {};
  if (isCents(amount) && amount > 0 && isCents(reversed) && reversed >= amount) return 'full';
  if (isCents(reversed) && reversed > 0) return 'partial';
  return 'none';
}

function lineFor(kind, reversal, transfer) {
  if (kind === 'paid') {
    return { status: 'transfer_completed', notes: `💰 ${money(transfer.amount)} transferred to the provider` };
  }
  if (kind === 'failed') {
    return { status: 'transfer_failed', notes: `❌ Transfer failed: ${transfer.failure_message || 'Unknown error'}` };
  }
  if (reversal === 'full') {
    const cents = isCents(transfer.amount_reversed) && transfer.amount_reversed > 0 ? transfer.amount_reversed : transfer.amount;
    return { status: 'transfer_reversed', notes: `↩️ ${money(cents)} transfer to the provider was reversed` };
  }
  return {
    status: 'transfer_part_reversed',
    notes: `↩️ ${money(transfer.amount_reversed)} of the ${money(transfer.amount)} transfer to the provider was reversed`,
  };
}

// Applies one event to one payout that is locked, inside the caller's transaction. Returns true when the payout moved or a line was written.
async function applyToPayout(connection, event, kind, reversal, payout) {
  const transfer = event.data.object;
  const target = kind === 'paid' ? 'paid' : 'failed';
  const line = lineFor(kind, reversal, transfer);

  if (kind === 'reversed' && reversal === 'partial') {
    // A partial reversal changes no status. The line is the record, written once for a pair of amounts: the same line already on the
    // booking means this reversal has been recorded. That holds under ten deliveries at once only because of the order in settle(): the row
    // lock is the transaction's first read, so the snapshot of the read below is taken after the lock was won. Read anything ahead of it and a
    // delivery that waited for the lock cannot see the line the one before it wrote.
    if (!['pending', 'processing', 'paid'].includes(payout.status) || payout.booking_id === null) return false;
    const [seen] = await connection.execute(
      'SELECT id FROM booking_status_history WHERE booking_id = ? AND status = ? AND notes = ? LIMIT 1',
      [payout.booking_id, line.status, line.notes]
    );
    if (seen.length) return false;
  } else {
    if (!MOVE_FROM[target].includes(payout.status)) return false;
    if (target === 'paid') {
      // The time Stripe reported, so a late or repeated delivery says when it happened and cannot change it.
      const reportedAt = Number.isInteger(event.created) && event.created > 0 ? event.created : Math.floor(Date.now() / 1000);
      await connection.execute("UPDATE provider_payouts SET status = 'paid', paid_at = FROM_UNIXTIME(?) WHERE id = ?", [reportedAt, payout.id]);
    } else {
      await connection.execute("UPDATE provider_payouts SET status = 'failed' WHERE id = ?", [payout.id]);
    }
  }

  if (payout.booking_id !== null) {
    await connection.execute('INSERT INTO booking_status_history (booking_id, status, notes) VALUES (?, ?, ?)', [payout.booking_id, line.status, line.notes]);
  }
  return true;
}

// Records one transfer event. Resolves { outcome, rows }, where rows is how many payouts carry the transfer's id:
//   'applied'   a payout moved or a line was written
//   'unchanged' a payout was found and the event had nothing left to do
//   'unmatched' no payout, and the transfer was not made for one
//   'retry'     no payout yet, and the transfer was made for one
export async function recordTransferEvent(connection, event) {
  const kind = EVENT_KIND[event?.type];
  const transfer = event?.data?.object;
  const result = await settle(connection, event, kind, transfer);
  console.log(`Transfer event ${event?.type} ${typeof transfer?.id === 'string' ? transfer.id : '(no id)'}: ${result.outcome}`);
  return result;
}

async function settle(connection, event, kind, transfer) {
  if (!kind || typeof transfer?.id !== 'string' || transfer.id === '') return { outcome: 'unmatched', rows: 0 };

  const [found] = await connection.execute('SELECT id FROM provider_payouts WHERE stripe_transfer_id = ? ORDER BY id', [transfer.id]);
  if (!found.length) {
    const madeForPayout = typeof transfer.metadata?.provider_id === 'string' && transfer.metadata.provider_id !== '';
    return { outcome: madeForPayout ? 'retry' : 'unmatched', rows: 0 };
  }

  const reversal = kind === 'reversed' ? reversalOf(transfer) : null;
  if (reversal === 'none') return { outcome: 'unchanged', rows: found.length };

  const changed = await inTransaction(connection, async () => {
    let any = false;
    for (const { id } of found) {
      const [locked] = await connection.execute('SELECT id, booking_id, status FROM provider_payouts WHERE id = ? FOR UPDATE', [id]);
      if (!locked.length) continue;
      if (await applyToPayout(connection, event, kind, reversal, locked[0])) any = true;
    }
    return any;
  });
  return { outcome: changed ? 'applied' : 'unchanged', rows: found.length };
}
