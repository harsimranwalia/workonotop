// @ts-check
// ENG-019: the seams that no single spec joins. The cases of this file are named by the acceptance map (e2e/acceptance/contract.js) by their title prefix
// ("Seams: W9 queue:", "Seams: W9 claim:", "Seams: W2 charge:", "Seams: W8 queue:", "Seams: W8 alerts:", "Seams: W8 charge:", "Seams: W10 booked:",
// "Seams: W1 quote:"); the file's name, the describe and the title together are the baseline key.
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
//              108.00) nor the charge moves;
//   W8 queue   all five kinds of on-site report (nobody answers, the details are wrong, the home is unhygienic, more items, the job cannot be done) are
//              sent from the job link by a cleaner who has signed in and ticked in, as the page sends them (one multipart body: kind, note, photo), and are
//              read back from the admin report queue (GET /api/admin/reports) with the photo, the note, the sender and the job; the photo is a file in the
//              store and is served as the bytes that were sent;
//   W8 alerts  one case per kind: the provider of the job and each admin are told by text and by e-mail, and nobody else is (not the cleaner who sent it, not
//              the customer); the notice rows are the record, their outcome is read from the row (`not_configured` on a stack with no Twilio or mail
//              credential, so each case is ATTEMPTED and says what is missing, `credentialGap`, and is never a PASS);
//   W8 charge  an add-more-items report the admin approves is priced by the server from the service's price list (an oven and two fridges, 95.00 = 9500
//              cents, hand-worked), charged once, on a payment of its own under the report's key, and the provider's share is worked out; a sum the server did
//              not work out is refused, a second approval is refused, and a declined report and one left open charge nothing and move no booking money. The
//              approve route answers 503 without a Stripe key, so the decision (decideReport in src/lib/report-desk.js) runs IN PROCESS on the rows the real
//              routes left, with the Stripe stand-in of W2 charge: the clause is `in-process`;
//   W10 booked a weekly series booked by a signed-in customer is texted and e-mailed to the customer once, on the first visit, and not once for each of the
//              twelve (the rows of notice_attempts are the record);
//   W1 quote   a quote request posted to the public route is listed to the admin (GET /api/quote-requests) and shown on the admin job page with the
//              customer's contact, the address, the pick that sent the job to a quote, the message and a way to book it.
// The config runs one worker, so the cases run one at a time and in order. The database is the dev database the way e2e/acceptance-roles.spec.js reaches
// it. Every row this file makes has an e-mail address that starts with EMAIL_PREFIX (bookings and quote requests) or a number in +1 403 555 0730 to 0759
// (customers, and the crew members of later cases), so the sweep before the first case, after every case and after the last removes exactly its own rows,
// the notice rows those cases caused and the sms_budget counters they spent. A notice is written after the answer that caused it, so the sweep waits
// until the record has stopped changing before it deletes. A failure message names the case, the status and the route, never a cookie or a token.
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { getCredentialHeaders } from './auth/credentials.js';
import { RESET_RETRIES, signInAs } from './support/auth.js';
import { credentialGap } from './support/credentials.js';
import { FIXTURE_LOGINS, users, providers } from '../database/fixtures/accounts.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';
import { collectBookingPayment } from '../src/lib/booking-payment.js';
import { cardOnFile } from '../src/lib/booking-card.js';
import { sha256Hex } from '../src/lib/link-token.js';
import { NOTICE_KINDS } from '../src/lib/notice-templates.js';
import { decideReport } from '../src/lib/report-desk.js';
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

// The fixture admin: the one account of the three in `users` that holds the admin role.
const ADMIN = users[2];

// The report photos: the app stores each under public/uploads/job-photos with a random name and the report row names the file.
const PHOTO_DIRECTORY = path.join(process.cwd(), 'public', 'uploads', 'job-photos');
const STORED_NAME = /^[0-9a-f]{32}\.(jpg|png|webp)$/;
const PHOTO_URL = /^\/uploads\/job-photos\/[0-9a-f]{32}\.(jpg|png|webp)$/;
// A minimal JPEG the photo store accepts: start of image, a JFIF header, a start of scan with two bytes of data and the end of image.
const TINY_JPEG = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0x34, 0xff, 0xd9,
]);

// The five kinds of on-site report, with the label the office reads for each (the cleaner's page offers the same five) and a note of a cleaner's own.
const KINDS = [
    { code: 'no_answer', label: 'Customer did not answer', note: 'Knocked and called twice, no one came to the door' },
    { code: 'details_wrong', label: 'Job details are incorrect', note: 'The address has a back lane entrance and no front door' },
    { code: 'unhygienic', label: 'Unhygienic conditions', note: 'The kitchen has not been cleaned for weeks' },
    { code: 'add_items', label: 'Add more items', note: 'The customer also wants the oven and both fridges done' },
    { code: 'cannot_complete', label: 'Unable to complete the job', note: 'The water is off in the whole building' },
];

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

