// @ts-check
// The guided booking flow at /booking/schedule?service=<id>[&step=<n>]: up to four steps built from the service's pricing rule, with the
// price of the answers on screen shown at every step. The cases drive the page through its accessible surface only (roles, labels, the
// 'Your price' region with its price-total and price-line test ids, and the customer-facing copy) and work out every expected price
// themselves from the rows of database/fixtures/catalog.js (oracle() below): no expected price is read from the page's own pricing responses;
// the booking case also checks that the lines and quoted minutes it stored are the ones the page was served.
// The cases of the flow page need no sign-in and write nothing to the database; the confirm case signs in as a fixture customer, and the booking
// case writes one booking row through the API and deletes it in a finally block.
//
// The worked figures (service 1; amounts from the catalog rows, base 80.00):
//   bedrooms 2, bathrooms 1, house, deep clean, oven 1, fridge 2, on a weekday:
//     80.00 + 2 x 20.00 + 1 x 15.00 + 60.00 + 25.00 + 1 x 35.00 + 2 x 30.00 = 315.00; on a Saturday, + 30.00 = 345.00.
//   by the hour, 2.5 h, house, oven 1 (the hours replace the base and the units, so bedrooms 2 add nothing):
//     2.5 x 45.00 + 25.00 + 35.00 = 172.50; on a Saturday, + 30.00 = 202.50.
//   by the hour, 2 h, house: 2 x 45.00 + 25.00 = 115.00.
import { test, expect } from '@playwright/test';
import { catalog } from '../database/fixtures/catalog.js';
import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import { RESET_RETRIES, signInAs } from './support/auth.js';
import { warm } from './support/warm.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';

/** @typedef {import('@playwright/test').Page} Page */

// Every case starts with no stored cookies and an empty sessionStorage: a visitor who has not started a booking.
test.use({ storageState: { cookies: [], origins: [] }, timezoneId: 'America/Vancouver' });

// `next dev` compiles a route on its first visit.
const FIRST_VISIT_MS = 45_000;

// Fixture services (database/fixtures/catalog.js): 1 has a full rule, 2 has a unit and an extra, 3 has none.
const FULL_RULE = 1;
const UNITS_AND_EXTRA = 2;
const NO_RULE = 3;

const ABOUT = 'About the job';
const OPTION = 'The option';
const INCLUDED = "What's included";
const WHEN_WHERE = 'When and where';

const HOURS_MESSAGE = 'Enter the number of hours (for example 2 or 2.5) to see your price.';
const FAILED_MESSAGE = "We couldn't update the price. Check your connection and try again.";
const CHANGED_MESSAGE = 'Some choices for this service have changed. Please check your answers.';
const BY_THE_HOUR_NOTE = 'Priced by the hour: the hours you choose set the price.';

const SERVICES = catalog.tables.services;
const RULE_ROWS = catalog.tables.service_pricing_items;

function ruleRow(serviceId, kind, code) {
    const found = RULE_ROWS.find((row) => row.service_id === serviceId && row.kind === kind && row.code === code);
    if (!found) throw new Error(`the catalog fixture has no ${kind} '${code}' for service ${serviceId}`);
    return found;
}

const cents = (amount) => Math.round(Number(amount) * 100);
// Every total of these cases is under 1,000.00, so the en-CA format has no thousands separator.
const money = (valueCents) => `$${(valueCents / 100).toFixed(2)}`;
const plain = (valueCents) => (valueCents / 100).toFixed(2);

const BEDROOMS = ruleRow(FULL_RULE, 'unit', 'bedrooms').label;
const BATHROOMS = ruleRow(FULL_RULE, 'unit', 'bathrooms').label;
const APARTMENT = ruleRow(FULL_RULE, 'property_type', 'apartment').label;
const HOUSE = ruleRow(FULL_RULE, 'property_type', 'house').label;
const STANDARD = ruleRow(FULL_RULE, 'option', 'standard').label;
const DEEP = ruleRow(FULL_RULE, 'option', 'deep').label;
const BY_THE_HOUR = ruleRow(FULL_RULE, 'option', 'hourly').label;
const OVEN = ruleRow(FULL_RULE, 'extra', 'oven').label;
const FRIDGE = ruleRow(FULL_RULE, 'extra', 'fridge').label;
const WEEKEND_NOTICE = `Weekend dates add ${money(cents(ruleRow(FULL_RULE, 'weekend', 'weekend').amount))}. Your price updates when you pick a date.`;

/**
 * The expected price of a set of answers, summed from the catalog rows. `picks` names the service (default 1), the quantity of each
 * unit and extra by code, the option, the hours, the property type and whether the job's first date falls on a weekend.
 * Answers the total and the amount of each line, in cents.
 */
function oracle(picks) {
    const service = picks.service ?? FULL_RULE;
    const rule = (kind, code) => ruleRow(service, kind, code);
    const lines = [];
    const chosen = picks.option ? rule('option', picks.option) : null;
    if (chosen && chosen.is_hourly === 1) {
        lines.push(Math.round(picks.hours * cents(chosen.amount)));
    } else {
        const row = SERVICES.find((candidate) => candidate.id === service);
        if (!row) throw new Error(`the catalog fixture has no service ${service}`);
        lines.push(cents(row.base_price));
        for (const [code, count] of Object.entries(picks.units ?? {})) {
            if (count > 0) lines.push(count * cents(rule('unit', code).amount));
        }
        if (chosen) lines.push(cents(chosen.amount));
    }
    if (picks.propertyType) lines.push(cents(rule('property_type', picks.propertyType).amount));
    if (picks.weekend) lines.push(cents(rule('weekend', 'weekend').amount));
    for (const [code, count] of Object.entries(picks.extras ?? {})) {
        if (count > 0) lines.push(count * cents(rule('extra', code).amount));
    }
    return { cents: lines.reduce((sum, line) => sum + line, 0), lines };
}

// The answers of the 315.00 path.
const FULL = { units: { bedrooms: 2, bathrooms: 1 }, option: 'deep', propertyType: 'house', extras: { oven: 1, fridge: 2 } };
// The answers of the 172.50 path.
const HOURLY = { units: { bedrooms: 2 }, option: 'hourly', hours: 2.5, propertyType: 'house', extras: { oven: 1 } };

// ---- dates, built from numbers (no date text is ever parsed) ----
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const weekdayOf = ({ year, month, day }) => new Date(Date.UTC(year, month - 1, day)).getUTCDay();
const dayLabel = (date) => `${WEEKDAYS_SHORT[weekdayOf(date)]}, ${MONTHS_SHORT[date.month - 1]} ${date.day}`;
const isoOf = ({ year, month, day }) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

function addDays({ year, month, day }, days) {
    const moved = new Date(Date.UTC(year, month - 1, day + days));
    return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
}

// The first Saturday after the given day (a Saturday gives the one a week on).
const saturdayAfter = (date) => addDays(date, ((6 - weekdayOf(date) + 7) % 7) || 7);

// Today on the browser's clock, the clock the calendar of the page disables past days by.
/** @param {Page} page */
async function today(page) {
    return page.evaluate(() => {
        const now = new Date();
        return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
    });
}

// ---- locators: the accessible surface of the page ----
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const startingWith = (label) => new RegExp(`^${escapeRegExp(label)}`);

