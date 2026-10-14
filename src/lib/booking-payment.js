// Decisions about a booking's payment: the amounts a card payment can take, whether a payment matches a booking, and the one
// charge when the job is done. The Stripe client is passed in, so each branch runs with a scripted client in the suite.
// This module imports nothing and holds no connection: the routes hand it their client and their save/read callbacks.

// The smallest and largest amounts a card payment can take (50 in the smallest unit, the CAD minimum; the eight-digit ceiling
// that holds for every method the Payment Element may offer).
const MIN_CENTS = 50;
const MAX_CENTS = 99999999;

// paymentAmountCents(price) -> { ok: true, cents } | { ok: false, reason: 'below_minimum' | 'too_large' }
export function paymentAmountCents(price) {
  const cents = Math.round(price * 100);
  if (!Number.isFinite(cents) || cents < MIN_CENTS) return { ok: false, reason: 'below_minimum' };
  if (cents > MAX_CENTS) return { ok: false, reason: 'too_large' };
  return { ok: true, cents };
}

// paymentCheckMode({ hasKey, nodeEnv }) -> 'verify' | 'unverified' | 'refuse'
// Without a payment key, production refuses bookings; other environments record them as pending, unverified.
export function paymentCheckMode({ hasKey, nodeEnv }) {
  if (hasKey) return 'verify';
  return nodeEnv === 'production' ? 'refuse' : 'unverified';
}

// checkHeldPayment(intent, { amountCents, currency, customerId, nowSeconds }) decides whether a retrieved intent is the
// payment for this booking: a hold of exactly this booking's price, in this currency, for the account the booking is
// recorded for. A payment already taken by automatic capture in the last 24 hours, received for the booking's price, is
// accepted as paid; the intents create-intent makes are holds and a completion charge names its booking, so neither is taken
// as one. Customer and currency are checked first, so a request naming another
// account's intent gets the general refusal and never the price message.
//   -> { ok: true, paymentStatus: 'authorized' | 'paid', authorizedCents }
//    | { ok: false, status, message, check }
export function checkHeldPayment(intent, { amountCents, currency, customerId, nowSeconds }) {
  const mismatch = { ok: false, status: 400, message: 'This payment does not match this booking.', check: 'match' };
  const changed = { ok: false, status: 409, message: 'The price of this booking has changed since the card was authorized. Please confirm the booking again.', check: 'amount' };
  if (!intent || typeof intent !== 'object') return mismatch;
  if (!customerId || intent.customer !== customerId) return mismatch;
  if (String(intent.currency).toLowerCase() !== String(currency).toLowerCase()) return mismatch;

  if (intent.status === 'requires_capture') {
    if (intent.capture_method !== 'manual') return mismatch;
    if (intent.amount !== amountCents) return changed;
    if (intent.amount_capturable !== intent.amount) return mismatch;
    return { ok: true, paymentStatus: 'authorized', authorizedCents: intent.amount };
  }

  // A payment taken by automatic capture in the last day, received for the booking's price: accepted as paid. A completion
  // charge names its booking (metadata.booking_id) and is never a payment for another booking.
  if (intent.status === 'succeeded' && intent.capture_method !== 'manual'
      && typeof intent.created === 'number' && nowSeconds - intent.created < 86400) {
    if (intent.metadata && intent.metadata.booking_id) return mismatch;
    if (intent.amount_received !== amountCents) return changed;
    return { ok: true, paymentStatus: 'paid', authorizedCents: intent.amount_received };
  }

  return mismatch;
}

// The time zone "today" is read in wherever the money path compares a date with the day it is (the market is Metro Vancouver).
// No Canadian zone is behind it, so its date is never ahead of the date anywhere else in the country: a visit is not treated as
// due before its date in any province, and in the easternmost it is due a few hours late, which does no harm. A name, not an
// offset: the zone database decides the offset (tzdata 2026c has this zone at UTC-7 all year), so no rule is written here.
export const BUSINESS_TIME_ZONE = 'America/Vancouver';

