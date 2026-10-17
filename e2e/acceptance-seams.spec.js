// @ts-check
// ENG-019: the seams that no single spec joins. The cases of this file are named by the acceptance map (e2e/acceptance/contract.js) by their title prefix
// ("Seams: W9 queue:", "Seams: W9 claim:", "Seams: W2 charge:"); the file's name, the describe and the title together are the baseline key.
//   W9 queue   a booking an admin made for a customer, and a booking made from a customer's quote request, are rows of the admin job queue
//              (GET /api/bookings?queue=1) as waiting, and as assigned once the admin assigns them. The queue is read a page at a time until the
//              booking is found, so the answer does not depend on how many other jobs the queue holds. e2e/marketplace.spec.js reads the queue for
//              bookings made by the checkout, and e2e/recurring-visits.spec.js for a series; these are the two other ways a job comes to the queue;
//   W9 claim   a provider's claim BY ID of a job assigned to another provider is refused 403 and the job is left as it was. The design of this ticket
//              expected a 409 here; the route answers 403 `Forbidden` for a job that is neither the caller's own nor open to everyone, and 409 only to
//              the caller's own job, which has a provider already (src/app/api/provider/available-jobs/[id]/route.js, the ownership check before the
//              409). The case asserts the route's answers and says so. The same claim through the body route (the one the page uses) is asked beside it,
//              and the assignee is let in through that route, so a refusal is read beside an acceptance;
//   W2 charge  the recorded price meets the amount charged. A job is booked through a real route (the checkout with a device price of one cent, the
//              admin's booking for a customer), the price it stores is the pricing rule's (a hand-worked literal: 80.00 base + 2 bedrooms at 20.00 +
//              1 bathroom at 15.00 on a weekday = 135.00), and the charging module (src/lib/booking-payment.js) is then run IN PROCESS on the row the
//              route stored, with a Stripe stand-in that behaves as Stripe does (a capture takes what it is asked for, a created intent is confirmed
//              for its own amount): the amount it asks for is the stored price in cents, 13500, and what the stand-in received is the same. The dev
//              stack holds no Stripe key, so no live charge is possible: the clause is `in-process` and the handoff note says so. The provider's finish
//              enters hours and a crew size of the provider's choosing; neither the stored price nor the payout (the price less the 20 % commission,
//              108.00) nor the charge moves.
// The config runs one worker, so the cases run one at a time and in order. The database is the dev database the way e2e/acceptance-roles.spec.js reaches
// it. Every row this file makes has an e-mail address that starts with EMAIL_PREFIX (bookings and quote requests) or a number in +1 403 555 0730 to 0759
// (customers, and the crew members of later cases), so the sweep before the first case, after every case and after the last removes exactly its own rows,
// the notice rows those cases caused and the sms_budget counters they spent. A notice is written after the answer that caused it, so the sweep waits
// until the record has stopped changing before it deletes. A failure message names the case, the status and the route, never a cookie or a token.
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { getCredentialHeaders } from './auth/credentials.js';
import { RESET_RETRIES } from './support/auth.js';
import { FIXTURE_LOGINS, users, providers } from '../database/fixtures/accounts.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';
import { collectBookingPayment } from '../src/lib/booking-payment.js';
import { cardOnFile } from '../src/lib/booking-card.js';
import { NOTICE_KINDS } from '../src/lib/notice-templates.js';
import { budgetScope } from '../src/lib/sms-budget.js';
import { normalisePhone } from '../src/lib/phone.js';

// Every request carries a fixture account's session header and a trace records request headers: tracing is off, as in e2e/auth-matrix.spec.js.
test.use({ trace: 'off' });
// `next dev` compiles a route on its first request; a case sends a handful of them.
test.describe.configure({ timeout: 180_000 });

const [PROVIDER1, PROVIDER2] = providers;
const EMAIL_PREFIX = 'e2e-asm-';
// The number block of this file: the digits after '+1 403 555 0'.
const NUMBER_FIRST = 730;
const NUMBER_LAST = 759;
const stored = (n) => `+14035550${n}`;
const typed = (n) => `+1 403 555 0${n}`;
// Each case takes its numbers from the start of the block again: its rows and counters are swept before the next.
let numbersUsed = 0;
const nextNumber = () => {
    if (NUMBER_FIRST + numbersUsed > NUMBER_LAST) throw new Error('the case needs more numbers than the block has');
    numbersUsed += 1;
    return NUMBER_FIRST + numbersUsed - 1;
};

