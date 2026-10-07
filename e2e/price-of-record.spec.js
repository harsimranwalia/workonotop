// @ts-check
// The amounts a booking is charged and paid come from the price recorded when it is booked. Eight cases, each titled for what it shows:
//   1  a booking records the catalog price of the service it books;
//   2  a booking records the catalog hourly rate of the service it books and authorizes by it (fixture service 2, whose figures differ
//      from service 1's, the service the other cases book);
//   3  create-intent answers 400 for a service the catalog does not offer, and so does the checkout (the case posts to both routes);
//   4  the finish stores the payout as the booking's price less its commission, whatever hours and crew are entered;
//   5  the finish stores the measured minutes past the standard duration and no overtime earnings;
//   6  the invoice total is the booking's recorded price and its payout follows the commission rule (a commission set, and none set,
//      and after the admin's override of hours and crew);
//   7  the routes that charge or pay (approve, auto-release, the Stripe webhook, create-intent) take the amount from the price of record
//      (a source read: each of them runs after a Stripe call, which the dev stack has no key for);
//   8  the price of record and the payout follow the catalog row and the commission rule (the module's own cases).
// Cases 1, 2 and 4 to 6 make their booking through the public checkout (a made-up payment intent id, as e2e/defects.spec.js does) and move
// it with the app's own routes: the admin's booking update and override, the provider's start and stop, the admin's invoice generation.
// Each booking is deleted again as admin, and the case deletes the rows that delete may leave (booking_audit_logs, which no foreign key
// removes; job_sessions, which go with the booking unless its delete fails).
// Stored values are read back with a small database helper that checks the target before it connects (assertDevTarget: a local host and
// the database workontap_db) and the rows once connected (assertNoRealPeople: no e-mail address outside the reserved test names), the two
// guards the fixture loader uses. It reads the catalog and the stored rows of the cases' own bookings and invoices (by booking id; case 3
// looks for the e-mail of the booking it expects the checkout to refuse), plants the one closed job session that case 5 measures, and
// deletes the rows named above (the bookings carry the e-mail prefix 'e2e-eng005-'). It reaches the database the way the department's
// test command lets it: that container runs with --network host, so the published port 127.0.0.1:3307 is the dev database.
// Fixture accounts: the admin is users 3, provider1 is service_providers 1 (database/fixtures/accounts.js); the services are fixture
// service 1 (every case but case 2) and fixture service 2 (case 2).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { getCredentialHeaders } from './auth/credentials.js';
import { RESET_RETRIES } from './support/auth.js';
import { providers } from '../database/fixtures/accounts.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';

// Every request carries a fixture account's session and a trace records request headers and bodies: tracing is off, as in
// e2e/ownership.spec.js. A failure message names the case, the status and the account, never a header or a token.
test.use({ trace: 'off' });

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const [PROVIDER1] = providers;
const EMAIL_PREFIX = 'e2e-eng005-';
const SERVICE_ID = 1;
const SECOND_SERVICE_ID = 2;
const NOT_OFFERED = 'This service is not available for booking';

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

test.afterAll(async () => {
    if (!connection) return;
    try {
        await connection.end();
    } finally {
        connection = null;
    }
});

async function rows(sql, params) {
    const [found] = await (await db()).query(sql, params);
    return /** @type {any[]} */ (found);
}

// The catalog row the cases book (service 1; case 2 books service 2), read at the start of a case: its figures are what the booking must record.
async function catalogService(serviceId = SERVICE_ID) {
    const [row] = await rows('SELECT id, name, base_price, additional_price, duration_minutes, is_active FROM services WHERE id = ?', [serviceId]);
    expect(row, `service ${serviceId} is in the catalog`).toBeDefined();
    expect(Number(row.is_active), 'the service is offered').toBe(1);
    expect(Number(row.base_price), 'the service has a price').toBeGreaterThan(0);
    return { id: row.id, name: row.name, price: Number(row.base_price), rate: Number(row.additional_price), minutes: Number(row.duration_minutes) };
}