// businessToday(nowMs) -> 'YYYY-MM-DD': the calendar day it is in BUSINESS_TIME_ZONE at nowMs (milliseconds, as Date.now()).
// The clock is the caller's, so this stays pure. A time that is not a number is refused, never read as "now" or as 1970.
export function businessToday(nowMs) {
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) throw new RangeError('businessToday needs a time in milliseconds');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(nowMs));
  const part = (type) => parts.find((p) => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// The calendar day a booking's job_date names, 'YYYY-MM-DD', or null when it names none. A date-only string is taken as written. A
// Date is what the database driver makes of a DATE column: midnight in this server's own zone, so its local year, month and day
// are the column's (reading it in UTC would name the day before, east of Greenwich the day after).
function dayOf(value) {
  if (typeof value === 'string') return DAY.test(value) ? value : null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const two = (n) => String(n).padStart(2, '0');
    return `${String(value.getFullYear()).padStart(4, '0')}-${two(value.getMonth() + 1)}-${two(value.getDate())}`;
  }
  return null;
}

// collectBookingPayment(stripe, booking, opts) takes the one charge for a booking whose job is done, for the price recorded
// on the booking. opts: { currency, saveIntentId(newId, oldId) -> saved?, readIntentId() -> the id on the booking, cardIntentId, card, today }.
// The two callbacks run outside the route's transaction, so a saved charge stays on the booking whatever the route does next.
// cardIntentId: for a booking with no payment of its own (a later visit of a series), the payment whose card it is charged on.
// card: { customer, payment_method }, for a booking with no payment of its own that an admin made on a customer's behalf: the Stripe
// customer and the card its customer put on file from a link (cardOnFile, in booking-card.js). It is charged on that card, for the
// recorded price, as a lapsed hold is, and it is tried before cardIntentId. Given without both fields, it is not there.
// today: businessToday(Date.now()); a booking with no payment of its own is charged on or after its job_date and not before, whatever
// its status says (a provider's click or an admin's write can mark a visit done weeks early). With no readable date or no today it is refused.
// Never throws for an expected outcome.
//   -> { ok: true, chargeId, amountCents, overCollected } | { ok: false, reason, day? }
// reason: 'mismatch' | 'declined' | 'action_required' | 'no_payment_method' | 'cancelled_by_person' | 'unavailable' | 'not_configured'
//   | 'not_due' (nothing was called: the visit's date is still ahead, and day is that date)
// A booking with no payment of its own, no card and no cardIntentId is 'no_payment_method': one made on a customer's behalf whose
// customer never added a card.
export async function collectBookingPayment(stripe, booking, opts = {}) {
  // First, before the key is asked about: this refusal calls nothing, so it holds on a server with no payment key too.
  if (!booking.payment_intent_id) {
    const day = dayOf(booking.job_date);
    if (!day || !DAY.test(opts.today || '')) return { ok: false, reason: 'mismatch' };
    if (day > opts.today) return { ok: false, reason: 'not_due', day };
  }
  if (!stripe) return { ok: false, reason: 'not_configured' };
  const currency = opts.currency || 'cad';
  const expected = Math.round(parseFloat(booking.service_price) * 100);
  if (!Number.isInteger(expected) || expected <= 0) return { ok: false, reason: 'mismatch' };

  // A later visit of a series holds no payment of its own: it is charged, for its own recorded price, on the card of the
  // payment its series' first visit holds (opts.cardIntentId), as a lapsed hold is. That payment is read first: one a person
  // cancelled is not a card to charge (as for a lapsed hold, below), and one with no customer cannot be charged off-session.
  if (!booking.payment_intent_id) {
    // A booking an admin made on a customer's behalf holds no payment either and is no visit of a series. Its customer put a card on
    // file from a link, and that card is charged by the same charge, under the same per-booking key. It names the customer and the
    // card itself, so there is no payment to read first.
    if (opts.card && opts.card.customer && opts.card.payment_method) {
      return chargeSavedCard(stripe, booking, opts.card, expected, currency, opts);
    }
    if (!opts.cardIntentId) return { ok: false, reason: 'no_payment_method' };
    let source;
    try {
      source = await stripe.paymentIntents.retrieve(opts.cardIntentId);
    } catch (err) {
      return { ok: false, reason: errorReason(err) };
    }
    if (source.status === 'canceled' && source.cancellation_reason !== 'automatic' && source.cancellation_reason !== 'expired') {
      return { ok: false, reason: 'cancelled_by_person' };
    }
    if (!source.customer) return { ok: false, reason: 'no_payment_method' };
    return chargeSavedCard(stripe, booking, source, expected, currency, opts);
  }

  let intent;
  try {
    intent = await stripe.paymentIntents.retrieve(booking.payment_intent_id);
  } catch (err) {
    return { ok: false, reason: errorReason(err) };
  }

  // A retry after a crash between saving the charge and confirming it, or the customer's own retry after a decline: the
  // saved charge is waiting on the booking and is confirmed without creating another (one that needs the customer is reported,
  // not confirmed).
  if ((intent.status === 'requires_confirmation' || intent.status === 'requires_payment_method' || intent.status === 'requires_action')
      && intent.metadata && String(intent.metadata.booking_id) === String(booking.id)) {
    return decideSavedCharge(stripe, intent, expected);
  }

  if (intent.status === 'requires_capture') {
    if (intent.amount_capturable < expected) return { ok: false, reason: 'mismatch' };
    try {
      await stripe.paymentIntents.capture(intent.id, { amount_to_capture: expected }, { idempotencyKey: `booking-${booking.id}-capture` });
    } catch (err) {
      return settleAfterError(stripe, intent.id, expected, err);
    }
    return readCollected(stripe, intent.id, expected);
  }

  if (intent.status === 'succeeded') return collectedFrom(intent, expected);

  if (intent.status === 'canceled') {
    if (intent.cancellation_reason !== 'automatic' && intent.cancellation_reason !== 'expired') {
      return { ok: false, reason: 'cancelled_by_person' };
    }
    // The hold lapsed. Another call may have saved its charge on the booking after this call read it: carry on with that one.
    const onBooking = typeof opts.readIntentId === 'function' ? await opts.readIntentId() : null;
    if (onBooking && onBooking !== booking.payment_intent_id) return continueSavedCharge(stripe, onBooking, expected);
    return chargeSavedCard(stripe, booking, intent, expected, currency, opts);
  }

  if (intent.status === 'processing') return { ok: false, reason: 'unavailable' };
  return { ok: false, reason: 'mismatch' };
}