const REQUEST_TIMEOUT = 60_000;
// A token, wherever it turns up in a failure message, is hidden.
const TOKEN_SHAPE = /[A-Za-z0-9_-]{43}/g;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A job on a Wednesday: the weekend surcharge is on the booking's first date, so a literal price needs a weekday (e2e/on-behalf-booking.spec.js).
const WEDNESDAY = '2026-10-21';
const TWO_AND_ONE = { units: { bedrooms: 2, bathrooms: 1 } };
const COMMERCIAL = { property_type: 'commercial' };
const SERVICE_NAME = 'Fixture Standard Clean';
// Worked by hand from the fixture rule of service 1: 80.00 + 2 x 20.00 + 15.00 = 135.00; the default commission is 20 %, so the payout is 108.00.
const RULE_PRICE = 135;
const RULE_CENTS = 13500;
const RULE_PAYOUT = 108;

const FORBIDDEN = { success: false, message: 'Forbidden' };
const TAKEN = { success: false, message: 'Job already accepted by another provider' };
const UPDATED = { success: true, message: 'Booking updated successfully' };

// ---- the dev database, the way e2e/acceptance-roles.spec.js reaches it ----

// One object feeds both the guard and the connection, so the guard certifies the values that get used (as database/fixtures/load.js).
const DB = { host: '127.0.0.1', port: 3307, user: 'root', password: 'root123', database: 'workontap_db' };

/** @type {import('mysql2/promise').Connection | null} */
let connection = null;

// The one connection of this worker, opened on first use, after the guard has checked the target and the rows in it.
async function db() {
    if (connection) return connection;
    assertDevTarget(DB);
    let opened;
    try {
        opened = await mysql.createConnection(DB);
    } catch (error) {
        throw new Error(`the dev database did not accept a connection at ${DB.host}:${DB.port} (${/** @type {any} */ (error).code || 'no code'}); the test command runs the container with --network host`, { cause: error });
    }
    try {
        await assertNoRealPeople(opened);
    } catch (error) {
        await opened.end();
        throw error;
    }
    connection = opened;
    return connection;
}

// Every statement of this file is prepared, with a ? for every value.
async function rows(sql, params = []) {
    const [found] = await (await db()).execute(sql, params);
    return /** @type {any[]} */ (found);
}
const marks = (list) => list.map(() => '?').join(', ');

// The highest notice_attempts id when the file starts: a quote request's notices belong to no booking, so they are told from the rest by being newer.
let startMax = 0;

// What the record of this file's rows holds, as one string: it is the same twice running once the notices a case caused have all been written.
async function recordKey() {
    const mine = `${EMAIL_PREFIX}%`;
    const [booked] = await rows("SELECT COUNT(*) AS n, COALESCE(MAX(n.id), 0) AS top, COALESCE(SUM(n.outcome = 'pending'), 0) AS waiting FROM notice_attempts n JOIN bookings b ON b.id = n.booking_id WHERE b.customer_email LIKE ?", [mine]);
    const [quoted] = await rows("SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS top, COALESCE(SUM(outcome = 'pending'), 0) AS waiting FROM notice_attempts WHERE id > ? AND booking_id IS NULL AND kind = 'quote_requested'", [startMax]);
    const [logged] = await rows("SELECT COUNT(*) AS n FROM activity_logs a JOIN bookings b ON a.entity_type = 'booking' AND a.entity_id = b.id WHERE b.customer_email LIKE ?", [mine]);
    return { key: JSON.stringify([booked, quoted, logged]), waiting: Number(booked.waiting) + Number(quoted.waiting) };
}

// A notice runs after the answer that caused it, so a row can be written after the case has ended and its booking is gone. The record is read until it
// is the same twice running with no attempt still pending, for at most three seconds.
async function settle() {
    let last = null;
    for (let round = 0; round < 12; round += 1) {
        const seen = await recordKey();
        if (seen.waiting === 0 && seen.key === last) return;
        last = seen.key;
        await sleep(250);
    }
}