async function headersFor(baseURL) {
    const styles = await getCredentialHeaders(String(baseURL));
    return { admin: styles['admin-bearer'], provider: styles['provider-bearer'], customer: styles['customer-bearer'] };
}

// The body of a checkout, with the catalog's own price and rate as the apps send them; `fields` replaces or adds to the body.
function checkoutBody(service, fields = {}) {
    const tag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    return {
        service_id: service.id, service_name: service.name, service_price: service.price, additional_price: service.rate,
        first_name: 'E2E', last_name: 'Price', email: `${EMAIL_PREFIX}${tag}@workontap.test`, phone: '+14035550199',
        job_date: '2026-02-01', job_time_slot: '09:00', job_description: 'E2E price-of-record booking, deleted by the case.',
        address_line1: '1 Probe Street', city: 'Calgary', payment_intent_id: `pi_e2e_${EMAIL_PREFIX}${tag}`,
        ...fields,
    };
}

// Posts a checkout body and answers the HTTP response; `headers` signs the checkout in (a booking made with no credential belongs to no
// account, and an invoice needs one).
function postCheckout(request, data, headers = {}) {
    return request.post('/api/bookings', { headers, data, maxRetries: RESET_RETRIES, timeout: 60_000 });
}

// A booking made through the public checkout.
async function checkout(request, service, fields = {}, headers = {}) {
    const response = await postCheckout(request, checkoutBody(service, fields), headers);
    expect(response.status(), 'checkout makes the booking').toBe(200);
    const answer = await response.json();
    expect(Number.isInteger(answer.booking_id), 'the booking has an id').toBe(true);
    return { id: /** @type {number} */ (answer.booking_id), answer };
}

// Runs `run(id, answer)` on a booking made by checkout and deletes the booking again as admin, even when `run` fails. The admin's delete
// removes the booking's invoices, and the database removes its job_sessions rows with it (a cascade); the booking_audit_logs rows that the
// admin's override writes have no foreign key to the booking, so the helper's connection deletes them, and the job_sessions rows too, which
// are still there when the admin's delete fails.
async function withBooking(request, as, service, fields, run, headers = {}) {
    const { id, answer } = await checkout(request, service, fields, headers);
    try {
        await run(id, answer);
    } finally {
        await request.delete(`/api/bookings?id=${id}`, { headers: as.admin, maxRetries: RESET_RETRIES, timeout: 60_000 });
        await (await db()).query('DELETE FROM job_sessions WHERE booking_id = ?', [id]);
        await (await db()).query('DELETE FROM booking_audit_logs WHERE booking_id = ?', [id]);
    }
}

async function storedBooking(id) {
    const [row] = await rows('SELECT service_price, additional_price, authorized_amount, commission_percent, final_provider_amount, overtime_minutes, overtime_earnings, actual_duration_minutes, submitted_duration_minutes, submitted_headcount FROM bookings WHERE id = ?', [id]);
    expect(row, `booking ${id} is stored`).toBeDefined();
    return row;
}

// The admin confirms the booking for provider 1, with a commission percent when one is given.
async function confirm(request, as, id, commission) {
    const data = { provider_id: PROVIDER1.id, status: 'confirmed', ...(commission === undefined ? {} : { commission_percent: commission }) };
    const response = await request.put(`/api/bookings?id=${id}`, { headers: as.admin, data, maxRetries: RESET_RETRIES, timeout: 60_000 });
    expect(response.status(), `the admin confirms booking ${id}`).toBe(200);
}

// One of the provider's own actions on the booking (start or stop). Answers the HTTP response.
function act(request, as, data) {
    return request.post('/api/provider/jobs/time-tracking', { headers: as.provider, data, maxRetries: RESET_RETRIES, timeout: 60_000 });
}

// The provider's own read of the booking's timer and money columns (GET time-tracking).
async function providerRead(request, as, id) {
    const response = await request.get(`/api/provider/jobs/time-tracking?booking_id=${id}`, { headers: as.provider, maxRetries: RESET_RETRIES, timeout: 60_000 });
    expect(response.status(), `the provider reads booking ${id}`).toBe(200);
    return (await response.json()).data;
}

