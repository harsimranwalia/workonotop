// @ts-check
// Repeating visits: weekly, every 2 weeks or monthly, each visit its own job. The server cases, in three groups:
//   visit dates
//    1  weekly visits are twelve dates seven days apart and every-2-weeks visits are six dates fourteen days apart;
//    2  monthly visits keep the start's day number and take the last day of a shorter month;
//   the price of a visit
//    3  the monthly percent is a price line of its own, rounded half-up to the cent;
//    4  a frequency outside the list is refused, naming the frequency field; with no percent set there is no discount line;
//   booking repeating visits
//   11  a weekly booking saves twelve jobs a week apart, numbered from the first;
//   12  each visit of a series is its own job in the admin queue;
//   13  a monthly booking records each visit's price with the monthly discount;
//   14  repeating visits need a signed-in customer;
//   15  repeating visits take one start date and one set of times;
//   16  a frequency outside the list is refused and nothing is saved;
//   17  cancelling one visit leaves the other visits booked;
//   18  a series makes one notification for the customer and one activity entry.
// The module cases (1 to 4) call visitDates from src/lib/visit-series.js and priceJob, priceVisits and loadPricing from src/lib/pricing-rules.js
// with fixture service 1's rows written as literals in this file. Every expected date and figure is a literal worked by hand, never computed by
// the code under test. Each case loads the modules itself, so a missing module fails each case on its own. loadPricing is given a stand-in for
// the database helper's execute that answers service 1, its pricing items and the system_settings rows the case sets.
// The booking cases (11 to 18) book fixture service 1 through the public checkout (a made-up payment intent id, as e2e/pricing-rules.spec.js
// does, with an e-mail address that starts 'e2e-eng011-'), signed in as customer 1 unless a case says otherwise, and read what the booking
// stored the way that file does: a small helper checks the target before it connects (assertDevTarget: a local host and the database
// workontap_db) and the rows once connected (assertNoRealPeople). Every booking a case makes is deleted again as admin, every visit of it,
// found by its e-mail address and its series (the answer of that delete is not checked); the activity_logs rows the app's routes write about
// the bookings stay. The booking rules hold no lead time, so the visits are on fixed dates from November 2026 and no expected figure depends
// on the day the suite runs. Case 13 needs the monthly percent of the dev fixture (database/fixtures/catalog.js: 10; weekly and every 2 weeks
// are 0). A push to the customer writes no row, so case 18 reads the booking route's text for it: a source read is a guard on the text; the
// behaviour is the rows the running app stores.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { getCredentialHeaders } from './auth/credentials.js';
import { RESET_RETRIES } from './support/auth.js';
import { users } from '../database/fixtures/accounts.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';

// Tracing is off, as in e2e/price-of-record.spec.js: the cases that send requests carry a fixture account's session, and a trace records
// request headers and bodies. A failure message names the case and the figures, never a header or a token.
test.use({ trace: 'off' });

// The rows the module cases pass to the pricing rule, written out as the database gives them (DECIMAL columns arrive as strings, the minutes
// and the flags as numbers): fixture services 1 and 3 of database/fixtures/catalog.js, and service 1's placeholder pricing items.
const SERVICE_1 = { id: 1, name: 'Fixture Standard Clean', base_price: '80.00', additional_price: '40.00', duration_minutes: 120, is_active: 1 };
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

// The percents of the dev fixture, as the pricing rule takes them: hundredths of a percent (10% is 1000).
const DISCOUNTS = { weekly: 0, every_2_weeks: 0, monthly: 1000 };

// 2026-10-14 is a Wednesday: the date of the module cases' answers.
const WEDNESDAY = '2026-10-14';

// The weekly series of the booking cases starts on Wednesday 2026-11-04; its twelve visits, worked by hand, are all Wednesdays:
// [date, the day as the booking screens label it].
const WEEKLY_START = '2026-11-04';
const WEEKLY_VISITS = [
    ['2026-11-04', 'Nov 4'], ['2026-11-11', 'Nov 11'], ['2026-11-18', 'Nov 18'], ['2026-11-25', 'Nov 25'],
    ['2026-12-02', 'Dec 2'], ['2026-12-09', 'Dec 9'], ['2026-12-16', 'Dec 16'], ['2026-12-23', 'Dec 23'],
    ['2026-12-30', 'Dec 30'], ['2027-01-06', 'Jan 6'], ['2027-01-13', 'Jan 13'], ['2027-01-20', 'Jan 20'],
];
// Every 2 weeks from the same Wednesday: six visits.
const EVERY_2_WEEKS_DATES = ['2026-11-04', '2026-11-18', '2026-12-02', '2026-12-16', '2026-12-30', '2027-01-13'];
// Monthly from Thursday 2026-11-19: the 19th of the next two months, a Saturday (2026-12-19) and a Tuesday (2027-01-19).
const MONTHLY_START = '2026-11-19';
const MONTHLY_DATES = ['2026-11-19', '2026-12-19', '2027-01-19'];

