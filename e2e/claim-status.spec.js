// e2e/claim-status.spec.js
//
// ENG-018, security gate round 1, finding B2 (A01, Medium): a provider who has signed up is 'inactive' (or 'pending') until an admin approves them, and one an
// admin has suspended is 'suspended'; either can sign in, and requireCaller reads no table, so either could claim an open job through the two claim routes
//   POST /api/provider/available-jobs            { booking_id }        (also the accept of a job an admin assigned)
//   POST /api/provider/available-jobs/[id]
// and ENG-018's claim notice then told the customer "a professional has accepted your booking" by text and by e-mail. Two lines close it:
//   the routes       read the caller's status before the transaction takes the booking (providerIsActive, src/lib/marketplace.js) and answer 403 'Your
//                    account is not active yet.' (CHECK_MESSAGES.notActive, the words of the number check) with no-store when it is not 'active': nothing
//                    is written and nothing is sent
//   the event        noticeClaimed answers [] for a provider who is not active, so no other caller can tell a customer of a claim that was not allowed
// The broader gap (every other provider route also reads no status) is the proposals.md row of 2026-10-17 and is not this file's.
//
// The cases (the numbers are this file's own):
//   C1-C3  POST /api/provider/available-jobs for a signed-in provider whose status is inactive, pending, suspended: 403 with the words and no-store, the
//          booking keeps provider_id NULL and its status, no notice row is written, and neither the customer's number nor the provider's day is spent;
//          the same provider made active again claims it at once (200) and the booking is theirs
//   C4-C6  the same, for POST /api/provider/available-jobs/[id]
//   C7-C9  the library: noticeClaimed for a booking whose provider is inactive, pending, suspended tells no one: [] and no transport call, no row, and no counter
//   C10    the library, for an active provider: the customer and the provider are each told by text and by e-mail (so that C7-C9's [] is about a thing that
//          is otherwise done)
//
// The database is the dev database the way e2e/number-check-status.spec.js reaches it. The route cases sign in as the fixture provider (providers[0]) and set
// that provider's status in the database for the case; the sweep puts it back to 'active'. The library cases give the library a RECORDING transport. Every
// number is in +1403555 0600-0639 and every address starts with EMAIL_PREFIX.
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { getCredentialHeaders } from './auth/credentials.js';
import { RESET_RETRIES } from './support/auth.js';
import { providers } from '../database/fixtures/accounts.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';
import { noticeClaimed } from '../src/lib/notice-events.js';
import { normalisePhone } from '../src/lib/phone.js';
import { budgetScope } from '../src/lib/sms-budget.js';

test.use({ trace: 'off' });

const RUN = Date.now().toString(36);
const EMAIL_PREFIX = 'cst018-';
const FIRST_NUMBER = 600;
const BLOCK_SIZE = 40;
const e164At = (i) => `+1403555${String(FIRST_NUMBER + i).padStart(4, '0')}`;
let numbersUsed = 0;
const nextNumber = () => {
    if (numbersUsed >= BLOCK_SIZE) throw new Error('the case needs more numbers than the block has');
    numbersUsed += 1;
    return e164At(numbersUsed - 1);
};
let seq = 0;
const mail = (label) => `${EMAIL_PREFIX}${label}-${RUN}-${seq++}@notices.test`;
const marks = (list) => list.map(() => '?').join(', ');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PROVIDER = providers[0];
const NOT_ACTIVE = 'Your account is not active yet.';
const SERVICE_NAME = 'Fixture Standard Clean';
const NOT_ACTIVE_STATUSES = ['inactive', 'pending', 'suspended'];
const REACHED = ['sent', 'not_configured', 'rejected', 'unsure'];

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

// The library takes `execute` in the shape of src/lib/db.js: the rows for a SELECT, the result header for a write.
async function execute(sql, params = []) {
    const [result] = await (await db()).execute(sql, params);
    return /** @type {any} */ (result);
}
const rows = (sql, params = []) => /** @type {Promise<any[]>} */ (execute(sql, params));

// ---- the sweep: what this file made, and what it spent ----