/** @param {Page} page */
const priceBox = (page) => page.getByRole('region', { name: 'Your price' });
/** @param {Page} page */
const totalOf = (page) => priceBox(page).getByTestId('price-total');
/** @param {Page} page */
const linesOf = (page) => priceBox(page).getByTestId('price-line');
/** @param {Page} page */
const statusOf = (page) => priceBox(page).locator('[role="status"][aria-live="polite"]');
/** @param {Page} page */
const stepsNav = (page) => page.getByRole('navigation', { name: 'Booking steps' });
/** @param {Page} page */
const currentStep = (page) => stepsNav(page).locator('[aria-current="step"]');
const stepHeading = (page, name) => page.getByRole('heading', { level: 2, name, exact: true });
const continueButton = (page) => page.getByRole('button', { name: 'Continue', exact: true });
const backButton = (page) => page.getByRole('button', { name: 'Back', exact: true });
const tryAgainButton = (page) => page.getByRole('button', { name: 'Try again', exact: true });
const stepper = (page, label) => page.getByRole('group', { name: label, exact: true });
const quantityOf = (page, label) => stepper(page, label).getByRole('spinbutton');
const addOne = (page, label) => page.getByRole('button', { name: `Add one ${label}`, exact: true });
const removeOne = (page, label) => page.getByRole('button', { name: `Remove one ${label}`, exact: true });
// A radio's accessible name starts with the item's label and may go on with its amount.
const radio = (root, label) => root.getByRole('radio', { name: startingWith(label) });
const hoursInput = (page) => page.getByLabel('How many hours?');
const addressField = (page) => page.getByLabel('Service Address');
const counter = (page, k, n) => page.getByText(`Step ${k} of ${n}`).first();
const onStep = (n) => (url) => url.pathname === '/booking/schedule' && url.searchParams.get('step') === String(n);

// The calendar of step 4: the month heading and its two month buttons, which carry no text of their own.
const MONTH_HEADING = new RegExp(`^(${MONTHS.join('|')}) \\d{4}$`);
const monthHeading = (page) => page.getByText(MONTH_HEADING).first();
const previousMonth = (page) => page.getByRole('button', { name: /previous month/i }).or(monthHeading(page).locator('xpath=..').getByRole('button').first());
const nextMonth = (page) => page.getByRole('button', { name: /next month/i }).or(monthHeading(page).locator('xpath=..').getByRole('button').last());

/** Shows the month of `date` in the calendar by pressing its month buttons. */
async function showMonth(page, date) {
    const wanted = date.year * 12 + (date.month - 1);
    for (let presses = 0; presses < 6; presses += 1) {
        const [name, year] = (await monthHeading(page).innerText()).trim().split(' ');
        const shown = Number(year) * 12 + MONTHS.indexOf(name);
        if (shown === wanted) return;
        await (shown < wanted ? nextMonth(page) : previousMonth(page)).click();
    }
    throw new Error(`the calendar did not reach ${MONTHS[date.month - 1]} ${date.year}`);
}

/** Taps a day of the calendar, in its own month; a day button is named by its full date. */
async function pickDay(page, date) {
    await showMonth(page, date);
    await page.getByRole('button', { name: `${MONTHS[date.month - 1]} ${date.day}, ${date.year}`, exact: true }).click();
}

// ---- the price on screen against the oracle ----
const showsAmount = (text, amount) => new RegExp(`(^|[^\\d.])${escapeRegExp(amount)}(?!\\d)`).test(text);

/**
 * Waits for the price box to show the oracle's total for `picks`, with one line for each line of the oracle's sum and each line's amount.
 * @param {Page} page
 * @param {number} [timeout]
 */
async function expectPrice(page, picks, timeout) {
    const expected = oracle(picks);
    await expect(totalOf(page), `the total for ${JSON.stringify(picks)}`).toHaveText(money(expected.cents), timeout ? { timeout } : undefined);
    await expect(linesOf(page), 'one price line for each part of the sum').toHaveCount(expected.lines.length);
    const left = await linesOf(page).allTextContents();
    for (const line of expected.lines) {
        const at = left.findIndex((text) => showsAmount(text, plain(line)));
        expect(at, `a price line shows ${plain(line)} (lines shown: ${JSON.stringify(left)})`).toBeGreaterThanOrEqual(0);
        left.splice(at, 1);
    }
}

// The price region holds no total and no line, and announces no price, while the answers are being priced or cannot be priced.
async function expectNoFigure(page) {
    await expect(totalOf(page)).toHaveCount(0);
    await expect(linesOf(page)).toHaveCount(0);
    await expect(statusOf(page)).not.toHaveText(/\$\d/);
}

// ---- driving the page ----
/** @param {Page} page */
async function openFlow(page, serviceId) {
    await page.goto(`/booking/schedule?service=${serviceId}`, { timeout: FIRST_VISIT_MS });
    await expect(totalOf(page)).toBeVisible({ timeout: FIRST_VISIT_MS });
}

// Continues to the step called `heading`, once the price on screen is the oracle's figure for `picks`.
async function goOn(page, heading, picks) {
    if (picks) await expectPrice(page, picks);
    await expect(continueButton(page)).toBeEnabled();
    await continueButton(page).click();
    await expect(stepHeading(page, heading)).toBeVisible();
}

async function setQuantity(page, label, count) {
    await quantityOf(page, label).fill(String(count));
}

// Answers steps 1 to 3 of service 1 with the 315.00 path and stays on step 3.
async function answerFullPath(page) {
    await openFlow(page, FULL_RULE);
    await setQuantity(page, BEDROOMS, FULL.units.bedrooms);
    await setQuantity(page, BATHROOMS, FULL.units.bathrooms);
    await radio(page, HOUSE).check();
    await goOn(page, OPTION, { units: FULL.units, propertyType: 'house' });
    await radio(page, DEEP).check();
    await goOn(page, INCLUDED, { units: FULL.units, propertyType: 'house', option: 'deep' });
    await setQuantity(page, OVEN, FULL.extras.oven);
    await setQuantity(page, FRIDGE, FULL.extras.fridge);
    await expectPrice(page, FULL);
}

// Answers steps 1 to 3 of service 1 with the 172.50 path and stays on step 3.
async function answerHourlyPath(page) {
    await openFlow(page, FULL_RULE);
    await setQuantity(page, BEDROOMS, HOURLY.units.bedrooms);
    await radio(page, HOUSE).check();
    await goOn(page, OPTION, { units: HOURLY.units, propertyType: 'house' });
    await radio(page, BY_THE_HOUR).check();
    await hoursInput(page).fill(String(HOURLY.hours));
    await goOn(page, INCLUDED, { units: HOURLY.units, propertyType: 'house', option: 'hourly', hours: HOURLY.hours });
    await setQuantity(page, OVEN, HOURLY.extras.oven);
    await expectPrice(page, HOURLY);
}

// ---- the requests the page sends to /api/pricing ----
/**
 * Records every POST /api/pricing request body, in order, and applies one-shot plans to the next requests: hold one until it is
 * released, abort one, or answer one with a given status and JSON body. A plan's `index` is the position of the request it took (-1 until then).
 * @param {Page} page
 */
async function watchPricing(page) {
    /** @type {any[]} */
    const bodies = [];
    /** @type {any[]} */
    const plans = [];
    await page.route('**/api/pricing', async (route) => {
        const request = route.request();
        if (request.method() !== 'POST') {
            await route.continue();
            return;
        }
        let body = null;
        try {
            body = request.postDataJSON();
        } catch {
            body = null;
        }
        const index = bodies.push(body) - 1;
        const plan = plans.shift();
        if (plan) plan.index = index;
        try {
            if (plan?.kind === 'hold') {
                await plan.gate;
                await route.continue();
            } else if (plan?.kind === 'abort') {
                await route.abort('failed');
            } else if (plan?.kind === 'answer') {
                await route.fulfill({ status: plan.status, json: plan.body });
            } else {
                await route.continue();
            }
        } catch {
            // The page dropped the request before the handler answered it.
        }
    });
    return {
        bodies,
        holdNext() {
            let release = () => {};
            const gate = new Promise((resolve) => {
                release = () => resolve(undefined);
            });
            const plan = { kind: 'hold', gate, release, index: -1 };
            plans.push(plan);
            return plan;
        },
        failNext() {
            const plan = { kind: 'abort', index: -1 };
            plans.push(plan);
            return plan;
        },
        answerNext(status, body) {
            const plan = { kind: 'answer', status, body, index: -1 };
            plans.push(plan);
            return plan;
        },
    };
}

