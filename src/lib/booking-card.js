// The card a customer adds, from a link, to a booking an admin made on their behalf: the link's token, the state the link is in,
// the SetupIntent that puts the card on file, and the card the one completion charge is taken on. The Stripe client and the
// database are passed in (the routes hand over theirs), so each branch runs with scripted ones in the suite. This module holds no
// connection and logs no token, card or personal detail.
import { LINK_TOKEN_PATTERN, newLinkToken, sha256Hex } from './link-token.js';

// How long an issued link lives, and how many times its page may start a card entry before the link dies. Neither is stored per
// row, so changing one needs no migration.
export const CARD_LINK_DAYS = 14;
export const CARD_LINK_ATTEMPTS = 10;

// 32 random bytes as base64url: 43 characters, no padding (src/lib/link-token.js, which the job link shares). Anything else is not a token
// and is refused before the database is read.
export const CARD_TOKEN_PATTERN = LINK_TOKEN_PATTERN;

const CLOSED_STATUSES = ['completed', 'cancelled', 'disputed'];

// newCardToken() -> { token, hash }. The token goes to the one person who is sent the link and is never stored; the table keeps
// the hash, so a copy of the table opens no link.
export function newCardToken() {
  const token = newLinkToken();
  return { token, hash: sha256Hex(token) };
}

// hashCardToken(token) -> the 64-character hex SHA-256 of the token, or null when it is not a token (not a string, wrong length or
// characters), so a malformed one never reaches a query.
export function hashCardToken(token) {
  if (typeof token !== 'string' || !CARD_TOKEN_PATTERN.test(token)) return null;
  return sha256Hex(token);
}

// cardLinkState(row) -> 'closed' | 'expired' | 'used' | 'exhausted' | 'ok', the first that holds. row carries the facts the query
// computed: expired and used (0/1, from the database's own clock, so no JavaScript clock is compared with it), attempts, and
// booking_status. A link whose booking is done, cancelled or disputed is closed whatever else is true of it; a link that took its
// card is used, however many tries it needed.
export function cardLinkState(row) {
  if (CLOSED_STATUSES.includes(row.booking_status)) return 'closed';
  if (Number(row.expired)) return 'expired';
  if (Number(row.used)) return 'used';
  if (Number(row.attempts) >= CARD_LINK_ATTEMPTS) return 'exhausted';
  return 'ok';
}

// The link and the facts about its booking that the pages and the checks need. The customer's name and email are for the Stripe
// customer only and are never answered to the public routes.
const LINK_SELECT = `SELECT l.id, l.booking_id, l.stripe_customer_id, l.setup_intent_id, l.payment_method_id, l.card_brand, l.card_last4,
    l.expires_at, l.attempts, (l.expires_at <= NOW()) AS expired, (l.used_at IS NOT NULL) AS used,
    b.status AS booking_status, b.user_id AS booking_user_id, b.booking_number, b.service_name, b.service_price, b.job_date,
    b.job_time_slot, b.customer_first_name, b.customer_last_name, b.customer_email
  FROM booking_card_links l JOIN bookings b ON b.id = l.booking_id`;

function withState(row) {
  return { ...row, state: cardLinkState(row) };
}

// findCardLink(execute, token) -> the link with its state, or null: a malformed token (no database read) or one that names no row.
// The row is found by the hash of the token, an indexed lookup of a value the caller cannot choose, so how long it takes says
// nothing about the token.
export async function findCardLink(execute, token) {
  const hash = hashCardToken(token);
  if (!hash) return null;
  const rows = await execute(`${LINK_SELECT} WHERE l.token_hash = ? LIMIT 1`, [hash]);
  return rows && rows.length > 0 ? withState(rows[0]) : null;
}

// findCardLinkByBooking(execute, bookingId) -> the same link, found by its booking (the admin's read), or null when the booking was
// not made on a customer's behalf.
export async function findCardLinkByBooking(execute, bookingId) {
  const rows = await execute(`${LINK_SELECT} WHERE l.booking_id = ? LIMIT 1`, [bookingId]);
  return rows && rows.length > 0 ? withState(rows[0]) : null;
}

// cardOnFile(execute, booking) -> { customer, payment_method } | null. The card to take a booking's one charge on when it has no
// payment of its own: null at once, with no query, for a booking that has a payment_intent_id, and null for a booking with no
// link row or whose link has no card yet. A card a reissue left in place counts: a reissue never un-cards a booking.
export async function cardOnFile(execute, booking) {
  if (booking.payment_intent_id) return null;
  const rows = await execute(
    'SELECT stripe_customer_id, payment_method_id FROM booking_card_links WHERE booking_id = ? AND payment_method_id IS NOT NULL AND stripe_customer_id IS NOT NULL LIMIT 1',
    [booking.id],
  );
  if (!rows || rows.length === 0) return null;
  return { customer: rows[0].stripe_customer_id, payment_method: rows[0].payment_method_id };
}

// An id from a Stripe field that is a string, or an object once expanded.
function idOf(value) {
  if (typeof value === 'string') return value || null;
  if (value && typeof value.id === 'string') return value.id;
  return null;
}