// Two bedrooms and one bathroom on each monthly visit at 10% off: 135.00 less 13.50 on the weekdays; 165.00 (the weekend's 30.00 added) less
// 16.50 on the Saturday.
const MONTHLY_PRICES = [121.5, 148.5, 121.5];
const MONTHLY_CODES = [
    ['base', 'bedrooms', 'bathrooms', 'monthly'],
    ['base', 'bedrooms', 'bathrooms', 'weekend', 'monthly'],
    ['base', 'bedrooms', 'bathrooms', 'monthly'],
];
const MONTHLY_DISCOUNT_LINES = ['-13.50', '-16.50', '-13.50'].map((amount) => discountLine('monthly', 'Monthly discount (10%)', amount));

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const [CUSTOMER1] = users;
const EMAIL_PREFIX = 'e2e-eng011-';

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

// Two bedrooms and one bathroom on a Wednesday, the answers every case starts from; `more` adds answers to them or replaces some.
function twoAndOne(more = {}) {
    return { units: { bedrooms: 2, bathrooms: 1 }, date: WEDNESDAY, ...more };
}

// The discount line of a priced visit, as the rule writes it.
function discountLine(code, label, amount) {
    return { kind: 'discount', code, label, quantity: 1, amount, minutes: 0 };
}

// The codes of a priced job's lines, in order.
function codesOf(job) {
    return job.lines.map((line) => line.code);
}

// The sum of a priced job's lines, in whole cents.
function centsOfLines(job) {
    return job.lines.reduce((cents, line) => cents + Math.round(Number(line.amount) * 100), 0);
}

// A priced job holds the price and the quoted minutes given (literals worked by hand); `what` names the answers in the failure messages.
function expectPriced(job, what, price, minutes) {
    expect(job.ok, `${what}: the answers are priced`).toBe(true);
    expect(job.price, `${what}: the price`).toBe(price);
    expect(job.minutes, `${what}: the quoted minutes`).toBe(minutes);
}

// A refusal holds the reason and the answer it names.
function expectRefused(job, what, reason, field) {
    expect(job.ok, `${what}: refused`).toBe(false);
    expect(job.reason, `${what}: the reason`).toBe(reason);
    expect(job.field, `${what}: the answer it names`).toBe(field);
}

// A stand-in for the database helper's execute, as loadPricing calls it: service 1's row, its pricing items, and the system_settings rows in
// `settings` (key to value, as the table holds them). Any other statement throws.
function standIn(settings) {
    return async (sql) => {
        if (/\bsystem_settings\b/.test(sql)) return Object.entries(settings).map(([key, value]) => ({ key, value }));
        if (/\bservice_pricing_items\b/.test(sql)) return ITEMS_1;
        if (/\bservices\b/.test(sql)) return [SERVICE_1];
        throw new Error(`the stand-in database does not answer: ${sql}`);
    };
}

// The credentials of the booking cases: the admin (who deletes the bookings again and reads the job queue), customer 1 (who books and cancels)
// and provider 1 (who is not a customer).
async function headersFor(baseURL) {
    const styles = await getCredentialHeaders(String(baseURL));
    return { admin: styles['admin-bearer'], customer: styles['customer-bearer'], provider: styles['provider-bearer'] };
}

// The body of a checkout of fixture service 1 starting on the weekly series' Wednesday, with the service's catalog price and hourly rate in it
// as the apps send them; `fields` replaces or adds to the body. Each body has an e-mail address and a payment id of its own, so the visits of one
// booking are found by the address.
function checkoutBody(fields = {}) {
    const tag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    return {
        service_id: SERVICE_1.id, service_name: SERVICE_1.name, service_price: Number(SERVICE_1.base_price), additional_price: Number(SERVICE_1.additional_price),
        first_name: 'E2E', last_name: 'Series', email: `${EMAIL_PREFIX}${tag}@workontap.test`, phone: '+14035550199',
        job_date: WEEKLY_START, job_time_slot: 'Nov 4: Morning', job_description: 'E2E recurring-visits booking, deleted by the case.',
        address_line1: '1 Probe Street', city: 'Calgary', payment_intent_id: `pi_e2e_${EMAIL_PREFIX}${tag}`,
        ...fields,
    };
}