// The stored photo files of the directory, by name; [] when the directory is not there yet.
async function photoFiles() {
    try {
        return (await fs.readdir(PHOTO_DIRECTORY)).filter((name) => STORED_NAME.test(name)).sort();
    } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes(/** @type {any} */ (error).code)) return [];
        throw error;
    }
}

// The files that were in the directory when a case began: whatever else is there when it ends is the case's own.
let filesBefore = new Set();

async function removeNewFiles() {
    for (const name of await photoFiles()) {
        if (!filesBefore.has(name)) await fs.rm(path.join(PHOTO_DIRECTORY, name), { force: true });
    }
}

// Deletes what this file left: the files of the report photos its bookings hold, the sms_budget counters of its numbers, the notice rows and logs of its
// bookings and quote requests, the quote requests, the bookings of its e-mail prefix (their invoices, sessions, links, codes, check-ins, reports and crew
// rows go with them) and the crew members of its block.
async function sweepOnce() {
    const open = await db();
    const mine = `${EMAIL_PREFIX}%`;
    // The photo store makes its directory when it first needs one, and the dev container runs as root: a directory made here first is the test user's,
    // and the sweep can remove the files the app writes into it.
    await fs.mkdir(PHOTO_DIRECTORY, { recursive: true });
    const ids = (await rows('SELECT id FROM bookings WHERE customer_email LIKE ?', [mine])).map((row) => row.id);
    if (ids.length > 0) {
        for (const report of await rows(`SELECT photo_url FROM job_reports WHERE booking_id IN (${marks(ids)}) AND photo_url IS NOT NULL`, ids)) {
            if (PHOTO_URL.test(report.photo_url)) await fs.rm(path.join(process.cwd(), 'public', report.photo_url), { force: true });
        }
    }
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
// last, then the connection is closed. Every case also notes the photo files there are when it begins and removes the ones it added.
function sweepAround() {
    test.beforeAll(async () => {
        startMax = Number((await rows('SELECT COALESCE(MAX(id), 0) AS m FROM notice_attempts'))[0].m);
        await clearRows();
    });
    test.beforeEach(async () => {
        numbersUsed = 0;
        filesBefore = new Set(await photoFiles());
    });
    test.afterEach(async () => {
        try {
            await removeNewFiles();
        } finally {
            await clearRows();
        }
    });
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

// The sessions a case sends, as request headers (the cookie styles of getCredentialHeaders; the second provider signs in by its own route, unless the
// case has no use for a second provider).
async function setup(playwright, request, baseURL, { second = true } = {}) {
    const styles = await getCredentialHeaders(String(baseURL));
    return {
        playwright,
        baseURL: String(baseURL),
        request: guarded(request),
        admin: styles['admin-cookie'],
        customer: styles['customer-cookie'],
        provider1: styles['provider-cookie'],
        provider2: second ? await signedInAs(playwright, String(baseURL), 'provider2') : null,
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

// A quote request as the page posts it: service 1, the commercial property type (a quote verdict of the rule), a valid contact; `fields` replaces or adds to it.
const QUOTE_MESSAGE = 'A warehouse floor of about 4,000 square feet, to be cleaned once after a refit.';
function quoteBody(what, fields = {}) {
    return {
        service_id: 1, answers: COMMERCIAL, name: 'E2E Seam', email: mail(what), phone: typed(nextNumber()), address: '1 Probe Street, Calgary',
        message: QUOTE_MESSAGE,
        ...fields,
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

// ---- a cleaner at work: a job with a crew, the cleaner's sign-in and tick-in, and the reports the cleaner sends from the job link ----

// The job's own clock: every probe job falls in America/Toronto (Calgary has no cluster).
const ZONE = 'America/Toronto';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The calendar day in Toronto of an instant: 'YYYY-MM-DD'.
function torontoDay(instant) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
    const get = (type) => parts.find((part) => part.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
}

const plusDays = (day, count) => new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + count)).toISOString().slice(0, 10);
// A label as the checkout writes one day's slot: 'Oct 17: Morning'.
const slotLabel = (day, slot) => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}: ${slot}`;
// Yesterday: a job dated then has its check-in window open now, whatever the hour.
const yesterday = () => plusDays(torontoDay(new Date()), -1);

// The address of every probe job (Calgary), and a cleaner standing at it.
const ADDRESS = { latitude: 51.04473, longitude: -114.07192 };
const HERE = { ...ADDRESS, accuracy: 12.4 };

// A booking of provider 1 that is confirmed, in Calgary, in the Morning slot of yesterday, with a position, the rule's price and the default commission.
// `paymentIntentId` is the payment a checkout would have left on it.
async function insertBooking(paymentIntentId = null) {
    const id = tag();
    const day = yesterday();
    const [made] = /** @type {any[]} */ (await (await db()).execute(
        `INSERT INTO bookings (booking_number, service_id, service_name, service_price, commission_percent, customer_first_name, customer_last_name, customer_email, customer_phone,
           job_date, job_time_slot, job_description, address_line1, city, status, payment_status, payment_intent_id, provider_id, latitude, longitude)
         VALUES (?, 1, ?, ?, 20.00, 'E2E', 'Seam', ?, ?, ?, ?, 'ENG-019 seam probe, deleted by the case', '1 Probe Street', 'Calgary', 'confirmed', 'pending', ?, ?, ?, ?)`,
        [`E2EASM${id}`, SERVICE_NAME, RULE_PRICE, `${EMAIL_PREFIX}${id}@example.invalid`, stored(NUMBER_LAST), day, slotLabel(day, 'Morning'), paymentIntentId, PROVIDER1.id, ADDRESS.latitude, ADDRESS.longitude],
    ));
    return Number(made.insertId);
}

// A provider adds a cleaner through the crew route, with the next number of this file's block.
async function addCleaner(ctx, name) {
    const number = nextNumber();
    const body = await bodyOf(await call(ctx, 'POST', '/api/provider/crew', ctx.provider1, { name, phone: typed(number) }), 201, `provider 1 adds ${name}`);
    return { id: body.data.member.id, name, number };
}

// The proof the number-check routes leave behind: a used row for the member and the number they have now.
async function markChecked(member) {
    const [current] = await rows('SELECT phone FROM provider_crew_members WHERE id = ?', [member.id]);
    await (await db()).execute('INSERT INTO crew_number_checks (crew_member_id, phone, code_hash, expires_at, used_at) VALUES (?, ?, ?, NOW(), NOW())', [member.id, current.phone, sha256Hex(`asm-probe:${tag()}`)]);
}

// The six digits of the member's live code on a link, found by hashing every candidate against code_hash (a text cannot be read in dev).
async function findCode(linkId, memberId) {
    const [row] = await rows('SELECT code_hash FROM job_link_codes WHERE link_id = ? AND crew_member_id = ? AND used_at IS NULL AND expires_at > NOW() ORDER BY id DESC LIMIT 1', [linkId, memberId]);
    expect(row !== undefined, 'a live code row exists for the member').toBe(true);
    for (let n = 0; n < 1_000_000; n += 1) {
        const candidate = String(n).padStart(6, '0');
        if (sha256Hex(`${linkId}:${memberId}:${candidate}`) === row.code_hash) return candidate;
    }
    throw new Error('no six-digit code fits the stored hash');
}

// A cleaner opens the link: the number is checked, a code is asked for through the route, found from its hash and given back. The cookie comes from a
// context of its own so that no jar carries it into the next request; it is returned as a `jls_{link id}={value}` string for a `cookie` header, and
// never printed.
async function signInWith(ctx, job, member) {
    await markChecked(member);
    const asked = await ctx.request.post(`/api/job/${job.token}/code`, { data: { phone: typed(member.number) }, timeout: REQUEST_TIMEOUT });
    expect(asked.status(), `${member.name} asks for a code`).toBe(200);
    const code = await findCode(job.linkId, member.id);
    const fresh = await ctx.playwright.request.newContext({ baseURL: ctx.baseURL });
    try {
        const verified = await guarded(fresh).post(`/api/job/${job.token}/verify`, { data: { phone: typed(member.number), code }, timeout: REQUEST_TIMEOUT });
        expect(verified.status(), `${member.name} gives the code back`).toBe(200);
        const line = verified.headersArray().filter((header) => header.name.toLowerCase() === 'set-cookie').map((header) => header.value).find((value) => value.startsWith(`jls_${job.linkId}=`));
        expect(line !== undefined, `the answer sets the session cookie of link ${job.linkId}`).toBe(true);
        return { cookie: String(line).split(';')[0] };
    } finally {
        await fresh.dispose();
    }
}

// A probe job of provider 1 with a cleaner on its crew and a link made by the provider's route.
async function makeJob(ctx, member, paymentIntentId = null) {
    const bookingId = await insertBooking(paymentIntentId);
    await bodyOf(await call(ctx, 'PUT', `/api/provider/jobs/${bookingId}/crew`, ctx.provider1, { crew_ids: [member.id] }), 200, `provider 1 puts ${member.name} on job ${bookingId}`);
    const created = await bodyOf(await call(ctx, 'POST', `/api/provider/jobs/${bookingId}/job-link`, ctx.provider1, { action: 'create' }), 200, 'provider 1 makes the job link');
    const linkPath = created.data.job_link?.path;
    expect(typeof linkPath === 'string' && /^\/job\/[A-Za-z0-9_-]{43}$/.test(linkPath), 'the link has a path of 43 base64url characters').toBe(true);
    const [link] = await rows('SELECT id FROM job_links WHERE booking_id = ?', [bookingId]);
    return { bookingId, token: String(linkPath).slice('/job/'.length), linkId: link.id };
}

// A job with one cleaner (Ann) on its crew, signed in at the link and ticked in at the address: the state in which the link takes a report.
async function cleanerAtWork(ctx, paymentIntentId = null) {
    const ann = await addCleaner(ctx, 'Ann');
    const job = await makeJob(ctx, ann, paymentIntentId);
    const cleaner = await signInWith(ctx, job, ann);
    await bodyOf(await call(ctx, 'POST', `/api/job/${job.token}/check-in`, cleaner, { crew_ids: [ann.id], location: HERE }), 200, 'Ann ticks in');
    return { ann, job, cleaner };
}

// A report as the cleaner's page sends it: the kind, a note and a photo, in one multipart body.
function postReport(ctx, work, kind) {
    const multipart = { type: kind.code, note: kind.note, photo: { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: TINY_JPEG } };
    return ctx.request.post(`/api/job/${work.job.token}/reports`, { headers: work.cleaner, multipart, timeout: REQUEST_TIMEOUT });
}

// A report the link takes; answers its id.
async function sendReport(ctx, work, kind) {
    const body = await bodyOf(await postReport(ctx, work, kind), 200, `the cleaner sends a ${kind.code} report`);
    expect(body.data.again, `the ${kind.code} report is new`).toBe(false);
    expect(Number.isInteger(body.data.report.id), `the ${kind.code} report has an id`).toBe(true);
    return /** @type {number} */ (body.data.report.id);
}

// ---- the notices a case caused, read from the rows ----

// Reads until the answer is the one wanted, for at most `ms`; the last read is returned either way, so the assertion that follows names what was there.
async function eventually(read, done, ms = 10_000) {
    const until = Date.now() + ms;
    for (;;) {
        const seen = await read();
        if (done(seen) || Date.now() >= until) return seen;
        await sleep(250);
    }
}

const noticeRows = (bookingId, kind) => rows('SELECT channel, recipient_kind, recipient_ref, outcome FROM notice_attempts WHERE booking_id = ? AND kind = ? ORDER BY channel, recipient_kind, recipient_ref', [bookingId, kind]);
// Who was told, as sorted 'channel kind ref' lines. An address given by the environment (ADMIN_EMAIL) is an admin with no id; it is left out.
const toldOf = (list) => list.filter((row) => row.recipient_ref !== null).map((row) => `${row.channel} ${row.recipient_kind} ${row.recipient_ref}`).sort();
const adminIds = async () => (await rows("SELECT id FROM users WHERE role = 'admin' ORDER BY id")).map((row) => row.id);

// A notice reached the point of an attempt: the gateway took it (sent), had nothing to send with (not_configured) or answered with something that is not a
// delivery (rejected, unsure). A refusal before an attempt (a budget, a bad number) is none of these.
const REACHED = ['sent', 'not_configured', 'rejected', 'unsure'];

// The outcome of every row of a channel, read from the row. On a stack with no credential for the channel the attempt stops at not_configured and the case
// has been marked "verified by attempt" (credentialGap); with the credential the outcome is any of REACHED.
function expectAttempted(list, channel, missing, who) {
    const mine = list.filter((row) => row.channel === channel);
    expect(mine.length > 0, `${who}: the ${channel} rows are there to read`).toBe(true);
    for (const row of mine) {
        const label = `${who}: ${channel} to ${row.recipient_kind} ${row.recipient_ref}`;
        if (missing.length > 0) expect(row.outcome, `${label}: the stack has no ${channel} credential, so the attempt stops there`).toBe('not_configured');
        else expect(REACHED, `${label}: the outcome ${row.outcome}`).toContain(row.outcome);
    }
}

// ---- the charging module's pool: shaped as src/lib/db.js is: execute(sql, params) -> rows, and withConnection(work) with a connection of its own ----

/** @type {import('mysql2/promise').Pool | null} */
let pool = null;
async function poolOf() {
    await db();
    return (pool ??= mysql.createPool(DB));
}
const run = async (sql, params = []) => (await (await poolOf()).execute(sql, params))[0];
const withConnection = async (work) => {
    const held = await (await poolOf()).getConnection();
    try {
        return await work(held);
    } finally {
        held.release();
    }
};

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

// W8: what a cleaner reports from the job link reaches the office. The job is provider 1's, confirmed and dated yesterday so that the tick-in window is open;
// the cleaner (Ann) signs in at the link with a code found from its hash and ticks in at the address, which is what the link requires before it takes a report.
test.describe('Seams acceptance: what a cleaner reports from the job link reaches the office', () => {
    sweepAround();
    test.afterAll(async () => {
        if (pool) await pool.end();
        pool = null;
    });

    // W8 (admin queue), case 9: the five kinds, each with a photo, in the queue the office reads.
    test('Seams: W8 queue: all five kinds of on-site report a cleaner sends from the job link are in the admin report queue, each with its photo, note, sender and job', async ({ playwright, request, baseURL }) => {
        const ctx = await setup(playwright, request, baseURL, { second: false });
        const work = await cleanerAtWork(ctx);
        const sent = [];
        for (const kind of KINDS) sent.push({ kind, id: await sendReport(ctx, work, kind) });
        const [job] = await rows("SELECT booking_number, DATE_FORMAT(job_date, '%Y-%m-%d') AS day, job_time_slot FROM bookings WHERE id = ?", [work.job.bookingId]);

        const answer = await bodyOf(await call(ctx, 'GET', `/api/admin/reports?status=open&booking_id=${work.job.bookingId}&limit=50`, ctx.admin), 200, 'the admin reads the open reports of the job');
        const { reports, open_count: openCount, next_before: nextBefore } = answer.data;
        expect(reports.map((report) => report.id), 'the queue holds the five, newest first').toEqual(sent.map((one) => one.id).reverse());
        expect(nextBefore, 'and there is no page after them').toBeNull();
        expect(openCount, 'the count of reports waiting on the office is the count the database holds').toBe(
            Number((await rows("SELECT COUNT(*) AS n FROM job_reports WHERE status = 'open' OR (status = 'approved' AND charge_status IN ('pending', 'failed'))"))[0].n),
        );

        const files = await photoFiles();
        const shown = new Set();
        for (const { kind, id } of sent) {
            const report = reports.find((entry) => entry.id === id);
            expect(report !== undefined, `the ${kind.code} report is in the queue`).toBe(true);
            expect([report.type, report.label, report.note, report.status, report.decision], `${kind.code}: the kind, its label, the cleaner's own note, waiting, not decided`).toEqual([kind.code, kind.label, kind.note, 'open', null]);
            expect(report.by, `${kind.code}: sent by the cleaner`).toEqual({ kind: 'cleaner', name: 'Ann' });
            expect(report.booking, `${kind.code}: the job it was sent from`).toEqual({ id: work.job.bookingId, number: job.booking_number, service: SERVICE_NAME, date: job.day, slot: job.job_time_slot, customer: 'E2E Seam' });
            expect(report.added_items, `${kind.code}: only an add-more-items report carries items to price`).toEqual(
                kind.code === 'add_items' ? { lines: [], cents: null, charge: 'none', reason: null, provider_share_cents: null } : null,
            );
            expect(report.photo, `${kind.code}: the photo's address`).toMatch(PHOTO_URL);
            expect(files, `${kind.code}: the photo is a file in the store`).toContain(path.basename(report.photo));
            shown.add(report.photo);
            const served = await ctx.request.get(report.photo, { headers: ctx.admin, timeout: REQUEST_TIMEOUT });
            expect([served.status(), served.headers()['content-type']], `${kind.code}: the photo is served as a JPEG`).toEqual([200, 'image/jpeg']);
            expect((await served.body()).equals(TINY_JPEG), `${kind.code}: the bytes served are the bytes the cleaner sent`).toBe(true);
        }
        expect(shown.size, 'each report has a photo of its own').toBe(KINDS.length);
    });

    // W8 (alerts), case 10: one report, the owner and every admin told on both channels, never the cleaner who sent it. The notice rows are the record, and
    // their outcome is read from the row; the dev stack has no texting or mail credential, so the attempt is the proof and each case says so.
    for (const kind of KINDS) {
        test(`Seams: W8 alerts: a "${kind.code}" report from a cleaner texts and e-mails the provider and each admin, and not the cleaner who sent it`, async ({ playwright, request, baseURL }, testInfo) => {
            const missingSms = credentialGap(testInfo, 'sms');
            const missingMail = credentialGap(testInfo, 'email');
            const ctx = await setup(playwright, request, baseURL, { second: false });
            const work = await cleanerAtWork(ctx);
            await sendReport(ctx, work, kind);

            const admins = await adminIds();
            expect(admins, 'the fixture admin is one of the admins').toContain(ADMIN.id);
            const expected = ['email', 'sms'].flatMap((channel) => [`${channel} provider ${PROVIDER1.id}`, ...admins.map((id) => `${channel} admin ${id}`)]).sort();
            const told = await eventually(() => noticeRows(work.job.bookingId, 'report_added'), (list) => toldOf(list).length >= expected.length && list.every((row) => row.outcome !== 'pending'));
            expect(toldOf(told), 'the provider of the job and each admin are told on both channels').toEqual(expected);
            expect(told.filter((row) => !['admin', 'provider'].includes(row.recipient_kind)), 'nobody else is told: not the cleaner who sent it, not the customer').toEqual([]);
            const known = told.filter((row) => row.recipient_ref !== null);
            expectAttempted(known, 'sms', missingSms, `a ${kind.code} report`);
            expectAttempted(known, 'email', missingMail, `a ${kind.code} report`);

            // One report is one notice: the rows are the same a moment later.
            await sleep(1500);
            expect(await noticeRows(work.job.bookingId, 'report_added'), 'nothing is added once the notice is done').toEqual(told);
        });
    }

    // What a decision on a report must leave as it found it: the booking's money fields and the number of rows in the two tables that hold what the platform
    // owes a provider and what it bills (counted whole, so a row written for any booking shows).
    const MONEY_FIELDS = ['service_price', 'status', 'payment_status', 'payment_intent_id', 'commission_percent', 'authorized_amount', 'provider_amount', 'final_provider_amount'];
    async function untouched(bookingId) {
        const [booking] = await rows(`SELECT ${MONEY_FIELDS.join(', ')} FROM bookings WHERE id = ?`, [bookingId]);
        const [{ n: payouts }] = await rows('SELECT COUNT(*) AS n FROM provider_payouts');
        const [{ n: invoices }] = await rows('SELECT COUNT(*) AS n FROM invoices');
        return { booking, payouts: Number(payouts), invoices: Number(invoices) };
    }
    const reportRow = async (id) => (await rows('SELECT status, charge_status, approved_cents, charge_intent_id, decided_by FROM job_reports WHERE id = ?', [id]))[0];

    // W8 (charged after approval), case 11: the charge follows the admin's approval, for the cents the server priced, once. The dev stack holds no Stripe key, so the
    // desk's decision runs IN PROCESS (src/lib/report-desk.js) against the dev database with the Stripe stand-in of this file, on reports the cleaner sent through the
    // route: the clause is `in-process`, and the handoff note says so.
    test('Seams: W8 charge: an add-more-items report the admin approves is priced by the server and charged once on a payment of its own, and a declined one and one left open charge nothing', async ({ playwright, request, baseURL }) => {
        const ctx = await setup(playwright, request, baseURL, { second: false });
        const checkout = `pi_asm_checkout_${tag()}`;
        const work = await cleanerAtWork(ctx, checkout);
        const bookingId = work.job.bookingId;
        const items = KINDS.find((kind) => kind.code === 'add_items');
        const approved = await sendReport(ctx, work, items);
        const declined = await sendReport(ctx, work, { ...items, note: 'The customer also wants the garage swept' });
        const waiting = await sendReport(ctx, work, { ...items, note: 'The customer also wants the windows done' });

        // The office reads the service's price list on the report: the oven is 35.00 and a fridge is 30.00, so an oven and two fridges are 95.00 = 9500 cents
        // (hand-worked), of which the provider keeps 80 % at the booking's 20.00 commission: 76.00 = 7600 cents.
        const detail = await bodyOf(await call(ctx, 'GET', `/api/admin/reports/${approved}`, ctx.admin), 200, 'the admin opens the report');
        expect(detail.data.catalogue.filter((item) => ['oven', 'fridge'].includes(item.code)).map((item) => [item.code, item.amount]).sort(), 'the price list the admin picks from').toEqual([['fridge', 30], ['oven', 35]]);
        const EXTRAS = [{ code: 'oven', quantity: 1 }, { code: 'fridge', quantity: 2 }];
        const SUM = 9500;
        const SHARE = 7600;

        for (const [what, id] of [['approved', approved], ['declined', declined], ['left open', waiting]]) {
            expect(await reportRow(id), `before any decision, the report to be ${what} is waiting and nothing is priced`).toEqual({ status: 'open', charge_status: 'none', approved_cents: null, charge_intent_id: null, decided_by: null });
        }
        const before = await untouched(bookingId);
        const stripe = stripeStandIn(heldFor(checkout, RULE_CENTS));
        const desk = (id, over = {}) => decideReport({ withConnection, execute: run, stripe, currency: 'cad', id, admin: { id: ADMIN.id }, action: 'approve', note: 'Agreed with the customer on site', extras: EXTRAS, expectedCents: SUM, ...over });

        // A sum that is not the one the server prices is refused before anything is recorded or charged, and says what the sum is.
        const wrong = await desk(approved, { expectedCents: SUM - 100 });
        expect([wrong.ok, wrong.reason, wrong.cents], 'a sum of 94.00 is refused with the price the server worked out').toEqual([false, 'price_changed', SUM]);
        expect(stripe.calls, 'no call to Stripe for the refusal').toEqual([]);
        expect((await reportRow(approved)).status, 'and the report is still waiting').toBe('open');

        const result = await desk(approved);
        expect(result.ok, JSON.stringify(result)).toBe(true);
        expect(result.report.status, 'the approved report').toBe('approved');
        expect(result.report.added_items, 'the items are priced by the server, recorded and paid').toMatchObject({ cents: SUM, charge: 'paid', reason: null, provider_share_cents: SHARE });
        expect(result.report.added_items.lines.map((line) => [line.code, line.quantity, line.amount]), 'the lines the server priced').toEqual([['oven', 1, '35.00'], ['fridge', 2, '60.00']]);
        const created = stripe.calls.filter((entry) => entry[0] === 'create');
        expect(created.length, 'one payment is made').toBe(1);
        expect(created[0][1], 'for the priced cents, on the card of the customer\'s checkout payment').toMatchObject({ amount: SUM, currency: 'cad', customer: 'cus_asm_1', payment_method: 'pm_asm_1', metadata: { booking_id: String(bookingId), report_id: String(approved) } });
        expect(created[0][2], 'under the report\'s own key').toEqual({ idempotencyKey: `report-${approved}-added-items-charge` });
        expect(stripe.calls.filter((entry) => entry[0] === 'confirm').length, 'and confirmed once').toBe(1);
        expect(stripe.calls.filter((entry) => entry[0] === 'capture'), 'the booking\'s own payment is not captured').toEqual([]);
        expect(stripe.received(), 'the checkout\'s authorization took nothing and the payment made took the priced cents').toEqual([0, SUM]);
        expect(await reportRow(approved), 'the report row').toEqual({ status: 'approved', charge_status: 'paid', approved_cents: SUM, charge_intent_id: 'pi_asm_made_1', decided_by: ADMIN.id });

        // A second approval of the same report is refused and charges nothing more.
        const calls = stripe.calls.length;
        const again = await desk(approved);
        expect([again.ok, again.reason], 'the second approval').toEqual([false, 'decided']);
        expect(stripe.calls.length, 'no call to Stripe for the second approval').toBe(calls);

        // A report that is declined calls no Stripe and records nothing priced; one left open stays as it was.
        const turnedDown = await desk(declined, { action: 'decline', note: 'Not needed', extras: undefined, expectedCents: undefined });
        expect([turnedDown.ok, turnedDown.report?.status, turnedDown.report?.added_items?.charge], JSON.stringify(turnedDown)).toEqual([true, 'declined', 'none']);
        expect(stripe.calls.length, 'no call to Stripe for the decline').toBe(calls);
        expect(await reportRow(declined), 'the declined report row').toEqual({ status: 'declined', charge_status: 'none', approved_cents: null, charge_intent_id: null, decided_by: ADMIN.id });
        expect(await reportRow(waiting), 'the report left open').toEqual({ status: 'open', charge_status: 'none', approved_cents: null, charge_intent_id: null, decided_by: null });
        expect(await untouched(bookingId), 'the booking\'s money fields and the rows of provider_payouts and invoices are as they were: the one charge is the only money that moved').toEqual(before);

        // The office reads the outcome of the three in its own queue.
        const after = await bodyOf(await call(ctx, 'GET', `/api/admin/reports?status=all&booking_id=${bookingId}&limit=50`, ctx.admin), 200, 'the admin reads the three reports again');
        const seen = new Map(after.data.reports.map((report) => [report.id, report]));
        expect([approved, declined, waiting].map((id) => seen.get(id)?.status), 'the queue shows the three decisions').toEqual(['approved', 'declined', 'open']);
        expect(seen.get(approved)?.added_items, 'the approved report in the queue').toMatchObject({ cents: SUM, charge: 'paid', provider_share_cents: SHARE });
        expect(seen.get(approved)?.decision?.note, 'with the admin\'s note').toBe('Agreed with the customer on site');
        expect(seen.get(waiting)?.added_items, 'the report left open in the queue').toEqual({ lines: [], cents: null, charge: 'none', reason: null, provider_share_cents: null });
    });
});