// A Stripe answer that says the thing asked about is not there or not acceptable, as opposed to Stripe being out of reach.
function refusedByStripe(err) {
  return Boolean(err) && (err.code === 'resource_missing' || err.statusCode === 404 || err.type === 'StripeInvalidRequestError');
}

// The Stripe customer the card is saved on: the link's own, else the matched account's, else a new one. The new one is made under
// a key per link and saved with a compare-and-set, so two entries racing on the first card end up on one customer; if the booking
// has an account that had none, the account keeps it too, as create-intent does.
async function ensureStripeCustomer(stripe, execute, link) {
  if (link.stripe_customer_id) return link.stripe_customer_id;

  let customerId = null;
  if (link.booking_user_id) {
    const accounts = await execute('SELECT stripe_customer_id FROM users WHERE id = ?', [link.booking_user_id]);
    if (accounts && accounts.length > 0) customerId = accounts[0].stripe_customer_id || null;
  }

  let created = false;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: link.customer_email,
      name: `${link.customer_first_name} ${link.customer_last_name}`.trim(),
      metadata: { card_link_id: String(link.id), booking_id: String(link.booking_id) },
    }, { idempotencyKey: `card-link-${link.id}-customer` });
    customerId = customer.id;
    created = true;
  }

  await execute('UPDATE booking_card_links SET stripe_customer_id = ? WHERE id = ? AND stripe_customer_id IS NULL', [customerId, link.id]);
  const saved = await execute('SELECT stripe_customer_id FROM booking_card_links WHERE id = ?', [link.id]);
  const winner = saved && saved.length > 0 && saved[0].stripe_customer_id ? saved[0].stripe_customer_id : customerId;

  if (created && link.booking_user_id && winner === customerId) {
    await execute('UPDATE users SET stripe_customer_id = ? WHERE id = ? AND stripe_customer_id IS NULL', [winner, link.booking_user_id]);
  }
  return winner;
}

// reusableCardEntry(setup, link) -> true when a SetupIntent read from Stripe is still the open card entry this link was given: waiting for
// a card with no failed confirm on it, on the link's customer, made for this link, for off-session use, and with a client secret to hand
// back. These are the facts verifyCardSetup will ask of it once it has a card, so a page is never handed an entry that could not be saved.
function reusableCardEntry(setup, link) {
  if (!setup || typeof setup !== 'object' || setup.status !== 'requires_payment_method' || setup.last_setup_error) return false;
  if (!link.stripe_customer_id || idOf(setup.customer) !== link.stripe_customer_id) return false;
  if (!setup.metadata || setup.metadata.card_link_id !== String(link.id) || setup.usage !== 'off_session') return false;
  return typeof setup.client_secret === 'string' && setup.client_secret !== '';
}

// openCardEntry(stripe, link) -> the SetupIntent the link kept (setup_intent_id) when it is still an open card entry, else null: nothing kept, a
// link its reader did not find 'ok' (the count the caller makes next decides whether it lives), Stripe could not be reached or does not know
// it, or it is not reusable (another status, a failed confirm, another link's). The caller starts a new entry then. A read that fails for any
// reason other than Stripe not knowing the id is one fixed line.
async function openCardEntry(stripe, link) {
  if (!link.setup_intent_id || link.state !== 'ok') return null;
  try {
    const setup = await stripe.setupIntents.retrieve(link.setup_intent_id);
    return reusableCardEntry(setup, link) ? setup : null;
  } catch (err) {
    if (!refusedByStripe(err)) console.error('A card entry could not be read:', err && (err.code || err.type || err.name));
    return null;
  }
}

// keepCardEntry(execute, link, setup) puts the id of the SetupIntent just made on the link, so a reload of the page finds it again. The link is
// not used yet, or the write does nothing. The page does not need it kept to go on, so a write that fails is one fixed line and not an error.
async function keepCardEntry(execute, link, setup) {
  if (typeof setup.id !== 'string' || setup.id === '') return;
  try {
    await execute('UPDATE booking_card_links SET setup_intent_id = ? WHERE id = ? AND used_at IS NULL', [setup.id, link.id]);
  } catch (err) {
    console.error('A card entry could not be kept:', err && (err.code || err.name));
  }
}