// Deletes what this file left: the sms_budget counters of its numbers, the notice rows and logs of its bookings and quote requests, the quote requests, the
// bookings of its e-mail prefix (their invoices, sessions, links, codes, check-ins, reports and crew rows go with them) and the crew members of its block.
async function sweepOnce() {
    const open = await db();
    const mine = `${EMAIL_PREFIX}%`;
    const ids = (await rows('SELECT id FROM bookings WHERE customer_email LIKE ?', [mine])).map((row) => row.id);
    const links = ids.length === 0 ? [] : await rows(`SELECT id FROM job_links WHERE booking_id IN (${marks(ids)})`, ids);
    const members = await rows('SELECT id FROM provider_crew_members WHERE phone BETWEEN ? AND ?', [stored(NUMBER_FIRST), stored(NUMBER_LAST)]);
    const quoted = await rows('SELECT customer_email FROM quote_requests WHERE customer_email LIKE ?', [mine]);
    if (ids.length > 0) {
        await open.execute(`DELETE FROM notice_attempts WHERE booking_id IN (${marks(ids)})`, ids);
        await open.execute(`DELETE FROM activity_logs WHERE entity_type = 'booking' AND entity_id IN (${marks(ids)})`, ids);
        await open.execute(`DELETE FROM booking_audit_logs WHERE booking_id IN (${marks(ids)})`, ids);
    }
    await open.execute("DELETE FROM notice_attempts WHERE id > ? AND booking_id IS NULL AND kind = 'quote_requested'", [startMax]);
    await open.execute('DELETE FROM quote_requests WHERE customer_email LIKE ?', [mine]);
    await open.execute('DELETE FROM bookings WHERE customer_email LIKE ?', [mine]);
    await open.execute('DELETE FROM provider_crew_members WHERE phone BETWEEN ? AND ?', [stored(NUMBER_FIRST), stored(NUMBER_LAST)]);

    // The numbers the cases text: this file's block and the fixtures' own (the admin, the providers and the customers are told by routes too).
    const numbers = [];
    for (let n = NUMBER_FIRST; n <= NUMBER_LAST; n += 1) numbers.push(stored(n));
    for (const person of [...users, ...providers]) {
        const phone = normalisePhone(person.phone);
        if (phone.ok) numbers.push(phone.phone);
    }
    const scopes = [budgetScope('platform', 'day'), budgetScope('provider', PROVIDER1.id), budgetScope('provider', PROVIDER2.id)];
    for (const shift of [0, -86_400_000, 86_400_000]) scopes.push(budgetScope('platform-warned', new Date(Date.now() + shift).toISOString().slice(0, 10)));
    for (const number of numbers) {
        scopes.push(budgetScope('number', number));
        for (const kind of NOTICE_KINDS) scopes.push(budgetScope('kind', kind, number));
    }
    scopes.push(budgetScope('kind-platform', 'quote_requested'), budgetScope('mail-kind', 'quote_requested'));
    for (const { customer_email: address } of quoted) scopes.push(budgetScope('mail', 'quote_requested', String(address).toLowerCase()));
    for (const link of links) {
        scopes.push(budgetScope('ask', link.id), budgetScope('verify', link.id));
        for (const member of members) scopes.push(budgetScope('cooldown', link.id, member.id));
    }
    for (const member of members) scopes.push(budgetScope('check_ask', member.id));
    for (let from = 0; from < scopes.length; from += 200) {
        const chunk = scopes.slice(from, from + 200);
        await open.execute(`DELETE FROM sms_budget WHERE scope IN (${marks(chunk)})`, chunk);
    }
}

// The sweep is sent again when MySQL picks it as the victim of a deadlock or a lock wait against another request's writes (1213, 1205).
async function clearRows() {
    await settle();
    for (let attempt = 1; ; attempt += 1) {
        try {
            return await sweepOnce();
        } catch (error) {
            if (attempt >= 3 || ![1213, 1205].includes(/** @type {any} */ (error)?.errno)) throw error;
            await sleep(300 * attempt);
        }
    }
}

// The hooks of a describe that uses the database: a sweep before its first case, after every case (also a case that failed or timed out) and after its
// last, then the connection is closed.
function sweepAround() {
    test.beforeAll(async () => {
        startMax = Number((await rows('SELECT COALESCE(MAX(id), 0) AS m FROM notice_attempts'))[0].m);
        await clearRows();
    });
    test.beforeEach(() => {
        numbersUsed = 0;
    });
    test.afterEach(clearRows);
    test.afterAll(async () => {
        if (!connection) return;
        try {
            await clearRows();
        } finally {
            await connection.end();
            connection = null;
        }
    });
}

// ---- requests ----

// Playwright's own errors name the URL of the call that failed and, below their first line, its headers (a cookie): every request this file sends goes
// through a context whose errors are cut to their first line, with anything shaped like a token hidden.
function guarded(context) {
    const through = (verb) => async (url, options) => {
        try {
            return await context[verb](url, options);
        } catch (error) {
            throw new Error(`${verb.toUpperCase()} ${String(url).replace(TOKEN_SHAPE, '{token}')} could not be sent: ${String(/** @type {any} */ (error)?.message ?? error).split('\n')[0].replace(TOKEN_SHAPE, '{token}')}`);
        }
    };
    return { get: through('get'), post: through('post'), put: through('put'), fetch: through('fetch') };
}

