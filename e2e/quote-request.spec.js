// @ts-check
// A job that cannot be priced from a few taps becomes a short request for a quote (ENG-012). The server cases are here, B1 to B11; B12 (the
// route coverage and the role-by-route specs pass with the two new rows) is e2e/auth-coverage.spec.js and e2e/auth-matrix.spec.js over the two
// rows added to e2e/auth/route-matrix.js, so it has no case of its own. The screen cases F1 to F5 are added to this file by the frontend seat.
//   B1  a job whose answers pick an item at its quote_from is not priced: priceJob answers reason 'quote' and the picks, and no figure;
//   B2  the threshold is the item's own: a unit or an extra by its count, an option or a property type once, a weekend never, no quote_from never;
//   B3  an answer that cannot be priced next to a flagged pick is the refusal it is today, not a quote;
//   B4  a flagged pick quotes with a frequency and as a series, and the same answers without the flag price as before;
//   B5  the price route answers a quote with 200, the picks and the choices and no figure, and a job that can be priced with its price;
//   B6  a booking and create-intent refuse a job that needs a quote: 400, no booking row, no Stripe call (the fail-closed pin);
//   B7  a request for a quote is saved with the picks that sent it, as a row of quote_requests and never a booking; only a customer's credential sets user_id;
//   B8  answers that can be priced, answers that cannot, a service that is not offered and an empty or unreadable body save nothing;
//   B9  each contact field is checked and its refusal names the field; the limits themselves are accepted;
//  B10  the fourth request from one email in an hour and the thirty-first in all are refused with 429;
//  B11  the admin reads the requests, newest first, a page at a time; no credential is 401, a customer or a provider is 403.
// B1 to B4 call priceJob, priceVisits, picksOf and quoteFlagsOf from src/lib/pricing-rules.js with the rule's rows passed as literals, written in
// this file (fixture service 1 with its placeholder figures and the quote_from that database/fixtures/catalog.js gives them). Every expected
// figure is a literal worked by hand from those rows and a fixed date, never computed by the code under test. Each case loads the module itself,
// so a missing module fails each case on its own. B5 to B11 ask the running app and read quote_requests and bookings in the dev database the way
// e2e/pricing-rules.spec.js does (assertDevTarget before it connects, assertNoRealPeople once connected). Every request this file saves carries an
// e-mail address that starts 'e2e-eng012-' and every row it seeds is one of those, so each case ends by deleting the rows of that prefix.
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { getCredentialHeaders } from './auth/credentials.js';
import { RESET_RETRIES } from './support/auth.js';
import { users } from '../database/fixtures/accounts.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';

// Tracing is off, as in e2e/pricing-rules.spec.js: the cases that send requests carry a fixture account's session, and a trace records request
// headers and bodies. A failure message names the case and the figures, never a header or a token.
test.use({ trace: 'off' });

const SERVICE_1 = { id: 1, name: 'Fixture Standard Clean', base_price: '80.00', additional_price: '40.00', duration_minutes: 120, is_active: 1 };

// Service 1's rows as the database gives them with 0005 applied and the fixtures loaded (DECIMAL columns arrive as strings, the minutes, the
// flags and quote_from as numbers or null): base 80.00 and 120 minutes; bedrooms 20.00 and 30 minutes each, a quote from 7; bathrooms 15.00 and
// 20; the options standard (0.00), deep (60.00 and 60 minutes) and hourly (45.00 an hour); the property types apartment (0.00), house (25.00
// and 30 minutes), commercial and post_construction (0.00, a quote from 1); the weekend (30.00); the extras oven (35.00 and 30 minutes) and
// fridge (30.00 and 20 minutes).
const ITEMS_1 = [
    { kind: 'unit', code: 'bedrooms', label: 'Bedrooms (placeholder figure)', amount: '20.00', minutes: 30, is_hourly: 0, quote_from: 7 },
    { kind: 'unit', code: 'bathrooms', label: 'Bathrooms (placeholder figure)', amount: '15.00', minutes: 20, is_hourly: 0, quote_from: null },
    { kind: 'option', code: 'standard', label: 'Standard clean (placeholder figure)', amount: '0.00', minutes: 0, is_hourly: 0, quote_from: null },
    { kind: 'option', code: 'deep', label: 'Deep clean (placeholder figure)', amount: '60.00', minutes: 60, is_hourly: 0, quote_from: null },
    { kind: 'option', code: 'hourly', label: 'By the hour (placeholder figure)', amount: '45.00', minutes: 0, is_hourly: 1, quote_from: null },
    { kind: 'property_type', code: 'apartment', label: 'Apartment (placeholder figure)', amount: '0.00', minutes: 0, is_hourly: 0, quote_from: null },
    { kind: 'property_type', code: 'house', label: 'House (placeholder figure)', amount: '25.00', minutes: 30, is_hourly: 0, quote_from: null },
    { kind: 'property_type', code: 'commercial', label: 'Commercial (placeholder figure)', amount: '0.00', minutes: 0, is_hourly: 0, quote_from: 1 },
    { kind: 'property_type', code: 'post_construction', label: 'Post-construction (placeholder figure)', amount: '0.00', minutes: 0, is_hourly: 0, quote_from: 1 },
    { kind: 'weekend', code: 'weekend', label: 'Weekend (placeholder figure)', amount: '30.00', minutes: 0, is_hourly: 0, quote_from: null },
    { kind: 'extra', code: 'oven', label: 'Oven (placeholder figure)', amount: '35.00', minutes: 30, is_hourly: 0, quote_from: null },
    { kind: 'extra', code: 'fridge', label: 'Fridge (placeholder figure)', amount: '30.00', minutes: 20, is_hourly: 0, quote_from: null },
];

// ITEMS_1 with the row `code` changed: the rows a client would write for its own thresholds.
const withRow = (code, changes) => ITEMS_1.map((item) => (item.code === code ? { ...item, ...changes } : item));

// The flag the commercial property type gives, as priceJob and the price route answer it.
const COMMERCIAL_FLAG = { kind: 'property_type', code: 'commercial', label: 'Commercial (placeholder figure)', quantity: 1 };
const COMMERCIAL = { property_type: 'commercial' };

// 2026-10-14 is a Wednesday and 2026-10-10 a Saturday.
const WEDNESDAY = '2026-10-14';
const SATURDAY = '2026-10-10';

