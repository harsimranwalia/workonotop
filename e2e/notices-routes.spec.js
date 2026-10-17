// e2e/notices-routes.spec.js
//
// ENG-018, step 6: the hooks. Each route that has an event in it hands the event its ids once its work has committed (`afterCommit(() => noticeX(execute,
// { ... }))`, src/lib/notice-events.js), and what the event attempts is recorded in notice_attempts. The library half (who is told, in what words, with a
// recording transport) is e2e/notices-events.spec.js; this file asks the RUNNING APP and reads the record. The dev stack holds no Twilio, SMTP or ADMIN_EMAIL
// credential, so every text and e-mail a route attempts ends 'not_configured' and nothing is sent. What is proved here is WHO the code tried to reach, by
// which channel, how many times, and that the answer of the route is the answer it gave before the hook was there. A receipt for this file says "verified
// by what the code attempts", never "delivered": each case annotates itself with credentialGap, and where a family has a credential the outcome may be any
// answer the carrier gave (sent, rejected, unsure), where it has none it must be 'not_configured'.
//
// The notice runs after the response (Next's after()), so a row is not there when the answer is. A case reads the record until the rows it expects are
// there, and then once more a moment later to prove that nothing else was written.
//
// The cases (the numbers are this file's own; E16, E18, E19 and E20 are the design's, and each says which case it is):
//   R1   a quote request with a phone: the customer by text and by e-mail, and the answer is the 201 it was
//   R2   a quote request without one: by e-mail only, and no row says a text was refused
//   R3   an admin's booking for a customer: the card link and no confirmation (decision (a)), and the answer still holds the link once; the stored token is a hash
//   R4   a customer's checkout: the booking is confirmed to the customer by text and e-mail
//   R5   an admin puts a provider on a job: that provider is told, and putting the same provider on again (as a number, or as the text a select sends) tells no one
//   R6   a reassign tells the new provider and not the old one
//   R7   a provider claims an open job by its number: the customer (a guest, reached through the booking's own columns) and the provider are told on both channels
//   R8   the same by the address of the job
//   R9   the accept of a job assigned to the provider (E20): once, and a second accept tells no one
//   R10  a provider makes a job link: each checked cleaner is texted, an unchecked one and one outside Canada are refused; a reissue tells them again; off tells no one
//   R11  an admin's link does the same
//   R12  a crew save that adds a cleaner texts that cleaner and no one else, and only while a link is on
//   R13  a number check that passes texts that cleaner for the open jobs whose link is on, and for no other
//   R14  an on-site report: the provider (when an admin sent it) and the admins, never the sender, a replay tells no one more, and no row holds the note
//   R15  the start and the finish of a job for a guest (E16, E19): a start that is refused tells no one, a start that commits tells the customer once
//   R16  the same for a customer with an account (E16): by text only
//   R17  a notice that cannot be made leaves the response of the route as it was (E18)
//
// The database is the dev database the way e2e/notices-events.spec.js reaches it (mysql2/promise, assertDevTarget before it connects, assertNoRealPeople on
// it). Every row this file makes has an e-mail address that starts with EMAIL_PREFIX (bookings, quote requests) or a number in +1403555 0470-0499 (crew,
// customers) or, for the one cleaner R10 puts abroad, the London number no one owns, so the sweep before and after each case removes exactly its own
// rows, the files its reports wrote and the budget it spent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { getCredentialHeaders } from './auth/credentials.js';
import { RESET_RETRIES } from './support/auth.js';
import { credentialGap } from './support/credentials.js';
import { FIXTURE_LOGINS, users, providers } from '../database/fixtures/accounts.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';
import { NOTICE_KINDS } from '../src/lib/notice-templates.js';
import { newLinkToken, sha256Hex } from '../src/lib/link-token.js';
import { budgetScope } from '../src/lib/sms-budget.js';
import { normalisePhone } from '../src/lib/phone.js';

// Tracing is off: the cases carry fixture sessions, and a trace records request headers and bodies.
test.use({ trace: 'off' });

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RUN = Date.now().toString(36);
const EMAIL_PREFIX = 'rt018-';
const FIRST_NUMBER = 470;
const BLOCK_SIZE = 30;
const e164At = (i) => `+1403555${String(FIRST_NUMBER + i).padStart(4, '0')}`;
const typed = (e164) => e164.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3');
let numbersUsed = 0;
const nextNumber = () => {
    if (numbersUsed >= BLOCK_SIZE) throw new Error('the case needs more numbers than the block has');
    numbersUsed += 1;
    return e164At(numbersUsed - 1);
};
let seq = 0;
const mail = (label) => `${EMAIL_PREFIX}${label}-${RUN}-${seq++}@notices.test`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const [PROVIDER1, PROVIDER2] = providers;
const ADMIN = users.find((user) => user.role === 'admin');
const CUSTOMER = users.find((user) => user.role === 'user');
// A London number from the range Ofcom keeps for drama: a number the texting rules refuse (not Canadian) that no one owns.
const ABROAD = '+442079460958';
const SERVICE_NAME = 'Fixture Standard Clean';
const COMMERCIAL = { property_type: 'commercial' };
const TWO_AND_ONE = { units: { bedrooms: 2, bathrooms: 1 } };

// ---- the dev database ----

const DB = { host: '127.0.0.1', port: 3307, user: 'root', password: 'root123', database: 'workontap_db' };

/** @type {import('mysql2/promise').Connection | null} */
let connection = null;

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

async function execute(sql, params = []) {
    const [result] = await (await db()).execute(sql, params);
    return /** @type {any} */ (result);
}
const rows = (sql, params = []) => /** @type {Promise<any[]>} */ (execute(sql, params));
const marks = (list) => list.map(() => '?').join(', ');

