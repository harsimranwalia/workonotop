// @ts-check
// Prices and quoted minutes come from each service's pricing rule and the answers given. Twelve cases:
//   1  the price and the quoted minutes follow the service's rule for each set of answers;
//   2  one more room or unit changes the price by that unit's amount;
//   3  changing only the option, the property type or the date changes the price by exactly that adjustment;
//   4  an option sets the price and the quoted minutes, and by the hour prices the hours asked for;
//   5  an extra adds its amount times any whole quantity;
//   6  answers the rule cannot price are refused and the refusal names the answer;
//   7  the price route answers the price, the quoted minutes and the lines for the answers given;
//   8  a booking records the price and the quoted minutes its answers produce;
//   9  a figure in the request is not read: the price route, create-intent and a booking use the rule's price;
//  10  every active service prices with no answers at its catalog price and minutes;
//  11  a booking an admin makes is priced by the rule from its answers;
//  12  time past the quote is measured from the booking's quoted minutes.
// The module cases (1 to 6) call priceJob from src/lib/pricing-rules.js with the rule's rows passed as literals, written in this file (fixture
// services 1 to 3 with their placeholder figures). Every expected figure is a literal worked by hand from those rows and a fixed date, never
// computed by the code under test. Each case loads the module itself, so a missing module fails each case on its own.
// Case 7 asks the running app's price route (POST /api/pricing) with no credential, as a screen does before anyone has signed in.
// Case 10 reads the dev database the way e2e/price-of-record.spec.js does: a small helper checks the target before it connects (assertDevTarget:
// a local host and the database workontap_db) and the rows once connected (assertNoRealPeople), then prices every active service with the
// pricing item rows it reads from the database.
// Cases 8, 9 and 11 book through the public checkout (a made-up payment intent id, as e2e/price-of-record.spec.js does, with an e-mail address
// that starts 'e2e-eng007-') and read what the booking stored with the same database helper. Each booking is deleted again as admin, with the
// booking_audit_logs and job_sessions rows that belong to it (the answer of that delete is not checked). Case 9 and case 11 also read source
// files: the lines that take an amount from the rule. A source read is a guard on the text; the behaviour is the figures the running app
// answers and stores.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { getCredentialHeaders } from './auth/credentials.js';
import { RESET_RETRIES } from './support/auth.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';

// Tracing is off, as in e2e/price-of-record.spec.js: the cases that send requests carry a fixture account's session, and a trace records
// request headers and bodies. A failure message names the case and the figures, never a header or a token.
test.use({ trace: 'off' });

// The rows the module cases pass to priceJob, written out as the database gives them (DECIMAL columns arrive as strings, the minutes and the
// flags as numbers). Services 1 to 3 are the fixture services of database/fixtures/catalog.js; every pricing item is a placeholder figure.
const SERVICE_1 = { id: 1, name: 'Fixture Standard Clean', base_price: '80.00', additional_price: '40.00', duration_minutes: 120, is_active: 1 };
const SERVICE_2 = { id: 2, name: 'Fixture Deep Clean', base_price: '140.00', additional_price: '60.00', duration_minutes: 180, is_active: 1 };
const SERVICE_3 = { id: 3, name: 'Fixture Furniture Assembly', base_price: '100.00', additional_price: '50.00', duration_minutes: 90, is_active: 1 };

// Service 1 (base 80.00 and 120 minutes): bedrooms 20.00 and 30 minutes each, bathrooms 15.00 and 20; the options standard (0.00), deep (60.00
// and 60 minutes) and hourly (45.00 an hour); the property types apartment (0.00) and house (25.00 and 30 minutes); the weekend (30.00); the
// extras oven (35.00 and 30 minutes) and fridge (30.00 and 20 minutes).
const ITEMS_1 = [
    { kind: 'unit', code: 'bedrooms', label: 'Bedrooms (placeholder figure)', amount: '20.00', minutes: 30, is_hourly: 0 },
    { kind: 'unit', code: 'bathrooms', label: 'Bathrooms (placeholder figure)', amount: '15.00', minutes: 20, is_hourly: 0 },
    { kind: 'option', code: 'standard', label: 'Standard clean (placeholder figure)', amount: '0.00', minutes: 0, is_hourly: 0 },
    { kind: 'option', code: 'deep', label: 'Deep clean (placeholder figure)', amount: '60.00', minutes: 60, is_hourly: 0 },
    { kind: 'option', code: 'hourly', label: 'By the hour (placeholder figure)', amount: '45.00', minutes: 0, is_hourly: 1 },
    { kind: 'property_type', code: 'apartment', label: 'Apartment (placeholder figure)', amount: '0.00', minutes: 0, is_hourly: 0 },
    { kind: 'property_type', code: 'house', label: 'House (placeholder figure)', amount: '25.00', minutes: 30, is_hourly: 0 },
    { kind: 'weekend', code: 'weekend', label: 'Weekend (placeholder figure)', amount: '30.00', minutes: 0, is_hourly: 0 },
    { kind: 'extra', code: 'oven', label: 'Oven (placeholder figure)', amount: '35.00', minutes: 30, is_hourly: 0 },
    { kind: 'extra', code: 'fridge', label: 'Fridge (placeholder figure)', amount: '30.00', minutes: 20, is_hourly: 0 },
];
// Service 2 (base 140.00 and 180 minutes): bedrooms 30.00 and 45 minutes each, the extra oven (35.00 and 30 minutes).
const ITEMS_2 = [
    { kind: 'unit', code: 'bedrooms', label: 'Bedrooms (placeholder figure)', amount: '30.00', minutes: 45, is_hourly: 0 },
    { kind: 'extra', code: 'oven', label: 'Oven (placeholder figure)', amount: '35.00', minutes: 30, is_hourly: 0 },
];
// Service 3 (base 100.00 and 90 minutes) has no pricing items.
const ITEMS_3 = [];
const ITEMS_BY_SERVICE_ID = new Map([[1, ITEMS_1], [2, ITEMS_2], [3, ITEMS_3]]);

// Fixed dates: 2026-10-14 is a Wednesday, 2026-10-09 a Friday, 2026-10-10 a Saturday and 2026-10-11 a Sunday.
const WEDNESDAY = '2026-10-14';
const FRIDAY = '2026-10-09';
const SATURDAY = '2026-10-10';
const SUNDAY = '2026-10-11';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EMAIL_PREFIX = 'e2e-eng007-';

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

// The pricing rows of a fixture service (none for a service the cases do not define, and for no service).
function itemsOf(service) {
    if (!service) return [];
    return ITEMS_BY_SERVICE_ID.get(service.id) || [];
}

// Two bedrooms and one bathroom on a Wednesday, the answers most cases start from; `more` adds answers to them or replaces some.
function twoAndOne(more = {}) {
    return { units: { bedrooms: 2, bathrooms: 1 }, date: WEDNESDAY, ...more };
}

// The codes of a priced job's lines, in order.
function codesOf(job) {
    return job.lines.map((line) => line.code);
}

// What `after` adds to `before`, in whole cents and in minutes (both are results of priceJob that were priced).
function change(before, after) {
    return { cents: Math.round(after.price * 100) - Math.round(before.price * 100), minutes: after.minutes - before.minutes };
}

// A priced job holds the price and the quoted minutes given (literals worked by hand); `what` names the answers in the failure messages.
function expectPriced(job, what, price, minutes) {
    expect(job.ok, `${what}: the answers are priced`).toBe(true);
    expect(job.price, `${what}: the price`).toBe(price);
    expect(job.minutes, `${what}: the quoted minutes`).toBe(minutes);
}

// A refusal holds the reason and the answer it names (`field` is undefined when it names none).
function expectRefused(job, what, reason, field) {
    expect(job.ok, `${what}: refused`).toBe(false);
    expect(job.reason, `${what}: the reason`).toBe(reason);
    expect(job.field, `${what}: the answer it names`).toBe(field);
}

// The credentials of the cases that book: the admin (who deletes the bookings again, and books in case 11) and a customer (create-intent).
async function headersFor(baseURL) {
    const styles = await getCredentialHeaders(String(baseURL));
    return { admin: styles['admin-bearer'], customer: styles['customer-bearer'] };
}