// W10: the customer is told once of a booking, and a series is one booking.
test.describe('Seams acceptance: the notice of a booked series', () => {
    sweepAround();

    // W10 (job booked), case 17: a weekly series saves twelve jobs and tells the customer once, on the first visit's number and no other.
    test('Seams: W10 booked: a weekly series booked by a signed-in customer is texted and e-mailed to the customer once, on the first visit, and not once for each of the twelve', async ({ playwright, request, baseURL }, testInfo) => {
        const missingSms = credentialGap(testInfo, 'sms');
        const missingMail = credentialGap(testInfo, 'email');
        const ctx = await setup(playwright, request, baseURL, { second: false });
        // As the booking screens send it: one date and one slot, each in a list, and the frequency in the answers.
        const body = checkoutBody('series', { job_date: [WEDNESDAY], job_time_slot: [slotLabel(WEDNESDAY, 'Morning')], answers: { ...TWO_AND_ONE, date: WEDNESDAY, frequency: 'weekly' } });
        const answer = await bodyOf(await call(ctx, 'POST', '/api/bookings', ctx.customer, body), 200, 'the signed-in customer books a weekly series');

        const visits = await rows('SELECT id, series_visit FROM bookings WHERE customer_email = ? ORDER BY series_visit, id', [body.email]);
        expect(visits.map((visit) => Number(visit.series_visit)), 'twelve visits are saved, numbered from one').toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
        expect(visits[0].id, 'visit 1 is the booking the answer names').toBe(answer.booking_id);
        const ids = visits.map((visit) => visit.id);

        const noticesOfSeries = () => rows(`SELECT booking_id, channel, recipient_kind, recipient_ref, outcome FROM notice_attempts WHERE kind = 'job_booked' AND booking_id IN (${marks(ids)}) ORDER BY CAST(channel AS CHAR), booking_id`, ids);
        const told = await eventually(noticesOfSeries, (list) => list.length >= 2 && list.every((row) => row.outcome !== 'pending'));
        expect(told.map((row) => [row.booking_id, row.channel, row.recipient_kind, String(row.recipient_ref)]), 'one text and one e-mail, to the customer, both on the first visit').toEqual([
            [answer.booking_id, 'email', 'customer', String(users[0].id)],
            [answer.booking_id, 'sms', 'customer', String(users[0].id)],
        ]);
        expectAttempted(told, 'sms', missingSms, 'the booked series');
        expectAttempted(told, 'email', missingMail, 'the booked series');

        await sleep(1500);
        expect(await noticesOfSeries(), 'nothing is added for the other eleven visits once the notice is done').toEqual(told);
    });
});