const COOKIE_OF = { provider2: 'provider_token' };
// Signs the second fixture provider in through its own login route and returns its session cookie as a request header; it is never printed.
async function signedInAs(playwright, baseURL, who) {
    const login = FIXTURE_LOGINS[who];
    const context = await playwright.request.newContext({ baseURL });
    try {
        const response = await guarded(context).post(login.loginRoute, { data: { email: login.email, password: login.password }, maxRetries: RESET_RETRIES, timeout: REQUEST_TIMEOUT });
        expect(response.status(), `${who} signs in`).toBe(200);
        const held = (await context.storageState()).cookies.find((entry) => entry.name === COOKIE_OF[who]);
        expect(held, `${who}'s ${COOKIE_OF[who]} cookie`).toBeTruthy();
        return { cookie: `${COOKIE_OF[who]}=${held?.value}` };
    } finally {
        await context.dispose();
    }
}

// The sessions a case sends, as request headers (the cookie styles of getCredentialHeaders; the second provider signs in by its own route).
async function setup(playwright, request, baseURL) {
    const styles = await getCredentialHeaders(String(baseURL));
    return {
        request: guarded(request),
        admin: styles['admin-cookie'],
        provider1: styles['provider-cookie'],
        provider2: await signedInAs(playwright, String(baseURL), 'provider2'),
    };
}

function call(ctx, method, url, headers, data) {
    return ctx.request.fetch(url, { method, headers, data, maxRetries: RESET_RETRIES, timeout: REQUEST_TIMEOUT });
}

// The whole body of an answer that succeeded. The message of a refusal is named, never the whole body (a success holds a card link's path).
async function bodyOf(response, status, who) {
    const body = await response.json().catch(() => null);
    expect(response.status(), `${who}: status (${body?.success === false ? body.message : 'no message'})`).toBe(status);
    expect(body?.success, `${who}: success`).toBe(true);
    return body;
}

// The exact answer of a refusal: status and the whole body (a refusal holds a message and no secret).
async function expectBody(response, status, body, who) {
    expect(response.status(), `${who}: status`).toBe(status);
    expect(await response.json().catch(() => null), `${who}: body`).toEqual(body);
}

// ---- the bodies ----

let sequence = 0;
const tag = () => `${Date.now().toString(36)}${(sequence += 1)}`;
const mail = (what) => `${EMAIL_PREFIX}${what}-${tag()}@workontap.test`;

// The body of a booking an admin makes for a customer who phoned in; `fields` replaces or adds to it (e2e/on-behalf-booking.spec.js).
function behalfBody(what, fields = {}) {
    return {
        service_id: 1, first_name: 'E2E', last_name: 'Seam', email: mail(what), phone: typed(nextNumber()),
        job_date: WEDNESDAY, job_time_slot: '09:00', job_description: 'ENG-019 seam probe, deleted by the case.',
        address_line1: '1 Probe Street', city: 'Calgary', answers: TWO_AND_ONE,
        ...fields,
    };
}

// The body of a checkout as the page posts it, with a device price of ONE CENT in it: the route must record the rule's price and not this one.
function checkoutBody(what, fields = {}) {
    return {
        service_id: 1, service_name: SERVICE_NAME, service_price: 0.01, additional_price: 0.01,
        first_name: 'E2E', last_name: 'Seam', email: mail(what), phone: typed(nextNumber()),
        job_date: WEDNESDAY, job_time_slot: '09:00', job_description: 'ENG-019 seam probe, deleted by the case.',
        address_line1: '1 Probe Street', city: 'Calgary', payment_intent_id: `pi_e2e_asm_${tag()}`, answers: TWO_AND_ONE,
        ...fields,
    };
}

// A quote request as the page posts it: service 1, the commercial property type (a quote verdict of the rule), a valid contact.
function quoteBody(what) {
    return {
        service_id: 1, answers: COMMERCIAL, name: 'E2E Seam', email: mail(what), phone: typed(nextNumber()), address: '1 Probe Street, Calgary',
        message: 'A warehouse floor of about 4,000 square feet, to be cleaned once after a refit.',
    };
}

// ---- making and reading jobs ----

// A booking made by the admin's route for a customer; answers { id, number, price }.
async function bookForCustomer(ctx, what, fields = {}) {
    const body = await bodyOf(await call(ctx, 'POST', '/api/admin/bookings', ctx.admin, behalfBody(what, fields)), 201, `the admin books "${what}" for a customer`);
    expect(Number.isInteger(body.booking_id), 'the booking has an id').toBe(true);
    return { id: /** @type {number} */ (body.booking_id), number: String(body.booking_number), price: Number(body.service_price) };
}