// Waits until the page has sent the request a plan took.
async function reached(plan) {
    await expect.poll(() => plan.index, { message: 'the page sent the request' }).toBeGreaterThanOrEqual(0);
}

// Answers as the pricing rule reads them: a unit or extra list with nothing in it is the same as none.
function normalised(answers) {
    const copy = { ...answers };
    if (copy.units && Object.keys(copy.units).length === 0) delete copy.units;
    if (Array.isArray(copy.extras) && copy.extras.length === 0) delete copy.extras;
    return copy;
}

const SIX_KEYS = ['date', 'extras', 'hours', 'option', 'property_type', 'units'];

// The street the flow page has kept in sessionStorage for the confirm step and for a reload.
/** @param {Page} page */
const storedAddress = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('bookingFlow') ?? 'null')?.whenAndWhere?.address ?? null);

/**
 * Taps "Add one" on bedrooms with the next request held, taps it again so that a newer request goes through, then lets the held
 * request go: the newer figure stays on screen, with no failure shown. `picks` holds the bedrooms already on screen.
 * @param {Page} page
 */
async function supersedeAndRelease(page, watch, picks) {
    const count = picks.units.bedrooms;
    const newest = { ...picks, units: { bedrooms: count + 2 } };
    const held = watch.holdNext();
    await addOne(page, BEDROOMS).click();
    await reached(held);
    await addOne(page, BEDROOMS).click();
    await expectPrice(page, newest);
    held.release();
    for (let look = 0; look < 6; look += 1) {
        await page.waitForTimeout(250);
        await expect(totalOf(page)).toHaveText(money(oracle(newest).cents));
        await expect(page.getByText(FAILED_MESSAGE)).toHaveCount(0);
    }
    await expect(quantityOf(page, BEDROOMS)).toHaveValue(String(count + 2));
}

// ---- the checkout: from the last step to the request that asks for the card hold ----
// The 345.00 path: the 315.00 answers with a Saturday as the job's first date.
const FULL_ON_SATURDAY = { ...FULL, weekend: true };
// The same path as the pricing rule's answers (normalised), for the first date `date`: what a price request, a hold and a stored booking carry.
const answersOfFullPathOn = (date) => ({
    units: { bedrooms: 2, bathrooms: 1 },
    option: 'deep',
    property_type: 'house',
    date: isoOf(date),
    extras: [{ code: 'oven', quantity: 1 }, { code: 'fridge', quantity: 2 }],
});
// Typed on step 4; the description needs at least 20 characters.
const ADDRESS = '1 Probe Street';
const DESCRIPTION = 'A deep clean of the whole house, with the oven and the two fridges.';

// One object feeds both the guard and the connection, so the guard certifies the values that get used (as database/fixtures/load.js).
// The test command runs the app's container with --network host, so the published port 127.0.0.1:3307 is the dev database.
const DB = { host: '127.0.0.1', port: 3307, user: 'root', password: 'root123', database: 'workontap_db' };

// A connection to the dev database, opened after the guard has checked the target and the rows in it.
async function openDatabase() {
    assertDevTarget(DB);
    let connection;
    try {
        connection = await mysql.createConnection(DB);
    } catch (error) {
        throw new Error(`the dev database did not accept a connection at ${DB.host}:${DB.port} (${/** @type {any} */ (error).code || 'no code'}); the test command runs the container with --network host`, { cause: error });
    }
    try {
        await assertNoRealPeople(connection);
    } catch (error) {
        await connection.end();
        throw error;
    }
    return connection;
}

// The bookings made with a payment id, as stored. A DATE column is read as text, so no time zone is involved.
async function bookingsMadeWith(connection, paymentId) {
    const [found] = await connection.query(
        "SELECT id, DATE_FORMAT(job_date, '%Y-%m-%d') AS job_date, timing_constraints, address_line1, service_price, price_breakdown, standard_duration_minutes FROM bookings WHERE payment_intent_id = ?",
        [paymentId],
    );
    return /** @type {any[]} */ (found);
}

// Deletes the bookings made with a payment id and the status history and photo rows the checkout wrote for them.
// The activity_logs and notification rows that the checkout writes about a booking stay.
async function deleteBookingsMadeWith(connection, paymentId) {
    for (const { id } of await bookingsMadeWith(connection, paymentId)) {
        await connection.query('DELETE FROM booking_status_history WHERE booking_id = ?', [id]);
        await connection.query('DELETE FROM booking_photos WHERE booking_id = ?', [id]);
        await connection.query('DELETE FROM bookings WHERE id = ?', [id]);
    }
}

/**
 * Records, in the order the requests were sent, the body of each POST /api/pricing request and the JSON the server answered it with
 * (null until the answer is in).
 * @param {Page} page
 */
function recordPriced(page) {
    /** @type {{ body: any, answer: any }[]} */
    const priced = [];
    /** @type {Map<any, { body: any, answer: any }>} */
    const byRequest = new Map();
    page.on('request', (request) => {
        if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/pricing') return;
        let body = null;
        try {
            body = request.postDataJSON();
        } catch {
            body = null;
        }
        const entry = { body, answer: null };
        byRequest.set(request, entry);
        priced.push(entry);
    });
    page.on('response', async (response) => {
        const entry = byRequest.get(response.request());
        if (!entry) return;
        try {
            entry.answer = await response.json();
        } catch {
            entry.answer = null;
        }
    });
    return priced;
}

/**
 * Answers each POST /api/payment/create-intent with HTTP 500 and a failure body, as a server with no payment key does, and records the
 * request bodies, in order.
 * @param {Page} page
 */
async function refuseHold(page) {
    /** @type {any[]} */
    const holds = [];
    await page.route('**/api/payment/create-intent', async (route) => {
        let body = null;
        try {
            body = route.request().postDataJSON();
        } catch {
            body = null;
        }
        holds.push(body);
        await route.fulfill({ status: 500, json: { success: false, message: 'x' } });
    });
    return holds;
}

/**
 * Signs in as the fixture customer, answers service 1 with the 345.00 path (a Saturday as the first date and the Monday after it as the
 * second, the morning of each, an address and a description) and continues from the last step to the confirm step. Two dates, so that the
 * first and the last differ. Answers the two dates, the pricing requests the page sent (watch), the pricing exchanges (priced) and the
 * bodies of the hold requests (holds).
 * @param {Page} page
 */
async function openConfirm(page) {
    const watch = await watchPricing(page);
    const priced = recordPriced(page);
    const holds = await refuseHold(page);
    await signInAs(page, 'customer1');

    await answerFullPath(page);
    await goOn(page, WHEN_WHERE, FULL);
    const saturday = saturdayAfter(await today(page));
    const monday = addDays(saturday, 2);
    await pickDay(page, saturday);
    await expectPrice(page, FULL_ON_SATURDAY);
    await pickDay(page, monday);
    // The first date prices the booking: a second date leaves the 345.00 as it was.
    await expectPrice(page, FULL_ON_SATURDAY);
    for (const date of [saturday, monday]) {
        await page.getByRole('group', { name: dayLabel(date), exact: true }).getByRole('button', { name: startingWith('Morning') }).click();
    }
    await addressField(page).fill(ADDRESS);
    await page.getByRole('textbox', { name: /What do you need done/ }).fill(DESCRIPTION);
    await expect(continueButton(page)).toBeEnabled();
    await continueButton(page).click();

    await expect(page).toHaveURL((url) => url.pathname === '/booking/confirm', { timeout: FIRST_VISIT_MS });
    return { saturday, monday, watch, priced, holds };
}