// chargeSavedCard: the hold lapsed, so the card the hold was placed on is charged for the recorded price with a new
// off-session intent, created unconfirmed under a per-booking key and saved on the booking before it is confirmed, so any
// retry finds it.
async function chargeSavedCard(stripe, booking, intent, expected, currency, opts) {
  const card = await savedCardOf(stripe, intent);
  if (card.reason) return { ok: false, reason: card.reason };
  if (!card.id) return { ok: false, reason: 'no_payment_method' };

  let created;
  try {
    created = await stripe.paymentIntents.create({
      amount: expected,
      currency,
      customer: intent.customer,
      payment_method: card.id,
      metadata: { booking_id: String(booking.id) },
      confirm: false,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    }, { idempotencyKey: `booking-${booking.id}-completion-charge` });
  } catch (err) {
    return { ok: false, reason: errorReason(err) };
  }

  // Saved before it is confirmed, compare-and-set on the old intent id. If another call saved its charge first, this call
  // continues with that one; a charge that is on no booking is never confirmed.
  const saved = await opts.saveIntentId(created.id, booking.payment_intent_id);
  if (!saved) {
    const current = await opts.readIntentId();
    if (!current || current === booking.payment_intent_id) return { ok: false, reason: 'unavailable' };
    return continueSavedCharge(stripe, current, expected);
  }
  return confirmSavedCharge(stripe, created.id, card.id, expected);
}

// The card a lapsed hold was placed on: the payment method of the intent, else the payment method of its latest charge.
// -> { id } | { reason }
async function savedCardOf(stripe, intent) {
  const named = idOf(intent.payment_method);
  if (named) return { id: named };
  const charge = intent.latest_charge;
  if (!charge) return { id: null };
  let chargeObject = charge;
  if (typeof charge === 'string') {
    try {
      chargeObject = await stripe.charges.retrieve(charge);
    } catch (err) {
      return { reason: errorReason(err) };
    }
  }
  return { id: idOf(chargeObject.payment_method) };
}