// A booking made by the public checkout; answers its id.
async function checkOut(ctx, what, fields = {}) {
    const body = await bodyOf(await call(ctx, 'POST', '/api/bookings', {}, checkoutBody(what, fields)), 200, `the customer checks out "${what}"`);
    expect(Number.isInteger(body.booking_id), 'the booking has an id').toBe(true);
    return /** @type {number} */ (body.booking_id);
}

// The booking as the admin reads it (GET /api/bookings/[id]: the row and its status_history, newest first).
async function adminRow(ctx, id) {
    const response = await call(ctx, 'GET', `/api/bookings/${id}`, ctx.admin);
    expect(response.status(), `admin reads booking ${id}`).toBe(200);
    return (await response.json()).data;
}

// What a refused write must leave as it was.
const standing = (row) => ({ provider_id: row.provider_id, status: row.status, marketplace_pushed_at: row.marketplace_pushed_at });
const history = (row, match) => row.status_history.filter((entry) => Object.entries(match).every(([field, value]) => entry[field] === value));

async function assign(ctx, id, data) {
    const response = await call(ctx, 'PUT', `/api/bookings?id=${id}`, ctx.admin, data);
    expect(response.status(), `admin updates booking ${id}`).toBe(200);
    expect(await response.json(), `admin updates booking ${id}: body`).toEqual(UPDATED);
}

// The booking's row in the admin job queue, read a page at a time (the queue is oldest first, so a booking just made is on the last page), or undefined
// when the queue does not hold it.
async function queueRow(ctx, id) {
    for (let offset = 0; ;) {
        const response = await call(ctx, 'GET', `/api/bookings?queue=1&limit=500&offset=${offset}`, ctx.admin);
        const body = await response.json().catch(() => null);
        expect([response.status(), body?.success], `admin reads the job queue from ${offset}`).toEqual([200, true]);
        const found = body.data.find((row) => row.id === id);
        if (found) return found;
        offset += body.data.length;
        if (body.data.length === 0 || offset >= body.total) return undefined;
    }
}

// The request as the admin lists it (GET /api/quote-requests: newest first, so a request just sent is on the first page), or undefined.
async function quoteListed(ctx, id) {
    const response = await call(ctx, 'GET', '/api/quote-requests?limit=200', ctx.admin);
    const body = await response.json().catch(() => null);
    expect([response.status(), body?.success], 'admin lists the quote requests').toEqual([200, true]);
    return body.data.find((row) => row.id === id);
}

const claimByBody = (ctx, headers, id) => call(ctx, 'POST', '/api/provider/available-jobs', headers, { booking_id: id });
const claimById = (ctx, headers, id) => call(ctx, 'POST', `/api/provider/available-jobs/${id}`, headers, {});

// ---- the charging module, in process, with a Stripe stand-in that behaves as Stripe does ----

// The calls are recorded as [method, ...arguments]. A capture takes what it is asked for (amount_to_capture), a created intent waits for its confirmation,
// and a confirmation takes the intent's own amount, so the amount received is whatever the module asked for and a wrong ask shows in what was received.
function stripeStandIn(held = null) {
    const calls = [];
    const intents = new Map();
    if (held) intents.set(held.id, { ...held });
    let made = 0;
    const find = (id) => {
        const intent = intents.get(id);
        if (!intent) throw Object.assign(new Error(`No such payment_intent: '${id}'`), { type: 'StripeInvalidRequestError', code: 'resource_missing', statusCode: 404 });
        return intent;
    };
    return {
        calls,
        received: () => [...intents.values()].map((intent) => intent.amount_received ?? 0),
        paymentIntents: {
            retrieve: async (id) => {
                calls.push(['retrieve', id]);
                return { ...find(id) };
            },
            capture: async (id, params, options) => {
                calls.push(['capture', id, params, options]);
                const intent = find(id);
                const next = { ...intent, status: 'succeeded', amount_received: params.amount_to_capture, amount_capturable: 0, latest_charge: `ch_${id}` };
                intents.set(id, next);
                return { ...next };
            },
            create: async (params, options) => {
                calls.push(['create', params, options]);
                made += 1;
                const id = `pi_asm_made_${made}`;
                intents.set(id, { id, status: 'requires_confirmation', amount: params.amount, currency: params.currency, customer: params.customer, payment_method: params.payment_method, metadata: params.metadata, latest_charge: null, amount_received: 0 });
                return { ...find(id) };
            },
            confirm: async (id, params) => {
                calls.push(['confirm', id, params]);
                const intent = find(id);
                const next = { ...intent, status: 'succeeded', amount_received: intent.amount, latest_charge: `ch_${id}` };
                intents.set(id, next);
                return { ...next };
            },
        },
        charges: {
            retrieve: async (id) => {
                calls.push(['charge', id]);
                throw new Error('the stand-in holds no charge to read');
            },
        },
    };
}