async function sweep() {
    const open = await db();
    const mine = `${EMAIL_PREFIX}%`;
    const block = Array.from({ length: BLOCK_SIZE }, (_, i) => e164At(i));
    const bookings = (await rows('SELECT id FROM bookings WHERE customer_email LIKE ?', [mine])).map((row) => row.id);
    if (bookings.length > 0) {
        await open.execute(`DELETE FROM notice_attempts WHERE booking_id IN (${marks(bookings)})`, bookings);
        await open.execute(`DELETE FROM activity_logs WHERE entity_type = 'booking' AND entity_id IN (${marks(bookings)})`, bookings);
        await open.execute(`DELETE FROM bookings WHERE id IN (${marks(bookings)})`, bookings);
    }
    const made = await rows('SELECT id FROM service_providers WHERE email LIKE ?', [mine]);
    await open.execute('DELETE FROM service_providers WHERE email LIKE ?', [mine]);
    await open.execute("UPDATE service_providers SET status = 'active' WHERE id = ?", [PROVIDER.id]);

    const scopes = [budgetScope('platform', 'day'), budgetScope('provider', PROVIDER.id)];
    const own = normalisePhone(PROVIDER.phone);
    if (own.ok) scopes.push(budgetScope('number', own.phone));
    for (const number of block) scopes.push(budgetScope('number', number));
    for (const provider of made) scopes.push(budgetScope('provider', provider.id));
    await open.execute(`DELETE FROM sms_budget WHERE scope IN (${marks(scopes)})`, scopes);
}