// The body of a checkout of fixture service 1 on a Wednesday, with the service's catalog price and hourly rate in it as the apps send them;
// `fields` replaces or adds to the body.
function checkoutBody(fields = {}) {
    const tag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    return {
        service_id: SERVICE_1.id, service_name: SERVICE_1.name, service_price: Number(SERVICE_1.base_price), additional_price: Number(SERVICE_1.additional_price),
        first_name: 'E2E', last_name: 'Pricing', email: `${EMAIL_PREFIX}${tag}@workontap.test`, phone: '+14035550199',
        job_date: WEDNESDAY, job_time_slot: '09:00', job_description: 'E2E pricing-rules booking, deleted by the case.',
        address_line1: '1 Probe Street', city: 'Calgary', payment_intent_id: `pi_e2e_${EMAIL_PREFIX}${tag}`,
        ...fields,
    };
}

// Posts a checkout body; `headers` signs the checkout in (the checkout is public, and a booking made with no credential belongs to no account).
function postCheckout(request, data, headers = {}) {
    return request.post('/api/bookings', { headers, data, maxRetries: RESET_RETRIES, timeout: 60_000 });
}

// Deletes a booking again as admin, with the rows of the tables that have no foreign key to it (the answer of the admin's delete is not checked).
async function deleteBooking(request, as, id) {
    await request.delete(`/api/bookings?id=${id}`, { headers: as.admin, maxRetries: RESET_RETRIES, timeout: 60_000 });
    await (await db()).query('DELETE FROM job_sessions WHERE booking_id = ?', [id]);
    await (await db()).query('DELETE FROM booking_audit_logs WHERE booking_id = ?', [id]);
}

// Runs `run(id, answer)` on a booking made by the checkout with `fields` in its body (200 is expected) and deletes the booking again, even when
// `run` fails.
async function withBooking(request, as, fields, run, headers = {}) {
    const response = await postCheckout(request, checkoutBody(fields), headers);
    expect(response.status(), 'checkout makes the booking').toBe(200);
    const answer = await response.json();
    expect(Number.isInteger(answer.booking_id), 'the booking has an id').toBe(true);
    try {
        await run(/** @type {number} */ (answer.booking_id), answer);
    } finally {
        await deleteBooking(request, as, answer.booking_id);
    }
}

// What a booking stored for its price: the price, the quoted minutes, the amount held on the card and the breakdown.
async function storedBooking(id) {
    const [row] = await rows('SELECT service_price, standard_duration_minutes, authorized_amount, price_breakdown FROM bookings WHERE id = ?', [id]);
    expect(row, `booking ${id} is stored`).toBeDefined();
    return row;
}

// The lines of a stored breakdown, without their labels. The column is JSON, which the driver hands over parsed (a server that keeps the text
// of a JSON column hands it over as that text).
function linesOf(stored) {
    const lines = typeof stored.price_breakdown === 'string' ? JSON.parse(stored.price_breakdown) : stored.price_breakdown;
    return lines.map(({ kind, code, quantity, amount, minutes }) => ({ kind, code, quantity, amount, minutes }));
}

// The files under `directory` that end .js, as paths from the repository root with forward slashes.
function sourcesUnder(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const found = path.join(directory, entry.name);
        if (entry.isDirectory()) return sourcesUnder(found);
        return entry.name.endsWith('.js') ? [path.relative(ROOT, found).split(path.sep).join('/')] : [];
    });
}