// The authorization a checkout holds on the customer's card: the price of the booking, as checkHeldPayment requires at the checkout, kept for capture.
function heldFor(intentId, cents) {
    return { id: intentId, status: 'requires_capture', capture_method: 'manual', amount: cents, amount_capturable: cents, currency: 'cad', customer: 'cus_asm_1', payment_method: 'pm_asm_1', latest_charge: null, amount_received: 0, metadata: {} };
}

// The booking row as the charging routes read it: SELECT * (a DECIMAL comes back as text, a DATE as a Date).
async function bookingRow(id) {
    const [row] = await rows('SELECT * FROM bookings WHERE id = ?', [id]);
    expect(row !== undefined, `booking ${id} is stored`).toBe(true);
    return row;
}

const centsOf = (row) => Math.round(parseFloat(row.service_price) * 100);

// The charge taken from a held checkout payment: the capture asks for exactly `cents`, once, under the booking's capture key, and the stand-in received them.
async function expectCaptured(id, cents, who) {
    const row = await bookingRow(id);
    const stripe = stripeStandIn(heldFor(row.payment_intent_id, cents));
    const result = await collectBookingPayment(stripe, row, { currency: 'cad', saveIntentId: async () => true, readIntentId: async () => row.payment_intent_id });
    expect(result, `${who}: the charge`).toEqual({ ok: true, chargeId: `ch_${row.payment_intent_id}`, amountCents: RULE_CENTS, overCollected: false });
    const captures = stripe.calls.filter((entry) => entry[0] === 'capture');
    expect(captures, `${who}: one capture, for the stored price in cents, under the booking's own key`).toEqual([['capture', row.payment_intent_id, { amount_to_capture: RULE_CENTS }, { idempotencyKey: `booking-${id}-capture` }]]);
    expect(RULE_CENTS, `${who}: the cents asked for are the stored price in cents`).toBe(centsOf(row));
    expect(stripe.received(), `${who}: what the stand-in received`).toEqual([RULE_CENTS]);
}

// ---- the cases ----