test.beforeAll(sweep);
test.beforeEach(async () => {
    numbersUsed = 0;
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

// ---- rows the cases plant and read (SQL only, so that the route or the event under test is the one sender) ----

async function mkProvider(status) {
    const made = await execute("INSERT INTO service_providers (name, email, phone, password, status) VALUES (?, ?, ?, 'x', ?)", [`Probe ${status}`, mail(status), nextNumber(), status]);
    return { id: /** @type {number} */ (made.insertId) };
}

// A job on the marketplace (an admin's push) when no provider is given, or one held by `providerId` when it is.
async function mkBooking({ providerId = null } = {}) {
    const number = `CS${RUN}${seq++}`.toUpperCase();
    const phone = nextNumber();
    const made = await execute(
        `INSERT INTO bookings (booking_number, user_id, service_id, service_name, service_price, customer_first_name, customer_last_name, customer_email, customer_phone,
           job_date, job_time_slot, job_description, address_line1, city, postal_code, worker_count, status, payment_status, provider_id, latitude, longitude, marketplace_pushed_at)
         VALUES (?, NULL, 1, ?, 80, 'Rhea', 'Rowe', ?, ?, DATE_FORMAT(CURDATE(), '%Y-%m-%d'), 'Oct 17: Morning', 'x', '1 Probe Street', 'Calgary', 'T2P 0A1', 3, 'pending', 'pending', ?, 51.04473, -114.07192, IF(?, NOW(), NULL))`,
        [number, SERVICE_NAME, mail('b'), phone, providerId, providerId === null ? 1 : 0]
    );
    return { id: /** @type {number} */ (made.insertId), number, phone };
}

const setStatus = (providerId, status) => execute('UPDATE service_providers SET status = ? WHERE id = ?', [status, providerId]);
const bookingOf = async (id) => (await rows('SELECT provider_id, status FROM bookings WHERE id = ?', [id]))[0];
const noticeRowsOf = (bookingId) => rows('SELECT kind, channel, outcome FROM notice_attempts WHERE booking_id = ? ORDER BY id', [bookingId]);

async function usedOf(scope) {
    const found = await rows('SELECT used FROM sms_budget WHERE scope = ?', [scope]);
    return found.length === 0 ? null : Number(found[0].used);
}

// What a claim would spend: the customer's number (the claim's text to the customer), the provider's own number, the provider's day and the platform's.
async function spentBy(job, providerId, providerPhone) {
    const own = normalisePhone(providerPhone);
    return {
        customer: await usedOf(budgetScope('number', job.phone)),
        number: own.ok ? await usedOf(budgetScope('number', own.phone)) : null,
        provider: await usedOf(budgetScope('provider', providerId)),
        platform: await usedOf(budgetScope('platform', 'day')),
    };
}

// A recording transport: where a text or an e-mail would go.
function recorder() {
    /** @type {{ to: string }[]} */
    const texts = [];
    /** @type {{ to: string }[]} */
    const mails = [];
    return {
        texts,
        mails,
        deps: {
            sendSMS: async (to) => { texts.push({ to }); return { ok: true }; },
            sendMail: async (message) => { mails.push({ to: message.to }); return { success: true }; },
            appOrigin: () => 'http://localhost:3000',
        },
    };
}

// ---- the routes ----

const ROUTES = [
    { label: 'POST /api/provider/available-jobs', claim: (request, headers, job) => request.fetch('/api/provider/available-jobs', { method: 'POST', headers, data: { booking_id: job.id }, maxRetries: RESET_RETRIES, timeout: 60_000 }) },
    { label: 'POST /api/provider/available-jobs/[id]', claim: (request, headers, job) => request.fetch(`/api/provider/available-jobs/${job.id}`, { method: 'POST', headers, data: {}, maxRetries: RESET_RETRIES, timeout: 60_000 }) },
];

test.describe('ENG-018 B2: a provider who is not active cannot claim a job, and a claim they cannot make tells no one', () => {
    let caseNumber = 0;
    for (const route of ROUTES) {
        for (const status of NOT_ACTIVE_STATUSES) {
            caseNumber += 1;
            test(`C${caseNumber} (${route.label}, ${status}): the claim is refused 403, the job keeps no provider, nothing is sent or spent; made active again, the same provider claims it`, async ({ request, baseURL }) => {
                const headers = (await getCredentialHeaders(String(baseURL)))['provider-cookie'];
                const job = await mkBooking();
                await setStatus(PROVIDER.id, status);
                const before = await spentBy(job, PROVIDER.id, PROVIDER.phone);

                const refused = await route.claim(request, headers, job);

                expect([refused.status(), refused.headers()['cache-control'], await refused.json()], `the answer to a provider whose status is ${status}`).toEqual([403, 'no-store', { success: false, message: NOT_ACTIVE }]);
                expect(await bookingOf(job.id), 'the job has no provider and keeps its status').toEqual({ provider_id: null, status: 'pending' });
                await sleep(2500);
                expect(await noticeRowsOf(job.id), 'no notice row is written (the notice would run after the response)').toEqual([]);
                expect(await spentBy(job, PROVIDER.id, PROVIDER.phone), 'neither the customer\'s number, the provider\'s number and day, nor the platform\'s day is spent').toEqual(before);

                await setStatus(PROVIDER.id, 'active');
                const served = await route.claim(request, headers, job);
                expect([served.status(), (await served.json()).success], 'the same provider, active, claims it at once').toEqual([200, true]);
                expect(await bookingOf(job.id), 'and the job is theirs').toMatchObject({ provider_id: PROVIDER.id });
            });
        }
    }

    for (const [i, status] of NOT_ACTIVE_STATUSES.entries()) {
        test(`C${caseNumber + 1 + i} (${status}): noticeClaimed for a job whose provider is ${status} tells no one and spends nothing`, async () => {
            const provider = await mkProvider(status);
            const job = await mkBooking({ providerId: provider.id });
            const sending = recorder();

            const told = await noticeClaimed(execute, { bookingId: job.id, providerId: provider.id }, sending.deps);

            expect(told, 'no one is told').toEqual([]);
            expect([sending.texts, sending.mails], 'nothing is handed to a transport').toEqual([[], []]);
            expect(await noticeRowsOf(job.id), 'no row is written, not even a refusal').toEqual([]);
            expect(await usedOf(budgetScope('number', job.phone)), 'the customer\'s number is not spent').toBeNull();
            expect(await usedOf(budgetScope('platform', 'day')), 'the platform\'s day is not spent').toBeNull();
        });
    }

    test(`C${caseNumber + 1 + NOT_ACTIVE_STATUSES.length} (active): noticeClaimed for a job whose provider is active tells the customer and the provider, each by text and by e-mail`, async () => {
        const provider = await mkProvider('active');
        const job = await mkBooking({ providerId: provider.id });
        const sending = recorder();

        const told = await noticeClaimed(execute, { bookingId: job.id, providerId: provider.id }, sending.deps);

        expect(told.map((entry) => [entry.to, entry.sms, entry.email]), 'both are told, on both channels').toEqual([['customer', 'sent', 'sent'], ['provider', 'sent', 'sent']]);
        expect(sending.texts.length + sending.mails.length, 'four messages are handed over').toBe(4);
        expect((await noticeRowsOf(job.id)).filter((row) => REACHED.includes(row.outcome)).length, 'four rows say so').toBe(4);
    });
});