// startCardSetup(stripe, execute, link) starts one card entry for a link found by findCardLink in the state 'ok'. A link that already has an
// open one is handed it again and spends nothing, so a reload, a link preview or a second tab cost one try between them (ENG-013 F7); the
// state was read by the caller a moment before, and the confirm asks again. Otherwise it counts the attempt first, in one statement that also
// asks whether the link is still alive, and only then calls Stripe: the SetupIntent saves a card for later and holds nothing, and its id is
// kept on the link for the next call. A failed confirm leaves its mark on the SetupIntent, which is then not reused: the next call is a new
// entry and a new try, so the ten tries bound the entries a page was given after a failure, not what a client does with one secret it holds.
// stripe may be null (no key on the server): nothing is counted or changed then.
//   -> { ok: true, client_secret } | { ok: false, reason: 'unavailable' | 'dead' }
// 'unavailable': no Stripe client, or Stripe could not be reached or answered badly; 'dead': the link stopped being usable between
// the read and the write (expired, used, out of attempts).
export async function startCardSetup(stripe, execute, link) {
  if (!stripe) return { ok: false, reason: 'unavailable' };

  const open = await openCardEntry(stripe, link);
  if (open) return { ok: true, client_secret: open.client_secret };

  const counted = await execute(
    'UPDATE booking_card_links SET attempts = attempts + 1 WHERE id = ? AND attempts < ? AND used_at IS NULL AND expires_at > NOW()',
    [link.id, CARD_LINK_ATTEMPTS],
  );
  if (!counted || counted.affectedRows !== 1) return { ok: false, reason: 'dead' };

  try {
    const customer = await ensureStripeCustomer(stripe, execute, link);
    const setup = await stripe.setupIntents.create({
      customer,
      usage: 'off_session',
      payment_method_types: ['card'],
      metadata: { card_link_id: String(link.id), booking_id: String(link.booking_id) },
    });
    if (!setup || typeof setup.client_secret !== 'string') return { ok: false, reason: 'unavailable' };
    await keepCardEntry(execute, link, setup);
    return { ok: true, client_secret: setup.client_secret };
  } catch (err) {
    console.error('A card entry could not be started:', err && (err.code || err.type || err.name));
    return { ok: false, reason: 'unavailable' };
  }
}

// verifyCardSetup(stripe, setup, link) decides whether a retrieved SetupIntent is the one that put a card on this link's customer:
// it succeeded, its customer is the link's, it was made for this link, it is for off-session use and its payment method is a card.
// The brand and last four come from Stripe's payment method, never from the request. The payment method arrives expanded; one that
// arrives as an id is read.
//   -> { ok: true, paymentMethod, brand, last4 } | { ok: false, reason: 'invalid' | 'unavailable' }
async function verifyCardSetup(stripe, setup, link) {
  const invalid = { ok: false, reason: 'invalid' };
  if (!setup || typeof setup !== 'object' || setup.status !== 'succeeded') return invalid;
  if (!link.stripe_customer_id || idOf(setup.customer) !== link.stripe_customer_id) return invalid;
  if (!setup.metadata || setup.metadata.card_link_id !== String(link.id)) return invalid;
  if (setup.usage !== 'off_session') return invalid;

  let method = setup.payment_method;
  if (typeof method === 'string' && method) {
    try {
      method = await stripe.paymentMethods.retrieve(method);
    } catch (err) {
      if (refusedByStripe(err)) return invalid;
      console.error('A saved card could not be read:', err && (err.code || err.type || err.name));
      return { ok: false, reason: 'unavailable' };
    }
  }
  if (!method || typeof method !== 'object' || typeof method.id !== 'string' || method.type !== 'card' || !method.card) return invalid;
  const owner = idOf(method.customer);
  if (owner && owner !== link.stripe_customer_id) return invalid;

  const brand = typeof method.card.brand === 'string' ? method.card.brand.slice(0, 30) : '';
  const last4 = method.card.last4;
  if (!brand || typeof last4 !== 'string' || !/^\d{4}$/.test(last4)) return invalid;
  return { ok: true, paymentMethod: method.id, brand, last4 };
}

// saveCardSetup(stripe, execute, link, setupIntentId) puts the card of a verified SetupIntent on the link, once per issue: the
// write only lands on a row whose used_at is still empty, so of two confirms racing, one saves and the other is told 'used'.
//   -> { ok: true, card: { brand, last4 } } | { ok: false, reason: 'used' | 'invalid' | 'unavailable' }
// 'used': a card is already on file for this issue; 'invalid': the SetupIntent is not found, is not this link's or this customer's,
// is not a finished card setup; 'unavailable': no Stripe client, or Stripe could not be reached. Nothing is saved unless ok.
export async function saveCardSetup(stripe, execute, link, setupIntentId) {
  if (Number(link.used)) return { ok: false, reason: 'used' };
  if (!stripe) return { ok: false, reason: 'unavailable' };

  let setup;
  try {
    setup = await stripe.setupIntents.retrieve(setupIntentId, { expand: ['payment_method'] });
  } catch (err) {
    if (refusedByStripe(err)) return { ok: false, reason: 'invalid' };
    console.error('A card setup could not be read:', err && (err.code || err.type || err.name));
    return { ok: false, reason: 'unavailable' };
  }

  const checked = await verifyCardSetup(stripe, setup, link);
  if (!checked.ok) return checked;

  const saved = await execute(
    'UPDATE booking_card_links SET setup_intent_id = ?, payment_method_id = ?, card_brand = ?, card_last4 = ?, used_at = NOW() WHERE id = ? AND used_at IS NULL',
    [setup.id || setupIntentId, checked.paymentMethod, checked.brand, checked.last4, link.id],
  );
  if (!saved || saved.affectedRows !== 1) return { ok: false, reason: 'used' };
  return { ok: true, card: { brand: checked.brand, last4: checked.last4 } };
}