// Posts a checkout body; `headers` signs the checkout in (the checkout is public).
function postCheckout(request, data, headers = {}) {
    return request.post('/api/bookings', { headers, data, maxRetries: RESET_RETRIES, timeout: 60_000 });
}

// The visits saved with this e-mail address, in the order they were inserted, with the day of each as text.
function savedVisits(email) {
    return rows(
        "SELECT id, booking_number, user_id, status, DATE_FORMAT(job_date, '%Y-%m-%d') AS job_date, job_time_slot, series_id, series_visit, series_frequency, service_price, price_breakdown FROM bookings WHERE customer_email = ? ORDER BY id",
        [email],
    );
}

// Deletes again, as admin, every booking saved with this e-mail address and every other visit of their series (the admin's delete takes the
// photo and status history rows with each). The answer of each delete is not checked.
async function deleteBookingsOf(request, as, email) {
    const made = await rows('SELECT id, series_id FROM bookings WHERE customer_email = ?', [email]);
    const seriesIds = [...new Set(made.map((row) => row.series_id).filter((id) => id !== null))];
    const visits = seriesIds.length > 0 ? await rows('SELECT id FROM bookings WHERE series_id IN (?)', [seriesIds]) : [];
    for (const id of new Set([...made, ...visits].map((row) => row.id))) {
        await request.delete(`/api/bookings?id=${id}`, { headers: as.admin, maxRetries: RESET_RETRIES, timeout: 60_000 });
    }
}

// Books `body` as customer 1 (200 is expected), runs `run(answer, saved)` with the answer and the visits saved, and deletes every visit again,
// even when the booking or `run` fails.
async function withSeries(request, as, body, run) {
    try {
        const response = await postCheckout(request, body, as.customer);
        expect(response.status(), `customer 1 books ${body.answers.frequency} visits`).toBe(200);
        const answer = await response.json();
        expect(answer.success, 'the answer says it succeeded').toBe(true);
        await run(answer, await savedVisits(body.email));
    } finally {
        await deleteBookingsOf(request, as, body.email);
    }
}

// Posts `body` with `headers`, expects the refusal (its status, its message and, when given, the answer it names) and no booking saved with
// the body's e-mail address; anything that was saved is deleted again.
async function expectRefusedCheckout(request, as, { body, headers, what, status, message, field }) {
    try {
        const response = await postCheckout(request, body, headers);
        expect(response.status(), `${what}: the status`).toBe(status);
        const answer = await response.json();
        expect(answer.success, `${what}: the answer says it did not succeed`).toBe(false);
        expect(answer.message, `${what}: the message`).toBe(message);
        if (field !== undefined) expect(answer.field, `${what}: the answer it names`).toBe(field);
        expect(await rows('SELECT id FROM bookings WHERE customer_email = ?', [body.email]), `${what}: nothing is saved`).toEqual([]);
    } finally {
        await deleteBookingsOf(request, as, body.email);
    }
}

// The stored lines of a visit. The column is JSON, which the driver hands over parsed (a server that keeps the text of a JSON column hands it
// over as that text).
function breakdownOf(visit) {
    return typeof visit.price_breakdown === 'string' ? JSON.parse(visit.price_breakdown) : visit.price_breakdown;
}

// Every booking of the admin job queue, read 500 at a time from the oldest.
async function queueRows(request, as) {
    const held = [];
    for (let offset = 0; ; offset += 500) {
        const response = await request.get(`/api/bookings?queue=1&limit=500&offset=${offset}`, { headers: as.admin, maxRetries: RESET_RETRIES, timeout: 60_000 });
        expect(response.status(), `admin reads the job queue from ${offset}`).toBe(200);
        const page = await response.json();
        expect(page.success, `the job queue from ${offset}: success`).toBe(true);
        held.push(...page.data);
        if (page.data.length < 500) return held;
    }
}