const EMAIL_PREFIX = 'e2e-eng012-';
const QUOTE_REFUSAL = { success: false, message: 'This job needs a quote, not a price', field: 'quote' };
const TOO_MANY = { success: false, message: 'Too many requests just now. Please try again in a little while.' };
const [CUSTOMER1] = users;

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

// Every request and every seeded row of this file is deleted again, after each case and before the first, so a run that died halfway leaves
// nothing that counts against the caps of the next.
async function clearRequests() {
    await (await db()).query('DELETE FROM quote_requests WHERE customer_email LIKE ?', [`${EMAIL_PREFIX}%`]);
}

test.beforeAll(clearRequests);
test.afterEach(clearRequests);
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

// The number a one-column count query gives.
async function count(sql, params) {
    const [row] = await rows(sql, params);
    return Number(row.n);
}

// A JSON column as the driver hands it over: parsed, or as the text when the server keeps it.
const parsed = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

const tag = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
// An address of this file's prefix, lower case as the route stores it.
const emailOf = (what) => `${EMAIL_PREFIX}${what}-${tag()}@workontap.test`;

// The credentials of the cases that ask the app: the three roles, each by its Bearer and by its cookie.
async function headersFor(baseURL) {
    const styles = await getCredentialHeaders(String(baseURL));
    return {
        admin: styles['admin-bearer'], customer: styles['customer-bearer'], provider: styles['provider-bearer'],
        adminCookie: styles['admin-cookie'], customerCookie: styles['customer-cookie'], providerCookie: styles['provider-cookie'],
    };
}

// The contact fields of a request, all valid; `fields` replaces or adds to them (undefined leaves a field out of the body).
function contact(fields = {}) {
    return {
        name: 'E2E Quote', email: emailOf('req'), phone: '+14035550123', address: '1 Probe Street, Calgary',
        message: 'A warehouse floor of about 4,000 square feet, to be cleaned once after a refit.', ...fields,
    };
}

// The body of a request that the rule sends to a quote: service 1, the commercial property type, a valid contact.
function quoteBody(fields = {}) {
    return { service_id: SERVICE_1.id, answers: COMMERCIAL, ...contact(), ...fields };
}

function send(request, data, headers = {}) {
    return request.post('/api/quote-requests', { headers, data, maxRetries: RESET_RETRIES, timeout: 60_000 });
}

// Sends a body that is expected to be refused and checks the answer: the status, the body (a literal or a check of the field named) and that
// no row of `email` was saved.
async function expectRefusedRequest(request, what, data, status, expected) {
    const response = await send(request, data);
    expect(response.status(), `${what}: the status`).toBe(status);
    const answer = await response.json();
    expect(answer.success, `${what}: success is false`).toBe(false);
    if (expected) expect(answer, `${what}: the body`).toEqual(expected);
    if (typeof data?.email === 'string') {
        expect(await count('SELECT COUNT(*) AS n FROM quote_requests WHERE customer_email = ?', [data.email.trim().toLowerCase()]), `${what}: nothing is saved`).toBe(0);
    }
    return answer;
}

// A booking body for fixture service 1 on a Wednesday, as e2e/pricing-rules.spec.js sends it; `fields` replaces or adds to it.
function checkoutBody(fields = {}) {
    return {
        service_id: SERVICE_1.id, service_name: SERVICE_1.name, service_price: Number(SERVICE_1.base_price), additional_price: Number(SERVICE_1.additional_price),
        first_name: 'E2E', last_name: 'Quote', email: emailOf('book'), phone: '+14035550199',
        job_date: WEDNESDAY, job_time_slot: '09:00', job_description: 'E2E quote-request fail-closed pin, never saved.',
        address_line1: '1 Probe Street', city: 'Calgary', payment_intent_id: `pi_e2e_${EMAIL_PREFIX}${tag()}`,
        ...fields,
    };
}

// A row of quote_requests made in SQL, `minutesAgo` minutes old, for the caps and the list; `fields` replaces columns. Answers the id.
async function seedRequest(email, minutesAgo = 0, fields = {}) {
    const row = {
        service_id: 1, service_name: SERVICE_1.name, customer_name: 'E2E Seed', customer_email: email, customer_phone: null, address: null, message: 'Seeded by the e2e case.',
        answers: JSON.stringify(COMMERCIAL), picks: JSON.stringify([{ ...COMMERCIAL_FLAG, flagged: true }]), ...fields,
    };
    const columns = Object.keys(row);
    const [made] = /** @type {any} */ (await (await db()).query(
        `INSERT INTO quote_requests (${columns.join(', ')}, created_at) VALUES (${columns.map(() => '?').join(', ')}, NOW() - INTERVAL ? MINUTE)`,
        [...columns.map((column) => row[column]), minutesAgo],
    ));
    return Number(made.insertId);
}