// Confirms the booking, has the provider start it with `start` and finish it with `finish`, and answers the finish's response data.
// `measured` plants a closed job session of that many minutes before the finish, so the measured time is more than the seconds the
// case itself takes.
async function runJob(request, as, id, { commission, start = {}, finish = {}, measured }) {
    await confirm(request, as, id, commission);
    const started = await act(request, as, { booking_id: id, action: 'start', ...start });
    expect(started.status(), `the provider starts booking ${id}`).toBe(200);
    if (measured) {
        await (await db()).query(
            'INSERT INTO job_sessions (booking_id, provider_id, clock_in, clock_out, session_duration_minutes) VALUES (?, ?, DATE_SUB(NOW(), INTERVAL ? MINUTE), NOW(), ?)',
            [id, PROVIDER1.id, measured + 5, measured],
        );
    }
    const finished = await act(request, as, { booking_id: id, action: 'stop', ...finish });
    expect(finished.status(), `the provider finishes booking ${id}`).toBe(200);
    return (await finished.json()).data;
}

// Both invoices of a booking, as stored, each holding the `expected` columns (numbers).
async function expectInvoices(id, expected, when) {
    const invoices = await rows('SELECT invoice_type, total_amount, overtime_amount, overtime_minutes, commission_percent, commission_amount, provider_earnings, final_provider_amount, overtime_earnings FROM invoices WHERE booking_id = ? ORDER BY invoice_type', [id]);
    expect(invoices.map((invoice) => invoice.invoice_type), `${when}: the invoices stored for the booking`).toEqual(['customer', 'provider']);
    for (const invoice of invoices) {
        for (const [column, value] of Object.entries(expected)) {
            expect(Number(invoice[column]), `${when}: the ${invoice.invoice_type} invoice: ${column}`).toBe(value);
        }
    }
}