test.describe('visit dates', () => {
    // Mutant that turns this case red: every 2 weeks steps seven days at a time.
    test('weekly visits are twelve dates seven days apart and every-2-weeks visits are six dates fourteen days apart', async () => {
        const { FREQUENCIES, MAX_VISITS, visitDates } = await import('../src/lib/visit-series.js');

        expect([FREQUENCIES.weekly.visits, FREQUENCIES.weekly.days], 'weekly: twelve visits, seven days apart').toEqual([12, 7]);
        expect([FREQUENCIES.every_2_weeks.visits, FREQUENCIES.every_2_weeks.days], 'every 2 weeks: six visits, fourteen days apart').toEqual([6, 14]);
        expect(MAX_VISITS, 'no series has more than twelve visits').toBe(12);

        // Weekly from Wednesday 2026-10-28: the dates run over the end of October, the clock change of 1 November and the end of the year.
        expect(visitDates('weekly', '2026-10-28'), 'weekly from 2026-10-28').toEqual([
            '2026-10-28', '2026-11-04', '2026-11-11', '2026-11-18', '2026-11-25', '2026-12-02',
            '2026-12-09', '2026-12-16', '2026-12-23', '2026-12-30', '2027-01-06', '2027-01-13',
        ]);
        expect(visitDates('weekly', WEEKLY_START), `weekly from ${WEEKLY_START}`).toEqual(WEEKLY_VISITS.map(([date]) => date));

        // Every 2 weeks from Tuesday 2028-02-15: the second visit is 29 February of a leap year.
        expect(visitDates('every_2_weeks', '2028-02-15'), 'every 2 weeks from 2028-02-15').toEqual(['2028-02-15', '2028-02-29', '2028-03-14', '2028-03-28', '2028-04-11', '2028-04-25']);
        expect(visitDates('every_2_weeks', WEEKLY_START), `every 2 weeks from ${WEEKLY_START}`).toEqual(EVERY_2_WEEKS_DATES);
    });

    // Mutant that turns this case red: visit 3 of a monthly series is counted from visit 2's date (2027-01-31 gives 2027-03-28).
    test("monthly visits keep the start's day number and take the last day of a shorter month", async () => {
        const { FREQUENCIES, visitDates } = await import('../src/lib/visit-series.js');

        expect(FREQUENCIES.monthly.visits, 'monthly: three visits').toBe(3);
        // [start, its three visits, what the start shows]
        const series = [
            [MONTHLY_START, MONTHLY_DATES, 'the 19th of each month, over the end of the year'],
            ['2026-11-30', ['2026-11-30', '2026-12-30', '2027-01-30'], 'the 30th of each month'],
            ['2027-01-31', ['2027-01-31', '2027-02-28', '2027-03-31'], 'the last day of February 2027 (28 days), then the 31st again'],
            ['2028-01-31', ['2028-01-31', '2028-02-29', '2028-03-31'], 'the last day of February 2028 (29 days), then the 31st again'],
            ['2028-02-29', ['2028-02-29', '2028-03-29', '2028-04-29'], 'a start on 29 February keeps the 29th'],
            ['2026-12-31', ['2026-12-31', '2027-01-31', '2027-02-28'], 'over the end of the year, then the last day of February'],
            ['2027-03-31', ['2027-03-31', '2027-04-30', '2027-05-31'], 'the last day of April (30 days), then the 31st again'],
        ];
        for (const [start, dates, what] of series) {
            expect(visitDates('monthly', start), `monthly from ${start}: ${what}`).toEqual(dates);
        }
    });
});