// W1: a quote request a customer sends is in the admin's queue of requests, on the page the admin works from.
test.describe('Seams acceptance: a quote request reaches the admin page', () => {
    sweepAround();
    const ADMIN_VISIT_MS = 90_000;
    // The label the fixture catalogue gives the commercial property type, the pick the rule sends to a quote.
    const COMMERCIAL_LABEL = 'Commercial (placeholder figure)';

    // W1 (quote in the queue), case 18: the request a customer sends is listed to the admin with everything the office needs to call them, and with a way to book it.
    test('Seams: W1 quote: a quote request a customer sends is on the admin job page with the contact, the address, the pick that sent it to a quote and the message, and can be booked', async ({ page, playwright, request, baseURL }) => {
        test.setTimeout(240_000);
        const ctx = await setup(playwright, request, baseURL, { second: false });
        const name = `E2E Seam ${tag()}`;
        const body = quoteBody('page', { name });
        // The list and the link's text carry the number as sent; the tel: link is its digits with the leading +.
        const phone = body.phone.replace(/\s/g, '');
        const sent = await bodyOf(await call(ctx, 'POST', '/api/quote-requests', ctx.customer, body), 201, 'the customer sends the quote request');

        const listed = await quoteListed(ctx, sent.id);
        expect(listed !== undefined, `the admin's list holds quote request ${sent.id}`).toBe(true);
        expect([listed.customer_name, listed.customer_email, listed.customer_phone, listed.address, listed.service_name, listed.message, listed.booking_id, listed.booking_number],
            'the list carries the contact, the address, the service and the message as sent, and no booking yet').toEqual([name, body.email, body.phone, body.address, SERVICE_NAME, QUOTE_MESSAGE, null, null]);
        expect(listed.picks.filter((pick) => pick.flagged === true).map((pick) => pick.code), 'the pick that sent the job to a quote is flagged').toEqual(['commercial']);

        await signInAs(page, 'admin');
        await page.goto('/admin/jobs', { timeout: ADMIN_VISIT_MS });
        const section = page.getByTestId('quote-requests');
        await expect(section).toBeVisible({ timeout: ADMIN_VISIT_MS });
        const row = section.getByTestId('quote-request-row').filter({ hasText: name });
        await expect(row).toHaveCount(1);
        await expect(row.getByRole('heading', { level: 3 })).toHaveText(name);
        await expect(row.getByRole('link', { name: body.email })).toHaveAttribute('href', `mailto:${body.email}`);
        await expect(row.getByRole('link', { name: body.phone })).toHaveAttribute('href', `tel:${phone}`);
        await expect(row).toContainText(body.address);
        await expect(row).toContainText(SERVICE_NAME);
        await expect(row.getByRole('listitem').filter({ hasText: COMMERCIAL_LABEL }), 'the pick that sent the job to a quote is marked in words').toContainText('Needs quote');
        await expect(row).toContainText(QUOTE_MESSAGE);
        await expect(row.getByRole('button', { name: 'Book this' }), 'a request with no booking can be booked from the page').toBeVisible();
    });
});