/**
 * Ticks the terms on the confirm step and presses "Proceed to Payment"; the payment step then asks for the card hold, which refuseHold
 * answers with a failure. Answers the booking the confirm step stored in sessionStorage for the payment step.
 * @param {Page} page
 * @param {any[]} holds the bodies that refuseHold recorded
 */
async function proceedToPayment(page, holds) {
    await page.getByRole('checkbox', { name: /Terms of Service/ }).check();
    const proceed = page.getByRole('button', { name: /Proceed to Payment/ });
    await expect(proceed).toBeEnabled();
    await proceed.click();
    await expect.poll(() => holds.length, { message: 'the page asked for the card hold', timeout: FIRST_VISIT_MS }).toBeGreaterThan(0);
    return page.evaluate(() => JSON.parse(sessionStorage.getItem('pendingBooking') ?? 'null'));
}

// ---- the payment step: the request that creates the card hold is refused ----
const SESSION_ENDED_MESSAGE = 'Your session has expired. Please sign in again to finish your booking.';
const NOT_AVAILABLE_MESSAGE = "This service isn't available for booking right now.";
// A sentence of the case's own, so the case shows that the step prints the words the server sent.
const ANSWERS_REFUSED_SENTENCE = 'These answers are outside what one card hold can take.';

/**
 * Signs in as the fixture customer, takes service 1 along the 345.00 path to the confirm step and presses "Proceed to Payment" with the
 * request for the card hold answered as given. Answers the bodies of the hold requests, in order.
 * @param {Page} page
 * @param {number} status
 * @param {any} json
 */
async function openRefusedPayment(page, status, json) {
    await openConfirm(page);
    /** @type {any[]} */
    const holds = [];
    // The route registered last answers first, so the payment step gets this answer and not the failure that refuseHold gives.
    await page.route('**/api/payment/create-intent', async (route) => {
        if (route.request().method() !== 'POST') {
            await route.continue();
            return;
        }
        let body = null;
        try {
            body = route.request().postDataJSON();
        } catch {
            body = null;
        }
        holds.push(body);
        await route.fulfill({ status, json });
    });
    await proceedToPayment(page, holds);
    return holds;
}

// The block of the payment step that says why there is no card form: the alert that holds the sentence, whole as written.
const refusalBlock = (page, sentence) => page.getByRole('alert').filter({ has: page.getByText(sentence, { exact: true }) });

// The refusal takes the place of the card form: no amount held on the card and no button that authorizes the payment.
async function expectNoCardForm(page) {
    await expect(page.getByText('Amount held on your card')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Authorize Payment/ })).toHaveCount(0);
}

// The hold is created once per visit: one request was made, and the refusal does not lead to a second.
async function expectOneHoldRequest(page, holds) {
    // A second request, if the step made one, is on its way well inside this wait.
    await page.waitForTimeout(500);
    expect(holds, 'the card hold was asked for once').toHaveLength(1);
}