test.describe('the price of a visit', () => {
    // Mutant that turns this case red: the discount is cut to the cent, not rounded half-up (10.05 at 10% gives 1.00 off).
    test('the monthly percent is a price line of its own, rounded half-up to the cent', async () => {
        const { priceJob, priceVisits } = await import('../src/lib/pricing-rules.js');

        // Two bedrooms and one bathroom on a Wednesday: 135.00 and 200 minutes; 10% of it is 13.50, a line of its own after the sum: 121.50.
        const monthly = priceJob(SERVICE_1, ITEMS_1, twoAndOne({ frequency: 'monthly' }), DISCOUNTS);
        expectPriced(monthly, 'monthly at 10%', 121.5, 200);
        expect(codesOf(monthly), 'monthly at 10%: the lines').toEqual(['base', 'bedrooms', 'bathrooms', 'monthly']);
        expect(monthly.lines[3], 'monthly at 10%: the discount line').toEqual(discountLine('monthly', 'Monthly discount (10%)', '-13.50'));
        expect(centsOfLines(monthly), 'monthly at 10%: the lines add up to the price').toBe(12150);

        // Half-up to the cent, on service 3 with no items and these catalog prices (90 minutes): 10% of 10.05 is 1.005, which is 1.01 off;
        // 10% of 10.04 is 1.004, which is 1.00 off. Both are 9.04.
        for (const [basePrice, amount] of [['10.05', '-1.01'], ['10.04', '-1.00']]) {
            const job = priceJob({ ...SERVICE_3, base_price: basePrice }, [], { frequency: 'monthly' }, DISCOUNTS);
            expectPriced(job, `${basePrice} at 10%`, 9.04, 90);
            expect(job.lines[1], `${basePrice} at 10%: the discount line`).toEqual(discountLine('monthly', 'Monthly discount (10%)', amount));
            expect(centsOfLines(job), `${basePrice} at 10%: the lines add up to the price`).toBe(904);
        }

        // A percent with decimals, shown as set: 12.5% of 135.00 is 16.875, which is 16.88 off (118.12); 12.55% is 16.9425, which is 16.94
        // off (118.06).
        for (const [hundredths, label, amount, price] of [[1250, 'Monthly discount (12.5%)', '-16.88', 118.12], [1255, 'Monthly discount (12.55%)', '-16.94', 118.06]]) {
            const job = priceJob(SERVICE_1, ITEMS_1, twoAndOne({ frequency: 'monthly' }), { ...DISCOUNTS, monthly: hundredths });
            expectPriced(job, label, price, 200);
            expect(job.lines[3], `${label}: the discount line`).toEqual(discountLine('monthly', label, amount));
            expect(centsOfLines(job), `${label}: the lines add up to the price`).toBe(Math.round(price * 100));
        }

        // Each visit of a monthly series is priced at its own date with a discount line of its own: the Saturday adds the weekend's 30.00.
        const series = priceVisits(SERVICE_1, ITEMS_1, twoAndOne({ frequency: 'monthly', date: MONTHLY_START }), DISCOUNTS);
        expect(series.ok, `monthly from ${MONTHLY_START}: priced`).toBe(true);
        expect(series.visits.map(({ date, price, minutes }) => ({ date, price, minutes })), `monthly from ${MONTHLY_START}: each visit's date, price and minutes`).toEqual(
            MONTHLY_DATES.map((date, index) => ({ date, price: MONTHLY_PRICES[index], minutes: 200 })),
        );
        expect(series.visits.map(codesOf), `monthly from ${MONTHLY_START}: each visit's lines`).toEqual(MONTHLY_CODES);
        expect(series.visits.map((visit) => visit.lines.at(-1)), `monthly from ${MONTHLY_START}: each visit's discount line`).toEqual(MONTHLY_DISCOUNT_LINES);
        series.visits.forEach((visit, index) => {
            expect(centsOfLines(visit), `monthly from ${MONTHLY_START}, visit ${index + 1}: the lines add up to the price`).toBe(Math.round(MONTHLY_PRICES[index] * 100));
        });
    });

    // Mutant that turns this case red: a frequency is looked up with `in`, so a built-in property of objects ('constructor') is priced.
    test('a frequency outside the list is refused, naming the frequency field; with no percent set there is no discount line', async () => {
        const { priceJob, priceVisits, loadPricing } = await import('../src/lib/pricing-rules.js');

        // [what, frequency]; each is refused with the reason 'answers', naming frequency, for one visit and for a series.
        const outside = [
            ['a frequency the list does not hold', 'daily'],
            ['a frequency written with a capital', 'Monthly'],
            ['a frequency written with hyphens', 'every-2-weeks'],
            ['a frequency that names a built-in property of objects', 'constructor'],
            ['another frequency that names a built-in property of objects', 'toString'],
            ['a frequency given as a number', 7],
            ['a frequency given as a list', ['monthly']],
        ];
        for (const [what, frequency] of outside) {
            expectRefused(priceJob(SERVICE_1, ITEMS_1, twoAndOne({ frequency }), DISCOUNTS), what, 'answers', 'frequency');
            expectRefused(priceVisits(SERVICE_1, ITEMS_1, twoAndOne({ frequency }), DISCOUNTS), `${what}, as a series`, 'answers', 'frequency');
        }

        // No percent for the frequency: the sum (135.00 and 200 minutes) and no discount line.
        const unset = [
            ['monthly with no percents given', twoAndOne({ frequency: 'monthly' }), undefined],
            ['monthly with no percent for monthly', twoAndOne({ frequency: 'monthly' }), { weekly: 1000 }],
            ['monthly at 0', twoAndOne({ frequency: 'monthly' }), { ...DISCOUNTS, monthly: 0 }],
            ['weekly at the dev percent (0)', twoAndOne({ frequency: 'weekly' }), DISCOUNTS],
            ['every 2 weeks at the dev percent (0)', twoAndOne({ frequency: 'every_2_weeks' }), DISCOUNTS],
        ];
        for (const [what, answers, discounts] of unset) {
            const job = priceJob(SERVICE_1, ITEMS_1, answers, discounts);
            expectPriced(job, what, 135, 200);
            expect(codesOf(job), `${what}: no discount line`).toEqual(['base', 'bedrooms', 'bathrooms']);
        }

        // loadPricing reads the percents from system_settings as hundredths of a percent: 12.5 is 1250, 12.55 is 1255, 10 is 1000.
        const set = await loadPricing(standIn({
            recurring_discount_weekly_percent: '12.5', recurring_discount_every_2_weeks_percent: '12.55', recurring_discount_monthly_percent: '10',
        }), SERVICE_1.id);
        expect(set.discounts, 'the percents set, in hundredths').toEqual({ weekly: 1250, every_2_weeks: 1255, monthly: 1000 });

        // No row reads as 0, and so does a value that is not a percent from 0 to 100 with at most two decimals; the price has no discount line.
        const none = await loadPricing(standIn({}), SERVICE_1.id);
        expect(none.discounts, 'no percent set: every percent is 0').toEqual({ weekly: 0, every_2_weeks: 0, monthly: 0 });
        expect(codesOf(priceJob(none.service, none.items, twoAndOne({ frequency: 'monthly' }), none.discounts)), 'no percent set: no discount line').toEqual(['base', 'bedrooms', 'bathrooms']);
        for (const value of ['', '-5', '100.5', '12.555', 'ten']) {
            const what = `a monthly percent of ${JSON.stringify(value)}`;
            const { service, items, discounts } = await loadPricing(standIn({ recurring_discount_monthly_percent: value }), SERVICE_1.id);
            expect(discounts.monthly, `${what} reads as 0`).toBe(0);
            const job = priceJob(service, items, twoAndOne({ frequency: 'monthly' }), discounts);
            expectPriced(job, what, 135, 200);
            expect(codesOf(job), `${what}: no discount line`).toEqual(['base', 'bedrooms', 'bathrooms']);
        }
    });
});