test.describe('Pricing rules', () => {
    // Mutant that turns this case red: the property-type line is dropped.
    test("the price and the quoted minutes follow the service's rule for each set of answers", async () => {
        const { priceJob } = await import('../src/lib/pricing-rules.js');

        // Each set of answers with its price, its quoted minutes and the codes of its lines (in order), worked by hand from the rows above.
        const sets = [
            {
                // the base: 80.00 and 120 minutes
                what: 'service 1, no answers',
                service: SERVICE_1, answers: {},
                price: 80, minutes: 120, codes: ['base'],
            },
            {
                // 80 + 2 bedrooms at 20 + 1 bathroom at 15 = 135.00; 120 + 2 at 30 + 1 at 20 = 200 minutes
                what: 'service 1, two bedrooms and one bathroom on a Wednesday',
                service: SERVICE_1, answers: twoAndOne(),
                price: 135, minutes: 200, codes: ['base', 'bedrooms', 'bathrooms'],
            },
            {
                // 80 + 40 + 15 + deep 60 + house 25 + Saturday 30 + 2 ovens at 35 + 1 fridge at 30 = 350.00
                // 120 + 60 + 20 + 60 + 30 + 0 + 2 at 30 + 1 at 20 = 370 minutes
                what: 'service 1, every kind of answer, on a Saturday',
                service: SERVICE_1,
                answers: twoAndOne({ option: 'deep', property_type: 'house', date: SATURDAY, extras: [{ code: 'oven', quantity: 2 }, { code: 'fridge', quantity: 1 }] }),
                price: 350, minutes: 370, codes: ['base', 'bedrooms', 'bathrooms', 'deep', 'house', 'weekend', 'oven', 'fridge'],
            },
            {
                // an empty units object and an empty list of extras name nothing: the base only
                what: 'service 1, empty units and no extras',
                service: SERVICE_1, answers: { units: {}, extras: [] },
                price: 80, minutes: 120, codes: ['base'],
            },
            {
                // the lines follow the order of the rule's rows, not the order the answers name them in: the same 135.00 and 200 minutes
                what: 'service 1, the units named bathrooms first',
                service: SERVICE_1, answers: { units: { bathrooms: 1, bedrooms: 2 }, date: WEDNESDAY },
                price: 135, minutes: 200, codes: ['base', 'bedrooms', 'bathrooms'],
            },
            {
                // keys that are not answers are not read: the same 135.00 and 200 minutes
                what: 'service 1, two bedrooms and one bathroom with keys that are not answers',
                service: SERVICE_1,
                answers: twoAndOne({ price: 1, total: 1, amount: 1, service_price: 0.01, quoted_minutes: 1, standard_duration: 1 }),
                price: 135, minutes: 200, codes: ['base', 'bedrooms', 'bathrooms'],
            },
            {
                // the base of service 2: 140.00 and 180 minutes
                what: 'service 2, no answers',
                service: SERVICE_2, answers: {},
                price: 140, minutes: 180, codes: ['base'],
            },
            {
                // 140 + 4 bedrooms at 30 = 260.00; 180 + 4 at 45 = 360 minutes
                what: 'service 2, four bedrooms',
                service: SERVICE_2, answers: { units: { bedrooms: 4 } },
                price: 260, minutes: 360, codes: ['base', 'bedrooms'],
            },
            {
                // the base of service 3: 100.00 and 90 minutes
                what: 'service 3, no answers',
                service: SERVICE_3, answers: {},
                price: 100, minutes: 90, codes: ['base'],
            },
        ];
        for (const set of sets) {
            const job = priceJob(set.service, itemsOf(set.service), set.answers);
            expectPriced(job, set.what, set.price, set.minutes);
            expect(codesOf(job), `${set.what}: the codes of the lines, in order`).toEqual(set.codes);
        }

        // Answers that are absent, null or an empty object price the base only; the base line holds the service's name, one, the base price and minutes.
        for (const [what, answers] of [['an empty object', {}], ['null', null], ['no answers argument', undefined]]) {
            const job = priceJob(SERVICE_1, ITEMS_1, answers);
            expectPriced(job, `service 1 with answers as ${what}`, 80, 120);
            expect(job.lines, `service 1 with answers as ${what}: the base line`).toEqual([
                { kind: 'base', code: 'base', label: 'Fixture Standard Clean', quantity: 1, amount: '80.00', minutes: 120 },
            ]);
        }

        // A service whose catalog row has no duration (NULL, or 0) is quoted 60 minutes, as every reader of the catalog takes it; its price is its base.
        for (const [what, duration] of [['no duration', null], ['a duration of 0', 0]]) {
            const job = priceJob({ ...SERVICE_3, duration_minutes: duration }, ITEMS_3, {});
            expectPriced(job, `service 3 with ${what}`, 100, 60);
            expect(job.lines, `service 3 with ${what}: the base line holds 60 minutes`).toEqual([
                { kind: 'base', code: 'base', label: 'Fixture Furniture Assembly', quantity: 1, amount: '100.00', minutes: 60 },
            ]);
        }

        // A line holds its row's label, the quantity, and the line's amount and minutes (the quantity times the row's figures); 40.00 and 60
        // minutes are 2 bedrooms at 20.00 and 30.
        const small = priceJob(SERVICE_1, ITEMS_1, twoAndOne());
        expect(small.lines, 'service 1, two bedrooms and one bathroom: the lines').toEqual([
            { kind: 'base', code: 'base', label: 'Fixture Standard Clean', quantity: 1, amount: '80.00', minutes: 120 },
            { kind: 'unit', code: 'bedrooms', label: 'Bedrooms (placeholder figure)', quantity: 2, amount: '40.00', minutes: 60 },
            { kind: 'unit', code: 'bathrooms', label: 'Bathrooms (placeholder figure)', quantity: 1, amount: '15.00', minutes: 20 },
        ]);
        const everything = priceJob(SERVICE_1, ITEMS_1, twoAndOne({ option: 'deep', property_type: 'house', date: SATURDAY, extras: [{ code: 'oven', quantity: 2 }, { code: 'fridge', quantity: 1 }] }));
        expect(everything.lines, 'service 1, every kind of answer, on a Saturday: the lines').toEqual([
            { kind: 'base', code: 'base', label: 'Fixture Standard Clean', quantity: 1, amount: '80.00', minutes: 120 },
            { kind: 'unit', code: 'bedrooms', label: 'Bedrooms (placeholder figure)', quantity: 2, amount: '40.00', minutes: 60 },
            { kind: 'unit', code: 'bathrooms', label: 'Bathrooms (placeholder figure)', quantity: 1, amount: '15.00', minutes: 20 },
            { kind: 'option', code: 'deep', label: 'Deep clean (placeholder figure)', quantity: 1, amount: '60.00', minutes: 60 },
            { kind: 'property_type', code: 'house', label: 'House (placeholder figure)', quantity: 1, amount: '25.00', minutes: 30 },
            { kind: 'weekend', code: 'weekend', label: 'Weekend (placeholder figure)', quantity: 1, amount: '30.00', minutes: 0 },
            { kind: 'extra', code: 'oven', label: 'Oven (placeholder figure)', quantity: 2, amount: '70.00', minutes: 60 },
            { kind: 'extra', code: 'fridge', label: 'Fridge (placeholder figure)', quantity: 1, amount: '30.00', minutes: 20 },
        ]);
    });

    // Mutant that turns this case red: a unit's amount is applied once for the kind of unit, not once for each unit counted.
    test("one more room or unit changes the price by that unit's amount", async () => {
        const { priceJob } = await import('../src/lib/pricing-rules.js');

        // A third bedroom: 80 + 3 at 20 + 15 = 155.00 and 120 + 3 at 30 + 20 = 230 minutes, against 135.00 and 200 for two (a bedroom is 20.00 and 30 minutes).
        const two = priceJob(SERVICE_1, ITEMS_1, twoAndOne());
        const three = priceJob(SERVICE_1, ITEMS_1, twoAndOne({ units: { bedrooms: 3, bathrooms: 1 } }));
        expectPriced(two, 'two bedrooms and one bathroom', 135, 200);
        expectPriced(three, 'three bedrooms and one bathroom', 155, 230);
        expect(change(two, three), 'a third bedroom adds 20.00 and 30 minutes').toEqual({ cents: 2000, minutes: 30 });

        // A second bathroom: 80 + 2 at 20 + 2 at 15 = 150.00 and 120 + 60 + 2 at 20 = 220 minutes (a bathroom is 15.00 and 20 minutes).
        const twoBathrooms = priceJob(SERVICE_1, ITEMS_1, twoAndOne({ units: { bedrooms: 2, bathrooms: 2 } }));
        expectPriced(twoBathrooms, 'two bedrooms and two bathrooms', 150, 220);
        expect(change(two, twoBathrooms), 'a second bathroom adds 15.00 and 20 minutes').toEqual({ cents: 1500, minutes: 20 });

        // Service 2: three bedrooms are 140 + 3 at 30 = 230.00 and 180 + 3 at 45 = 315 minutes; four are 260.00 and 360.
        const deepThree = priceJob(SERVICE_2, ITEMS_2, { units: { bedrooms: 3 } });
        const deepFour = priceJob(SERVICE_2, ITEMS_2, { units: { bedrooms: 4 } });
        expectPriced(deepThree, 'service 2, three bedrooms', 230, 315);
        expectPriced(deepFour, 'service 2, four bedrooms', 260, 360);
        expect(change(deepThree, deepFour), 'service 2: a fourth bedroom adds 30.00 and 45 minutes').toEqual({ cents: 3000, minutes: 45 });

        // The same third bedroom with the deep option, a house and a Saturday: 80 + 40 + 15 + 60 + 25 + 30 = 250.00 and
        // 120 + 60 + 20 + 60 + 30 + 0 = 290 minutes for two bedrooms; 270.00 and 320 minutes for three.
        const setTwo = priceJob(SERVICE_1, ITEMS_1, twoAndOne({ option: 'deep', property_type: 'house', date: SATURDAY }));
        const setThree = priceJob(SERVICE_1, ITEMS_1, twoAndOne({ units: { bedrooms: 3, bathrooms: 1 }, option: 'deep', property_type: 'house', date: SATURDAY }));
        expectPriced(setTwo, 'two bedrooms with the deep option, a house and a Saturday', 250, 290);
        expectPriced(setThree, 'three bedrooms with the deep option, a house and a Saturday', 270, 320);
        expect(change(setTwo, setThree), 'a third bedroom adds the same 20.00 and 30 minutes with the other answers set').toEqual({ cents: 2000, minutes: 30 });

        // From none to one: a unit not named counts 0 and has no line; one bedroom is 80 + 20 + 15 = 115.00 and 120 + 30 + 20 = 170 minutes,
        // against 95.00 and 140 minutes with no bedroom.
        const notNamed = priceJob(SERVICE_1, ITEMS_1, { units: { bathrooms: 1 } });
        const zero = priceJob(SERVICE_1, ITEMS_1, { units: { bedrooms: 0, bathrooms: 1 } });
        const one = priceJob(SERVICE_1, ITEMS_1, { units: { bedrooms: 1, bathrooms: 1 } });
        expectPriced(notNamed, 'one bathroom and no bedrooms named', 95, 140);
        expectPriced(zero, 'one bathroom and 0 bedrooms', 95, 140);
        expectPriced(one, 'one bathroom and one bedroom', 115, 170);
        expect(codesOf(notNamed), 'a unit not named has no line').toEqual(['base', 'bathrooms']);
        expect(codesOf(zero), 'a unit of quantity 0 has no line').toEqual(['base', 'bathrooms']);
        expect(codesOf(one), 'one bedroom has its line').toEqual(['base', 'bedrooms', 'bathrooms']);
        expect(change(zero, one), 'the first bedroom adds 20.00 and 30 minutes').toEqual({ cents: 2000, minutes: 30 });

        // A very large home is priced by the same rule: 1,000 bedrooms are 80 + 20,000 = 20,080.00 and 120 + 30,000 = 30,120 minutes.
        expectPriced(priceJob(SERVICE_1, ITEMS_1, { units: { bedrooms: 1000 } }), 'service 1, a thousand bedrooms', 20_080, 30_120);
    });

    // Mutant that turns this case red: the weekend test leaves out Sunday.
    test('changing only the option, the property type or the date changes the price by exactly that adjustment', async () => {
        const { priceJob } = await import('../src/lib/pricing-rules.js');
        const base = priceJob(SERVICE_1, ITEMS_1, twoAndOne());
        expectPriced(base, 'two bedrooms and one bathroom on a Wednesday', 135, 200);

        // The option: standard adds 0.00 and 0 minutes; deep adds 60.00 and 60 minutes (195.00 and 260).
        const standard = priceJob(SERVICE_1, ITEMS_1, twoAndOne({ option: 'standard' }));
        const deep = priceJob(SERVICE_1, ITEMS_1, twoAndOne({ option: 'deep' }));
        expectPriced(standard, 'the standard option', 135, 200);
        expectPriced(deep, 'the deep option', 195, 260);
        expect(change(base, standard), 'the standard option adds nothing').toEqual({ cents: 0, minutes: 0 });
        expect(change(base, deep), 'the deep option adds 60.00 and 60 minutes').toEqual({ cents: 6000, minutes: 60 });

        // The property type: apartment adds 0.00 and 0 minutes; house adds 25.00 and 30 minutes (160.00 and 230).
        const apartment = priceJob(SERVICE_1, ITEMS_1, twoAndOne({ property_type: 'apartment' }));
        const house = priceJob(SERVICE_1, ITEMS_1, twoAndOne({ property_type: 'house' }));
        expectPriced(apartment, 'an apartment', 135, 200);
        expectPriced(house, 'a house', 160, 230);
        expect(change(base, apartment), 'an apartment adds nothing').toEqual({ cents: 0, minutes: 0 });
        expect(change(base, house), 'a house adds 25.00 and 30 minutes').toEqual({ cents: 2500, minutes: 30 });

        // A chosen option and a chosen property type each have a line, even at 0.00.
        expect(codesOf(standard), 'the standard option has its line').toEqual(['base', 'bedrooms', 'bathrooms', 'standard']);
        expect(standard.lines[3], 'the standard option line holds 0.00 and 0 minutes').toEqual({ kind: 'option', code: 'standard', label: 'Standard clean (placeholder figure)', quantity: 1, amount: '0.00', minutes: 0 });
        expect(codesOf(apartment), 'an apartment has its line').toEqual(['base', 'bedrooms', 'bathrooms', 'apartment']);
        expect(apartment.lines[3], 'the apartment line holds 0.00 and 0 minutes').toEqual({ kind: 'property_type', code: 'apartment', label: 'Apartment (placeholder figure)', quantity: 1, amount: '0.00', minutes: 0 });

        // The date: a Saturday and a Sunday add the weekend's 30.00 and 0 minutes (165.00 and 200); a Friday, a Wednesday and no date add nothing.
        const saturday = priceJob(SERVICE_1, ITEMS_1, twoAndOne({ date: SATURDAY }));
        const sunday = priceJob(SERVICE_1, ITEMS_1, twoAndOne({ date: SUNDAY }));
        const friday = priceJob(SERVICE_1, ITEMS_1, twoAndOne({ date: FRIDAY }));
        const noDate = priceJob(SERVICE_1, ITEMS_1, { units: { bedrooms: 2, bathrooms: 1 } });
        expectPriced(saturday, 'a Saturday', 165, 200);
        expectPriced(sunday, 'a Sunday', 165, 200);
        expectPriced(friday, 'a Friday', 135, 200);
        expectPriced(noDate, 'no date', 135, 200);
        expect(change(base, saturday), 'a Saturday adds 30.00 and no minutes').toEqual({ cents: 3000, minutes: 0 });
        expect(change(base, sunday), 'a Sunday adds 30.00 and no minutes').toEqual({ cents: 3000, minutes: 0 });
        expect(change(base, friday), 'a Friday adds nothing').toEqual({ cents: 0, minutes: 0 });
        expect(codesOf(saturday), 'a Saturday has the weekend line').toEqual(['base', 'bedrooms', 'bathrooms', 'weekend']);
        expect(codesOf(sunday), 'a Sunday has the weekend line').toEqual(['base', 'bedrooms', 'bathrooms', 'weekend']);
        expect(codesOf(friday), 'a Friday has no weekend line').toEqual(['base', 'bedrooms', 'bathrooms']);
        expect(codesOf(noDate), 'no date has no weekend line').toEqual(['base', 'bedrooms', 'bathrooms']);
        expect(saturday.lines[3], 'the weekend line').toEqual({ kind: 'weekend', code: 'weekend', label: 'Weekend (placeholder figure)', quantity: 1, amount: '30.00', minutes: 0 });

        // A service with no weekend row adds nothing on a Saturday: 100.00 and 90 minutes, and no weekend line.
        const assembly = priceJob(SERVICE_3, ITEMS_3, { date: SATURDAY });
        expectPriced(assembly, 'service 3 on a Saturday', 100, 90);
        expect(codesOf(assembly), 'service 3 has no weekend line').toEqual(['base']);

        // The same adjustments hold with other answers set.
        // The weekend with the deep option, a house and 2 ovens: 80 + 40 + 15 + 60 + 25 + 70 = 290.00 and 120 + 60 + 20 + 60 + 30 + 60 = 350 minutes
        // on a Wednesday; 320.00 and 350 minutes on a Saturday.
        const loaded = { option: 'deep', property_type: 'house', extras: [{ code: 'oven', quantity: 2 }] };
        const loadedWednesday = priceJob(SERVICE_1, ITEMS_1, twoAndOne({ ...loaded }));
        const loadedSaturday = priceJob(SERVICE_1, ITEMS_1, twoAndOne({ ...loaded, date: SATURDAY }));
        expectPriced(loadedWednesday, 'the deep option, a house and 2 ovens on a Wednesday', 290, 350);
        expectPriced(loadedSaturday, 'the deep option, a house and 2 ovens on a Saturday', 320, 350);
        expect(change(loadedWednesday, loadedSaturday), 'the weekend adds 30.00 and no minutes with the other answers set').toEqual({ cents: 3000, minutes: 0 });
        // The deep option with a house on a Saturday: 80 + 40 + 15 + 25 + 30 = 190.00 and 230 minutes with the standard option; 250.00 and 290 with deep.
        const standardHouse = priceJob(SERVICE_1, ITEMS_1, twoAndOne({ option: 'standard', property_type: 'house', date: SATURDAY }));
        const deepHouse = priceJob(SERVICE_1, ITEMS_1, twoAndOne({ option: 'deep', property_type: 'house', date: SATURDAY }));
        expectPriced(standardHouse, 'the standard option, a house and a Saturday', 190, 230);
        expectPriced(deepHouse, 'the deep option, a house and a Saturday', 250, 290);
        expect(change(standardHouse, deepHouse), 'the deep option adds 60.00 and 60 minutes with the other answers set').toEqual({ cents: 6000, minutes: 60 });
        // A house with the deep option: 195.00 and 260 minutes with an apartment; 220.00 and 290 with a house.
        const deepApartment = priceJob(SERVICE_1, ITEMS_1, twoAndOne({ option: 'deep', property_type: 'apartment' }));
        const deepHouseWeekday = priceJob(SERVICE_1, ITEMS_1, twoAndOne({ option: 'deep', property_type: 'house' }));
        expectPriced(deepApartment, 'the deep option in an apartment', 195, 260);
        expectPriced(deepHouseWeekday, 'the deep option in a house', 220, 290);
        expect(change(deepApartment, deepHouseWeekday), 'a house adds 25.00 and 30 minutes with the other answers set').toEqual({ cents: 2500, minutes: 30 });
    });

    // Mutant that turns this case red: the hourly line is rounded as a floating-point product (1.5 hours at 33.33 gives 49.99, not 50.00).
    test('an option sets the price and the quoted minutes, and by the hour prices the hours asked for', async () => {
        const { priceJob } = await import('../src/lib/pricing-rules.js');

        // A tier option adds its amount and its minutes to the job: standard 135.00 and 200 minutes, deep 135 + 60 = 195.00 and 200 + 60 = 260.
        const standard = priceJob(SERVICE_1, ITEMS_1, twoAndOne({ option: 'standard' }));
        const deep = priceJob(SERVICE_1, ITEMS_1, twoAndOne({ option: 'deep' }));
        expectPriced(standard, 'two bedrooms and one bathroom with the standard option', 135, 200);
        expectPriced(deep, 'two bedrooms and one bathroom with the deep option', 195, 260);
        expect(deep.lines[3], 'the deep option line').toEqual({ kind: 'option', code: 'deep', label: 'Deep clean (placeholder figure)', quantity: 1, amount: '60.00', minutes: 60 });

        // By the hour, the hours times the amount an hour take the place of the base and the unit lines. 3 hours at 45.00 are 135.00 and 180
        // minutes; the two bedrooms named in the answers are checked, not priced, and have no line.
        const three = priceJob(SERVICE_1, ITEMS_1, { units: { bedrooms: 2 }, option: 'hourly', hours: 3 });
        expectPriced(three, '3 hours at 45.00 an hour, with 2 bedrooms named', 135, 180);
        expect(three.lines, '3 hours: the one line, with no base line and no unit line').toEqual([
            { kind: 'option', code: 'hourly', label: 'By the hour (placeholder figure)', quantity: 3, amount: '135.00', minutes: 180 },
        ]);

        // Hours with a fraction, each at 45.00 an hour.
        const hours = [
            // 2.5 hours: 112.50 and 2.5 x 60 = 150 minutes
            { hours: 2.5, price: 112.5, amount: '112.50', minutes: 150 },
            // 4.35 hours: 195.75 and 261 minutes (4.35 has two decimals, though 4.35 times 100 is not a whole number in floating point)
            { hours: 4.35, price: 195.75, amount: '195.75', minutes: 261 },
            // 1.33 hours: 59.85 and 79.8 minutes, which rounds to 80
            { hours: 1.33, price: 59.85, amount: '59.85', minutes: 80 },
        ];
        for (const row of hours) {
            const job = priceJob(SERVICE_1, ITEMS_1, { option: 'hourly', hours: row.hours });
            expectPriced(job, `${row.hours} hours at 45.00 an hour`, row.price, row.minutes);
            expect(job.lines, `${row.hours} hours: the one line`).toEqual([
                { kind: 'option', code: 'hourly', label: 'By the hour (placeholder figure)', quantity: row.hours, amount: row.amount, minutes: row.minutes },
            ]);
        }

        // By the hour, the property type, the weekend and the extras still add: 3 hours 135 + house 25 + Saturday 30 + 1 oven 35 = 225.00 and
        // 180 + 30 + 0 + 30 = 240 minutes.
        const added = priceJob(SERVICE_1, ITEMS_1, { option: 'hourly', hours: 3, property_type: 'house', date: SATURDAY, extras: [{ code: 'oven', quantity: 1 }] });
        expectPriced(added, '3 hours with a house, on a Saturday, with 1 oven', 225, 240);
        expect(codesOf(added), '3 hours with the other answers: the hourly line, then the others').toEqual(['hourly', 'house', 'weekend', 'oven']);

        // An hourly row at 33.33, where the cent and a floating-point product differ. 1.5 hours: 150 x 3,333 = 499,950 hundredths of a cent, which
        // is 4,999.5 cents and rounds half up to 5,000 cents = 50.00 (a floating-point product gives 49.99); 1.5 x 60 = 90 minutes.
        // 1.25 hours: 125 x 3,333 = 416,625 hundredths of a cent = 4,166.25 cents, which rounds to 4,166 cents = 41.66; 75 minutes.
        const thirtyThreeThirtyThree = [{ kind: 'option', code: 'hourly', label: 'By the hour (placeholder figure)', amount: '33.33', minutes: 0, is_hourly: 1 }];
        const oneAndAHalf = priceJob(SERVICE_1, thirtyThreeThirtyThree, { option: 'hourly', hours: 1.5 });
        expectPriced(oneAndAHalf, '1.5 hours at 33.33 an hour', 50, 90);
        expect(oneAndAHalf.lines, '1.5 hours at 33.33 an hour: the one line').toEqual([
            { kind: 'option', code: 'hourly', label: 'By the hour (placeholder figure)', quantity: 1.5, amount: '50.00', minutes: 90 },
        ]);
        const oneAndAQuarter = priceJob(SERVICE_1, thirtyThreeThirtyThree, { option: 'hourly', hours: 1.25 });
        expectPriced(oneAndAQuarter, '1.25 hours at 33.33 an hour', 41.66, 75);
        expect(oneAndAQuarter.lines, '1.25 hours at 33.33 an hour: the one line').toEqual([
            { kind: 'option', code: 'hourly', label: 'By the hour (placeholder figure)', quantity: 1.25, amount: '41.66', minutes: 75 },
        ]);
    });

    // Mutant that turns this case red: the quantity of an extra is limited (1,000,000 ovens must be priced).
    test('an extra adds its amount times any whole quantity', async () => {
        const { priceJob } = await import('../src/lib/pricing-rules.js');
        const base = priceJob(SERVICE_1, ITEMS_1, twoAndOne());
        expectPriced(base, 'two bedrooms and one bathroom', 135, 200);

        // 1 oven adds 35.00 and 30 minutes (170.00 and 230); 2 ovens add 70.00 and 60 minutes (205.00 and 260); 1 fridge adds 30.00 and 20 (165.00 and 220).
        const oneOven = priceJob(SERVICE_1, ITEMS_1, twoAndOne({ extras: [{ code: 'oven', quantity: 1 }] }));
        const twoOvens = priceJob(SERVICE_1, ITEMS_1, twoAndOne({ extras: [{ code: 'oven', quantity: 2 }] }));
        const oneFridge = priceJob(SERVICE_1, ITEMS_1, twoAndOne({ extras: [{ code: 'fridge', quantity: 1 }] }));
        expectPriced(oneOven, 'one oven', 170, 230);
        expectPriced(twoOvens, 'two ovens', 205, 260);
        expectPriced(oneFridge, 'one fridge', 165, 220);
        expect(change(base, oneOven), 'one oven adds 35.00 and 30 minutes').toEqual({ cents: 3500, minutes: 30 });
        expect(change(base, twoOvens), 'two ovens add 70.00 and 60 minutes').toEqual({ cents: 7000, minutes: 60 });
        expect(change(base, oneFridge), 'one fridge adds 30.00 and 20 minutes').toEqual({ cents: 3000, minutes: 20 });

        // Two ovens and a fridge: 135 + 70 + 30 = 235.00 and 200 + 60 + 20 = 280 minutes; the lines follow the order of the rule's rows, whatever
        // order the answers list the extras in.
        const both = priceJob(SERVICE_1, ITEMS_1, twoAndOne({ extras: [{ code: 'fridge', quantity: 1 }, { code: 'oven', quantity: 2 }] }));
        expectPriced(both, 'two ovens and a fridge, the fridge listed first', 235, 280);
        expect(codesOf(both), 'two ovens and a fridge: the lines follow the order of the rule rows').toEqual(['base', 'bedrooms', 'bathrooms', 'oven', 'fridge']);

        // An extra of quantity 0 adds nothing and has no line.
        const noOven = priceJob(SERVICE_1, ITEMS_1, twoAndOne({ extras: [{ code: 'oven', quantity: 0 }] }));
        expectPriced(noOven, 'an oven of quantity 0', 135, 200);
        expect(codesOf(noOven), 'an extra of quantity 0 has no line').toEqual(['base', 'bedrooms', 'bathrooms']);

        // Service 2 prices the extra from its own row: 3 ovens are 140 + 105 = 245.00 and 180 + 90 = 270 minutes.
        expectPriced(priceJob(SERVICE_2, ITEMS_2, { extras: [{ code: 'oven', quantity: 3 }] }), 'service 2, three ovens', 245, 270);

        // 1,000,000 ovens: 80 + 35,000,000 = 35,000,080.00 and 120 + 30,000,000 = 30,000,120 minutes.
        const million = priceJob(SERVICE_1, ITEMS_1, { extras: [{ code: 'oven', quantity: 1_000_000 }] });
        expectPriced(million, 'one million ovens', 35_000_080, 30_000_120);
        expect(million.lines[1], 'the line of one million ovens').toEqual({ kind: 'extra', code: 'oven', label: 'Oven (placeholder figure)', quantity: 1_000_000, amount: '35000000.00', minutes: 30_000_000 });

        // The largest quantity of ovens that a booking can record: 2,857,140 ovens are 80 + 99,999,900 = 99,999,980.00 and 120 + 85,714,200 =
        // 85,714,320 minutes. 2,857,141 ovens are 100,000,015.00, above the 99,999,999.99 that a booking records, and 3,000,000 ovens are
        // 80 + 105,000,000 = 105,000,080.00. The largest whole number a quantity can hold is refused as too large, not read wrongly.
        const largest = priceJob(SERVICE_1, ITEMS_1, { extras: [{ code: 'oven', quantity: 2_857_140 }] });
        expectPriced(largest, '2,857,140 ovens', 99_999_980, 85_714_320);
        for (const [what, quantity] of [
            ['2,857,141 ovens, the first quantity past the limit', 2_857_141],
            ['three million ovens', 3_000_000],
            ['the largest whole number a quantity can hold', Number.MAX_SAFE_INTEGER],
        ]) {
            expectRefused(priceJob(SERVICE_1, ITEMS_1, { extras: [{ code: 'oven', quantity }] }), what, 'too_large', 'answers');
        }

        // The quoted minutes are limited to 2,147,483,647. An extra of 0.00 and 1,000 minutes leaves the price at the base of 80.00:
        // 2,147,483 of them are 120 + 2,147,483,000 = 2,147,483,120 minutes, under the limit; 2,147,484 are 2,147,484,120, above it.
        const sweep = [{ kind: 'extra', code: 'sweep', label: 'Sweep (placeholder figure)', amount: '0.00', minutes: 1000, is_hourly: 0 }];
        expectPriced(priceJob(SERVICE_1, sweep, { extras: [{ code: 'sweep', quantity: 2_147_483 }] }), '2,147,483 sweeps', 80, 2_147_483_120);
        expectRefused(priceJob(SERVICE_1, sweep, { extras: [{ code: 'sweep', quantity: 2_147_484 }] }), '2,147,484 sweeps, the first quantity past the minutes limit', 'too_large', 'answers');
    });

    // Mutant that turns this case red: the check that a code is one of the service's own rows is dropped (an extra of another service gets priced).
    test('answers the rule cannot price are refused and the refusal names the answer', async () => {
        const { priceJob } = await import('../src/lib/pricing-rules.js');

        // [what, service, answers, the answer the refusal names]; every row is refused with the reason 'answers'.
        const refusals = [
            // a code that is not one of the service's rows of that kind
            ['an extra of another service (a fridge on service 2)', SERVICE_2, { extras: [{ code: 'fridge', quantity: 1 }] }, 'extras'],
            ['a unit on a service with no units (bedrooms on service 3)', SERVICE_3, { units: { bedrooms: 1 } }, 'units'],
            ['a unit code the service does not have', SERVICE_1, { units: { garage: 1 } }, 'units'],
            ['an extra code the service does not have', SERVICE_1, { extras: [{ code: 'garage', quantity: 1 }] }, 'extras'],
            ['an option code the service does not have', SERVICE_1, { option: 'platinum' }, 'option'],
            ['a property type code the service does not have', SERVICE_1, { property_type: 'castle' }, 'property_type'],
            ['an option code written as SQL text', SERVICE_1, { option: "deep' OR '1'='1" }, 'option'],
            ['an option code that names a built-in property of objects', SERVICE_1, { option: 'constructor' }, 'option'],
            ['a property type code that names a built-in property of objects', SERVICE_1, { property_type: 'toString' }, 'property_type'],
            ['a unit code that names a built-in property of objects', SERVICE_1, { units: { constructor: 1 } }, 'units'],
            // the hours
            ['hours with a tier option', SERVICE_1, { option: 'deep', hours: 3 }, 'hours'],
            ['hours with no option', SERVICE_1, { hours: 3 }, 'hours'],
            ['an hourly option with no hours', SERVICE_1, { option: 'hourly' }, 'hours'],
            ['hours of 0', SERVICE_1, { option: 'hourly', hours: 0 }, 'hours'],
            ['hours below 0', SERVICE_1, { option: 'hourly', hours: -2 }, 'hours'],
            ['hours with three decimals', SERVICE_1, { option: 'hourly', hours: 1.234 }, 'hours'],
            ['hours given as a string', SERVICE_1, { option: 'hourly', hours: '3' }, 'hours'],
            // units named with an hourly option are checked, though they are not priced
            ['a unit code the service does not have, with an hourly option', SERVICE_1, { units: { garage: 1 }, option: 'hourly', hours: 3 }, 'units'],
            ['a unit quantity below 0, with an hourly option', SERVICE_1, { units: { bedrooms: -1 }, option: 'hourly', hours: 3 }, 'units'],
            // the quantities of units
            ['a unit quantity below 0', SERVICE_1, { units: { bedrooms: -1 } }, 'units'],
            ['a fractional unit quantity', SERVICE_1, { units: { bedrooms: 1.5 } }, 'units'],
            ['a unit quantity given as a string', SERVICE_1, { units: { bedrooms: '2' } }, 'units'],
            ['a unit quantity that is not a safe integer', SERVICE_1, { units: { bedrooms: Number.MAX_SAFE_INTEGER + 1 } }, 'units'],
            ['units given as a list', SERVICE_1, { units: [2] }, 'units'],
            // the quantities and the list of extras
            ['an extra quantity below 0', SERVICE_1, { extras: [{ code: 'oven', quantity: -1 }] }, 'extras'],
            ['a fractional extra quantity', SERVICE_1, { extras: [{ code: 'oven', quantity: 1.5 }] }, 'extras'],
            ['an extra quantity given as a string', SERVICE_1, { extras: [{ code: 'oven', quantity: '2' }] }, 'extras'],
            ['an extra quantity that is not a safe integer', SERVICE_1, { extras: [{ code: 'oven', quantity: Number.MAX_SAFE_INTEGER + 1 }] }, 'extras'],
            ['the same extra listed twice', SERVICE_1, { extras: [{ code: 'oven', quantity: 1 }, { code: 'oven', quantity: 2 }] }, 'extras'],
            ['extras given as one object, not a list', SERVICE_1, { extras: { code: 'oven', quantity: 1 } }, 'extras'],
            // the date
            ['a date that is not a real day (30 February)', SERVICE_1, { date: '2026-02-30' }, 'date'],
            ['a date that is not a real day (29 February in a year with 28 days in February)', SERVICE_1, { date: '2026-02-29' }, 'date'],
            ['a date written day first with slashes', SERVICE_1, { date: '10/10/2026' }, 'date'],
            ['a date given as a number', SERVICE_1, { date: 20261010 }, 'date'],
            // the answers themselves
            ['answers given as a list holding an object', SERVICE_1, [{ units: { bedrooms: 2 } }], 'answers'],
            ['answers given as an empty list', SERVICE_1, [], 'answers'],
            ['answers given as a string', SERVICE_1, 'bedrooms', 'answers'],
            ['answers given as a number', SERVICE_1, 5, 'answers'],
            ['answers given as true', SERVICE_1, true, 'answers'],
        ];
        for (const [what, service, answers, field] of refusals) {
            expectRefused(priceJob(service, itemsOf(service), answers), what, 'answers', field);
        }

        // A service the catalog does not offer is refused with the reason 'service' and no answer named, whatever the answers are: the service is
        // checked first.
        const unavailable = [
            ['a service that is not active', { ...SERVICE_1, is_active: 0 }, twoAndOne()],
            ['a service with a base price of 0', { ...SERVICE_1, base_price: '0.00' }, twoAndOne()],
            ['no service row', undefined, twoAndOne()],
            ['a service that is not active, with answers that cannot be priced either', { ...SERVICE_1, is_active: 0 }, []],
        ];
        for (const [what, service, answers] of unavailable) {
            expectRefused(priceJob(service, itemsOf(service), answers), what, 'service', undefined);
        }

        // An hourly amount of 0 makes a total of 0, which is refused as a base price of 0 is.
        const free = [{ kind: 'option', code: 'hourly', label: 'By the hour (placeholder figure)', amount: '0.00', minutes: 0, is_hourly: 1 }];
        expect(priceJob(SERVICE_1, free, { option: 'hourly', hours: 2 }).ok, 'an hourly amount of 0 gives a total of 0, which is refused').toBe(false);
    });

    // Mutant that turns this case red: the route answers the service's base price whatever the answers are.
    test('the price route answers the price, the quoted minutes and the lines for the answers given', async ({ request }) => {
        const ask = (data) => request.post('/api/pricing', { data, maxRetries: RESET_RETRIES, timeout: 60_000 });

        // Two bedrooms and one bathroom on a Wednesday: 135.00 and 200 minutes, a base line and two unit lines, and the ten choices of service 1
        // (the rows of its rule, in the order a screen shows them).
        const small = await ask({ service_id: 1, answers: twoAndOne() });
        expect(small.status(), 'the price route answers service 1 with two bedrooms and one bathroom').toBe(200);
        const smallAnswer = await small.json();
        expect(smallAnswer.success, 'the answer says it succeeded').toBe(true);
        expect(smallAnswer.service_id, 'the answer names the service').toBe(1);
        expect(smallAnswer.price, 'the price of two bedrooms and one bathroom').toBe(135);
        expect(smallAnswer.quoted_minutes, 'the quoted minutes of two bedrooms and one bathroom').toBe(200);
        expect(smallAnswer.lines.map((line) => line.code), 'the lines: a base line and two unit lines').toEqual(['base', 'bedrooms', 'bathrooms']);
        expect(smallAnswer.lines[1], 'the bedrooms line').toEqual({ kind: 'unit', code: 'bedrooms', label: 'Bedrooms (placeholder figure)', quantity: 2, amount: '40.00', minutes: 60 });
        expect(smallAnswer.choices, 'the ten choices of service 1').toEqual(ITEMS_1);

        // Every kind of answer, on a Saturday: 350.00 and 370 minutes.
        const everything = await ask({ service_id: 1, answers: twoAndOne({ option: 'deep', property_type: 'house', date: SATURDAY, extras: [{ code: 'oven', quantity: 2 }, { code: 'fridge', quantity: 1 }] }) });
        expect(everything.status(), 'the price route answers every kind of answer').toBe(200);
        const everythingAnswer = await everything.json();
        expect(everythingAnswer.price, 'the price with every kind of answer').toBe(350);
        expect(everythingAnswer.quoted_minutes, 'the quoted minutes with every kind of answer').toBe(370);
        expect(everythingAnswer.lines.map((line) => line.code), 'the lines with every kind of answer').toEqual(['base', 'bedrooms', 'bathrooms', 'deep', 'house', 'weekend', 'oven', 'fridge']);

        // By the hour: 3 hours at 45.00 are 135.00 and 180 minutes, in one line.
        const hourly = await ask({ service_id: 1, answers: { option: 'hourly', hours: 3 } });
        expect(hourly.status(), 'the price route answers an hourly option').toBe(200);
        const hourlyAnswer = await hourly.json();
        expect(hourlyAnswer.price, 'the price of 3 hours').toBe(135);
        expect(hourlyAnswer.quoted_minutes, 'the quoted minutes of 3 hours').toBe(180);
        expect(hourlyAnswer.lines.map((line) => line.code), 'the one line of 3 hours').toEqual(['hourly']);

        // No answers: the catalog price and duration. Service 3 is 100.00 and 90 minutes with a base line and no choices; service 1 is 80.00 and 120.
        const assembly = await ask({ service_id: 3 });
        expect(assembly.status(), 'the price route answers service 3 with no answers').toBe(200);
        const assemblyAnswer = await assembly.json();
        expect(assemblyAnswer.price, 'the price of service 3 with no answers').toBe(100);
        expect(assemblyAnswer.quoted_minutes, 'the quoted minutes of service 3 with no answers').toBe(90);
        expect(assemblyAnswer.lines.map((line) => line.code), 'the base line of service 3').toEqual(['base']);
        expect(assemblyAnswer.choices, 'service 3 has no choices').toEqual([]);
        const standard = await (await ask({ service_id: 1, answers: {} })).json();
        expect(standard.price, 'the price of service 1 with empty answers').toBe(80);
        expect(standard.quoted_minutes, 'the quoted minutes of service 1 with empty answers').toBe(120);

        // A service the catalog does not offer, and answers the rule cannot price, are 400 with the answer named.
        const unknown = await ask({ service_id: 2147483647, answers: twoAndOne() });
        expect(unknown.status(), 'a service with no row is refused').toBe(400);
        expect(await unknown.json(), 'a service with no row').toEqual({ success: false, message: 'This service is not available for booking' });
        const notOffered = await ask({ answers: twoAndOne() });
        expect(notOffered.status(), 'a request that names no service is refused').toBe(400);
        const fridge = await ask({ service_id: 2, answers: { extras: [{ code: 'fridge', quantity: 1 }] } });
        expect(fridge.status(), 'an extra of another service is refused').toBe(400);
        expect(await fridge.json(), 'an extra of another service').toEqual({ success: false, message: 'These answers cannot be priced for this service', field: 'extras' });
        const tooMany = await ask({ service_id: 1, answers: { extras: [{ code: 'oven', quantity: 3_000_000 }] } });
        expect(tooMany.status(), 'a price above what a booking records is refused').toBe(400);
        expect(await tooMany.json(), 'a price above what a booking records').toEqual({ success: false, message: 'The price for these answers is larger than a booking can record', field: 'answers' });
        // A body that is not JSON, sent as text so that the request library delivers it as written (it would make a JSON string of it under a JSON content type).
        const notJson = await request.post('/api/pricing', { headers: { 'Content-Type': 'text/plain' }, data: '{"service_id": ', maxRetries: RESET_RETRIES, timeout: 60_000 });
        expect(notJson.status(), 'a body that is not JSON is refused').toBe(400);
        expect(await notJson.json(), 'a body that is not JSON').toEqual({ success: false, message: 'Invalid request body' });
    });

    // Mutant that turns this case red: the insert writes the catalog duration.
    test('a booking records the price and the quoted minutes its answers produce', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);

        // Two bedrooms and one bathroom on a Wednesday: 135.00 and 200 minutes. The amount held on the card is the price and two hours at the
        // service's hourly rate of 40.00: 215.00. The answer says what was recorded, the row holds it, and the breakdown holds the three lines.
        await withBooking(request, as, { job_date: WEDNESDAY, answers: twoAndOne() }, async (id, answer) => {
            expect(answer.service_price, 'the answer: the price recorded').toBe(135);
            expect(answer.standard_duration, 'the answer: the standard duration').toBe(200);
            expect(answer.quoted_minutes, 'the answer: the quoted minutes').toBe(200);
            expect(answer.authorized_amount, 'the answer: the amount held on the card').toBe(215);
            const stored = await storedBooking(id);
            expect(Number(stored.service_price), 'the stored price').toBe(135);
            expect(Number(stored.standard_duration_minutes), 'the stored quoted minutes').toBe(200);
            expect(Number(stored.authorized_amount), 'the stored amount held on the card').toBe(215);
            expect(linesOf(stored), 'the stored breakdown: a base line and two unit lines').toEqual([
                { kind: 'base', code: 'base', quantity: 1, amount: '80.00', minutes: 120 },
                { kind: 'unit', code: 'bedrooms', quantity: 2, amount: '40.00', minutes: 60 },
                { kind: 'unit', code: 'bathrooms', quantity: 1, amount: '15.00', minutes: 20 },
            ]);
        });

        // Several dates: the booking's first date prices it. The date inside the answers (the Wednesday) is not read here, so the Saturday adds
        // its 30.00: 165.00 and the same 200 minutes, 245.00 on the card, and a weekend line.
        await withBooking(request, as, { job_date: `${SATURDAY},${WEDNESDAY}`, answers: twoAndOne({ date: WEDNESDAY }) }, async (id, answer) => {
            expect(answer.service_price, 'several dates, the first a Saturday: the price recorded').toBe(165);
            expect(answer.quoted_minutes, 'several dates, the first a Saturday: the quoted minutes').toBe(200);
            expect(answer.authorized_amount, 'several dates, the first a Saturday: the amount held on the card').toBe(245);
            const stored = await storedBooking(id);
            expect(Number(stored.service_price), 'several dates, the first a Saturday: the stored price').toBe(165);
            expect(linesOf(stored).map((line) => line.code), 'several dates, the first a Saturday: the stored lines').toEqual(['base', 'bedrooms', 'bathrooms', 'weekend']);
        });

        // A first date that is not a real day is refused with the booking's own name for it (job_date) when there are answers; with no answers the
        // date is not read and the booking is the catalog's: 80.00 and 120 minutes.
        const unreal = await postCheckout(request, checkoutBody({ job_date: '2026-02-30', answers: twoAndOne() }));
        expect(unreal.status(), 'answers and a first date that is not a day are refused').toBe(400);
        expect(await unreal.json(), 'answers and a first date that is not a day').toEqual({ success: false, message: 'These answers cannot be priced for this service', field: 'job_date' });
        await withBooking(request, as, { job_date: '2026-02-30' }, async (id, answer) => {
            expect(answer.service_price, 'no answers: the date is not read, the price recorded').toBe(80);
            expect(answer.quoted_minutes, 'no answers: the date is not read, the quoted minutes').toBe(120);
        });

        // The amount held on the card is a decimal(10,2) too. 2,857,139 ovens at 35.00 with the base are 99,999,945.00, which the rule prices;
        // with the two hours at 40.00 on top the card would hold 100,000,025.00, so the booking is refused before anything is written.
        const oversize = checkoutBody({ answers: { extras: [{ code: 'oven', quantity: 2_857_139 }] } });
        try {
            const refused = await postCheckout(request, oversize);
            expect(refused.status(), 'a price whose card amount is larger than a booking can record is refused').toBe(400);
            expect(await refused.json(), 'a price whose card amount is larger than a booking can record').toEqual({ success: false, message: 'The price for these answers is larger than a booking can record', field: 'answers' });
            expect(await rows('SELECT id FROM bookings WHERE customer_email = ?', [oversize.email]), 'the refused booking wrote nothing').toEqual([]);
        } finally {
            for (const { id } of await rows('SELECT id FROM bookings WHERE customer_email = ?', [oversize.email])) await deleteBooking(request, as, id);
        }
    });

    // Mutant that turns this case red: create-intent takes its amount from the body when the body holds one.
    test("a figure in the request is not read: the price route, create-intent and a booking use the rule's price", async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        // Figures at the top of the request and inside the answers, which are two bedrooms and one bathroom on a Wednesday (135.00, 200 minutes).
        const figures = { service_price: 0.01, price: 1, total: 1, amount: 1, quoted_minutes: 1 };
        const answers = twoAndOne({ price: 1 });

        const priced = await request.post('/api/pricing', { data: { service_id: 1, answers, ...figures }, maxRetries: RESET_RETRIES, timeout: 60_000 });
        expect(priced.status(), 'the price route answers a request that holds figures').toBe(200);
        const pricedAnswer = await priced.json();
        expect(pricedAnswer.price, "the price route answers the rule's price").toBe(135);
        expect(pricedAnswer.quoted_minutes, "the price route answers the rule's quoted minutes").toBe(200);

        await withBooking(request, as, { answers, ...figures }, async (id, answer) => {
            expect(answer.service_price, "the booking answers the rule's price").toBe(135);
            expect(answer.quoted_minutes, "the booking answers the rule's quoted minutes").toBe(200);
            const stored = await storedBooking(id);
            expect(Number(stored.service_price), "the booking stores the rule's price").toBe(135);
            expect(Number(stored.standard_duration_minutes), "the booking stores the rule's quoted minutes").toBe(200);
        });

        // create-intent prices before it reaches Stripe, for which the dev stack has no key: bedrooms are not a unit of service 3, and a price of 1
        // in the request does not change that. The refusal names the answer.
        const intent = await request.post('/api/payment/create-intent', { headers: as.customer, data: { service_id: 3, service_price: 1, answers: { units: { bedrooms: 1 } } }, maxRetries: RESET_RETRIES, timeout: 60_000 });
        expect(intent.status(), 'create-intent refuses answers the service cannot price').toBe(400);
        expect(await intent.json(), 'create-intent refuses answers the service cannot price').toEqual({ success: false, message: 'These answers cannot be priced for this service', field: 'units' });

        // Source read: create-intent runs the rest of its amount after a Stripe call, so its line is read. The amount is the price priceJob gives,
        // and the file holds no figure of the request.
        const source = fs.readFileSync(path.join(ROOT, 'src/app/api/payment/create-intent/route.js'), 'utf8');
        expect(source.includes('priceJob('), 'create-intent prices with priceJob').toBe(true);
        expect(source.includes('const basePrice = job.price'), "create-intent's amount is the rule's price").toBe(true);
        for (const text of ['service_price', 'body.price', 'body.total', 'body.amount', 'body.quoted_minutes']) {
            expect(source.includes(text), `create-intent does not hold ${JSON.stringify(text)}`).toBe(false);
        }
    });

    // Mutant that turns this case red: a unit with no answer is counted as 1.
    test('every active service prices with no answers at its catalog price and minutes', async () => {
        const { priceJob } = await import('../src/lib/pricing-rules.js');
        const services = await rows('SELECT id, name, base_price, additional_price, duration_minutes, is_active FROM services WHERE is_active = 1 ORDER BY id');
        const serviceIds = (await rows('SELECT id FROM services')).map((row) => Number(row.id));
        const items = await rows('SELECT service_id, kind, code, label, amount, minutes, is_hourly, is_placeholder FROM service_pricing_items ORDER BY service_id, kind, sort_order, id');
        const itemsOfService = (serviceId) => items.filter((item) => Number(item.service_id) === serviceId);

        // Every pricing item row belongs to a service, and its amount and minutes are not below 0. The rows of the fixture services (1 to 3) are
        // placeholders and say so in their labels.
        for (const item of items) {
            const name = `the ${item.kind} row ${item.code} of service ${item.service_id}`;
            expect(serviceIds, `${name} belongs to a service`).toContain(Number(item.service_id));
            expect(Number(item.amount), `${name}: the amount is not below 0`).toBeGreaterThanOrEqual(0);
            expect(Number(item.minutes), `${name}: the minutes are not below 0`).toBeGreaterThanOrEqual(0);
            if (Number(item.service_id) >= 1 && Number(item.service_id) <= 3) {
                expect(Number(item.is_placeholder), `${name} is marked as a placeholder`).toBe(1);
                expect(String(item.label).endsWith('(placeholder figure)'), `${name}: its label "${item.label}" ends (placeholder figure)`).toBe(true);
            }
        }

        // Every active service that the catalog offers (a base price above 0) prices with no answers at its base price and its duration, or 60
        // minutes when it has none.
        const checked = [];
        for (const service of services) {
            if (!(Number(service.base_price) > 0)) continue;
            const name = `service ${service.id} (${service.name})`;
            const job = priceJob(service, itemsOfService(Number(service.id)), {});
            expect(job.ok, `${name} prices with no answers`).toBe(true);
            expect(job.price, `${name}: the price with no answers is its base price`).toBe(Number(service.base_price));
            const minutes = service.duration_minutes === null || Number(service.duration_minutes) === 0 ? 60 : Number(service.duration_minutes);
            expect(job.minutes, `${name}: the quoted minutes with no answers are its duration`).toBe(minutes);
            checked.push(Number(service.id));
        }
        expect(checked.length, `at least three services were priced (services ${checked.join(', ')})`).toBeGreaterThanOrEqual(3);
        expect(itemsOfService(1).length, 'fixture service 1 has ten pricing item rows').toBe(10);
        expect(itemsOfService(2).length, 'fixture service 2 has two pricing item rows').toBe(2);
        expect(itemsOfService(3).length, 'fixture service 3 has no pricing item rows').toBe(0);
    });

    // Mutant that turns this case red: the booking route records the price in the body when the caller is a signed-in admin.
    test('a booking an admin makes is priced by the rule from its answers', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        // Twelve bedrooms, six bathrooms, deep, a house and three ovens on a Wednesday, booked with the admin's credential and a price of 1 in the
        // body: 80 + 12 x 20 + 6 x 15 + 60 + 25 + 3 x 35 = 600.00, and 120 + 12 x 30 + 6 x 20 + 60 + 30 + 3 x 30 = 780 minutes. The amount held
        // on the card is 600.00 and two hours at 40.00: 680.00.
        const answers = { units: { bedrooms: 12, bathrooms: 6 }, option: 'deep', property_type: 'house', extras: [{ code: 'oven', quantity: 3 }] };
        await withBooking(request, as, { job_date: WEDNESDAY, answers, service_price: 1 }, async (id, answer) => {
            expect(answer.service_price, "the answer: the rule's price").toBe(600);
            expect(answer.quoted_minutes, "the answer: the rule's quoted minutes").toBe(780);
            expect(answer.authorized_amount, 'the answer: the amount held on the card').toBe(680);
            const stored = await storedBooking(id);
            expect(Number(stored.service_price), "the stored price is the rule's").toBe(600);
            expect(Number(stored.standard_duration_minutes), "the stored quoted minutes are the rule's").toBe(780);
        }, as.admin);

        // Source read: the booking route is the only route under src/app/api that inserts a booking, it records the price priceJob gives, and its
        // list of fields read from the body names no price, amount or minutes.
        const inserting = sourcesUnder(path.join(ROOT, 'src/app/api')).filter((file) => /INSERT\s+INTO\s+`?bookings`?\b/i.test(fs.readFileSync(path.join(ROOT, file), 'utf8')));
        expect(inserting, 'the routes that insert a booking').toEqual(['src/app/api/bookings/route.js']);
        const route = fs.readFileSync(path.join(ROOT, 'src/app/api/bookings/route.js'), 'utf8');
        expect(route.includes('const basePrice = job.price'), "the booking route records the rule's price").toBe(true);
        const destructured = /let\s*\{([^}]*)\}\s*=\s*body/.exec(route);
        expect(destructured, 'the booking route reads its fields from the body in one destructuring').not.toBeNull();
        const fieldsRead = ((destructured && destructured[1]) || '').match(/[A-Za-z_]\w*/g) || [];
        expect(fieldsRead, 'the booking route reads the service id from the body').toContain('service_id');
        for (const figure of ['service_price', 'additional_price', 'price', 'total', 'amount', 'quoted_minutes', 'standard_duration', 'authorized_amount']) {
            expect(fieldsRead, `the booking route does not read ${figure} from its body`).not.toContain(figure);
        }
    });
});