let startMax = 0;

// ---- the sweep: what this file made, and what it spent ----

async function sweep() {
    const open = await db();
    const mine = `${EMAIL_PREFIX}%`;
    // A report's photo is a file, and the row that names it is about to go.
    for (const photo of await rows('SELECT r.photo_url FROM job_reports r JOIN bookings b ON b.id = r.booking_id WHERE b.customer_email LIKE ?', [mine])) {
        if (/^\/uploads\/job-photos\/[0-9a-f]{32}\.(jpg|png|webp)$/.test(String(photo.photo_url))) await fs.promises.rm(path.join(ROOT, 'public', photo.photo_url), { force: true });
    }
    const ids = (await rows('SELECT id FROM bookings WHERE customer_email LIKE ?', [mine])).map((row) => row.id);
    const links = ids.length === 0 ? [] : await rows(`SELECT id FROM job_links WHERE booking_id IN (${marks(ids)})`, ids);
    // The cleaners this file makes: those with a number of its block and the one with the number abroad (R10), of the two fixture providers.
    const memberTest = '(phone BETWEEN ? AND ? OR phone = ?) AND provider_id IN (?, ?)';
    const memberArgs = [e164At(0), e164At(BLOCK_SIZE - 1), ABROAD, PROVIDER1.id, PROVIDER2.id];
    const members = await rows(`SELECT id FROM provider_crew_members WHERE ${memberTest}`, memberArgs);
    if (ids.length > 0) {
        await open.execute(`DELETE FROM notice_attempts WHERE booking_id IN (${marks(ids)})`, ids);
        await open.execute(`DELETE FROM activity_logs WHERE entity_type = 'booking' AND entity_id IN (${marks(ids)})`, ids);
    }
    await open.execute("DELETE FROM notice_attempts WHERE id > ? AND booking_id IS NULL AND kind = 'quote_requested'", [startMax]);
    await open.execute('DELETE FROM quote_requests WHERE customer_email LIKE ?', [mine]);
    await open.execute('DELETE FROM bookings WHERE customer_email LIKE ?', [mine]);
    await open.execute(`DELETE FROM provider_crew_members WHERE ${memberTest}`, memberArgs);

    // The numbers the cases text: this file's block and the fixtures' own (the admin, the providers and the customers are told by routes too).
    const numbers = [];
    for (let i = 0; i < BLOCK_SIZE; i += 1) numbers.push(e164At(i));
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

test.beforeAll(async () => {
    startMax = Number((await rows('SELECT COALESCE(MAX(id), 0) AS m FROM notice_attempts'))[0].m);
    await sweep();
});
test.afterEach(sweep);
test.afterAll(async () => {
    if (!connection) return;
    try {
        await sweep();
    } finally {
        await connection.end();
        connection = null;
    }
});

// ---- asking the app ----

async function signedInAs(playwright, baseURL, who) {
    const login = FIXTURE_LOGINS[who];
    const cookieName = { provider2: 'provider_token' }[who];
    const context = await playwright.request.newContext({ baseURL });
    try {
        const response = await context.post(login.loginRoute, { data: { email: login.email, password: login.password }, maxRetries: RESET_RETRIES, timeout: 60_000 });
        expect(response.status(), `${who} signs in`).toBe(200);
        const held = (await context.storageState()).cookies.find((entry) => entry.name === cookieName);
        expect(held, `${who}'s ${cookieName} cookie`).toBeTruthy();
        return { cookie: `${cookieName}=${held?.value}` };
    } finally {
        await context.dispose();
    }
}

// The sessions a case sends, as request headers (the cookie styles of getCredentialHeaders; the second provider signs in by its own route).
async function sessions(playwright, baseURL) {
    const styles = await getCredentialHeaders(String(baseURL));
    return {
        none: {}, admin: styles['admin-cookie'], customer: styles['customer-cookie'], provider1: styles['provider-cookie'],
        provider2: await signedInAs(playwright, baseURL, 'provider2'),
    };
}

function call(request, method, url, headers, data) {
    return request.fetch(url, { method, headers, data, maxRetries: RESET_RETRIES, timeout: 60_000 });
}

// ---- reading the record ----

const maxId = async () => Number((await rows('SELECT COALESCE(MAX(id), 0) AS m FROM notice_attempts'))[0].m);
const quoteRowsSince = (mark) => rows("SELECT channel, outcome, recipient_kind, recipient_ref, kind FROM notice_attempts WHERE id > ? AND booking_id IS NULL AND kind = 'quote_requested' ORDER BY id", [mark]);
const rowsOfBooking = (bookingId, kind = null) => rows(
    `SELECT channel, outcome, recipient_kind, recipient_ref, kind FROM notice_attempts WHERE booking_id = ?${kind === null ? '' : ' AND kind = ?'} ORDER BY id`,
    kind === null ? [bookingId] : [bookingId, kind]
);
const rowsOfBookings = (bookingIds) => rows(
    `SELECT channel, outcome, recipient_kind, recipient_ref, kind, booking_id FROM notice_attempts WHERE booking_id IN (${marks(bookingIds)}) ORDER BY id`,
    bookingIds
);

/**
 * Reads until `done(list)` holds and no row is still 'pending', or `wait` ms have passed, and answers the last read. A notice runs after the response, so its
 * rows are not there when the answer is; and a row is claimed 'pending' before the send, so it is there before its outcome is.
 */
async function eventually(read, done, { wait = 20_000 } = {}) {
    const until = Date.now() + wait;
    for (;;) {
        const list = await read();
        if ((done(list) && list.every((row) => row.outcome !== 'pending')) || Date.now() >= until) return list;
        await sleep(200);
    }
}

/** The record a moment later, for a case that proves nothing more was written. */
async function afterAWhile(read, ms = 1500) {
    await sleep(ms);
    return read();
}

// An outcome that says the transport was reached. With no credential for the channel's family it can only be 'not_configured' (checked here), with one it
// may be what the carrier said.
const REACHED = ['sent', 'not_configured', 'rejected', 'unsure'];

/**
 * The rows as [recipient_kind, channel, outcome] sorted, a reached outcome written 'attempted' after it has been checked against the credentials. With
 * `refs` each entry is [recipient_kind, recipient_ref, channel, outcome]: who, and not only what kind of person (null for a customer with no account).
 */
function brief(testInfo, list, { refs = false } = {}) {
    const missing = { sms: credentialGap(testInfo, 'sms').length > 0, email: credentialGap(testInfo, 'email').length > 0 };
    return list.map((row) => {
        const reached = REACHED.includes(row.outcome);
        if (reached && missing[row.channel]) expect(row.outcome, `${row.recipient_kind} ${row.channel}: no credential is set for it, so it is not_configured`).toBe('not_configured');
        const outcome = reached ? 'attempted' : row.outcome;
        return refs ? [row.recipient_kind, row.recipient_ref, row.channel, outcome] : [row.recipient_kind, row.channel, outcome];
    }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

const want = (...pairs) => [...pairs].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const BOTH = (who) => [[who, 'email', 'attempted'], [who, 'sms', 'attempted']];
const BOTH_TO = (who, ref) => [[who, ref, 'email', 'attempted'], [who, ref, 'sms', 'attempted']];

// ---- bodies ----

function quoteBody(fields = {}) {
    return { service_id: 1, answers: COMMERCIAL, name: 'Rhea Rowe', email: mail('q'), phone: typed(nextNumber()), address: '1 Probe Street, Calgary', message: 'A warehouse floor of about 4,000 square feet, to be cleaned once.', ...fields };
}

// The first Wednesday three or more days on, so that a date check or a weekend charge changes nothing here.
function aWednesday() {
    const day = new Date();
    day.setUTCDate(day.getUTCDate() + 3);
    while (day.getUTCDay() !== 3) day.setUTCDate(day.getUTCDate() + 1);
    return day.toISOString().slice(0, 10);
}

function behalfBody(fields = {}) {
    return {
        service_id: 1, first_name: 'Rhea', last_name: 'Rowe', email: mail('caller'), phone: typed(nextNumber()),
        job_date: aWednesday(), job_time_slot: '09:00', job_description: 'A job booked for a customer who phoned in, deleted by the case.',
        address_line1: '1 Probe Street', city: 'Calgary', answers: TWO_AND_ONE, ...fields,
    };
}

// A guest's checkout as the public form sends it (the date is past, as in the other specs: the route does not check it).
function checkoutBody(fields = {}) {
    return {
        service_id: 1, service_name: SERVICE_NAME, service_price: 80, additional_price: 40, first_name: 'Rhea', last_name: 'Rowe', email: mail('b'),
        phone: typed(nextNumber()), job_date: '2026-02-01', job_time_slot: '09:00', job_description: 'ENG-018 route probe, deleted by the case.',
        address_line1: '1 Probe Street', city: 'Calgary', payment_intent_id: `pi_e2e_rt018_${RUN}_${seq++}`, ...fields,
    };
}

// ---- rows the cases plant (SQL only, so that the route under test is the one sender) ----

const SLOT = 'Oct 17: Morning';

// `pushed` puts the job on the marketplace (an admin's push), which is what makes a job with no provider one a provider may claim.
async function mkBooking({ providerId = null, userId = null, status = 'confirmed', phone = nextNumber(), pushed = false } = {}) {
    const email = mail('b');
    const number = `RT${RUN}${seq++}`.toUpperCase();
    const made = await execute(
        `INSERT INTO bookings (booking_number, user_id, service_id, service_name, service_price, customer_first_name, customer_last_name, customer_email, customer_phone,
           job_date, job_time_slot, job_description, address_line1, city, postal_code, worker_count, status, payment_status, provider_id, latitude, longitude, marketplace_pushed_at)
         VALUES (?, ?, 1, ?, 80, 'Rhea', 'Rowe', ?, ?, DATE_FORMAT(CURDATE(), '%Y-%m-%d'), ?, 'x', '1 Probe Street', 'Calgary', 'T2P 0A1', 3, ?, 'pending', ?, 51.04473, -114.07192, IF(?, NOW(), NULL))`,
        [number, userId, SERVICE_NAME, email, phone, SLOT, status, providerId, pushed ? 1 : 0]
    );
    return { id: /** @type {number} */ (made.insertId), number, email, phone };
}

async function mkLink(bookingId, token = newLinkToken()) {
    const made = await execute('INSERT INTO job_links (booking_id, token, off_at) VALUES (?, ?, NULL)', [bookingId, token]);
    return { id: /** @type {number} */ (made.insertId), token };
}

async function mkMember(providerId, name, phone = nextNumber()) {
    const made = await execute('INSERT INTO provider_crew_members (provider_id, name, phone) VALUES (?, ?, ?)', [providerId, name, phone]);
    return { id: /** @type {number} */ (made.insertId), name, phone };
}

const putOnJob = (bookingId, memberId) => execute('INSERT INTO booking_crew (booking_id, crew_member_id, assigned_at) VALUES (?, ?, NOW())', [bookingId, memberId]);

// The provider's proof that a number is the cleaner's own (the row a passed number check leaves), made here so that no text is asked for.
const checkNumber = (member) =>
    execute('INSERT INTO crew_number_checks (crew_member_id, phone, code_hash, expires_at, used_at) VALUES (?, ?, ?, NOW() + INTERVAL 1 DAY, NOW())', [member.id, member.phone, sha256Hex(`rt${member.id}${RUN}`)]);

// A code the provider asked for and has not typed yet: the row askNumberCheck leaves, with the hash confirmNumberCheck compares (src/lib/crew-number-check.js).
const pendingCheck = (member, code) =>
    execute(
        'INSERT INTO crew_number_checks (crew_member_id, phone, code_hash, expires_at) VALUES (?, ?, ?, NOW() + INTERVAL 10 MINUTE)',
        [member.id, member.phone, sha256Hex(`check:${member.id}:${member.phone}:${code}`)]
    );

// A before photo for the job, which the provider's start asks for (ENG-016, AC2). The row names a file that is not there, as in e2e/price-of-record.spec.js.
const plantBeforePhoto = (bookingId) =>
    execute("INSERT INTO job_photos (booking_id, photo_url, photo_type, uploaded_by) VALUES (?, '/uploads/job-photos/00000000000000000000000000000000.jpg', 'before', ?)", [bookingId, PROVIDER1.id]);

// ---- the same help for a case that needs a booking made by the routes (a checkout, an assignment, a push) ----

const UPDATED = { success: true, message: 'Booking updated successfully' };

/** A guest's checkout through the public route (or a customer's, with their session); answers the booking's id. */
async function checkout(request, headers = {}, fields = {}) {
    const answer = await call(request, 'POST', '/api/bookings', headers, checkoutBody(fields));
    expect(answer.status(), 'the checkout makes the booking').toBe(200);
    const id = (await answer.json()).booking_id;
    expect(Number.isInteger(id), 'the booking has an id').toBe(true);
    return id;
}

// The rows that belong to one kind, the way a case asks for them.
const kindRows = (bookingId, kind) => rowsOfBooking(bookingId, kind);

// A report as the job link's page sends it: multipart, with a photo the server reads as a JPEG from its bytes (the bytes e2e/job-reports.spec.js sends).
const TINY_JPEG = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0x34, 0xff, 0xd9,
]);
// Words no notice may carry: the note of a report is the sender's own and is read by the office on its screen, never put in a message.
const CANARY_NOTE = 'ENG-018 canary note 7f3a91 do not repeat';

function postReport(request, token, headers, { type = 'no_answer', note = CANARY_NOTE, clientToken = null } = {}) {
    const boundary = `----nr018${RUN}`;
    const field = (name, value) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
    const body = Buffer.concat([
        Buffer.from(field('type', type) + field('note', note) + (clientToken === null ? '' : field('client_token', clientToken)), 'utf8'),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="photo.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`, 'latin1'),
        TINY_JPEG,
        Buffer.from(`\r\n--${boundary}--\r\n`, 'latin1'),
    ]);
    return call(request, 'POST', `/api/job/${token}/reports`, { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` }, body);
}

// The job-timer route, as the provider's screen calls it.
const timer = (request, headers, fields) => call(request, 'POST', '/api/provider/jobs/time-tracking', headers, fields);

// ---- the cases ----

test.describe('ENG-018 step 6: the hooks, asked of the running app', () => {
    test('R1: a quote request with a phone tells the customer by text and by e-mail after the 201, and the answer is the 201 it was', async ({ request }, testInfo) => {
        const mark = await maxId();
        const answer = await call(request, 'POST', '/api/quote-requests', {}, quoteBody());
        expect(answer.status(), 'the request is saved').toBe(201);
        expect(await answer.json(), 'the answer holds the id and nothing the notice made').toEqual({ success: true, id: expect.any(Number) });
        const told = await eventually(() => quoteRowsSince(mark), (list) => list.length >= 2);
        expect(brief(testInfo, told)).toEqual(want(...BOTH('customer')));
        expect((await afterAWhile(() => quoteRowsSince(mark))).length, 'nothing else is written').toBe(2);
    });

    test('R2: a quote request with no phone tells the customer by e-mail only, and no row says a text was refused', async ({ request }, testInfo) => {
        const mark = await maxId();
        const answer = await call(request, 'POST', '/api/quote-requests', {}, quoteBody({ phone: undefined }));
        expect(answer.status(), 'the request is saved').toBe(201);
        const told = await eventually(() => quoteRowsSince(mark), (list) => list.length >= 1);
        expect(brief(testInfo, told)).toEqual(want(['customer', 'email', 'attempted']));
        expect((await afterAWhile(() => quoteRowsSince(mark))).length, 'nothing else is written').toBe(1);
    });

    test('R3: an admin\'s booking for a customer tells the customer the card link and not a confirmation, and the answer still holds the link, once', async ({ playwright, request, baseURL }, testInfo) => {
        const as = await sessions(playwright, baseURL);
        const answer = await call(request, 'POST', '/api/admin/bookings', as.admin, behalfBody());
        const body = await answer.json();
        expect([answer.status(), body.success, typeof body.booking_id], 'the booking is made').toEqual([201, true, 'number']);
        expect(body.card_link?.path, 'the answer holds the link').toMatch(/^\/card\/[A-Za-z0-9_-]{43}$/);
        expect(Object.keys(body).sort(), 'the answer holds what it held before the hook').toEqual(['account_matched', 'booking_id', 'booking_number', 'card_link', 'quoted_minutes', 'service_price', 'success']);
        const told = await eventually(() => rowsOfBooking(body.booking_id), (list) => list.length >= 2);
        expect(brief(testInfo, told.filter((row) => row.kind === 'card_link'))).toEqual(want(...BOTH('customer')));
        expect(told.filter((row) => row.kind !== 'card_link'), 'no confirmation goes with the card link (decision (a))').toEqual([]);
        expect((await afterAWhile(() => rowsOfBooking(body.booking_id))).length, 'nothing else is written').toBe(2);
        const [stored] = await rows('SELECT token_hash FROM booking_card_links WHERE booking_id = ?', [body.booking_id]);
        expect(stored.token_hash, 'the table holds the hash and not the token').not.toBe(body.card_link.path.slice('/card/'.length));
    });

    test('R4: a customer\'s checkout tells the customer the booking is confirmed, by text and by e-mail', async ({ request }, testInfo) => {
        const answer = await call(request, 'POST', '/api/bookings', {}, checkoutBody());
        expect(answer.status(), 'the checkout makes the booking').toBe(200);
        const body = await answer.json();
        expect(Number.isInteger(body.booking_id), 'the booking has an id').toBe(true);
        const told = await eventually(() => rowsOfBooking(body.booking_id), (list) => list.length >= 2);
        expect(brief(testInfo, told.filter((row) => row.kind === 'job_booked'))).toEqual(want(...BOTH('customer')));
        expect((await afterAWhile(() => rowsOfBooking(body.booking_id))).length, 'nothing else is written').toBe(2);
    });

    test('R5: an admin who puts a provider on a job tells that provider by text and by e-mail; the same provider again (as a number or as the text a select sends), a refused assignment and taking the provider off tell no one', async ({ playwright, request, baseURL }, testInfo) => {
        const as = await sessions(playwright, baseURL);
        const job = await mkBooking({ status: 'pending' });
        const assign = (providerId) => call(request, 'PUT', `/api/bookings?id=${job.id}`, as.admin, { provider_id: providerId });
        const kind = () => kindRows(job.id, 'job_assigned');

        const first = await assign(PROVIDER2.id);
        expect([first.status(), await first.json()], 'the answer is the one the route gave before the hook').toEqual([200, UPDATED]);
        expect(brief(testInfo, await eventually(kind, (list) => list.length >= 2), { refs: true })).toEqual(want(...BOTH_TO('provider', PROVIDER2.id)));

        for (const again of [PROVIDER2.id, String(PROVIDER2.id)]) {
            const repeat = await assign(again);
            expect([repeat.status(), await repeat.json()], `provider_id ${JSON.stringify(again)} on a job that provider holds`).toEqual([200, UPDATED]);
        }
        const rival = await assign(PROVIDER1.id);
        expect(rival.status(), 'a job another provider holds is not given to this one').toBe(409);
        const taken = await assign(null);
        expect([taken.status(), await taken.json()], 'taking the provider off').toEqual([200, UPDATED]);
        expect((await afterAWhile(() => rowsOfBooking(job.id))).length, 'nothing more was sent, to either provider').toBe(2);
    });

    test('R6: a reassign tells the new provider by text and by e-mail, and the old provider nothing', async ({ playwright, request, baseURL }, testInfo) => {
        const as = await sessions(playwright, baseURL);
        const job = await mkBooking({ providerId: PROVIDER1.id });
        const answer = await call(request, 'POST', `/api/bookings/${job.id}/reassign`, as.admin, { new_provider_id: PROVIDER2.id, old_provider_id: PROVIDER1.id });
        expect([answer.status(), await answer.json()], 'the answer is the one the route gave before the hook').toEqual([200, { success: true, message: 'Provider reassigned successfully' }]);
        expect(brief(testInfo, await eventually(() => kindRows(job.id, 'job_assigned'), (list) => list.length >= 2), { refs: true })).toEqual(want(...BOTH_TO('provider', PROVIDER2.id)));
        expect((await afterAWhile(() => rowsOfBooking(job.id))).length, 'the old provider is not told, and nothing else is written').toBe(2);
        const nobody = await call(request, 'POST', `/api/bookings/${job.id}/reassign`, as.admin, {});
        expect(nobody.status(), 'a reassign that names no provider').toBe(400);
        expect((await afterAWhile(() => rowsOfBooking(job.id), 500)).length, 'and tells no one').toBe(2);
    });

    // What a claim tells: the customer, reached through the booking's own columns (a guest has no account), and the provider who claimed, each on both channels.
    const toldOfClaim = async (testInfo, job, providerId) => {
        const told = await eventually(() => kindRows(job.id, 'job_claimed'), (list) => list.length >= 4);
        expect(brief(testInfo, told, { refs: true })).toEqual(want(...BOTH_TO('customer', null), ...BOTH_TO('provider', providerId)));
    };

    test('R7: a provider who claims an open job by its number tells the customer and the provider on both channels; a second attempt and another provider\'s tell no one', async ({ playwright, request, baseURL }, testInfo) => {
        const as = await sessions(playwright, baseURL);
        const job = await mkBooking({ status: 'pending', pushed: true });
        const claim = (who) => call(request, 'POST', '/api/provider/available-jobs', who, { booking_id: job.id });

        const won = await claim(as.provider1);
        const wonBody = await won.json();
        expect([won.status(), wonBody.success, wonBody.message], 'the answer is the one the route gave before the hook').toEqual([200, true, `You accepted: ${SERVICE_NAME}`]);
        await toldOfClaim(testInfo, job, PROVIDER1.id);

        expect((await claim(as.provider1)).status(), 'the same provider again: the job is no longer on offer').toBe(409);
        expect((await claim(as.provider2)).status(), 'another provider: the job is taken').toBe(409);
        expect((await afterAWhile(() => rowsOfBooking(job.id))).length, 'nothing more was sent').toBe(4);
    });

    test('R8: a provider who claims an open job by its address tells the same two people the same way, and a second attempt tells no one', async ({ playwright, request, baseURL }, testInfo) => {
        const as = await sessions(playwright, baseURL);
        const job = await mkBooking({ status: 'pending', pushed: true });
        const claim = (who) => call(request, 'POST', `/api/provider/available-jobs/${job.id}`, who, {});

        const won = await claim(as.provider2);
        const wonBody = await won.json();
        expect([won.status(), wonBody.success, wonBody.message], 'the answer is the one the route gave before the hook').toEqual([200, true, `Job accepted: ${SERVICE_NAME}`]);
        await toldOfClaim(testInfo, job, PROVIDER2.id);

        expect((await claim(as.provider2)).status(), 'the same provider again: the job already has a provider').toBe(409);
        expect((await claim(as.provider1)).status(), 'another provider: the job is not theirs to take').toBe(403);
        expect((await afterAWhile(() => rowsOfBooking(job.id))).length, 'nothing more was sent').toBe(4);
    });

    test('R9 (E20): the accept of a job an admin assigned to the provider tells the customer and the provider once, and a second accept tells no one', async ({ playwright, request, baseURL }, testInfo) => {
        const as = await sessions(playwright, baseURL);
        const job = await mkBooking({ providerId: PROVIDER1.id, status: 'matching' });
        const accept = () => call(request, 'POST', '/api/provider/available-jobs', as.provider1, { booking_id: job.id });

        const won = await accept();
        expect([won.status(), (await won.json()).success], 'the assigned job is accepted').toEqual([200, true]);
        await toldOfClaim(testInfo, job, PROVIDER1.id);

        expect((await accept()).status(), 'a second accept: the job is accepted already').toBe(409);
        expect((await afterAWhile(() => rowsOfBooking(job.id))).length, 'nothing more was sent').toBe(4);
    });

    test('R10: a provider\'s job link texts each cleaner on the job (a checked number is attempted, an unchecked one and one outside Canada are refused in the record), a reissue texts them again and switching off texts no one', async ({ playwright, request, baseURL }, testInfo) => {
        const as = await sessions(playwright, baseURL);
        const job = await mkBooking({ providerId: PROVIDER1.id });
        const checked = await mkMember(PROVIDER1.id, 'A checked');
        const unchecked = await mkMember(PROVIDER1.id, 'B unchecked');
        const abroad = await mkMember(PROVIDER1.id, 'C abroad', ABROAD);
        for (const member of [checked, unchecked, abroad]) await putOnJob(job.id, member.id);
        await checkNumber(checked);
        const change = (body) => call(request, 'POST', `/api/provider/jobs/${job.id}/job-link`, as.provider1, body);
        const kind = () => kindRows(job.id, 'job_link');
        const everyone = [['cleaner', checked.id, 'sms', 'attempted'], ['cleaner', unchecked.id, 'sms', 'unchecked'], ['cleaner', abroad.id, 'sms', 'cannot_text']];

        const made = await change({ action: 'create' });
        const madeBody = await made.json();
        expect([made.status(), madeBody.success], 'the link is made').toEqual([200, true]);
        expect(madeBody.data?.job_link?.path, 'the answer holds the link as it did before the hook').toMatch(/^\/job\/[A-Za-z0-9_-]{43}$/);
        expect(brief(testInfo, await eventually(kind, (list) => list.length >= 3), { refs: true })).toEqual(want(...everyone));

        const reissued = await change({ action: 'reissue', generation: madeBody.data.job_link.generation });
        expect(reissued.status(), 'the link is reissued').toBe(200);
        expect(brief(testInfo, await eventually(kind, (list) => list.length >= 6), { refs: true }), 'a new link is a new notice for everyone').toEqual(want(...everyone, ...everyone));

        const off = await change({ action: 'off' });
        expect(off.status(), 'the link is switched off').toBe(200);
        expect((await afterAWhile(kind)).length, 'switching off tells no one').toBe(6);
    });

    test('R11: an admin\'s job link texts the cleaner on the job the same way', async ({ playwright, request, baseURL }, testInfo) => {
        const as = await sessions(playwright, baseURL);
        const job = await mkBooking({ providerId: PROVIDER1.id });
        const checked = await mkMember(PROVIDER1.id, 'A checked');
        const unchecked = await mkMember(PROVIDER1.id, 'B unchecked');
        for (const member of [checked, unchecked]) await putOnJob(job.id, member.id);
        await checkNumber(checked);
        const change = (body) => call(request, 'POST', `/api/admin/bookings/${job.id}/job-link`, as.admin, body);
        const kind = () => kindRows(job.id, 'job_link');

        const made = await change({ action: 'create' });
        const madeBody = await made.json();
        expect([made.status(), madeBody.success], 'the link is made').toEqual([200, true]);
        expect(madeBody.data?.job_link?.path, 'the answer holds the link as it did before the hook').toMatch(/^\/job\/[A-Za-z0-9_-]{43}$/);
        expect(brief(testInfo, await eventually(kind, (list) => list.length >= 2), { refs: true })).toEqual(want(['cleaner', checked.id, 'sms', 'attempted'], ['cleaner', unchecked.id, 'sms', 'unchecked']));

        const off = await change({ action: 'off' });
        expect(off.status(), 'the link is switched off').toBe(200);
        expect((await afterAWhile(kind)).length, 'switching off tells no one').toBe(2);
    });

    test('R12: a crew save that adds a cleaner texts that cleaner only, and only while the job has a link on; the same save again tells no one', async ({ playwright, request, baseURL }, testInfo) => {
        const as = await sessions(playwright, baseURL);
        const job = await mkBooking({ providerId: PROVIDER1.id });
        const kept = await mkMember(PROVIDER1.id, 'A kept');
        const unchecked = await mkMember(PROVIDER1.id, 'B unchecked');
        const checked = await mkMember(PROVIDER1.id, 'C checked');
        await checkNumber(kept);
        await checkNumber(checked);
        const save = (members) => call(request, 'PUT', `/api/provider/jobs/${job.id}/crew`, as.provider1, { crew_ids: members.map((member) => member.id) });
        const kind = () => kindRows(job.id, 'job_link');
        const addedBy = async (answer) => (await answer.json()).data.added.map((member) => member.id);

        const bare = await save([kept]);
        expect([bare.status(), await addedBy(bare)], 'a save with no link on the job').toEqual([200, [kept.id]]);
        expect((await afterAWhile(kind)).length, 'a job with no link has nothing to text').toBe(0);

        await mkLink(job.id);
        const second = await save([kept, unchecked]);
        expect([second.status(), await addedBy(second)], 'the answer lists who was added, as it did before the hook').toEqual([200, [unchecked.id]]);
        expect(brief(testInfo, await eventually(kind, (list) => list.length >= 1), { refs: true }), 'only the cleaner added is asked about').toEqual(want(['cleaner', unchecked.id, 'sms', 'unchecked']));

        const third = await save([kept, unchecked, checked]);
        expect([third.status(), await addedBy(third)]).toEqual([200, [checked.id]]);
        expect(brief(testInfo, await eventually(kind, (list) => list.length >= 2), { refs: true })).toEqual(want(['cleaner', unchecked.id, 'sms', 'unchecked'], ['cleaner', checked.id, 'sms', 'attempted']));

        const same = await save([kept, unchecked, checked]);
        expect([same.status(), await addedBy(same)], 'the same crew again adds no one').toEqual([200, []]);
        expect((await afterAWhile(kind)).length, 'and tells no one').toBe(2);
    });

    test('R13: a number that passes its check texts that cleaner for each open job with a link on and for no other; a wrong code tells no one', async ({ playwright, request, baseURL }, testInfo) => {
        const as = await sessions(playwright, baseURL);
        const member = await mkMember(PROVIDER1.id, 'A cleaner');
        const open = await mkBooking({ providerId: PROVIDER1.id });
        const switchedOff = await mkBooking({ providerId: PROVIDER1.id });
        const closed = await mkBooking({ providerId: PROVIDER1.id, status: 'completed' });
        for (const job of [open, switchedOff, closed]) await putOnJob(job.id, member.id);
        await mkLink(open.id);
        const off = await mkLink(switchedOff.id);
        await execute('UPDATE job_links SET off_at = NOW() WHERE id = ?', [off.id]);
        await mkLink(closed.id);
        const code = '482913';
        await pendingCheck(member, code);
        const everyJob = [open.id, switchedOff.id, closed.id];
        const confirm = (typed) => call(request, 'POST', `/api/provider/crew/${member.id}/number-check`, as.provider1, { action: 'confirm', code: typed });

        const wrong = await confirm('000000');
        expect(wrong.status(), 'a wrong code').toBe(400);
        expect((await afterAWhile(() => rowsOfBookings(everyJob), 800)).length, 'a wrong code tells no one').toBe(0);

        const right = await confirm(code);
        expect([right.status(), await right.json()], 'the answer is the one the route gave before the hook').toEqual([200, { success: true, data: { checked: true } }]);
        expect(brief(testInfo, await eventually(() => rowsOfBookings(everyJob), (list) => list.length >= 1), { refs: true })).toEqual(want(['cleaner', member.id, 'sms', 'attempted']));
        const [told] = await rowsOfBookings(everyJob);
        expect(told.booking_id, 'the job that is open and has its link on').toBe(open.id);
        expect((await afterAWhile(() => rowsOfBookings(everyJob))).length, 'no job whose link is off or that is closed').toBe(1);
    });

    test('R14: an on-site report tells the owning provider and each admin on both channels, never the one who sent it and never the note; a report sent again tells no one more', async ({ playwright, request, baseURL }, testInfo) => {
        const as = await sessions(playwright, baseURL);
        const admins = (await rows("SELECT id FROM users WHERE role = 'admin' ORDER BY id")).map((row) => row.id);
        expect(admins, 'the fixture admin is on the team').toContain(ADMIN.id);

        // The provider sends it: the office is told and the provider is not.
        const job = await mkBooking({ providerId: PROVIDER1.id });
        const link = await mkLink(job.id);
        const mark = `rt018-${RUN}-${seq++}`;
        const sent = await postReport(request, link.token, as.provider1, { type: 'details_wrong', clientToken: mark });
        const sentBody = await sent.json();
        expect([sent.status(), sentBody.success, sentBody.data?.again], 'the report is saved').toEqual([200, true, false]);
        const office = admins.flatMap((id) => BOTH_TO('admin', id));
        expect(brief(testInfo, await eventually(() => kindRows(job.id, 'report_added'), (list) => list.length >= office.length), { refs: true })).toEqual(want(...office));

        const replay = await postReport(request, link.token, as.provider1, { type: 'details_wrong', clientToken: mark });
        expect([replay.status(), (await replay.json()).data?.again], 'a send made again is answered as saved').toEqual([200, true]);
        expect((await afterAWhile(() => kindRows(job.id, 'report_added'))).length, 'and tells no one').toBe(office.length);

        // An admin sends it: the provider is told and that admin is not.
        const other = await mkBooking({ providerId: PROVIDER1.id });
        const otherLink = await mkLink(other.id);
        const byAdmin = await postReport(request, otherLink.token, as.admin, { type: 'unhygienic' });
        expect([byAdmin.status(), (await byAdmin.json()).success], 'the admin\'s report is saved').toEqual([200, true]);
        const expected = want(...BOTH_TO('provider', PROVIDER1.id), ...admins.filter((id) => id !== ADMIN.id).flatMap((id) => BOTH_TO('admin', id)));
        expect(brief(testInfo, await eventually(() => kindRows(other.id, 'report_added'), (list) => list.length >= expected.length), { refs: true })).toEqual(expected);
        expect((await afterAWhile(() => kindRows(other.id, 'report_added'))).length, 'nothing more').toBe(expected.length);
        expect(JSON.stringify(await rowsOfBookings([job.id, other.id])), 'no row holds the note').not.toContain('canary');
    });

    test('R15 (E16, E19): the start tells a guest customer by text, once, and a start that is refused tells no one; the finish tells the guest by text and by e-mail', async ({ playwright, request, baseURL }, testInfo) => {
        const as = await sessions(playwright, baseURL);
        const job = await mkBooking({ providerId: PROVIDER1.id });
        await plantBeforePhoto(job.id);

        const started = await timer(request, as.provider1, { booking_id: job.id, action: 'start', worker_count: 2, estimated_hours: 3 });
        const startedBody = await started.json();
        expect([started.status(), startedBody.success, startedBody.data?.status], 'the job starts').toEqual([200, true, 'in_progress']);
        expect(brief(testInfo, await eventually(() => kindRows(job.id, 'job_started'), (list) => list.length >= 1), { refs: true })).toEqual(want(['customer', null, 'sms', 'attempted']));

        const again = await timer(request, as.provider1, { booking_id: job.id, action: 'start', worker_count: 2, estimated_hours: 3 });
        expect(again.status(), 'a second start on a running job is refused').toBe(400);
        expect((await afterAWhile(() => kindRows(job.id, 'job_started'))).length, 'a start that rolled back tells no one').toBe(1);

        const finished = await timer(request, as.provider1, { booking_id: job.id, action: 'stop', work_summary: 'Floors done', recommendations: 'None' });
        const finishedBody = await finished.json();
        expect([finished.status(), finishedBody.success, finishedBody.message], 'the job is finished').toEqual([200, true, 'Job submitted for customer approval']);
        expect(brief(testInfo, await eventually(() => kindRows(job.id, 'job_finished'), (list) => list.length >= 2), { refs: true })).toEqual(want(...BOTH_TO('customer', null)));
        expect((await afterAWhile(() => rowsOfBooking(job.id))).length, 'one for the start and two for the finish').toBe(3);
    });

    test('R16 (E16): a customer with an account is told of the start and of the finish by text only; the e-mail at the finish is the route\'s own', async ({ playwright, request, baseURL }, testInfo) => {
        const as = await sessions(playwright, baseURL);
        const job = await mkBooking({ providerId: PROVIDER1.id, userId: CUSTOMER.id });
        await plantBeforePhoto(job.id);

        const started = await timer(request, as.provider1, { booking_id: job.id, action: 'start', worker_count: 1, estimated_hours: 2 });
        expect([started.status(), (await started.json()).success], 'the job starts').toEqual([200, true]);
        expect(brief(testInfo, await eventually(() => kindRows(job.id, 'job_started'), (list) => list.length >= 1), { refs: true })).toEqual(want(['customer', CUSTOMER.id, 'sms', 'attempted']));

        const finished = await timer(request, as.provider1, { booking_id: job.id, action: 'stop', work_summary: 'Floors done' });
        expect([finished.status(), (await finished.json()).success], 'the job is finished').toEqual([200, true]);
        expect(brief(testInfo, await eventually(() => kindRows(job.id, 'job_finished'), (list) => list.length >= 1), { refs: true })).toEqual(want(['customer', CUSTOMER.id, 'sms', 'attempted']));
        expect((await afterAWhile(() => rowsOfBooking(job.id))).length, 'no e-mail row: the account holder\'s finish e-mail is the route\'s own').toBe(2);
    });

    test('R17 (E18): a notice that cannot be made (a link whose token the server did not make) writes nothing and leaves the answer of the route as it was', async ({ playwright, request, baseURL }, testInfo) => {
        const as = await sessions(playwright, baseURL);
        const member = await mkMember(PROVIDER1.id, 'A cleaner');
        const job = await mkBooking({ providerId: PROVIDER1.id });
        await putOnJob(job.id, member.id);
        const link = await mkLink(job.id, 'not-a-token-the-server-made');
        const code = '735190';
        await pendingCheck(member, code);

        const right = await call(request, 'POST', `/api/provider/crew/${member.id}/number-check`, as.provider1, { action: 'confirm', code });
        expect([right.status(), await right.json()], 'the answer is the one the route gave before the hook').toEqual([200, { success: true, data: { checked: true } }]);
        expect((await afterAWhile(() => rowsOfBooking(job.id))).length, 'the notice stopped at the token and wrote nothing').toBe(0);

        // The same job with a token the server made is texted, so it was the token that stopped the notice.
        await execute('UPDATE job_links SET token = ? WHERE id = ?', [newLinkToken(), link.id]);
        const made = await call(request, 'POST', `/api/admin/bookings/${job.id}/job-link`, as.admin, { action: 'create' });
        expect(made.status(), 'the link is made').toBe(200);
        expect(brief(testInfo, await eventually(() => kindRows(job.id, 'job_link'), (list) => list.length >= 1), { refs: true })).toEqual(want(['cleaner', member.id, 'sms', 'attempted']));
    });
});