test.describe('Seams acceptance: the job queue, the claim by id and the charge', () => {
    sweepAround();

    // W9 (hard gate), case 14: the two other ways a job comes to the queue. The existing cases read the queue for bookings made by the checkout
    // (e2e/marketplace.spec.js, M1 and M6) and for a series (e2e/recurring-visits.spec.js).
    test('Seams: W9 queue: a booking an admin made for a customer is in the admin job queue as waiting, then as assigned once the admin assigns it', async ({ playwright, request, baseURL }) => {
        const ctx = await setup(playwright, request, baseURL);
        const made = await bookForCustomer(ctx, 'caller');
        expect(made.price, 'the admin booking records the rule price').toBe(RULE_PRICE);

        const waiting = await queueRow(ctx, made.id);
        expect(waiting !== undefined, `the queue holds booking ${made.id}`).toBe(true);
        expect([waiting.queue_state, waiting.provider_id, waiting.status, waiting.service_price, waiting.booking_number], 'in the queue as waiting, with no provider, at the rule price').toEqual(['waiting', null, 'pending', RULE_PRICE, made.number]);

        await assign(ctx, made.id, { provider_id: PROVIDER1.id, status: 'matching' });
        const assigned = await queueRow(ctx, made.id);
        expect(assigned !== undefined, `the queue still holds booking ${made.id} once it is assigned`).toBe(true);
        expect([assigned.queue_state, assigned.provider_id, assigned.status], 'in the queue as assigned to provider 1').toEqual(['assigned', PROVIDER1.id, 'matching']);
    });

    test('Seams: W9 queue: a booking made from a quote request is in the admin job queue as waiting, then as assigned once the admin assigns it', async ({ playwright, request, baseURL }) => {
        const ctx = await setup(playwright, request, baseURL);
        const sent = await bodyOf(await call(ctx, 'POST', '/api/quote-requests', {}, quoteBody('quote')), 201, 'the customer sends the quote request');
        const request1 = await quoteListed(ctx, sent.id);
        expect(request1 !== undefined, `the admin's list holds quote request ${sent.id}`).toBe(true);
        expect([request1.booking_id, request1.booking_number], 'the request has no booking yet').toEqual([null, null]);

        // The admin books it on the customer's behalf, past the quote verdict: the same two bedrooms and one bathroom, priced by the rule.
        const made = await bookForCustomer(ctx, 'quoted', { quote_request_id: sent.id, answers: { ...TWO_AND_ONE, ...COMMERCIAL } });
        expect(made.price, 'the booking made from the request records the rule price').toBe(RULE_PRICE);
        const linked = await quoteListed(ctx, sent.id);
        expect([linked.booking_id, linked.booking_number], 'the request now names the booking made from it').toEqual([made.id, made.number]);

        const waiting = await queueRow(ctx, made.id);
        expect(waiting !== undefined, `the queue holds booking ${made.id}`).toBe(true);
        expect([waiting.queue_state, waiting.provider_id, waiting.status, waiting.booking_number], 'in the queue as waiting, with no provider').toEqual(['waiting', null, 'pending', made.number]);

        await assign(ctx, made.id, { provider_id: PROVIDER1.id, status: 'matching' });
        const assigned = await queueRow(ctx, made.id);
        expect(assigned !== undefined, `the queue still holds booking ${made.id} once it is assigned`).toBe(true);
        expect([assigned.queue_state, assigned.provider_id, assigned.status], 'in the queue as assigned to provider 1').toEqual(['assigned', PROVIDER1.id, 'matching']);
    });

    // W9 (hard gate), case 15: a job that is assigned to one provider cannot be taken by another, by the route that names the job in its path. The
    // design expected a 409; the route answers 403 (the ownership check comes before the check that the job has a provider), so the case asks for the 403.
    test('Seams: W9 claim: a claim by id of a job assigned to another provider is refused with 403 and the job is left as it was', async ({ playwright, request, baseURL }) => {
        const ctx = await setup(playwright, request, baseURL);
        const made = await bookForCustomer(ctx, 'assigned');
        await assign(ctx, made.id, { provider_id: PROVIDER1.id, status: 'matching' });
        const before = await adminRow(ctx, made.id);
        expect(standing(before), 'the job is assigned to provider 1, matching, not on the marketplace').toEqual({ provider_id: PROVIDER1.id, status: 'matching', marketplace_pushed_at: null });

        await expectBody(await claimById(ctx, ctx.provider2, made.id), 403, FORBIDDEN, 'provider 2 claims it by id');
        await expectBody(await claimByBody(ctx, ctx.provider2, made.id), 409, TAKEN, 'provider 2 claims it through the body route');
        const refused = await adminRow(ctx, made.id);
        expect(standing(refused), 'after the refused claims: still provider 1\'s, matching').toEqual(standing(before));
        expect(refused.status_history, 'after the refused claims: no history row added').toEqual(before.status_history);

        // The control: the assignee takes the job through the body route, so a refusal is read beside an acceptance.
        const accepted = await bodyOf(await claimByBody(ctx, ctx.provider1, made.id), 200, 'provider 1 accepts the job assigned to them');
        expect(accepted.success, 'the assignee\'s acceptance').toBe(true);
        const confirmed = await adminRow(ctx, made.id);
        expect(standing(confirmed), 'after the acceptance: provider 1\'s, confirmed').toEqual({ provider_id: PROVIDER1.id, status: 'confirmed', marketplace_pushed_at: null });
        expect(history(confirmed, { status: 'confirmed' }).map((entry) => entry.notes), 'one confirmed history row, provider 1\'s').toEqual([`Accepted by provider #${PROVIDER1.id}`]);

        // An accepted job is still another provider's: the same refusal by id, and nothing moves.
        await expectBody(await claimById(ctx, ctx.provider2, made.id), 403, FORBIDDEN, 'provider 2 claims the accepted job by id');
        const after = await adminRow(ctx, made.id);
        expect(standing(after), 'after the second refusal: still provider 1\'s, confirmed').toEqual(standing(confirmed));
        expect(after.status_history, 'after the second refusal: no history row added').toEqual(confirmed.status_history);
    });

    // W2 (hard gate), case 16: the recorded price meets the amount charged.
    test('Seams: W2 charge: a checkout posted with a price of one cent is charged the rule\'s price, the stored price in cents', async ({ playwright, request, baseURL }) => {
        const ctx = await setup(playwright, request, baseURL);
        const id = await checkOut(ctx, 'device');
        const row = await bookingRow(id);
        expect(Number(row.service_price), 'the checkout recorded the rule price and not the one cent the body named').toBe(RULE_PRICE);
        expect(typeof row.payment_intent_id === 'string' && row.payment_intent_id.length > 0, 'the booking holds the payment the checkout named').toBe(true);
        await expectCaptured(id, RULE_CENTS, 'the checkout booking');
    });

    test('Seams: W2 charge: a booking an admin made for a customer is charged the rule\'s price on the card the customer put on file', async ({ playwright, request, baseURL }) => {
        const ctx = await setup(playwright, request, baseURL);
        const made = await bookForCustomer(ctx, 'phoned');
        const row = await bookingRow(made.id);
        expect(Number(row.service_price), 'the admin booking recorded the rule price').toBe(RULE_PRICE);
        expect(row.payment_intent_id, 'an admin booking holds no payment of its own').toBeNull();

        // The customer puts a card on file from the link they are texted; the dev stack has no Stripe key, so the row the link would leave is planted.
        await (await db()).execute(
            "UPDATE booking_card_links SET stripe_customer_id = 'cus_asm_1', payment_method_id = 'pm_asm_1', card_brand = 'visa', card_last4 = '4242', setup_intent_id = 'seti_asm_1', used_at = NOW() WHERE booking_id = ?",
            [made.id],
        );
        const card = await cardOnFile(rows, row);
        expect(card, 'the card on file is the one planted').toEqual({ customer: 'cus_asm_1', payment_method: 'pm_asm_1' });

        // A booking with no payment of its own is charged on or after its job's day; the job's day is given as the day it is.
        const stripe = stripeStandIn();
        const result = await collectBookingPayment(stripe, row, { currency: 'cad', today: WEDNESDAY, card, saveIntentId: async () => true, readIntentId: async () => null });
        expect(result, 'the charge').toEqual({ ok: true, chargeId: 'ch_pi_asm_made_1', amountCents: RULE_CENTS, overCollected: false });
        expect(stripe.calls.map((entry) => entry[0]), 'a charge is created, confirmed and read back').toEqual(['create', 'confirm', 'retrieve']);
        const [, params, options] = stripe.calls[0];
        expect([params.amount, params.currency, params.customer, params.payment_method, params.metadata, options], 'the charge is created for the stored price in cents on the card on file, under the booking\'s own key').toEqual([
            RULE_CENTS, 'cad', 'cus_asm_1', 'pm_asm_1', { booking_id: String(made.id) }, { idempotencyKey: `booking-${made.id}-completion-charge` },
        ]);
        expect(params.amount, 'the cents asked for are the stored price in cents').toBe(centsOf(row));
        expect(stripe.calls[1].slice(1), 'the charge is confirmed on the card on file, off session').toEqual(['pi_asm_made_1', { payment_method: 'pm_asm_1', off_session: true }]);
        expect(stripe.received(), 'what the stand-in received').toEqual([RULE_CENTS]);
    });

    test('Seams: W2 charge: a finish with hours and a crew size of the provider\'s choosing changes neither the bill nor the payout', async ({ playwright, request, baseURL }) => {
        const ctx = await setup(playwright, request, baseURL);
        const id = await checkOut(ctx, 'finish');
        // The job is provider 1's and in progress: the assignment and the start are not what this case asks about (e2e/acceptance-links.spec.js reads the
        // starts), so the state a start leaves is planted, with a stretch of half an hour already run.
        const open = await db();
        await open.execute(
            "UPDATE bookings SET provider_id = ?, status = 'in_progress', job_timer_status = 'running', accepted_at = NOW(), start_time = DATE_SUB(NOW(), INTERVAL 30 MINUTE) WHERE id = ?",
            [PROVIDER1.id, id],
        );
        await open.execute('INSERT INTO job_sessions (booking_id, provider_id, clock_in) VALUES (?, ?, DATE_SUB(NOW(), INTERVAL 30 MINUTE))', [id, PROVIDER1.id]);
        expect(Number((await bookingRow(id)).service_price), 'before the finish: the rule price').toBe(RULE_PRICE);

        // The provider finishes, entering ten hours of work for a crew of ten.
        const finished = await bodyOf(await call(ctx, 'POST', '/api/provider/jobs/time-tracking', ctx.provider1, {
            booking_id: id, action: 'stop', work_summary: 'Done', submitted_duration_minutes: 600, submitted_headcount: 10, adjustment_reason: 'ENG-019 seam probe',
        }), 200, 'the provider finishes the job');
        expect(finished.data.total_earnings, 'the payout the finish answers: the price less the commission').toBe(RULE_PAYOUT);

        const row = await bookingRow(id);
        expect([row.status, Number(row.service_price), Number(row.final_provider_amount), row.submitted_duration_minutes, row.submitted_headcount], 'the stored price and payout, beside the entries the provider made')
            .toEqual(['awaiting_approval', RULE_PRICE, RULE_PAYOUT, 600, 10]);
        await expectCaptured(id, RULE_CENTS, 'the finished job');
    });
});