test.describe('booking repeating visits', () => {
    // Mutant that turns this case red: the later visits are saved on the start date.
    test('a weekly booking saves twelve jobs a week apart, numbered from the first', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        // As the booking screens send it (when-and-where.js): one date and one slot, each in a list, and the frequency in the answers.
        const body = checkoutBody({ job_date: [WEEKLY_START], job_time_slot: ['Nov 4: Morning & Afternoon'], answers: twoAndOne({ frequency: 'weekly' }) });
        await withSeries(request, as, body, async (answer, saved) => {
            expect(saved.length, 'twelve jobs are saved').toBe(12);
            const [first] = saved;
            expect(first.id, 'visit 1 is the booking the answer names').toBe(answer.booking_id);
            expect(first.booking_number, "visit 1's number is the answer's").toBe(answer.booking_number);
            expect(first.booking_number, "visit 1's number is a booking number with no suffix").toMatch(/^BK\d+$/);
            // Every visit: its own date a week after the last, its slot's day label rebuilt for that date, visit 1's number with -k from visit 2,
            // the series named by visit 1's id, and customer 1's.
            expect(saved.map((visit) => ({
                booking_number: visit.booking_number, job_date: visit.job_date, job_time_slot: visit.job_time_slot, series_id: visit.series_id,
                series_visit: visit.series_visit, series_frequency: visit.series_frequency, status: visit.status, user_id: Number(visit.user_id),
            })), 'the twelve visits').toEqual(WEEKLY_VISITS.map(([date, day], index) => ({
                booking_number: index === 0 ? first.booking_number : `${first.booking_number}-${index + 1}`, job_date: date,
                job_time_slot: `${day}: Morning & Afternoon`, series_id: first.id, series_visit: index + 1, series_frequency: 'weekly',
                status: 'pending', user_id: CUSTOMER1.id,
            })));
            // The answer names the frequency and lists the visits in date order, each with its price (135.00 every Wednesday).
            expect(answer.frequency, 'the answer names the frequency').toBe('weekly');
            expect(Array.isArray(answer.visits), 'the answer lists the visits').toBe(true);
            expect(answer.visits.map(({ booking_id, booking_number, job_date, service_price }) => ({ booking_id, booking_number, job_date, service_price })), 'the visits in the answer').toEqual(
                saved.map((visit) => ({ booking_id: visit.id, booking_number: visit.booking_number, job_date: visit.job_date, service_price: 135 })),
            );
        });
    });

    // Mutant that turns this case red: the queue leaves out the visits after the first (`b.series_visit IS NULL OR b.series_visit = 1`).
    test('each visit of a series is its own job in the admin queue', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        const body = checkoutBody({ answers: twoAndOne({ frequency: 'every_2_weeks' }) });
        await withSeries(request, as, body, async (answer, saved) => {
            expect(saved.map((visit) => visit.job_date), 'six visits, fourteen days apart').toEqual(EVERY_2_WEEKS_DATES);
            const queue = await queueRows(request, as);
            for (const visit of saved) {
                const held = queue.filter((row) => row.id === visit.id);
                expect(held.length, `the queue holds visit ${visit.series_visit} once`).toBe(1);
                const [row] = held;
                expect({ booking_number: row.booking_number, status: row.status, queue_state: row.queue_state, service_price: row.service_price }, `visit ${visit.series_visit} in the queue`).toEqual({
                    booking_number: visit.booking_number, status: 'pending', queue_state: 'waiting', service_price: 135,
                });
            }
        });
    });

    // Mutant that turns this case red: the later visits are saved with visit 1's price and lines.
    test("a monthly booking records each visit's price with the monthly discount", async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        const [percent] = await rows('SELECT `value` FROM system_settings WHERE `key` = ?', ['recurring_discount_monthly_percent']);
        expect(percent?.value, 'the dev database holds the monthly percent of database/fixtures/catalog.js').toBe('10');

        // The price route answers visit 1's price and each visit's date, price and lines.
        const answers = twoAndOne({ frequency: 'monthly', date: MONTHLY_START });
        const priced = await request.post('/api/pricing', { data: { service_id: SERVICE_1.id, answers }, maxRetries: RESET_RETRIES, timeout: 60_000 });
        expect(priced.status(), 'the price route answers a monthly series').toBe(200);
        const price = await priced.json();
        expect(price.price, "the price route answers visit 1's price").toBe(MONTHLY_PRICES[0]);
        expect(Array.isArray(price.visits), 'the price route answers the visits').toBe(true);
        const visits = price.visits.map(({ date, price: amount, lines }) => ({ date, price: amount, lines }));
        expect(visits.map(({ date, price: amount }) => ({ date, price: amount })), 'the price route: each visit\'s date and price').toEqual(
            MONTHLY_DATES.map((date, index) => ({ date, price: MONTHLY_PRICES[index] })),
        );
        expect(visits.map(codesOf), "the price route: each visit's lines").toEqual(MONTHLY_CODES);
        expect(visits.map((visit) => visit.lines.at(-1)), "the price route: each visit's discount line").toEqual(MONTHLY_DISCOUNT_LINES);

        // The booking records, on each visit, the price and the lines the price route answered for that visit's date.
        const body = checkoutBody({ job_date: MONTHLY_START, job_time_slot: 'Nov 19: Afternoon', answers });
        await withSeries(request, as, body, async (answer, saved) => {
            expect(saved.map((visit) => visit.job_date), 'three visits, on the 19th').toEqual(MONTHLY_DATES);
            expect(answer.service_price, "the answer: visit 1's price").toBe(MONTHLY_PRICES[0]);
            expect(saved.map((visit) => Number(visit.service_price)), "each visit's stored price").toEqual(MONTHLY_PRICES);
            expect(saved.map(breakdownOf), "each visit's stored lines are the price route's lines for its date").toEqual(visits.map((visit) => visit.lines));
        });
    });

    // Mutant that turns this case red: a series is booked with no customer session, as a guest booking is.
    test('repeating visits need a signed-in customer', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        // A guest, and an admin or a provider signed in: none of them is a customer.
        for (const [who, headers] of [['no credential', {}], ['the admin signed in', as.admin], ['provider 1 signed in', as.provider]]) {
            await expectRefusedCheckout(request, as, {
                body: checkoutBody({ answers: twoAndOne({ frequency: 'weekly' }) }), headers, what: `weekly visits with ${who}`,
                status: 401, message: 'Please sign in to book repeating visits.',
            });
        }
    });

    // Mutant that turns this case red: a second date in the request is read as the start of the series.
    test('repeating visits take one start date and one set of times', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        const weekly = twoAndOne({ frequency: 'weekly' });
        const dates = { field: 'job_date', message: 'Choose one start date for repeating visits.' };
        const times = { field: 'job_time_slot', message: 'Choose the times for the start date only.' };
        // [what, the dates and times sent, the refusal]
        const refusals = [
            ['two dates in a list', { job_date: [WEEKLY_START, '2026-11-11'], job_time_slot: ['Nov 4: Morning'] }, dates],
            ['two dates in one text', { job_date: `${WEEKLY_START},2026-11-11`, job_time_slot: 'Nov 4: Morning' }, dates],
            ['one date and two slots', { job_date: [WEEKLY_START], job_time_slot: ['Nov 4: Morning', 'Nov 11: Morning'] }, times],
        ];
        for (const [what, fields, refusal] of refusals) {
            await expectRefusedCheckout(request, as, {
                body: checkoutBody({ ...fields, answers: weekly }), headers: as.customer, what: `weekly visits, ${what}`, status: 400, ...refusal,
            });
        }
    });

    // Mutant that turns this case red: the booking route books a frequency outside the list once.
    test('a frequency outside the list is refused and nothing is saved', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        const message = 'These answers cannot be priced for this service';
        // Signed in, and as a guest: the frequency is checked before the caller.
        for (const [who, headers, frequency] of [['customer 1', as.customer, 'daily'], ['no credential', {}, 'fortnightly']]) {
            await expectRefusedCheckout(request, as, {
                body: checkoutBody({ answers: twoAndOne({ frequency }) }), headers, what: `a frequency of ${frequency} with ${who}`,
                status: 400, message, field: 'frequency',
            });
        }
        // The price route refuses it too, with the same answer named.
        const priced = await request.post('/api/pricing', { data: { service_id: SERVICE_1.id, answers: twoAndOne({ frequency: 'daily', date: WEEKLY_START }) }, maxRetries: RESET_RETRIES, timeout: 60_000 });
        expect(priced.status(), 'the price route refuses a frequency of daily').toBe(400);
        const refused = await priced.json();
        expect([refused.success, refused.message, refused.field], 'the price route: a frequency of daily').toEqual([false, message, 'frequency']);
    });

    // Mutant that turns this case red: the customer's cancel cancels every visit of the series (`WHERE id = ? OR series_id = ?`).
    test('cancelling one visit leaves the other visits booked', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        const body = checkoutBody({ answers: twoAndOne({ frequency: 'every_2_weeks' }) });
        await withSeries(request, as, body, async (answer, saved) => {
            expect(saved.length, 'six visits are saved').toBe(6);
            const cancel = async (visit) => {
                const response = await request.post(`/api/customer/bookings/${visit.id}/cancel`, { headers: as.customer, data: {}, maxRetries: RESET_RETRIES, timeout: 60_000 });
                expect(response.status(), `customer 1 cancels visit ${visit.series_visit}`).toBe(200);
            };
            const statuses = async () => (await savedVisits(body.email)).map((visit) => visit.status);

            // A later visit, then the first (the one the series is named by): each time the others stay booked, on their own dates.
            await cancel(saved[1]);
            expect(await statuses(), 'after visit 2 is cancelled').toEqual(['pending', 'cancelled', 'pending', 'pending', 'pending', 'pending']);
            await cancel(saved[0]);
            expect(await statuses(), 'after visit 1 is cancelled too').toEqual(['cancelled', 'cancelled', 'pending', 'pending', 'pending', 'pending']);
            expect((await savedVisits(body.email)).map((visit) => visit.job_date), 'every visit keeps its date').toEqual(EVERY_2_WEEKS_DATES);
        });
    });

    // Mutant that turns this case red: the activity entry is written once for each visit.
    test('a series makes one notification for the customer and one activity entry', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        const [{ last }] = await rows('SELECT COALESCE(MAX(id), 0) AS last FROM activity_logs');
        const body = checkoutBody({ answers: twoAndOne({ frequency: 'weekly' }) });
        await withSeries(request, as, body, async (answer, saved) => {
            expect(saved.length, 'twelve visits are saved').toBe(12);
            const ids = saved.map((visit) => visit.id);
            // The route writes the entry after it answers: wait for it, then a little longer, and count what is written about the visits.
            const entries = () => rows("SELECT id FROM activity_logs WHERE id > ? AND entity_type = 'booking' AND entity_id IN (?)", [last, ids]);
            await expect.poll(async () => (await entries()).length, { message: 'the activity entry of the series is written', timeout: 15_000 }).toBeGreaterThan(0);
            await new Promise((resolve) => setTimeout(resolve, 1_100));
            expect((await entries()).length, 'one activity entry for the twelve visits').toBe(1);
        });

        // Source read: the booking route's POST pushes to the customer at one place, as it pushes to each admin at one place.
        const route = fs.readFileSync(path.join(ROOT, 'src/app/api/bookings/route.js'), 'utf8');
        const start = route.indexOf('export async function POST(');
        expect(start, 'the booking route has a POST handler').toBeGreaterThan(-1);
        const end = route.indexOf('export async function', start + 1);
        const post = route.slice(start, end === -1 ? undefined : end);
        const pushedTo = [...post.matchAll(/notifyUser\([^;]*?['"](customer|admin|provider)['"]\s*\)/g)].map((match) => match[1]);
        expect(pushedTo.filter((role) => role === 'customer'), 'the POST handler pushes to the customer at one place').toEqual(['customer']);
        expect(pushedTo.filter((role) => role === 'admin'), 'the POST handler pushes to the admins at one place').toEqual(['admin']);
    });
});