test.describe('Price of record', () => {
    test('a booking records the catalog price of the service it books', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        const service = await catalogService();
        // The request names a price of one cent for the service; the booking records the catalog's.
        await withBooking(request, as, service, { service_price: 0.01, additional_price: service.rate }, async (id) => {
            const stored = await storedBooking(id);
            expect(Number(stored.service_price), 'the price the booking records').toBe(service.price);
        });
    });

    test('a booking records the catalog hourly rate of the service it books and authorizes by it', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        // Fixture service 2 has another price, rate and duration than service 1, so a booking priced from service 1 (or from the first row of
        // the catalog) records figures that are not this service's.
        const service = await catalogService(SECOND_SERVICE_ID);
        // The request names ten times the catalog's price and a different hourly rate; the booking records the catalog's figures and
        // authorizes the price plus two hours at the catalog's rate.
        await withBooking(request, as, service, { service_price: service.price * 10, additional_price: service.rate * 100 + 1 }, async (id, answer) => {
            const stored = await storedBooking(id);
            expect(Number(stored.service_price), 'the price the booking records').toBe(service.price);
            expect(Number(stored.additional_price), 'the hourly rate the booking records').toBe(service.rate);
            expect(Number(stored.authorized_amount), 'the amount the booking authorizes').toBe(service.price + 2 * service.rate);
            expect(answer.overtime_rate, 'the hourly rate the checkout answers').toBe(service.rate);
            expect(answer.authorized_amount, 'the amount the checkout answers').toBe(service.price + 2 * service.rate);
        });
    });

    // create-intent: the request names a service that is not in the catalog, and one with no service at all, each with a price in the body.
    // Both are refused before any Stripe call, and the answer is the same whether or not the dev app holds a Stripe key. The checkout
    // (POST /api/bookings) refuses a service that is not in the catalog the same way, before the booking is made: no booking is stored.
    test('create-intent answers 400 for a service the catalog does not offer', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        const service = await catalogService();
        for (const [what, data] of [
            ['a service id that is not in the catalog', { service_id: 2147483647, service_price: service.price }],
            ['no service id', { service_price: service.price }],
        ]) {
            const response = await request.post('/api/payment/create-intent', { headers: as.customer, data, maxRetries: RESET_RETRIES, timeout: 60_000 });
            expect(response.status(), `create-intent for ${what}: status`).toBe(400);
            const body = await response.json();
            expect(body.success, `create-intent for ${what}: success`).toBe(false);
            expect(body.message, `create-intent for ${what}: message`).toBe(NOT_OFFERED);
        }

        // The checkout, as a guest, for a service id that is not in the catalog: the same 400, and no booking row for its e-mail.
        const refusedBody = checkoutBody(service, { service_id: 2147483647 });
        const refused = await postCheckout(request, refusedBody);
        expect(refused.status(), 'checkout for a service id that is not in the catalog: status').toBe(400);
        const refusal = await refused.json();
        expect(refusal.success, 'checkout for a service id that is not in the catalog: success').toBe(false);
        expect(refusal.message, 'checkout for a service id that is not in the catalog: message').toBe(NOT_OFFERED);
        expect(await rows('SELECT id FROM bookings WHERE customer_email = ?', [refusedBody.email]), 'checkout for a service id that is not in the catalog: bookings stored').toEqual([]);
    });

    // The commission is left unset, so the payout rule's 20 applies: 80.00 less 20 % is 64.00 whatever is entered at the finish.
    // The first job has a crew and hours entered at the start and at the finish, the second has entries that are not whole numbers.
    test("the finish stores the payout as the booking's price less its commission, whatever hours and crew are entered", async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        const service = await catalogService();
        const payout = Math.round(service.price * 0.8 * 100) / 100;
        const jobs = [
            { what: 'a crew of 10 and 600 minutes', start: { worker_count: 7, estimated_hours: 9 }, finish: { submitted_duration_minutes: 600, submitted_headcount: 10 }, stored: [600, 10] },
            { what: 'entries that are not whole numbers', start: {}, finish: { submitted_duration_minutes: 'lots', submitted_headcount: -4 }, stored: [null, null] },
        ];
        for (const job of jobs) {
            await withBooking(request, as, service, {}, async (id) => {
                const data = await runJob(request, as, id, { start: job.start, finish: job.finish });
                expect(data.total_earnings, `${job.what}: the payout the finish answers`).toBe(payout);
                expect(data.overtime_earnings, `${job.what}: the overtime earnings the finish answers`).toBe(0);
                const read = await providerRead(request, as, id);
                expect(Number(read.final_provider_amount), `${job.what}: the payout the provider reads`).toBe(payout);
                const stored = await storedBooking(id);
                expect(Number(stored.final_provider_amount), `${job.what}: the payout the booking stores`).toBe(payout);
                expect([stored.submitted_duration_minutes, stored.submitted_headcount], `${job.what}: the entries the booking stores`).toEqual(job.stored);
            });
        }
    });

    // 150 measured minutes against the service's 120 is 30 minutes past the standard duration, whatever minutes are entered.
    test('the finish stores the measured minutes past the standard duration and no overtime earnings', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        const service = await catalogService();
        const measured = service.minutes + 30;
        await withBooking(request, as, service, {}, async (id) => {
            const data = await runJob(request, as, id, { measured, finish: { submitted_duration_minutes: 600, submitted_headcount: 10 } });
            expect(data.system_minutes, 'the measured minutes the finish answers').toBe(measured);
            expect(data.overtime_minutes, 'the minutes past the standard duration the finish answers').toBe(30);
            expect(data.overtime_earnings, 'the overtime earnings the finish answers').toBe(0);
            const read = await providerRead(request, as, id);
            expect(Number(read.actual_duration_minutes), 'the measured minutes the provider reads').toBe(measured);
            expect(Number(read.overtime_minutes), 'the minutes past the standard duration the provider reads').toBe(30);
            expect(Number(read.overtime_earnings), 'the overtime earnings the provider reads').toBe(0);
            const stored = await storedBooking(id);
            expect(Number(stored.overtime_minutes), 'the minutes past the standard duration the booking stores').toBe(30);
            expect(Number(stored.overtime_earnings), 'the overtime earnings the booking stores').toBe(0);
        });
    });

    // The invoices, generated once the admin has marked the job completed, state the price as their total and the commission rule's payout
    // as the provider's earnings. The first job has a commission of 25 % set by the admin before it starts (80.00 less 25 % is 60.00), the
    // second has none set, so the rule's 20 % applies (64.00). The admin then overrides the second job's hours and crew (10 workers, 600
    // minutes): the invoices keep the price as their total, state no overtime amount and no overtime earnings, keep the commission and the
    // earnings, and say the minutes entered. The bookings are customer 1's, because the invoice rows name the account the booking belongs to.
    test("the invoice total is the booking's recorded price and its payout follows the commission rule", async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        const service = await catalogService();
        const jobs = [
            { what: 'a commission of 25 % set', commission: 25, percent: 25, payout: Math.round(service.price * 0.75 * 100) / 100, override: false },
            { what: 'no commission set', commission: undefined, percent: 20, payout: Math.round(service.price * 0.8 * 100) / 100, override: true },
        ];
        for (const job of jobs) {
            const stated = {
                total_amount: service.price, overtime_amount: 0, commission_percent: job.percent,
                commission_amount: Math.round((service.price - job.payout) * 100) / 100,
                provider_earnings: job.payout, final_provider_amount: job.payout, overtime_earnings: 0,
            };
            await withBooking(request, as, service, {}, async (id) => {
                await runJob(request, as, id, { commission: job.commission, finish: { submitted_duration_minutes: 600, submitted_headcount: 10 } });
                const completed = await request.put(`/api/bookings?id=${id}`, { headers: as.admin, data: { status: 'completed' }, maxRetries: RESET_RETRIES, timeout: 60_000 });
                expect(completed.status(), `${job.what}: the admin marks booking ${id} completed`).toBe(200);

                const generated = await request.post('/api/admin/invoices/generate', { headers: as.admin, data: { booking_id: id }, maxRetries: RESET_RETRIES, timeout: 60_000 });
                expect(generated.status(), `${job.what}: the admin generates the invoices of booking ${id}`).toBe(200);
                const { breakdown } = (await generated.json()).invoice;
                expect(breakdown.total, `${job.what}: the total the invoice answers`).toBe(service.price);
                expect(breakdown.overtime_amount, `${job.what}: the overtime amount the invoice answers`).toBe(0);
                await expectInvoices(id, stated, job.what);

                if (job.override) {
                    const overridden = await request.put(`/api/admin/bookings/${id}/override`, {
                        headers: as.admin,
                        data: { worker_count: 10, actual_duration_minutes: 600, reason: 'E2E price-of-record: the override changes no amount.' },
                        maxRetries: RESET_RETRIES,
                        timeout: 60_000,
                    });
                    expect(overridden.status(), `${job.what}: the admin overrides the hours and crew of booking ${id}`).toBe(200);
                    await expectInvoices(id, { ...stated, overtime_minutes: 600 - service.minutes }, `${job.what}, after the override`);
                }
            }, as.customer);
        }
    });

    // The four routes run after a Stripe call that the dev stack has no key for, so their lines are read, not run: each imports the price
    // module and holds the line that takes its amount from it, and holds none of the listed inputs, which are the ones the amount does not
    // come from. This is a source guard, not a behaviour test.
    test('the routes that charge or pay take the amount from the price of record', () => {
        const routes = [
            {
                file: 'src/app/api/customer/bookings/[id]/approve/route.js',
                present: ['providerPayout(booking)', 'booking.service_price', 'amount_to_capture'],
                absent: ['submitted_headcount', 'submitted_duration_minutes', 'calcFinalAmount', 'off_session', 'worker_count', 'additional_price'],
            },
            {
                file: 'src/app/api/cron/auto-release/route.js',
                present: ['providerPayout(booking)', 'booking.service_price', 'amount_to_capture'],
                absent: ['final_provider_amount ||', 'worker_count'],
            },
            {
                file: 'src/app/api/stripe/webhook/route.js',
                present: ['providerPayout(booking)'],
                absent: ['metadata.provider_amount', 'provider_cents'],
            },
            {
                file: 'src/app/api/payment/create-intent/route.js',
                present: ['catalogPrice(serviceRow)', 'catalog.price'],
                absent: ['service_price'],
            },
        ];
        for (const { file, present, absent } of routes) {
            const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
            expect(/from\s+['"]@\/lib\/booking-price['"]/.test(source), `${file} imports the price module`).toBe(true);
            for (const text of present) expect(source.includes(text), `${file} holds ${JSON.stringify(text)}`).toBe(true);
            for (const text of absent) expect(source.includes(text), `${file} does not hold ${JSON.stringify(text)}`).toBe(false);
        }
    });

    test('the price of record and the payout follow the catalog row and the commission rule', async () => {
        const { catalogPrice, commissionPercentOf, providerPayout, DEFAULT_COMMISSION_PERCENT } = await import('../src/lib/booking-price.js');

        // The catalog offers an active service with a price above 0; DECIMAL columns arrive as strings.
        expect(catalogPrice({ is_active: 1, base_price: '80.00', additional_price: '40.00' }), 'a catalog row').toEqual({ price: 80, rate: 40 });
        expect(catalogPrice({ is_active: 1, base_price: 80, additional_price: null }), 'no hourly rate is a rate of 0').toEqual({ price: 80, rate: 0 });
        expect(catalogPrice({ is_active: 1, base_price: '80.00', additional_price: 'x' }), 'an hourly rate that is not a number is a rate of 0').toEqual({ price: 80, rate: 0 });
        expect(catalogPrice(undefined), 'no row').toBeNull();
        expect(catalogPrice(null), 'a null row').toBeNull();
        expect(catalogPrice({ is_active: 0, base_price: '80.00', additional_price: '40.00' }), 'an inactive service').toBeNull();
        expect(catalogPrice({ is_active: 1, base_price: '0.00', additional_price: '40.00' }), 'a price of 0').toBeNull();
        expect(catalogPrice({ is_active: 1, base_price: '-5.00', additional_price: '40.00' }), 'a price below 0').toBeNull();
        expect(catalogPrice({ is_active: 1, base_price: 'x', additional_price: '40.00' }), 'a price that is not a number').toBeNull();

        // The commission percent is the booking's own; none set is the default of 20, and a stored 0 is 0.
        expect(DEFAULT_COMMISSION_PERCENT, 'the default percent').toBe(20);
        expect(commissionPercentOf({ commission_percent: null }), 'NULL').toBe(20);
        expect(commissionPercentOf({ commission_percent: '' }), 'an empty string').toBe(20);
        expect(commissionPercentOf({}), 'no column').toBe(20);
        expect(commissionPercentOf({ commission_percent: 'x' }), 'not a number').toBe(20);
        expect(commissionPercentOf({ commission_percent: '0.00' }), 'a stored 0').toBe(0);
        expect(commissionPercentOf({ commission_percent: '25.00' }), 'a stored 25').toBe(25);

        // The payout is the recorded price less that percent, to the cent.
        expect(providerPayout({ service_price: '80.00', commission_percent: null }), 'the default percent').toBe(64);
        expect(providerPayout({ service_price: '80.00', commission_percent: '0.00' }), 'a stored 0 pays the whole price').toBe(80);
        expect(providerPayout({ service_price: '80.00', commission_percent: '25.00' }), 'a stored 25').toBe(60);
        expect(providerPayout({ service_price: '33.33', commission_percent: null }), '26.664 is 26.66').toBe(26.66);
        expect(providerPayout({ service_price: '19.99', commission_percent: '25.00' }), '14.9925 is 14.99').toBe(14.99);
    });
});