test.describe('Quote requests', () => {
    // Mutant that turns this case red: priceJob prices a flagged pick at its amount (the verdict removed), or leaves price, minutes or lines on a quote.
    test('a job whose answers pick an item at its quote_from is not priced: the quote carries the picks and no figure', async () => {
        const { priceJob, picksOf, quoteFlagsOf, refusalOf } = await import('../src/lib/pricing-rules.js');

        const commercial = priceJob(SERVICE_1, ITEMS_1, COMMERCIAL, {});
        expect(commercial, 'the commercial property type: a quote with its pick').toEqual({ ok: false, reason: 'quote', field: 'quote', flags: [COMMERCIAL_FLAG] });
        expect(Object.keys(commercial).sort(), 'a quote has no price, no minutes and no lines to read').toEqual(['field', 'flags', 'ok', 'reason']);

        const postConstruction = priceJob(SERVICE_1, ITEMS_1, { property_type: 'post_construction' }, {});
        expect(postConstruction.reason, 'the post-construction property type: a quote').toBe('quote');
        expect(postConstruction.flags, 'the post-construction property type: its pick').toEqual([{ kind: 'property_type', code: 'post_construction', label: 'Post-construction (placeholder figure)', quantity: 1 }]);

        // Seven bedrooms and a commercial property type with the other kinds of answer around them: the flags are the two picks that sent it, the units
        // first, whatever else the answers hold; the date, a weekend or not, changes nothing.
        const many = { units: { bedrooms: 7, bathrooms: 2 }, option: 'deep', property_type: 'commercial', date: SATURDAY, extras: [{ code: 'oven', quantity: 1 }] };
        const job = priceJob(SERVICE_1, ITEMS_1, many, {});
        expect(job.flags, 'the flags are the picks at their quote_from, the units first').toEqual([
            { kind: 'unit', code: 'bedrooms', label: 'Bedrooms (placeholder figure)', quantity: 7 },
            COMMERCIAL_FLAG,
        ]);
        expect(quoteFlagsOf(ITEMS_1, many), 'quoteFlagsOf gives the same flags').toEqual(job.flags);

        // Every pick the answers make, flagged or not, in the order the route stores them: the units asked for, then the option, the property type
        // and the extras. The weekend is not a pick.
        expect(picksOf(ITEMS_1, many), 'the picks of the answers, the flagged ones marked').toEqual([
            { kind: 'unit', code: 'bedrooms', label: 'Bedrooms (placeholder figure)', quantity: 7, flagged: true },
            { kind: 'unit', code: 'bathrooms', label: 'Bathrooms (placeholder figure)', quantity: 2, flagged: false },
            { kind: 'option', code: 'deep', label: 'Deep clean (placeholder figure)', quantity: 1, flagged: false },
            { kind: 'property_type', code: 'commercial', label: 'Commercial (placeholder figure)', quantity: 1, flagged: true },
            { kind: 'extra', code: 'oven', label: 'Oven (placeholder figure)', quantity: 1, flagged: false },
        ]);
        expect(quoteFlagsOf(ITEMS_1, { property_type: 'apartment' }), 'an apartment sends nothing to a quote').toEqual([]);
        expect(quoteFlagsOf(ITEMS_1, undefined), 'no answers send nothing to a quote').toEqual([]);

        // The refusal a route turns the quote into when it does not tell a quote from a refusal.
        expect(refusalOf(commercial), 'refusalOf names the quote and the answer').toEqual(QUOTE_REFUSAL);
    });

    // Mutant that turns this case red: the threshold is hard-coded (seven, or any property type), or a unit counts once whatever its quantity.
    test("the threshold is the item's own: a unit or an extra by its count, an option or a property type once, a weekend never, no quote_from never", async () => {
        const { priceJob, picksOf } = await import('../src/lib/pricing-rules.js');

        // Bedrooms: six prices (80.00 + 6 x 20.00 = 200.00 and 120 + 6 x 30 = 300 minutes), seven and more quote.
        const six = priceJob(SERVICE_1, ITEMS_1, { units: { bedrooms: 6 } }, {});
        expect([six.ok, six.price, six.minutes], 'six bedrooms are priced').toEqual([true, 200, 300]);
        for (const bedrooms of [7, 8, 40]) {
            const job = priceJob(SERVICE_1, ITEMS_1, { units: { bedrooms } }, {});
            expect([job.ok, job.reason, job.field], `${bedrooms} bedrooms are a quote`).toEqual([false, 'quote', 'quote']);
            expect(job.flags, `${bedrooms} bedrooms: the flag holds the count`).toEqual([{ kind: 'unit', code: 'bedrooms', label: 'Bedrooms (placeholder figure)', quantity: bedrooms }]);
        }
        // None asked for is no pick, whatever the threshold: 80.00 and 120 minutes.
        const none = priceJob(SERVICE_1, ITEMS_1, { units: { bedrooms: 0 } }, {});
        expect([none.ok, none.price, none.minutes], 'no bedrooms are priced').toEqual([true, 80, 120]);

        // A row with no quote_from never quotes, however many are asked for: 50 bathrooms are 80.00 + 50 x 15.00 = 830.00 and 120 + 50 x 20 = 1120 minutes.
        const bathrooms = priceJob(SERVICE_1, ITEMS_1, { units: { bathrooms: 50 } }, {});
        expect([bathrooms.ok, bathrooms.price, bathrooms.minutes], '50 bathrooms are priced').toEqual([true, 830, 1120]);

        // An extra is picked by its count: with a quote from 3, two ovens are 80.00 + 2 x 35.00 = 150.00 and 120 + 2 x 30 = 180 minutes, three quote.
        const ovenAt3 = withRow('oven', { quote_from: 3 });
        const two = priceJob(SERVICE_1, ovenAt3, { extras: [{ code: 'oven', quantity: 2 }] }, {});
        expect([two.ok, two.price, two.minutes], 'two ovens are priced').toEqual([true, 150, 180]);
        const three = priceJob(SERVICE_1, ovenAt3, { extras: [{ code: 'oven', quantity: 3 }] }, {});
        expect([three.ok, three.reason], 'three ovens are a quote').toEqual([false, 'quote']);
        expect(three.flags, 'three ovens: the flag holds the count').toEqual([{ kind: 'extra', code: 'oven', label: 'Oven (placeholder figure)', quantity: 3 }]);

        // An option is picked once: with a quote from 1 it quotes when chosen and not otherwise; with a quote from 2 it never does.
        const deepAt1 = withRow('deep', { quote_from: 1 });
        expect(priceJob(SERVICE_1, deepAt1, { option: 'deep' }, {}).reason, 'a chosen option with a quote from 1 is a quote').toBe('quote');
        const standard = priceJob(SERVICE_1, deepAt1, { option: 'standard' }, {});
        expect([standard.ok, standard.price, standard.minutes], 'another option is priced').toEqual([true, 80, 120]);
        const deepAt2 = priceJob(SERVICE_1, withRow('deep', { quote_from: 2 }), { option: 'deep' }, {});
        expect([deepAt2.ok, deepAt2.price, deepAt2.minutes], 'an option is picked once, so a quote from 2 never fires: 80.00 + 60.00').toEqual([true, 140, 180]);

        // A property type is picked once as well: house with a quote from 2 is priced, 80.00 + 25.00 = 105.00 and 150 minutes.
        const houseAt2 = priceJob(SERVICE_1, withRow('house', { quote_from: 2 }), { property_type: 'house' }, {});
        expect([houseAt2.ok, houseAt2.price, houseAt2.minutes], 'a property type is picked once, so a quote from 2 never fires').toEqual([true, 105, 150]);
        const apartment = priceJob(SERVICE_1, ITEMS_1, { property_type: 'apartment' }, {});
        expect([apartment.ok, apartment.price, apartment.minutes], 'an apartment is priced: 80.00 and 120 minutes').toEqual([true, 80, 120]);

        // A weekend is not a pick: even a row that carried a quote_from (the table refuses one) does not quote a Saturday, 80.00 + 30.00 = 110.00.
        const weekend = priceJob(SERVICE_1, withRow('weekend', { quote_from: 1 }), { date: SATURDAY }, {});
        expect([weekend.ok, weekend.price, weekend.minutes], 'a Saturday is priced, not quoted').toEqual([true, 110, 120]);
        expect(picksOf(withRow('weekend', { quote_from: 1 }), { date: SATURDAY }), 'the weekend is not among the picks').toEqual([]);

        // A rule whose own row is wrong is a fault in the rule and stops the price, rather than pricing the job or quoting it: a quote_from below 1.
        expect(() => priceJob(SERVICE_1, withRow('bedrooms', { quote_from: 0 }), { units: { bedrooms: 2 } }, {}), 'a quote_from of 0 is a fault in the rule').toThrow(/quote_from/);
    });

    // Mutant that turns this case red: the verdict is made before the answers are checked, so a malformed answer next to a flagged pick quotes.
    test('an answer that cannot be priced next to a flagged pick is the refusal it is today, not a quote', async () => {
        const { priceJob } = await import('../src/lib/pricing-rules.js');

        const refused = [
            ['a unit the service does not have', { ...COMMERCIAL, units: { attic: 1 } }, 'units'],
            ['a unit count that is not whole', { ...COMMERCIAL, units: { bedrooms: 2.5 } }, 'units'],
            ['a unit count that is text beside seven bedrooms', { units: { bedrooms: 7, bathrooms: 'two' } }, 'units'],
            ['an option the service does not have', { ...COMMERCIAL, option: 'platinum' }, 'option'],
            ['hours beside an option that is not by the hour', { units: { bedrooms: 7 }, hours: 3 }, 'hours'],
            ['a property type the service does not have', { property_type: 'palace' }, 'property_type'],
            ['a date that is no day', { ...COMMERCIAL, date: '2026-02-30' }, 'date'],
            ['an extra with a negative count', { ...COMMERCIAL, extras: [{ code: 'oven', quantity: -1 }] }, 'extras'],
            ['extras that are not a list', { ...COMMERCIAL, extras: 'oven' }, 'extras'],
            ['a frequency that is not offered', { ...COMMERCIAL, frequency: 'daily' }, 'frequency'],
            ['answers that are a list', [COMMERCIAL], 'answers'],
            ['answers that are text', 'commercial', 'answers'],
        ];
        for (const [what, answers, field] of refused) {
            const job = priceJob(SERVICE_1, ITEMS_1, answers, {});
            expect([job.ok, job.reason, job.field], `${what}: refused as an answer that cannot be priced`).toEqual([false, 'answers', field]);
            expect('flags' in job, `${what}: no flags come with a refusal`).toBe(false);
        }

        // A service the catalog does not offer is still that refusal, with a flagged pick or not.
        const noService = priceJob(undefined, ITEMS_1, COMMERCIAL, {});
        expect([noService.ok, noService.reason], 'a service that is not offered, beside a flagged pick').toEqual([false, 'service']);
        // No rows are no pick to flag: the property type is one the service does not have.
        const noRows = priceJob(SERVICE_1, [], COMMERCIAL, {});
        expect([noRows.ok, noRows.reason, noRows.field], 'a service with no rows').toEqual([false, 'answers', 'property_type']);
    });

    // Mutant that turns this case red: the verdict is skipped when the answers carry a frequency, or priceVisits prices the first visit of a flagged series.
    test('a flagged pick quotes with a frequency and as a series, and the same answers without the flag price as before', async () => {
        const { priceJob, priceVisits } = await import('../src/lib/pricing-rules.js');
        const discounts = { monthly: 1000, weekly: 500 };

        const flagged = { ...COMMERCIAL, frequency: 'monthly', date: WEDNESDAY };
        const job = priceJob(SERVICE_1, ITEMS_1, flagged, discounts);
        expect(job, 'a flagged pick with a frequency is a quote').toEqual({ ok: false, reason: 'quote', field: 'quote', flags: [COMMERCIAL_FLAG] });
        expect(priceVisits(SERVICE_1, ITEMS_1, flagged, discounts), 'a flagged series is a quote, not a list of visits').toEqual(job);
        expect(priceVisits(SERVICE_1, ITEMS_1, { ...COMMERCIAL, frequency: 'weekly' }, discounts), 'a flagged series with no start day is a quote as well').toEqual(job);
        expect(priceVisits(SERVICE_1, ITEMS_1, COMMERCIAL, discounts), 'a flagged job with no frequency, as a single visit, is a quote').toEqual(job);

        // The same answers with a house: 80.00 + 25.00 = 105.00 and 150 minutes; a tenth off monthly is 10.50, so 94.50 a visit; three visits.
        const house = priceJob(SERVICE_1, ITEMS_1, { property_type: 'house', frequency: 'monthly' }, discounts);
        expect([house.ok, house.price, house.minutes], 'a house, monthly, is priced with its discount').toEqual([true, 94.5, 150]);
        expect(house.lines.map((line) => line.code), 'the lines: the base, the house and the discount').toEqual(['base', 'house', 'monthly']);
        const series = priceVisits(SERVICE_1, ITEMS_1, { property_type: 'house', frequency: 'monthly', date: WEDNESDAY }, discounts);
        expect(series.ok, 'a house as a series is priced').toBe(true);
        expect(series.visits.length, 'the monthly series has three visits').toBe(3);
        expect(series.visits[0].price, 'the first visit, on a Wednesday: 94.50').toBe(94.5);
        // And a property type that is priced but has no quote_from in a rule that has the column NULL everywhere prices as it did before the column.
        const plain = ITEMS_1.map((item) => ({ ...item, quote_from: null }));
        const old = priceJob(SERVICE_1, plain, { units: { bedrooms: 20 }, property_type: 'commercial' }, {});
        expect([old.ok, old.price, old.minutes], 'with no quote_from anywhere every answer prices: 80.00 + 20 x 20.00 + 0.00').toEqual([true, 480, 720]);
    });

    // Mutant that turns this case red: the price route answers a quote with a 400 or a price, or the screen's choices go missing from the quote, or quote_from is listed in a choice.
    test('the price route answers a quote with 200, the picks and the choices and no figure, and a job that can be priced with its price', async ({ request }) => {
        const ask = (data) => request.post('/api/pricing', { data, maxRetries: RESET_RETRIES, timeout: 60_000 });

        // AC1: the commercial property type, with no credential, as a screen asks before anyone has signed in.
        const quoted = await ask({ service_id: 1, answers: COMMERCIAL });
        expect(quoted.status(), 'the commercial property type is not a refusal').toBe(200);
        const quote = await quoted.json();
        expect(quote.success, 'success').toBe(true);
        expect(quote.quote_required, 'the answer says a quote is required').toBe(true);
        expect(quote.service_id, 'the answer names the service').toBe(1);
        expect(quote.flags, 'the answer holds the pick that sent it').toEqual([COMMERCIAL_FLAG]);
        for (const key of ['price', 'quoted_minutes', 'lines', 'visits']) expect(key in quote, `a quote carries no ${key}`).toBe(false);
        // The choices are the rows of the rule as a priced answer lists them, so the screen can still change its answers, without the quote_from.
        const choices = ITEMS_1.map(({ quote_from, ...choice }) => choice);
        expect(quote.choices, 'the twelve choices of service 1, in the order a screen shows them').toEqual(choices);
        expect(quote.choices.some((choice) => 'quote_from' in choice), 'the thresholds are not listed').toBe(false);

        // The unit threshold: six bedrooms are priced (200.00 and 300 minutes), seven are a quote.
        const six = await (await ask({ service_id: 1, answers: { units: { bedrooms: 6 } } })).json();
        expect([six.price, six.quoted_minutes, 'quote_required' in six], 'six bedrooms: priced, no quote_required').toEqual([200, 300, false]);
        const sevenResponse = await ask({ service_id: 1, answers: { units: { bedrooms: 7 } } });
        expect(sevenResponse.status(), 'seven bedrooms are not a refusal').toBe(200);
        const seven = await sevenResponse.json();
        expect([seven.quote_required, seven.flags], 'seven bedrooms: a quote with the unit pick').toEqual([true, [{ kind: 'unit', code: 'bedrooms', label: 'Bedrooms (placeholder figure)', quantity: 7 }]]);

        // A series of a flagged job is a quote with no visits.
        const series = await (await ask({ service_id: 1, answers: { ...COMMERCIAL, frequency: 'weekly', date: WEDNESDAY } })).json();
        expect([series.quote_required, 'visits' in series, 'price' in series], 'a flagged series: a quote, no visits, no price').toEqual([true, false, false]);

        // AC3: a house is priced, 80.00 + 25.00 = 105.00 and 150 minutes, with its lines and the same choices.
        const housed = await ask({ service_id: 1, answers: { property_type: 'house' } });
        expect(housed.status(), 'a house is priced').toBe(200);
        const house = await housed.json();
        expect([house.success, house.price, house.quoted_minutes], 'a house: 105.00 and 150 minutes').toEqual([true, 105, 150]);
        expect(['quote_required', 'flags'].filter((key) => key in house), 'a priced answer carries neither quote_required nor flags').toEqual([]);
        expect(house.lines.map((line) => line.code), 'the lines of a house').toEqual(['base', 'house']);
        expect(house.choices, 'the same twelve choices').toEqual(choices);

        // A refusal that is not a quote stays the 400 it was.
        const refused = await ask({ service_id: 1, answers: { ...COMMERCIAL, units: { attic: 1 } } });
        expect(refused.status(), 'an answer that cannot be priced beside a flagged pick is still a 400').toBe(400);
        expect(await refused.json(), 'and names the answer').toEqual({ success: false, message: 'These answers cannot be priced for this service', field: 'units' });
    });

    // Mutant that turns this case red: bookings/route.js or create-intent/route.js reads a flagged job as one it can book (a 200 where a refusal is expected).
    test('a booking and create-intent refuse a job that needs a quote: 400, no booking row, no Stripe call', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        // A guest books a single visit; a series is booked by a signed-in customer, so the route would answer 401 to a guest before it priced anything.
        const refusals = [
            ['the commercial property type', COMMERCIAL, {}],
            ['seven bedrooms', { units: { bedrooms: 7 } }, {}],
            ['the commercial property type as a series', { ...COMMERCIAL, frequency: 'weekly' }, as.customer],
        ];
        for (const [what, answers, bookingHeaders] of refusals) {
            const body = checkoutBody({ answers });
            const booked = await request.post('/api/bookings', { headers: bookingHeaders, data: body, maxRetries: RESET_RETRIES, timeout: 60_000 });
            try {
                expect(booked.status(), `a booking of ${what} is refused`).toBe(400);
                expect(await booked.json(), `a booking of ${what}: the quote, naming the answer`).toEqual(QUOTE_REFUSAL);
            } finally {
                // A regression that books the job leaves a booking behind: it is deleted again as admin, the way e2e/pricing-rules.spec.js deletes its own.
                for (const made of await rows('SELECT id FROM bookings WHERE customer_email = ?', [body.email])) {
                    await request.delete(`/api/bookings?id=${made.id}`, { headers: as.admin, maxRetries: RESET_RETRIES, timeout: 60_000 });
                    await (await db()).query('DELETE FROM job_sessions WHERE booking_id = ?', [made.id]);
                    await (await db()).query('DELETE FROM booking_audit_logs WHERE booking_id = ?', [made.id]);
                }
            }
            expect(await rows('SELECT id FROM bookings WHERE customer_email = ?', [body.email]), `a booking of ${what}: no booking row`).toEqual([]);

            // create-intent prices before it reaches Stripe, for which the dev stack has no key: the quote's 400 can only come from before the Stripe call, and
            // a route that went on would answer with a payment error or a client secret instead.
            const intent = await request.post('/api/payment/create-intent', { headers: as.customer, data: { service_id: 1, service_price: 1, answers }, maxRetries: RESET_RETRIES, timeout: 60_000 });
            expect(intent.status(), `create-intent for ${what} is refused`).toBe(400);
            expect(await intent.json(), `create-intent for ${what}: the quote, naming the answer`).toEqual(QUOTE_REFUSAL);
        }
    });

    // Mutant that turns this case red: the request becomes a bookings row, user_id is read from the body, picks lose their labels or their flagged marks.
    test('a request for a quote is saved with the picks that sent it, as a row of quote_requests and never a booking; only a customer sets user_id', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        const bookingsBefore = await count('SELECT COUNT(*) AS n FROM bookings');

        // AC2, as a guest: the details trimmed, the e-mail address lower case, a user_id in the body ignored.
        const email = emailOf('guest');
        const response = await send(request, quoteBody({ name: '  E2E Quote  ', email: email.toUpperCase(), user_id: 2 }));
        expect(response.status(), 'a request for a quote is created').toBe(201);
        const answer = await response.json();
        expect(Object.keys(answer).sort(), 'the answer is success and the id').toEqual(['id', 'success']);
        expect([answer.success, Number.isInteger(answer.id)], 'success and an id').toEqual([true, true]);
        const [saved] = await rows('SELECT * FROM quote_requests WHERE id = ?', [answer.id]);
        expect(saved, 'the request is a row of quote_requests').toBeDefined();
        expect({ user_id: saved.user_id, service_id: saved.service_id, service_name: saved.service_name }, 'a guest has no user, and the service is copied by name').toEqual({ user_id: null, service_id: 1, service_name: 'Fixture Standard Clean' });
        expect({ name: saved.customer_name, email: saved.customer_email, phone: saved.customer_phone, address: saved.address }, 'the contact details, trimmed and lower case').toEqual({ name: 'E2E Quote', email, phone: '+14035550123', address: '1 Probe Street, Calgary' });
        expect(saved.message, 'what the customer said about the job').toBe('A warehouse floor of about 4,000 square feet, to be cleaned once after a refit.');
        expect(parsed(saved.answers), 'the answers the rule accepted').toEqual(COMMERCIAL);
        expect(parsed(saved.picks), 'the pick that sent it, with the label the customer saw').toEqual([{ ...COMMERCIAL_FLAG, flagged: true }]);
        expect(saved.created_at, 'the time it was sent').toBeInstanceOf(Date);
        // It is not a job: no bookings row anywhere, none for this customer.
        expect(await count('SELECT COUNT(*) AS n FROM bookings WHERE customer_email = ?', [email]), 'no booking is made for the customer').toBe(0);
        expect(await count('SELECT COUNT(*) AS n FROM bookings'), 'no booking is made at all').toBe(bookingsBefore);

        // A request with more picks keeps every pick, the flagged ones marked, and only the answers the rule reads; an extra is reduced to its code and count.
        const detailed = await send(request, quoteBody({
            email: emailOf('detail'), phone: undefined, address: undefined,
            answers: { units: { bedrooms: 7, bathrooms: 2 }, option: 'deep', property_type: 'house', date: WEDNESDAY, extras: [{ code: 'oven', quantity: 1, note: 'inside' }], note: 'not an answer' },
        }));
        expect(detailed.status(), 'seven bedrooms with the other kinds of answer: created').toBe(201);
        const [more] = await rows('SELECT * FROM quote_requests WHERE id = ?', [(await detailed.json()).id]);
        expect([more.customer_phone, more.address], 'a phone and an address left out are NULL').toEqual([null, null]);
        expect(parsed(more.answers), 'the stored answers hold the keys the rule reads and nothing else').toEqual({ units: { bedrooms: 7, bathrooms: 2 }, option: 'deep', property_type: 'house', date: WEDNESDAY, extras: [{ code: 'oven', quantity: 1 }] });
        expect(parsed(more.picks), 'every pick in the order the rule reads them, the flagged one marked').toEqual([
            { kind: 'unit', code: 'bedrooms', label: 'Bedrooms (placeholder figure)', quantity: 7, flagged: true },
            { kind: 'unit', code: 'bathrooms', label: 'Bathrooms (placeholder figure)', quantity: 2, flagged: false },
            { kind: 'option', code: 'deep', label: 'Deep clean (placeholder figure)', quantity: 1, flagged: false },
            { kind: 'property_type', code: 'house', label: 'House (placeholder figure)', quantity: 1, flagged: false },
            { kind: 'extra', code: 'oven', label: 'Oven (placeholder figure)', quantity: 1, flagged: false },
        ]);

        // user_id is the signed-in customer's, from the credential, by Bearer and by cookie, whatever the body names (customer 2 here); the credential
        // of a provider or an admin is not a customer's and sets none.
        const credentials = [
            ['a customer by Bearer', as.customer, CUSTOMER1.id], ['a customer by cookie', as.customerCookie, CUSTOMER1.id],
            ['a provider by Bearer', as.provider, null], ['a provider by cookie', as.providerCookie, null],
            ['an admin by Bearer', as.admin, null], ['an admin by cookie', as.adminCookie, null],
        ];
        for (const [who, headers, expected] of credentials) {
            const made = await send(request, quoteBody({ email: emailOf('who'), user_id: 2 }), headers);
            expect(made.status(), `${who}: the request is created`).toBe(201);
            const [row] = await rows('SELECT user_id FROM quote_requests WHERE id = ?', [(await made.json()).id]);
            expect(row.user_id, `${who}: user_id`).toBe(expected);
        }
    });

    // Mutant that turns this case red: a job that can be priced is saved as a request (AC3), or a body that is not a request reaches the table.
    test('answers that can be priced, answers that cannot, a service that is not offered and an empty or unreadable body save nothing', async ({ request }) => {
        // AC3: a job the rule can price is a booking, and says so.
        const priceable = [
            ['a house', { property_type: 'house' }], ['six bedrooms', { units: { bedrooms: 6 } }], ['an apartment', { property_type: 'apartment' }],
            ['no answers', undefined], ['empty answers', {}],
        ];
        for (const [what, answers] of priceable) {
            await expectRefusedRequest(request, `${what}`, quoteBody({ email: emailOf('priced'), answers }), 400, { success: false, message: 'This job can be priced, so book it instead', field: 'answers' });
        }

        // Answers the rule cannot price keep their own refusal, a flagged pick beside them or not; a service that is not offered likewise.
        await expectRefusedRequest(request, 'a flagged pick beside a unit the service does not have', quoteBody({ email: emailOf('bad'), answers: { ...COMMERCIAL, units: { attic: 1 } } }), 400,
            { success: false, message: 'These answers cannot be priced for this service', field: 'units' });
        await expectRefusedRequest(request, 'a service that does not exist', quoteBody({ email: emailOf('none'), service_id: 999999 }), 400, { success: false, message: 'This service is not available for booking' });
        await expectRefusedRequest(request, 'no service', quoteBody({ email: emailOf('none'), service_id: undefined }), 400, { success: false, message: 'This service is not available for booking' });

        // The matrix probe: an empty body is refused by the first field it lacks, a body that is not JSON or not an object is refused as unreadable.
        await expectRefusedRequest(request, 'an empty body', {}, 400, { success: false, message: 'Enter your name (up to 120 characters)', field: 'name' });
        const unreadable = await request.post('/api/quote-requests', { headers: { 'content-type': 'application/json' }, data: '{"name":', maxRetries: RESET_RETRIES, timeout: 60_000 });
        expect([unreadable.status(), await unreadable.json()], 'a body that is not JSON').toEqual([400, { success: false, message: 'Invalid request body' }]);
        for (const body of ['[]', '"quote"', 'null', '7']) {
            const odd = await request.post('/api/quote-requests', { headers: { 'content-type': 'application/json' }, data: body, maxRetries: RESET_RETRIES, timeout: 60_000 });
            expect([odd.status(), await odd.json()], `a body that is ${body}`).toEqual([400, { success: false, message: 'Invalid request body' }]);
        }
        expect(await count('SELECT COUNT(*) AS n FROM quote_requests WHERE customer_email LIKE ?', [`${EMAIL_PREFIX}%`]), 'nothing was saved by any of these').toBe(0);
    });

    // Mutant that turns this case red: a contact field is not checked, or a refusal names another field, or a limit is off by one.
    test("each contact field is checked and its refusal names the field; the limits themselves are accepted", async ({ request }) => {
        const failures = [
            ['a missing name', { name: undefined }, 'name'],
            ['a blank name', { name: '   ' }, 'name'],
            ['a name over 120', { name: 'n'.repeat(121) }, 'name'],
            ['a name that is not text', { name: 42 }, 'name'],
            ['a missing e-mail address', { email: undefined }, 'email'],
            ['an e-mail address over 254', { email: `${'a'.repeat(250)}@b.cd` }, 'email'],
            ['an e-mail address with no @', { email: 'nobody.example.test' }, 'email'],
            ['an e-mail address with no dot after the @', { email: 'nobody@example' }, 'email'],
            ['an e-mail address with a space', { email: 'no body@example.test' }, 'email'],
            ['an e-mail address that is not text', { email: 12345 }, 'email'],
            ['a phone number under 6', { phone: '12345' }, 'phone'],
            ['a phone number over 40', { phone: '1'.repeat(41) }, 'phone'],
            ['a phone number with letters', { phone: '403-555-CALL' }, 'phone'],
            ['a phone number that is not text', { phone: 4035550123 }, 'phone'],
            ['an address over 255', { address: 'a'.repeat(256) }, 'address'],
            ['an address that is not text', { address: 12 }, 'address'],
            ['a missing message', { message: undefined }, 'message'],
            ['a blank message', { message: '  ' }, 'message'],
            ['a message over 1000', { message: 'm'.repeat(1001) }, 'message'],
            ['a message that is not text', { message: ['a', 'b'] }, 'message'],
        ];
        for (const [what, fields, field] of failures) {
            const answer = await expectRefusedRequest(request, what, quoteBody({ email: emailOf('field'), ...fields }), 400);
            expect(answer.field, `${what}: the refusal names the field`).toBe(field);
            expect(typeof answer.message === 'string' && answer.message.length > 0, `${what}: the refusal says what to fix`).toBe(true);
        }
        expect(await count('SELECT COUNT(*) AS n FROM quote_requests WHERE customer_email LIKE ?', [`${EMAIL_PREFIX}%`]), 'none of them saved a row').toBe(0);

        // The limits themselves: a name of 120, an e-mail address of 254, a phone number of 40, an address of 255 and a message of 1000 are accepted.
        const long = `${EMAIL_PREFIX}edge-${tag()}`.padEnd(254 - '@workontap.test'.length, 'x') + '@workontap.test';
        expect(long.length, 'the longest e-mail address is 254').toBe(254);
        const edge = await send(request, quoteBody({ name: 'n'.repeat(120), email: long, phone: '1'.repeat(40), address: 'a'.repeat(255), message: 'm'.repeat(1000) }));
        expect(edge.status(), 'the longest of every field is accepted').toBe(201);
        const [wide] = await rows('SELECT CHAR_LENGTH(customer_name) AS name, CHAR_LENGTH(customer_email) AS email, CHAR_LENGTH(customer_phone) AS phone, CHAR_LENGTH(address) AS address, CHAR_LENGTH(message) AS message FROM quote_requests WHERE id = ?', [(await edge.json()).id]);
        expect({ ...wide }, 'and stored whole').toEqual({ name: 120, email: 254, phone: 40, address: 255, message: 1000 });
        // The shortest phone number is 6, and a phone number or address left blank is none.
        const short = await send(request, quoteBody({ email: emailOf('short'), phone: '(40) 555', address: '' }));
        expect(short.status(), 'a phone number of 6 and a blank address are accepted').toBe(201);
        const [narrow] = await rows('SELECT customer_phone, address FROM quote_requests WHERE id = ?', [(await short.json()).id]);
        expect([narrow.customer_phone, narrow.address], 'a blank address is NULL').toEqual(['(40) 555', null]);
        const blank = await send(request, quoteBody({ email: emailOf('blank'), phone: '' }));
        expect(blank.status(), 'a blank phone number is none').toBe(201);
        const [none] = await rows('SELECT customer_phone FROM quote_requests WHERE id = ?', [(await blank.json()).id]);
        expect(none.customer_phone, 'a blank phone number is NULL').toBeNull();
    });

    // Mutant that turns this case red: a cap is off by one, counts rows older than an hour, counts every email together, or lets a refused request in.
    test('the fourth request from one email in an hour and the thirty-first in all are refused with 429 and save nothing', async ({ request }) => {
        // Three requests from one address in the hour are saved and the fourth is not; another address is not held by it.
        const held = emailOf('held');
        for (const nth of [1, 2, 3]) {
            expect((await send(request, quoteBody({ email: held }))).status(), `request ${nth} from one address`).toBe(201);
        }
        const fourth = await send(request, quoteBody({ email: held }));
        expect([fourth.status(), await fourth.json()], 'the fourth request from one address in an hour').toEqual([429, TOO_MANY]);
        expect(await count('SELECT COUNT(*) AS n FROM quote_requests WHERE customer_email = ?', [held]), 'the fourth saved nothing').toBe(3);
        expect((await send(request, quoteBody({ email: emailOf('other') }))).status(), 'another address is not held by it').toBe(201);

        // Rows older than an hour do not count: three from two hours ago, and the address is not held. Two from ten minutes ago leave room for one.
        const old = emailOf('old');
        for (let n = 0; n < 3; n++) await seedRequest(old, 120);
        expect((await send(request, quoteBody({ email: old }))).status(), 'rows from two hours ago do not count').toBe(201);
        const recent = emailOf('recent');
        for (let n = 0; n < 2; n++) await seedRequest(recent, 10);
        expect((await send(request, quoteBody({ email: recent }))).status(), 'the third in the hour is saved').toBe(201);
        expect((await send(request, quoteBody({ email: recent }))).status(), 'and the next is not').toBe(429);
        await clearRequests();

        // The cap in all: with 29 saved in the last hour the 30th is saved and the 31st is not, whoever sends it. Rows of other people count as well.
        const others = await count("SELECT COUNT(*) AS n FROM quote_requests WHERE created_at > NOW() - INTERVAL 1 HOUR");
        expect(others, 'the table holds no other request of the last hour (a table with some is cleared first)').toBeLessThanOrEqual(29);
        for (let n = 0; n < 29 - others; n++) await seedRequest(emailOf(`fill${n}`), 5);
        const thirtieth = await send(request, quoteBody({ email: emailOf('thirtieth') }));
        expect(thirtieth.status(), 'the 30th request in the hour is saved').toBe(201);
        const late = emailOf('thirtyfirst');
        const thirtyFirst = await send(request, quoteBody({ email: late }));
        expect([thirtyFirst.status(), await thirtyFirst.json()], 'the 31st request in the hour, from an address that sent none').toEqual([429, TOO_MANY]);
        expect(await count('SELECT COUNT(*) AS n FROM quote_requests WHERE customer_email = ?', [late]), 'the 31st saved nothing').toBe(0);
    });

    // Mutant that turns this case red: the list is read without the admin guard, the order is oldest first, the fields differ from the contract or a page past the end fails.
    test('the admin reads the requests, newest first, a page at a time; no credential is 401 and a customer or a provider is 403', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        const get = (path, headers = {}) => request.get(`/api/quote-requests${path}`, { headers, maxRetries: RESET_RETRIES, timeout: 60_000 });

        // The guard comes first, for every kind of credential.
        expect((await get('')).status(), 'no credential').toBe(401);
        for (const [who, headers] of [['a customer by Bearer', as.customer], ['a customer by cookie', as.customerCookie], ['a provider by Bearer', as.provider], ['a provider by cookie', as.providerCookie]]) {
            const refused = await get('', headers);
            expect(refused.status(), `${who} is not an admin`).toBe(403);
            expect('data' in (await refused.json()), `${who} reads no request`).toBe(false);
        }

        // Five requests: three of 30, 20 and 10 minutes ago, and two made at the same moment, 5 minutes ago (the one made second has the higher id).
        const email = emailOf('list');
        const oldest = await seedRequest(email, 30, { customer_name: 'E2E Oldest' });
        const middle = await seedRequest(email, 20, { customer_name: 'E2E Middle' });
        const recent = await seedRequest(email, 10, { customer_name: 'E2E Recent', customer_phone: '+14035550100', address: '2 Seed Street' });
        const [tie] = /** @type {any} */ (await (await db()).query(
            `INSERT INTO quote_requests (service_id, service_name, customer_name, customer_email, message, answers, picks, created_at)
             VALUES (1, ?, 'E2E Tie A', ?, 'tie', '{}', '[]', NOW() - INTERVAL 5 MINUTE), (1, ?, 'E2E Tie B', ?, 'tie', '{}', '[]', NOW() - INTERVAL 5 MINUTE)`,
            [SERVICE_1.name, email, SERVICE_1.name, email],
        ));
        const tieA = Number(tie.insertId);
        const tieB = tieA + 1;
        const total = await count('SELECT COUNT(*) AS n FROM quote_requests');
        const mine = [tieB, tieA, recent, middle, oldest];

        for (const [who, headers] of [['the admin by Bearer', as.admin], ['the admin by cookie', as.adminCookie]]) {
            const listed = await get('?limit=200', headers);
            expect(listed.status(), `${who} reads the requests`).toBe(200);
            const list = await listed.json();
            expect([list.success, list.total, list.limit, list.offset], `${who}: success, the total of all, the page as applied`).toEqual([true, total, 200, 0]);
            expect(list.data.filter((row) => mine.includes(row.id)).map((row) => row.id), `${who}: newest first, the later id first when two were made at one moment`).toEqual(mine);
        }

        // The fields are the contract's, with the JSON columns as data and an unset phone or address as null.
        const { data } = await (await get('?limit=200', as.admin)).json();
        const row = data.find((entry) => entry.id === recent);
        expect(Object.keys(row).sort(), 'the fields of a request').toEqual(['address', 'answers', 'created_at', 'customer_email', 'customer_name', 'customer_phone', 'id', 'message', 'picks', 'service_id', 'service_name', 'user_id']);
        expect({ ...row, created_at: typeof row.created_at }, 'a request as the admin reads it').toEqual({
            id: recent, created_at: 'string', service_id: 1, service_name: SERVICE_1.name, customer_name: 'E2E Recent', customer_email: email, customer_phone: '+14035550100',
            address: '2 Seed Street', message: 'Seeded by the e2e case.', picks: [{ ...COMMERCIAL_FLAG, flagged: true }], answers: COMMERCIAL, user_id: null,
        });
        expect(Number.isNaN(Date.parse(row.created_at)), 'the time is a date').toBe(false);
        const bare = data.find((entry) => entry.id === oldest);
        expect([bare.customer_phone, bare.address], 'a phone and an address never given are null').toEqual([null, null]);

        // A page: what the list holds from the second request on, two at a time; the default, the least and the most a page may be; a page past the end.
        const newest = (await rows('SELECT id FROM quote_requests ORDER BY created_at DESC, id DESC LIMIT 4 OFFSET 1')).map((entry) => entry.id);
        const page = await (await get('?limit=2&offset=1', as.admin)).json();
        expect([page.limit, page.offset, page.total, page.data.map((entry) => entry.id)], 'limit 2, offset 1').toEqual([2, 1, total, newest.slice(0, 2)]);
        const defaults = await (await get('', as.admin)).json();
        expect([defaults.limit, defaults.offset, defaults.data.length], 'with no limit: 50, offset 0').toEqual([50, 0, Math.min(50, total)]);
        const clamps = [['?limit=500', 200, 0], ['?limit=0', 1, 0], ['?limit=-4', 1, 0], ['?limit=many', 50, 0], ['?offset=-3', 50, 0], ['?offset=soon', 50, 0]];
        for (const [query, limit, offset] of clamps) {
            const clamped = await (await get(query, as.admin)).json();
            expect([clamped.limit, clamped.offset], `${query}: the page as applied`).toEqual([limit, offset]);
        }
        for (const offset of [total, total + 100]) {
            const past = await get(`?offset=${offset}`, as.admin);
            expect(past.status(), `offset ${offset}, past the end`).toBe(200);
            const empty = await past.json();
            expect([empty.data, empty.total, empty.offset], `offset ${offset}: an empty page, the total unchanged`).toEqual([[], total, offset]);
        }
    });
});