test.describe('Guided booking flow', () => {
    // The page gives its live price 10 s (src/lib/use-live-price.js) and `next dev` compiles /api/pricing, the page and the routes the page also asks for when each is
    // first asked for (BUG-011: 15 to 27 s each, cold), so the 45 s FIRST_VISIT_MS below cannot help the price. They are asked for here, before the case opens the page.
    // A route is dropped after about a minute without a request, so this runs before each case.
    test.beforeEach(async ({ request }) => {
        test.setTimeout(120_000);
        await warm(request, ['/booking/schedule', '/api/pricing', '/api/services', '/api/provider/me']);
    });

    test("the steps of a service with a full rule are about the job, the option, what's included, and when and where, in that order", async ({ page }) => {
        await openFlow(page, FULL_RULE);

        await expect(stepsNav(page).getByRole('listitem')).toHaveText([ABOUT, OPTION, INCLUDED, WHEN_WHERE]);
        await expect(currentStep(page)).toHaveText(ABOUT);
        await expect(counter(page, 1, 4)).toBeAttached();
        await expect(stepHeading(page, ABOUT)).toBeVisible();
        await expect(backButton(page), 'no Back on the first step').toHaveCount(0);

        // Step 1 holds a stepper for each unit and the property types, with nothing chosen.
        for (const [label, code] of [[BEDROOMS, 'bedrooms'], [BATHROOMS, 'bathrooms']]) {
            await expect(stepper(page, label)).toBeVisible();
            await expect(stepper(page, label).getByText(`${money(cents(ruleRow(FULL_RULE, 'unit', code).amount))} each`)).toBeVisible();
            await expect(quantityOf(page, label)).toHaveValue('0');
            await expect(removeOne(page, label), 'Remove is off at 0').toBeDisabled();
            await expect(addOne(page, label)).toBeEnabled();
        }
        const types = page.getByRole('group', { name: 'Type of property', exact: true });
        await expect(types.getByRole('radio')).toHaveCount(4);
        await expect(radio(types, APARTMENT)).not.toBeChecked();
        await expect(radio(types, HOUSE)).not.toBeChecked();
        await expect(continueButton(page), 'a property type is required').toBeDisabled();

        await radio(page, HOUSE).check();
        await expectPrice(page, { propertyType: 'house' });
        await goOn(page, OPTION);

        // Step 2 holds the three options, with nothing chosen.
        await expect(page).toHaveURL(onStep(2));
        await expect(stepHeading(page, OPTION), 'focus moves to the step heading').toBeFocused();
        await expect(currentStep(page)).toHaveText(OPTION);
        await expect(counter(page, 2, 4)).toBeAttached();
        await expect(backButton(page)).toBeVisible();
        const options = page.getByRole('group', { name: 'Choose an option', exact: true });
        await expect(options.getByRole('radio')).toHaveCount(3);
        for (const label of [STANDARD, DEEP, BY_THE_HOUR]) {
            await expect(radio(options, label)).not.toBeChecked();
        }
        await expect(options.getByText(`${money(cents(ruleRow(FULL_RULE, 'option', 'hourly').amount))} an hour`)).toBeVisible();
        await expect(continueButton(page), 'an option is required').toBeDisabled();

        await radio(page, STANDARD).check();
        await goOn(page, INCLUDED, { propertyType: 'house', option: 'standard' });
        await expect(page).toHaveURL(onStep(3));
        await expect(currentStep(page)).toHaveText(INCLUDED);
        await expect(stepper(page, OVEN)).toBeVisible();
        await expect(stepper(page, FRIDGE)).toBeVisible();

        // The summary's note about who the pro is shows on the last step only.
        const proNote = page.getByRole('heading', { name: 'Who is my pro?' });
        await expect(proNote).toHaveCount(0);

        await goOn(page, WHEN_WHERE, { propertyType: 'house', option: 'standard' });
        await expect(page).toHaveURL(onStep(4));
        await expect(currentStep(page)).toHaveText(WHEN_WHERE);
        await expect(counter(page, 4, 4)).toBeAttached();
        await expect(proNote).toBeVisible();
    });

    test('a service with units and an extra shows three steps and a service with no rule shows one', async ({ page }) => {
        await openFlow(page, UNITS_AND_EXTRA);
        await expect(stepsNav(page).getByRole('listitem')).toHaveText([ABOUT, INCLUDED, WHEN_WHERE]);
        await expect(counter(page, 1, 3)).toBeAttached();
        await expect(stepper(page, ruleRow(UNITS_AND_EXTRA, 'unit', 'bedrooms').label)).toBeVisible();
        await expectPrice(page, { service: UNITS_AND_EXTRA });

        // The step number in the address is the canonical one: the second step shown is number 3.
        await goOn(page, INCLUDED, { service: UNITS_AND_EXTRA });
        await expect(page).toHaveURL(onStep(3));
        await expect(counter(page, 2, 3)).toBeAttached();
        await expect(stepper(page, ruleRow(UNITS_AND_EXTRA, 'extra', 'oven').label)).toBeVisible();

        await openFlow(page, NO_RULE);
        await expect(stepsNav(page).getByRole('listitem')).toHaveText([WHEN_WHERE]);
        await expect(stepHeading(page, WHEN_WHERE)).toBeVisible();
        await expect(page.getByText(/Step \d+ of \d+/), 'one step has no counter').toHaveCount(0);
        // No rule: the price is the service's catalog price.
        await expectPrice(page, { service: NO_RULE });
        await expect(totalOf(page)).toHaveText('$100.00');
    });

    test("the price on every step equals the pricing rule's price for the answers on screen", async ({ page }) => {
        await openFlow(page, FULL_RULE);
        // Nothing answered: the service's base price.
        await expectPrice(page, {}, FIRST_VISIT_MS);
        await expect(totalOf(page)).toHaveText('$80.00');

        const picks = { units: {}, extras: {} };
        // The total for the answers so far, with the page still on the step it was on.
        const settled = async (step) => {
            await expectPrice(page, picks);
            await expect(currentStep(page)).toHaveText(step);
        };

        // Step 1: one tap at a time, the total after each tap.
        await addOne(page, BEDROOMS).click();
        picks.units.bedrooms = 1;
        await settled(ABOUT);
        await addOne(page, BEDROOMS).click();
        picks.units.bedrooms = 2;
        await settled(ABOUT);
        await addOne(page, BATHROOMS).click();
        picks.units.bathrooms = 1;
        await settled(ABOUT);
        await radio(page, HOUSE).check();
        picks.propertyType = 'house';
        await settled(ABOUT);
        await expect(statusOf(page)).toHaveText(`Price ${money(oracle(picks).cents)}`);
        await goOn(page, OPTION);

        // Step 2: the price carries over and moves with the option.
        await settled(OPTION);
        await radio(page, DEEP).check();
        picks.option = 'deep';
        await settled(OPTION);
        await goOn(page, INCLUDED);

        // Step 3: the extras.
        await settled(INCLUDED);
        await addOne(page, OVEN).click();
        picks.extras.oven = 1;
        await settled(INCLUDED);
        await addOne(page, FRIDGE).click();
        picks.extras.fridge = 1;
        await settled(INCLUDED);
        await setQuantity(page, FRIDGE, 2);
        picks.extras.fridge = 2;
        await settled(INCLUDED);
        expect(money(oracle(picks).cents), 'the worked figure of the ticket').toBe('$315.00');
        await expect(totalOf(page)).toHaveText('$315.00');
        await expect(page).toHaveURL(onStep(3));

        // Taking one away prices the smaller answers, and putting it back prices the larger ones again.
        await removeOne(page, FRIDGE).click();
        picks.extras.fridge = 1;
        await settled(INCLUDED);
        await addOne(page, FRIDGE).click();
        picks.extras.fridge = 2;
        await settled(INCLUDED);
        await expect(totalOf(page)).toHaveText('$315.00');
    });

    test('a Saturday as the first date adds the weekend amount and a Friday before it does not', async ({ page }) => {
        await answerFullPath(page);
        // Before a date is picked the weekday price stands, and the box says what a weekend date adds.
        await expect(page.getByText(WEEKEND_NOTICE).first()).toBeVisible();
        await goOn(page, WHEN_WHERE, FULL);
        await expectPrice(page, FULL);

        const saturday = saturdayAfter(await today(page));
        const friday = addDays(saturday, -1);

        await pickDay(page, saturday);
        await expectPrice(page, { ...FULL, weekend: true });
        await expect(totalOf(page)).toHaveText('$345.00');
        await expect(page.getByText(/Your price is for your first date/), 'one date has no first-date notice').toHaveCount(0);

        // The earlier day sorts first and becomes the first date.
        await pickDay(page, friday);
        await expectPrice(page, FULL);
        await expect(totalOf(page)).toHaveText('$315.00');
        await expect(priceBox(page).getByText(`Your price is for your first date, ${dayLabel(friday)}.`).first()).toBeVisible();

        // Both days off, then the same two picked the other way round (Friday first): over the two orders the first date is neither the first one picked nor the newest, it is the earliest day.
        await pickDay(page, saturday);
        await pickDay(page, friday);
        await expectPrice(page, FULL);
        await expect(page.getByText(/Your price is for your first date/), 'with no date picked there is no first-date notice').toHaveCount(0);
        await pickDay(page, friday);
        await expectPrice(page, FULL);
        await pickDay(page, saturday);
        await expectPrice(page, FULL);
        await expect(totalOf(page)).toHaveText('$315.00');
        await expect(priceBox(page).getByText(`Your price is for your first date, ${dayLabel(friday)}.`).first()).toBeVisible();
    });

    test('by the hour the price is the hours at the hourly amount plus the property type and extras', async ({ page }) => {
        await openFlow(page, FULL_RULE);
        await setQuantity(page, BEDROOMS, 2);
        await radio(page, HOUSE).check();
        await goOn(page, OPTION, { units: { bedrooms: 2 }, propertyType: 'house' });

        await radio(page, BY_THE_HOUR).check();
        await expect(page.getByText(BY_THE_HOUR_NOTE).first()).toBeVisible();
        await expect(hoursInput(page)).toBeVisible();
        await expect(hoursInput(page)).toHaveValue('');
        await hoursInput(page).fill('2.5');
        // The hours replace the base and the units: 2.5 x 45.00 + 25.00.
        await goOn(page, INCLUDED, { units: { bedrooms: 2 }, option: 'hourly', hours: 2.5, propertyType: 'house' });
        await setQuantity(page, OVEN, 1);
        await expectPrice(page, HOURLY);
        expect(money(oracle(HOURLY).cents), 'the worked figure of the ticket').toBe('$172.50');
        await expect(totalOf(page)).toHaveText('$172.50');

        // Switching to a tier clears the hours and prices the tier, with no refusal.
        const tier = { units: { bedrooms: 2 }, option: 'deep', propertyType: 'house', extras: { oven: 1 } };
        await backButton(page).click();
        await expect(stepHeading(page, OPTION)).toBeVisible();
        await radio(page, DEEP).check();
        await expectPrice(page, tier);
        await expect(hoursInput(page)).toHaveCount(0);
        await expect(page.getByText(HOURS_MESSAGE)).toHaveCount(0);

        // By the hour again: the hours were cleared, so they are asked for again.
        await radio(page, BY_THE_HOUR).check();
        await expect(hoursInput(page)).toHaveValue('');
        await expect(page.getByText(HOURS_MESSAGE).first()).toBeVisible();
        await hoursInput(page).fill('2.5');
        await expectPrice(page, HOURLY);
    });

    test('no figure is shown while the price for the current answers is still being worked out', async ({ page }) => {
        const watch = await watchPricing(page);
        await openFlow(page, FULL_RULE);
        await radio(page, HOUSE).check();
        await expectPrice(page, { propertyType: 'house' });
        await expect(continueButton(page)).toBeEnabled();
        await expect(statusOf(page)).toHaveText(`Price ${money(oracle({ propertyType: 'house' }).cents)}`);

        const held = watch.holdNext();
        // The change itself hides the figure: the page is read one task after the tap, long before the quiet period (250 ms) is over.
        const figuresAfterTap = await page.evaluate(async (label) => {
            document.querySelector(`button[aria-label="Add one ${label}"]`).click();
            await new Promise((resolve) => setTimeout(resolve, 0));
            return document.querySelectorAll('[data-testid="price-total"]').length;
        }, BEDROOMS);
        expect(figuresAfterTap, 'no figure just after the tap').toBe(0);
        await reached(held);

        // The request for one bedroom is open: no total, no lines, nothing announced, and Continue is off.
        await expect(priceBox(page).getByText('Updating price…', { exact: true }).first()).toBeVisible();
        await expectNoFigure(page);
        await expect(statusOf(page), 'nothing is announced while updating').toHaveText('');
        await expect(continueButton(page)).toBeDisabled();
        await expect(quantityOf(page, BEDROOMS)).toHaveValue('1');

        held.release();
        const answered = { units: { bedrooms: 1 }, propertyType: 'house' };
        await expectPrice(page, answered);
        await expect(statusOf(page)).toHaveText(`Price ${money(oracle(answered).cents)}`);
        await expect(continueButton(page)).toBeEnabled();
    });

    test('an earlier price response that arrives after a later one is not shown', async ({ page }) => {
        const watch = await watchPricing(page);
        await openFlow(page, FULL_RULE);
        await radio(page, HOUSE).check();
        await expectPrice(page, { propertyType: 'house' });

        // Request A (one bedroom) is held, request B (two bedrooms) is answered, then A is let go.
        await supersedeAndRelease(page, watch, { units: { bedrooms: 0 }, propertyType: 'house' });
    });

    test("every price request carries the service and the answers, and the answers use only the pricing rule's six keys", async ({ page }) => {
        const watch = await watchPricing(page);

        // The 315.00 path, then a Saturday on step 4.
        await answerFullPath(page);
        await goOn(page, WHEN_WHERE, FULL);
        const saturday = saturdayAfter(await today(page));
        await pickDay(page, saturday);
        await expectPrice(page, { ...FULL, weekend: true });
        expect(normalised(watch.bodies.at(-1).answers), 'the answers of the last request of the 345.00 path').toEqual(answersOfFullPathOn(saturday));

        // The 172.50 path in a flow of its own, then the same Saturday: every one of the six keys is present.
        await page.evaluate(() => sessionStorage.clear());
        await answerHourlyPath(page);
        await goOn(page, WHEN_WHERE, HOURLY);
        await pickDay(page, saturday);
        await expectPrice(page, { ...HOURLY, weekend: true });
        const last = watch.bodies.at(-1);
        expect(Object.keys(last.answers).sort(), 'the hourly path with a date sends all six keys').toEqual(SIX_KEYS);
        expect(last.answers).toEqual({
            units: { bedrooms: 2 },
            option: 'hourly',
            hours: 2.5,
            property_type: 'house',
            date: isoOf(saturday),
            extras: [{ code: 'oven', quantity: 1 }],
        });
        expect(money(oracle({ ...HOURLY, weekend: true }).cents)).toBe('$202.50');

        // Every request of both paths: the body is exactly the service and the answers, the answers use the six keys and well-formed values.
        // One request for each settled change on both paths (the quiet period folds a burst of taps into one).
        expect(watch.bodies.length, 'requests were recorded').toBeGreaterThanOrEqual(8);
        watch.bodies.forEach((body, at) => {
            const which = `request ${at} ${JSON.stringify(body)}`;
            expect(body, `${which} is JSON`).not.toBeNull();
            expect(Object.keys(body).sort(), `${which}: the body keys`).toEqual(['answers', 'service_id']);
            expect(Number(body.service_id), `${which}: the service`).toBe(FULL_RULE);
            for (const key of Object.keys(body.answers)) {
                expect(SIX_KEYS, `${which}: answer key ${key}`).toContain(key);
            }
            const { units, hours, extras, date } = body.answers;
            if (units !== undefined) {
                for (const count of Object.values(units)) expect(Number.isInteger(count) && count > 0, `${which}: unit counts`).toBe(true);
            }
            if (hours !== undefined) expect(typeof hours, `${which}: hours is a number`).toBe('number');
            if (extras !== undefined) {
                for (const extra of extras) {
                    expect(Object.keys(extra).sort(), `${which}: an extra`).toEqual(['code', 'quantity']);
                    expect(Number.isInteger(extra.quantity) && extra.quantity > 0, `${which}: extra quantities`).toBe(true);
                }
            }
            if (date !== undefined) expect(date, `${which}: the date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });
    });

    test('the hours box asks for the hours before a by-the-hour price is shown', async ({ page }) => {
        await openFlow(page, FULL_RULE);
        await radio(page, HOUSE).check();
        await goOn(page, OPTION, { propertyType: 'house' });

        await radio(page, BY_THE_HOUR).check();
        const hours = hoursInput(page);
        await expect(hours).toBeVisible();
        await expect(hours).toHaveAttribute('min', '1');
        await expect(hours).toHaveAttribute('max', '24');
        await expect(hours).toHaveAttribute('step', '0.5');
        // The hours are missing: the message, the invalid mark, no figure, no way on.
        await expect(hours).toHaveAttribute('aria-invalid', 'true');
        await expect(hours).toHaveAccessibleDescription(HOURS_MESSAGE);
        await expect(page.getByText(HOURS_MESSAGE).first()).toBeVisible();
        await expect(statusOf(page), 'the refusal is announced').toHaveText(HOURS_MESSAGE);
        await expectNoFigure(page);
        await expect(continueButton(page)).toBeDisabled();

        // 2 x 45.00 + 25.00 for the house.
        await hours.fill('2');
        await expectPrice(page, { propertyType: 'house', option: 'hourly', hours: 2 });
        await expect(totalOf(page)).toHaveText('$115.00');
        await expect(hours).not.toHaveAttribute('aria-invalid', 'true');
        await expect(continueButton(page)).toBeEnabled();
    });

    test('a failed price request shows a retry and no figure', async ({ page }) => {
        const watch = await watchPricing(page);
        await openFlow(page, FULL_RULE);
        await radio(page, HOUSE).check();
        await expectPrice(page, { propertyType: 'house' });
        await expect(continueButton(page)).toBeEnabled();

        // The request for one bedroom fails in transit.
        const failing = watch.failNext();
        await addOne(page, BEDROOMS).click();
        await reached(failing);
        await expect(page.getByText(FAILED_MESSAGE).first()).toBeVisible();
        await expect(statusOf(page), 'the failure is announced').toHaveText(FAILED_MESSAGE);
        await expect(tryAgainButton(page)).toBeVisible();
        await expectNoFigure(page);
        await expect(continueButton(page)).toBeDisabled();

        // Try again sends the answers on screen, and this time the request goes through.
        const answered = { units: { bedrooms: 1 }, propertyType: 'house' };
        await tryAgainButton(page).click();
        await expectPrice(page, answered);
        await expect(page.getByText(FAILED_MESSAGE)).toHaveCount(0);
        await expect(continueButton(page)).toBeEnabled();

        // A request that the page itself drops because a newer answer replaced it is not a failure.
        await supersedeAndRelease(page, watch, answered);
    });

    test('reloading a step keeps the answers and the price', async ({ page }) => {
        await answerFullPath(page);
        await page.reload();

        await expect(page).toHaveURL(onStep(3));
        await expect(stepHeading(page, INCLUDED)).toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(currentStep(page)).toHaveText(INCLUDED);
        await expect(quantityOf(page, OVEN)).toHaveValue('1');
        await expect(quantityOf(page, FRIDGE)).toHaveValue('2');
        await expectPrice(page, FULL, FIRST_VISIT_MS);

        // The answers of the earlier steps are there too.
        await backButton(page).click();
        await expect(stepHeading(page, OPTION)).toBeVisible();
        await expect(radio(page, DEEP)).toBeChecked();
        await backButton(page).click();
        await expect(stepHeading(page, ABOUT)).toBeVisible();
        await expect(quantityOf(page, BEDROOMS)).toHaveValue('2');
        await expect(quantityOf(page, BATHROOMS)).toHaveValue('1');
        await expect(radio(page, HOUSE)).toBeChecked();
        await expect(radio(page, APARTMENT)).not.toBeChecked();
        await expectPrice(page, FULL);
    });

    test("when the service's choices change between taps the page reloads them and asks the customer to check", async ({ page }) => {
        const watch = await watchPricing(page);
        await openFlow(page, FULL_RULE);
        await radio(page, HOUSE).check();
        await goOn(page, OPTION, { propertyType: 'house' });
        await radio(page, STANDARD).check();
        const before = { propertyType: 'house', option: 'standard' };
        await goOn(page, INCLUDED, before);

        // The next request is refused as the server refuses an extra it does not know.
        const refusal = watch.answerNext(400, { success: false, field: 'extras', message: 'These answers cannot be priced for this service' });
        await addOne(page, OVEN).click();
        await reached(refusal);

        await expect(page.getByText(CHANGED_MESSAGE).first()).toBeVisible();
        // The choices are asked for once with no answers, then the answers are priced again: 80.00 + 0.00 + 25.00 + 35.00.
        const priced = { ...before, extras: { oven: 1 } };
        await expectPrice(page, priced);
        await expect(totalOf(page)).toHaveText('$140.00');
        await expect(quantityOf(page, OVEN)).toHaveValue('1');

        expect(normalised(watch.bodies[refusal.index].answers), 'the refused request carried the oven').toEqual({
            option: 'standard',
            property_type: 'house',
            extras: [{ code: 'oven', quantity: 1 }],
        });
        const after = watch.bodies.slice(refusal.index + 1);
        expect(normalised(after[0].answers), 'the request after the refusal has no answers').toEqual({});
        expect(after.filter((body) => Object.keys(normalised(body.answers)).length === 0), 'the choices are asked for once').toHaveLength(1);
        expect(normalised(after.at(-1).answers), 'the answers that remain are priced').toEqual({
            option: 'standard',
            property_type: 'house',
            extras: [{ code: 'oven', quantity: 1 }],
        });
    });

    test('the details address opens the booking flow at its last step, or the services page when there is no booking in progress', async ({ page }) => {
        // No booking in progress.
        await page.goto('/booking/details', { timeout: FIRST_VISIT_MS });
        await expect(page).toHaveURL((url) => url.pathname === '/services', { timeout: FIRST_VISIT_MS });

        // A service with no rule has one step, and that step is number 4.
        await openFlow(page, NO_RULE);
        await expect(stepHeading(page, WHEN_WHERE)).toBeVisible();
        await expectPrice(page, { service: NO_RULE });
        await page.goto('/booking/details', { timeout: FIRST_VISIT_MS });
        await expect(page).toHaveURL(
            (url) => url.pathname === '/booking/schedule' && url.searchParams.get('service') === String(NO_RULE) && url.searchParams.get('step') === '4',
            { timeout: FIRST_VISIT_MS },
        );
        await expect(stepHeading(page, WHEN_WHERE)).toBeVisible();
    });

    test('confirm shows the price for the same answers and the hold is asked for with exactly those answers', async ({ page }) => {
        const { saturday, monday, watch, holds } = await openConfirm(page);

        // The confirm step shows the price of the same answers.
        await expectPrice(page, FULL_ON_SATURDAY, FIRST_VISIT_MS);
        expect(money(oracle(FULL_ON_SATURDAY).cents), 'the worked figure of the ticket').toBe('$345.00');
        await expect(totalOf(page)).toHaveText('$345.00');

        const pending = await proceedToPayment(page, holds);

        // The hold is asked for with the service and the answers of the last price request, and nothing else. Two dates were chosen, so the
        // answers are the 345.00 path's with the Saturday, the first date, and not the Monday, the last.
        const answers = watch.bodies.at(-1).answers;
        expect(normalised(answers), 'the last price request carries the answers of the 345.00 path with the first date').toEqual(answersOfFullPathOn(saturday));
        for (const hold of holds) {
            expect(hold, 'the hold request has a JSON body').not.toBeNull();
            expect(Object.keys(hold).sort(), 'the hold is asked for with the service and the answers').toEqual(['answers', 'service_id']);
            expect(Number(hold.service_id), 'the service of the hold').toBe(FULL_RULE);
            expect(hold.answers, 'the answers of the hold are the answers of the last price request').toEqual(answers);
            expect(normalised(hold.answers), 'the answers of the hold are the 345.00 path with the first date').toEqual(answersOfFullPathOn(saturday));
        }

        // The booking kept for the payment step holds the answers and no money number.
        expect(pending, 'the confirm step stored the booking').not.toBeNull();
        expect(Object.keys(pending), 'no service price is stored').not.toContain('service_price');
        expect(Object.keys(pending), 'no additional price is stored').not.toContain('additional_price');
        expect(pending.answers, 'the stored answers are the answers of the last price request').toEqual(answers);
        expect(normalised(pending.answers), 'the stored answers are the 345.00 path with the first date').toEqual(answersOfFullPathOn(saturday));
        expect(pending.job_date, 'the stored job dates are the two chosen, the first date first').toBe(`${isoOf(saturday)},${isoOf(monday)}`);
    });

    test('a booking made with that body is a one-time job for the chosen date and address, priced by the pricing rule', async ({ page }) => {
        // The guard and the connection come first, so a database that cannot be reached stops the case before a booking exists.
        const connection = await openDatabase();
        const paymentId = `pi_e2e_eng009_${randomBytes(6).toString('hex')}`;
        try {
            const { saturday, monday, priced, holds } = await openConfirm(page);
            const pending = await proceedToPayment(page, holds);
            expect(pending, 'the confirm step stored the booking').not.toBeNull();
            // The price the page was last served: its lines and quoted minutes are what the booking must record.
            await expect.poll(() => priced.at(-1)?.answer?.success, { message: 'the last price response was recorded' }).toBe(true);
            const served = priced.at(-1)?.answer;

            // With no payment key on this host the booking is recorded as pending.
            const created = await page.request.post('/api/bookings', { data: { ...pending, payment_intent_id: paymentId }, maxRetries: RESET_RETRIES, timeout: 60_000 });
            const text = await created.text();
            expect(created.status(), `the checkout makes the booking: ${text.slice(0, 200)}`).toBe(200);
            expect(JSON.parse(text).success, 'the checkout reports success').toBe(true);

            const stored = await bookingsMadeWith(connection, paymentId);
            expect(stored, 'one booking is stored for the payment id').toHaveLength(1);
            const [row] = stored;
            expect(row.job_date, 'the job is on the first date chosen').toBe(isoOf(saturday));
            expect(row.timing_constraints, 'the booking lists the dates chosen, in the order the request gave them').toBe(`Selected Dates: ${isoOf(saturday)}, ${isoOf(monday)}`);
            expect(row.address_line1, 'the job is at the address entered').toBe(ADDRESS);
            expect(Number(row.service_price), 'the price recorded is the pricing rule\'s').toBe(oracle(FULL_ON_SATURDAY).cents / 100);
            const breakdown = typeof row.price_breakdown === 'string' ? JSON.parse(row.price_breakdown) : row.price_breakdown;
            expect(breakdown, 'the breakdown recorded is the lines the page was served').toEqual(served.lines);
            expect(Number(row.standard_duration_minutes), 'the standard duration recorded is the quoted minutes').toBe(served.quoted_minutes);
        } finally {
            try {
                await deleteBookingsMadeWith(connection, paymentId);
            } finally {
                await connection.end();
            }
        }
    });

    test("the wording beside a booking's amount follows its payment status", async () => {
        const { paymentStatusText } = await import('../src/lib/payment-status-text.js');
        // The words of each status, written out in full.
        const WORDS = {
            authorized: {
                baseLabel: 'Held on your card (base price):',
                notCompletedText: 'Held on your card; charged when the job is done',
                totalLabel: 'Total held',
                totalNote: 'Your card is held and is charged when the job is done',
            },
            paid: {
                baseLabel: 'Paid (base price):',
                notCompletedText: 'Paid',
                totalLabel: 'Total paid',
                totalNote: 'Paid when the job was done',
            },
            pending: {
                baseLabel: 'Payment not confirmed yet (base price):',
                notCompletedText: 'Payment not confirmed yet',
                totalLabel: 'Total',
                totalNote: 'Payment not confirmed yet',
            },
            failed: {
                baseLabel: 'Payment not completed (base price):',
                notCompletedText: 'Payment not completed',
                totalLabel: 'Total',
                totalNote: 'Payment not completed',
            },
            refunded: {
                baseLabel: 'Refunded (base price):',
                notCompletedText: 'Refunded',
                totalLabel: 'Total refunded',
                totalNote: 'Refunded to your card',
            },
        };
        for (const [status, words] of Object.entries(WORDS)) {
            expect(paymentStatusText(status), `the words for ${status}`).toEqual(words);
        }

        // No status, or one that is not listed, gets the authorized words: the receipt shown right after checkout carries none.
        for (const status of [undefined, null, '', 'unlisted', 'constructor']) {
            expect(paymentStatusText(status), `the words for ${JSON.stringify(status) ?? 'no status'}`).toEqual(WORDS.authorized);
        }

        // No row says that a booking is already paid.
        for (const status of Object.keys(WORDS)) {
            for (const [field, text] of Object.entries(paymentStatusText(status))) {
                expect(text.toLowerCase(), `${status}: ${field}`).not.toContain('already paid');
            }
        }
    });

    test('the payment page tells a customer whose session has ended to sign in again', async ({ page }) => {
        const holds = await openRefusedPayment(page, 401, { success: false, message: 'Unauthorized' });

        const refusal = refusalBlock(page, SESSION_ENDED_MESSAGE);
        await expect(refusal).toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(refusal.getByRole('link', { name: 'Log In', exact: true })).toHaveAttribute('href', '/login?redirect=/booking/payment');
        await expectNoCardForm(page);

        // The booking in progress is still in storage, so signing in again can pick it up.
        expect(await page.evaluate(() => sessionStorage.getItem('pendingBooking') !== null), 'the booking waits in storage for the sign-in').toBe(true);
        await expectOneHoldRequest(page, holds);
    });

    test('the payment page shows the reason a hold is refused for the answers and a way back to them', async ({ page }) => {
        const holds = await openRefusedPayment(page, 400, { success: false, message: ANSWERS_REFUSED_SENTENCE, field: 'answers' });

        const refusal = refusalBlock(page, ANSWERS_REFUSED_SENTENCE);
        await expect(refusal).toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(refusal.getByRole('link', { name: 'Change your answers', exact: true })).toHaveAttribute('href', `/booking/schedule?service=${FULL_RULE}&step=1`);
        await expectNoCardForm(page);
        await expectOneHoldRequest(page, holds);
    });

    test('the payment page says when the service is not available for booking', async ({ page }) => {
        const holds = await openRefusedPayment(page, 400, { success: false, message: 'x' });

        const refusal = refusalBlock(page, NOT_AVAILABLE_MESSAGE);
        await expect(refusal).toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(refusal.getByRole('link', { name: 'Browse services', exact: true })).toHaveAttribute('href', '/services');
        // No answer is at fault, so the step offers no way back to the answers.
        await expect(refusal.getByRole('link', { name: 'Change your answers' })).toHaveCount(0);
        await expectNoCardForm(page);
        await expectOneHoldRequest(page, holds);
    });

    test('a stored booking whose step-4 answers are incomplete does not reach the payment step', async ({ page }) => {
        const { holds } = await openConfirm(page);

        // Back on step 4 the customer empties the address; the page keeps what is on screen.
        await page.goBack();
        await expect(page).toHaveURL(onStep(4), { timeout: FIRST_VISIT_MS });
        await expect(stepHeading(page, WHEN_WHERE)).toBeVisible();
        await expect(addressField(page), 'the address the customer entered comes back').toHaveValue(ADDRESS);
        await addressField(page).fill('');
        await expect.poll(() => storedAddress(page), { message: 'the page kept the empty address' }).toBe('');

        // Forward to the confirm step again: step 4 would not let this booking through, so the confirm step sends the customer back to it.
        await page.goForward();
        await expect(page).toHaveURL(onStep(4), { timeout: FIRST_VISIT_MS });
        await expect(stepHeading(page, WHEN_WHERE)).toBeVisible();
        await expect(addressField(page)).toHaveValue('');
        await expect(page.getByRole('button', { name: /Proceed to Payment/ })).toHaveCount(0);
        expect(holds, 'no card hold was asked for').toHaveLength(0);
    });

    test("a booking restarted at another place opens step 4 with that place's address", async ({ page }) => {
        const FIRST_PLACE = { address: '10 First Avenue', city: 'Vancouver' };
        const OTHER_PLACE = { address: '20 Second Avenue', city: 'Burnaby' };
        const TYPED = '30 Typed Street';
        const reopenStep4 = async () => {
            await page.goto(`/booking/schedule?service=${FULL_RULE}&step=4`, { timeout: FIRST_VISIT_MS });
            await expect(stepHeading(page, WHEN_WHERE)).toBeVisible({ timeout: FIRST_VISIT_MS });
        };

        // The service page leaves the place the customer picked in sessionStorage; seeded once, before the first page of the case.
        await page.addInitScript(([address, city]) => {
            if (sessionStorage.getItem('userAddress') === null) {
                sessionStorage.setItem('userAddress', address);
                sessionStorage.setItem('userCity', city);
            }
        }, [FIRST_PLACE.address, FIRST_PLACE.city]);
        await answerFullPath(page);
        await goOn(page, WHEN_WHERE, FULL);
        await expect(addressField(page), 'step 4 opens with the place that was picked').toHaveValue(FIRST_PLACE.address);
        await expect.poll(() => storedAddress(page), { message: 'the page kept that address' }).toBe(FIRST_PLACE.address);

        // The customer starts the booking again from another place: the same booking in progress opens at step 4 with that place.
        await page.evaluate(([address, city]) => {
            sessionStorage.setItem('userAddress', address);
            sessionStorage.setItem('userCity', city);
        }, [OTHER_PLACE.address, OTHER_PLACE.city]);
        await reopenStep4();
        await expect(addressField(page), 'step 4 opens with the place picked since').toHaveValue(OTHER_PLACE.address);
        await expect.poll(() => storedAddress(page), { message: 'the page kept the new address' }).toBe(OTHER_PLACE.address);

        // With the place unchanged, what the customer typed in the field stands.
        await addressField(page).fill(TYPED);
        await expect.poll(() => storedAddress(page), { message: 'the page kept the typed street' }).toBe(TYPED);
        await reopenStep4();
        await expect(addressField(page), 'the street the customer typed stays while the place is the same').toHaveValue(TYPED);
    });
});