// The charge saved on the booking by an earlier call is read and decided by its state.
async function continueSavedCharge(stripe, savedId, expected) {
  let saved;
  try {
    saved = await stripe.paymentIntents.retrieve(savedId);
  } catch (err) {
    return { ok: false, reason: errorReason(err) };
  }
  return decideSavedCharge(stripe, saved, expected);
}

async function decideSavedCharge(stripe, saved, expected) {
  if (saved.status === 'succeeded') return collectedFrom(saved, expected);
  if (saved.status === 'requires_confirmation' || saved.status === 'requires_payment_method') {
    const paymentMethod = idOf(saved.payment_method);
    if (!paymentMethod) return { ok: false, reason: 'no_payment_method' };
    return confirmSavedCharge(stripe, saved.id, paymentMethod, expected);
  }
  if (saved.status === 'requires_action') return { ok: false, reason: 'action_required' };
  if (saved.status === 'processing') return { ok: false, reason: 'unavailable' };
  return { ok: false, reason: 'mismatch' };
}

async function confirmSavedCharge(stripe, intentId, paymentMethod, expected) {
  try {
    await stripe.paymentIntents.confirm(intentId, { payment_method: paymentMethod, off_session: true });
  } catch (err) {
    return settleAfterError(stripe, intentId, expected, err);
  }
  return readCollected(stripe, intentId, expected);
}

// After a capture or confirm error the intent is read again and the answer comes from its new state, never from the error
// text; when the new state does not settle it, the kind of error does.
async function settleAfterError(stripe, intentId, expected, err) {
  let fresh = null;
  try {
    fresh = await stripe.paymentIntents.retrieve(intentId);
  } catch (readErr) {
    console.error(`Payment ${intentId}: the read after a failed call failed (${readErr && readErr.type})`);
  }
  if (fresh && fresh.status === 'succeeded') return collectedFrom(fresh, expected);
  return { ok: false, reason: errorReason(err) };
}

async function readCollected(stripe, intentId, expected) {
  let fresh;
  try {
    fresh = await stripe.paymentIntents.retrieve(intentId);
  } catch (err) {
    return { ok: false, reason: errorReason(err) };
  }
  if (fresh.status === 'succeeded') return collectedFrom(fresh, expected);
  if (fresh.status === 'processing') return { ok: false, reason: 'unavailable' };
  if (fresh.status === 'requires_action') return { ok: false, reason: 'action_required' };
  if (fresh.status === 'requires_payment_method' || fresh.status === 'requires_confirmation') return { ok: false, reason: 'declined' };
  return { ok: false, reason: 'mismatch' };
}

// A succeeded intent is a collected payment when it received at least the recorded price and names its charge: the provider's
// payout is tied to that charge, so an intent with no charge is not paid out from.
function collectedFrom(intent, expected) {
  const chargeId = idOf(intent.latest_charge);
  if (!chargeId || !(intent.amount_received >= expected)) return { ok: false, reason: 'mismatch' };
  return { ok: true, chargeId, amountCents: intent.amount_received, overCollected: intent.amount_received > expected };
}

function idOf(value) {
  if (typeof value === 'string') return value || null;
  return (value && typeof value.id === 'string' && value.id) || null;
}

// Connection, rate-limit, server and key errors are about Stripe or this server's configuration, not about the booking: try
// again later. A card error is the card's answer. Any other error (an intent Stripe does not know, a request Stripe refuses)
// is about this booking: it is a mismatch, so the admins hear of it once and it is not retried for ever.
const TRY_LATER = new Set(['StripeConnectionError', 'StripeRateLimitError', 'StripeAPIError', 'StripeAuthenticationError', 'StripePermissionError']);

function errorReason(err) {
  if (err && err.type === 'StripeCardError') {
    if (err.code === 'authentication_required') return 'action_required';
    return 'declined';
  }
  if (err && (TRY_LATER.has(err.type) || err.statusCode >= 500)) return 'unavailable';
  return 'mismatch';
}
