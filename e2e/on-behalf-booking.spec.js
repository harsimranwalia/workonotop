// @ts-check
// A booking an admin makes for a customer who phoned in, and the card the customer adds from a link. The server cases of the design's table are here:
//   AC1  the admin's route records a booking priced by the rule from the answers, holding no payment, with a card link that stores a hash of its token;
//        a price, an account, a payment or a status in the body is ignored;
//   AC2  a job that is normally a quote is priced from the rule by both admin routes and the booking says which picks made it a quote; the price
//        route writes nothing;
//   AC3  the booking joins the account that has its email and is a guest booking otherwise; the activity log records who made it;
//   AC4  a missing or malformed field, a repeating frequency and a body that is not an object are 400s that name the field and write nothing;
//   AC5  the card routes: what the page shows and does not show, one 404 for every link that cannot be used, the 503 of a server with no payment
//        key (the dev stack has none, so nothing is changed by it), the 409 of a link that has its card; and, in this process with a scripted Stripe
//        client over the same dev database, startCardSetup and saveCardSetup of src/lib/booking-card.js: one off-session card SetupIntent and no
//        payment call, the cap of ten tries, a card saved from Stripe's answer and from nothing the caller says, five SetupIntents that are refused,
//        one save for each issue of a link, and a replacement card after a reissue; and (ENG-013 F7, added by ENG-018) an open card entry that a
//        reload is handed again for no try, a failed confirm that is not handed out again, and the reissue that drops an open entry;
//   AC6  the admin routes refuse a customer (403), a provider (403) and a caller with no credential (401), and write nothing.
// The cases of AC5 that need a booking in a given state seed the booking and its link with SQL, so that they do not depend on the admin's route; the
// cases of AC1 to AC4 and AC6 ask the running app. The database is the dev database the way e2e/quote-request.spec.js reaches it (assertDevTarget
// before it connects, assertNoRealPeople once connected). Every booking this file makes carries an e-mail address that starts 'e2e-onbehalf-' or
// has its id remembered, and each case ends by deleting those bookings (their card links and history go with them), the activity log rows about
// them, and the quote requests of that prefix.
// The last describe holds the cases of the screens: the confirm and done screens of the mode, its schedule screen, the customer's card page and the
// admin's card panel. They start on a screen with the booking flow written into the session, so that a case does not walk the steps the other specs walk.
import { createHash } from 'node:crypto';
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { getCredentialHeaders } from './auth/credentials.js';
import { RESET_RETRIES, signInAs } from './support/auth.js';
import { users } from '../database/fixtures/accounts.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';

const { findCardLink, startCardSetup, saveCardSetup, newCardToken, CARD_LINK_ATTEMPTS } = await import('../src/lib/booking-card.js');

// Tracing is off, as in e2e/pricing-rules.spec.js: the cases that ask the app carry a fixture account's session, and a trace records request
// headers and bodies. A failure message names the case and the figures, never a header, a token or a card.
test.use({ trace: 'off' });

const EMAIL_PREFIX = 'e2e-onbehalf-';
const [CUSTOMER1] = users;

// 2026-10-21 is a Wednesday, so the weekend charge is not in any price below. Service 1 (the fixture 'Standard Clean') is 80.00 and 120 minutes;
// two bedrooms (20.00 and 30 minutes each) and one bathroom (15.00 and 20 minutes) make 135.00 and 200 minutes. The commercial property type adds
// nothing and is a quote from 1, so the same units with it are 135.00 and 200 minutes too, once the job is priced past the quote; what tells the
// two apart is the pick that makes the second a quote.
const WEDNESDAY = '2026-10-21';
const TWO_AND_ONE = { units: { bedrooms: 2, bathrooms: 1 } };
const COMMERCIAL = { ...TWO_AND_ONE, property_type: 'commercial' };
const SERVICE_NAME = 'E2E card link service';

const NOT_VALID = { success: false, message: 'This link is not valid.' };
const UNAVAILABLE = 'Card entry is not available right now. Please try again shortly.';
const ALREADY_ON_FILE = 'A card is already on file for this booking.';
const NOT_SAVED = 'This card could not be saved.';

const FIRST_VISIT_MS = 45_000;
const ADMIN_VISIT_MS = 90_000;
const ADDRESS = '1 Probe Street';
const DESCRIPTION = 'A job booked for a customer who phoned in, deleted by the case.';
const SERVICE_1_NAME = 'Fixture Standard Clean';
const COMMERCIAL_LABEL = 'Commercial (placeholder figure)';

// The booking flow of service 1 as the schedule page saves it once its steps are answered, for the cases that start on the confirm screen.
function savedFlow(over = {}) {
    return {
        service_id: 1, service_name: SERVICE_1_NAME, step: 4, selections: { units: { bedrooms: 2, bathrooms: 1 }, propertyType: null, option: null, hours: '', extras: {} },
        whenAndWhere: {
            frequency: 'once', selectedDates: [WEDNESDAY], selectedTimes: { [WEDNESDAY]: ['morning'] }, timingConstraints: '', address: ADDRESS,
            jobDescription: DESCRIPTION, photos: [], parkingAccess: false, elevatorAccess: false, hasPets: false,
        },
        addressFrom: null,
        schedule: { job_date: [WEDNESDAY], job_time_slot: ['Oct 21: Morning'], timing_constraints: '' },
        details: { job_description: DESCRIPTION, instructions: '', parking_access: false, elevator_access: false, has_pets: false, photos: [], address: ADDRESS },
        answers: TWO_AND_ONE,
        ...over,
    };
}

// Writes a booking flow into the page's session before its first load, once: a load after the screen has cleared the flow is not seeded again.
/** @param {import('@playwright/test').Page} page */
async function seedFlow(page, flow) {
    await page.addInitScript((text) => {
        if (sessionStorage.getItem('e2eFlowSeeded')) return;
        sessionStorage.setItem('e2eFlowSeeded', '1');
        sessionStorage.setItem('bookingFlow', text);
    }, JSON.stringify(flow));
}

/** @param {import('@playwright/test').Page} page */
const totalOf = (page) => page.getByRole('region', { name: 'Your price', exact: true }).getByTestId('price-total');

test.describe('On-behalf booking: the screens', () => {
    // Every case starts as a visitor who has not signed in, then signs in as the role it needs.
    test.use({ storageState: { cookies: [], origins: [] }, timezoneId: 'America/Vancouver' });

    // Mutant that turns this case red: the button posts to the customer's route, stays on while the request runs, sends a form with a field missing, shows no
    // link or one the server did not issue, shows the typed e-mail wrongly, or leaves the flow in the session.
    test('an admin on the confirm screen creates the booking, is shown the link once, and the flow is cleared', async ({ page, baseURL }) => {
        test.setTimeout(150_000);
        const mine = emailOf('screen');
        await signInAs(page, 'admin');
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await seedFlow(page, savedFlow({ onBehalf: true }));
        let posts = 0;
        await page.route('**/api/admin/bookings', async (route) => {
            if (route.request().method() !== 'POST') return route.continue();
            posts += 1;
            await pause(1200);
            return route.continue();
        });
        await page.goto('/booking/confirm', { timeout: FIRST_VISIT_MS });
        await expect(page.getByRole('heading', { name: /Create the booking/, level: 2 })).toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(page.getByText('Booking for a customer', { exact: true })).toBeVisible();
        await expect(page.getByRole('checkbox'), 'no terms box').toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Proceed to Payment' }), 'no payment step').toHaveCount(0);
        await expect(page.getByRole('link', { name: 'Sign Up' }), 'no sign-up prompt').toHaveCount(0);

        const create = page.getByRole('button', { name: /^Creat(e|ing) booking/ });
        await expect(totalOf(page), 'the price of the answers').toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(create).toBeEnabled();
        await create.click();
        await expect(page.getByText("Enter the customer's first name.")).toBeVisible();
        await expect(page.getByLabel('First name')).toBeFocused();
        expect(posts, 'a form with fields missing sends nothing').toBe(0);

        await page.getByLabel('First name').fill('Screen');
        await page.getByLabel('Last name').fill('Caller');
        await page.getByLabel('Email').fill(mine);
        await expect(page.getByText('Email on the booking:'), 'the typed e-mail is read back above the button').toContainText(mine);
        await create.click();
        await expect(create, 'the button is off while the request runs').toBeDisabled();
        await expect(create).toHaveText('Creating booking...');
        await page.getByLabel('Last name').press('Enter');

        const done = page.getByRole('heading', { name: /^Booking .+ created$/, level: 2 });
        await expect(done).toBeVisible({ timeout: 30_000 });
        await expect(done, 'focus moves to the done heading').toBeFocused();
        expect(posts, 'one request however many presses').toBe(1);
        await expect(page.getByText('No account: booked as a guest')).toBeVisible();
        const shown = await page.getByLabel('Link for the customer to add their card').inputValue();
        expect(shown.startsWith(`${baseURL}/card/`), 'the link is on this site').toBe(true);
        const token = tokenOf(new URL(shown).pathname);
        expect(token, 'a 256-bit token').toMatch(/^[A-Za-z0-9_-]{43}$/);
        await expect(page.getByText('This link is shown once; to get another, open the booking and choose New link.')).toBeVisible();
        await page.getByRole('button', { name: 'Copy link' }).click();
        await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
        expect(await page.evaluate(() => navigator.clipboard.readText()), 'the link is on the clipboard').toBe(shown);

        const [made] = await rows('SELECT id, payment_intent_id, customer_first_name FROM bookings WHERE customer_email = ?', [mine]);
        expect(made && made.customer_first_name, 'the booking is made').toBe('Screen');
        expect(made.payment_intent_id, 'no payment is held').toBeNull();
        const [stored] = await rows('SELECT token_hash FROM booking_card_links WHERE booking_id = ?', [made.id]);
        expect(stored.token_hash, 'the stored hash is the hash of the link shown').toBe(sha256(token));
        await expect(page.getByRole('link', { name: 'Open the booking' })).toHaveAttribute('href', `/admin/bookings/${made.id}`);
        expect(await page.evaluate(() => sessionStorage.getItem('bookingFlow')), 'the flow is cleared').toBeNull();

        await page.reload({ waitUntil: 'commit' });
        await expect(page, 'a reload does not show the link again').toHaveURL(/\/services/, { timeout: FIRST_VISIT_MS });
    });

    // Mutant that turns this case red: the mode is trusted from the flag alone, so a customer's session shows the admin's form, or the refused flag stays in the session.
    test('a flag in a customer\'s session turns the mode off and shows no booking form for a customer', async ({ page }) => {
        test.setTimeout(120_000);
        await signInAs(page, 'customer1');
        await seedFlow(page, savedFlow({ onBehalf: true }));
        const asked = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/admin/me', { timeout: FIRST_VISIT_MS });
        await page.goto('/booking/confirm', { timeout: FIRST_VISIT_MS });
        expect((await asked).ok(), 'the admin check refuses a customer').toBe(false);
        await expect.poll(() => page.evaluate(() => (JSON.parse(sessionStorage.getItem('bookingFlow') || 'null') || {}).onBehalf), { timeout: 15_000 }).toBeUndefined();
        await expect(page.getByRole('button', { name: /^Creat(e|ing) booking/ }), 'no admin form for a customer').toHaveCount(0);
        await expect(page.getByLabel('First name'), 'no contact form for a customer').toHaveCount(0);
    });

    // Mutant that turns this case red: the schedule screen prices from the customer's route (a quote and its form show), the note is missing, the banner is missing, or the repeat pick shows.
    test('the schedule screen in the mode prices a job that is normally a quote, says so, and has no repeat pick', async ({ page }) => {
        test.setTimeout(150_000);
        await signInAs(page, 'admin');
        await seedFlow(page, { service_id: 1, service_name: SERVICE_1_NAME, onBehalf: true });
        const posted = [];
        page.on('request', (request) => {
            const path = new URL(request.url()).pathname;
            if (request.method() === 'POST' && /^\/api\/(admin\/)?pricing$/.test(path)) posted.push(path);
        });
        await page.goto('/booking/schedule?service=1&step=1', { timeout: FIRST_VISIT_MS });
        await expect(page.getByText('Booking for a customer', { exact: true })).toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(totalOf(page)).toBeVisible({ timeout: FIRST_VISIT_MS });
        await page.getByRole('group', { name: 'Type of property', exact: true }).getByRole('radio', { name: COMMERCIAL_LABEL }).check();
        await expect(page.getByText(`Normally a quote: ${COMMERCIAL_LABEL}.`)).toBeVisible();
        await expect(totalOf(page), 'the job is priced from the rule').toBeVisible();
        await expect(page.getByRole('region', { name: 'Ask for a quote', exact: true }), 'no quote form').toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
        expect(posted.length > 0 && posted.every((path) => path === '/api/admin/pricing'), `the prices are asked of the admin route (${posted.join(', ')})`).toBe(true);

        await page.goto('/booking/schedule?service=1&step=4', { timeout: FIRST_VISIT_MS });
        await expect(page.getByText('Booking for a customer', { exact: true })).toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(page.getByText('How often?'), 'a booking made on a customer\'s behalf does not repeat').toHaveCount(0);
    });

    // Mutant that turns this case red: the sidebar has no link, the list does not offer the services, a choice does not open the mode, or the mode opens at another service.
    test('the admin\'s entry lists the services, and choosing one opens the booking steps in the mode at that service', async ({ page }) => {
        test.setTimeout(150_000);
        await signInAs(page, 'admin');
        await page.goto('/admin/book', { timeout: ADMIN_VISIT_MS });
        await expect(page.getByRole('heading', { name: 'Book for a customer', level: 2 })).toBeVisible({ timeout: ADMIN_VISIT_MS });
        await expect(page.getByRole('link', { name: 'Book for a customer' }), 'the sidebar leads here').toBeVisible();
        const services = page.getByRole('list', { name: 'Services' });
        await expect(services.getByRole('button', { name: SERVICE_1_NAME })).toBeVisible();
        await services.getByRole('button', { name: SERVICE_1_NAME }).click();
        await expect(page).toHaveURL(/\/booking\/schedule\?service=1&step=1$/, { timeout: FIRST_VISIT_MS });
        await expect(page.getByText('Booking for a customer', { exact: true })).toBeVisible({ timeout: FIRST_VISIT_MS });
        const flow = await page.evaluate(() => JSON.parse(sessionStorage.getItem('bookingFlow') || 'null'));
        expect({ service: flow && flow.service_id, mode: flow && flow.onBehalf }, 'the session holds the mode at the service').toEqual({ service: 1, mode: true });
    });

    // Mutant that turns this case red: the panel shows for a booking with no link, hides the card or the state, shows the new link more than once or in the address bar,
    // leaves the first link working, or makes the new link without asking.
    test('the card panel shows the card and the link\'s state, "New link" makes a link that is shown once and ends the current link, and a booking with no link has no panel', async ({ page, request, baseURL }) => {
        test.setTimeout(180_000);
        const as = await headersFor(baseURL);
        const { answer } = await book(request, as.admin);
        const firstToken = tokenOf(answer.card_link.path);
        await signInAs(page, 'admin');
        await page.goto(`/admin/bookings/${answer.booking_id}`, { timeout: ADMIN_VISIT_MS });
        const panel = page.getByRole('region', { name: 'Card on file' });
        await expect(panel).toBeVisible({ timeout: ADMIN_VISIT_MS });
        await expect(panel.getByTestId('card-link-card')).toHaveText('No card yet');
        await expect(panel.getByTestId('card-link-state')).toContainText('Link active until');
        await expect(panel.getByLabel('Card link'), 'no address is shown before one is made').toHaveCount(0);

        await panel.getByRole('button', { name: 'New link' }).click();
        await expect(panel.getByText('This ends the current link. Make a new one?')).toBeVisible();
        expect((await call(request, 'GET', `/api/card/${firstToken}`, {}, undefined)).status(), 'the link stands until the choice is made').toBe(200);
        await panel.getByRole('button', { name: 'Make new link' }).click();
        const address = panel.getByLabel('Card link');
        await expect(address).toBeVisible();
        await expect(address, 'focus moves to the new link').toBeFocused();
        const shown = await address.inputValue();
        expect(shown.startsWith(`${baseURL}/card/`), 'the link is on this site').toBe(true);
        const newToken = tokenOf(new URL(shown).pathname);
        expect(newToken, 'a new token').not.toBe(firstToken);
        await expect(panel.getByText('This link is shown once; to get another, choose New link.')).toBeVisible();
        expect(page.url(), 'the token is not in the address bar').not.toContain(newToken);
        expect((await call(request, 'GET', `/api/card/${firstToken}`, {}, undefined)).status(), 'the first link is a 404 at once').toBe(404);
        expect((await call(request, 'GET', `/api/card/${newToken}`, {}, undefined)).status(), 'the new link works').toBe(200);
        const [stored] = await rows('SELECT token_hash FROM booking_card_links WHERE booking_id = ?', [answer.booking_id]);
        expect(stored.token_hash, 'the stored hash is the new token\'s').toBe(sha256(newToken));

        await (await db()).query(
            "UPDATE booking_card_links SET payment_method_id = 'pm_e2e_panel', stripe_customer_id = 'cus_e2e_panel', card_brand = 'visa', card_last4 = '4242', used_at = NOW() WHERE booking_id = ?",
            [answer.booking_id],
        );
        await page.reload();
        await expect(panel.getByTestId('card-link-card')).toHaveText('Visa •••• 4242 on file', { timeout: ADMIN_VISIT_MS });
        await expect(panel.getByTestId('card-link-state')).toHaveText('Card added through the link');
        await expect(panel.getByLabel('Card link'), 'a reload does not show the link again').toHaveCount(0);

        const bare = await seedBooking();
        await page.goto(`/admin/bookings/${bare}`, { timeout: ADMIN_VISIT_MS });
        await expect(page.getByRole('heading', { name: 'Booking Details', level: 1 })).toBeVisible({ timeout: ADMIN_VISIT_MS });
        await expect(page.getByTestId('card-link-panel'), 'a booking that has no link has no panel').toHaveCount(0);
    });

    // Mutant that turns this case red: a request has no "Book this", the mode opens without the request's answers, its contact or its id, the booking is not made against the
    // request, or a request that has its booking offers "Book this" again and shows no link to it.
    test('a quote request has "Book this", which opens the mode with its answers and contact, and the booking made from it shows on the row', async ({ page }) => {
        test.setTimeout(240_000);
        const mine = emailOf('quote');
        const [made] = /** @type {any} */ (await (await db()).query(
            `INSERT INTO quote_requests (service_id, service_name, customer_name, customer_email, customer_phone, address, message, answers, picks)
             VALUES (1, ?, 'Quote Caller', ?, '+14035550123', '1 Probe Street', 'A request for the screen cases, deleted by the case.', ?, '[]')`,
            [SERVICE_1_NAME, mine, JSON.stringify(COMMERCIAL)],
        ));
        const requestId = Number(made.insertId);
        await signInAs(page, 'admin');
        await page.goto('/admin/jobs', { timeout: ADMIN_VISIT_MS });
        const row = page.getByTestId('quote-request-row').filter({ hasText: mine });
        await expect(row).toBeVisible({ timeout: ADMIN_VISIT_MS });
        await row.getByRole('button', { name: 'Book this' }).click();
        await expect(page).toHaveURL(/\/booking\/schedule\?service=1&step=1$/, { timeout: FIRST_VISIT_MS });
        await expect(page.getByText('Booking for a customer', { exact: true })).toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(page.getByRole('group', { name: 'Type of property', exact: true }).getByRole('radio', { name: COMMERCIAL_LABEL }), 'the request\'s answers are the selections').toBeChecked();
        const opened = await page.evaluate(() => JSON.parse(sessionStorage.getItem('bookingFlow') || 'null'));
        expect({ id: opened.quote_request_id, mode: opened.onBehalf, contact: opened.contact }, 'the session carries the request').toEqual({
            id: requestId, mode: true, contact: { first_name: 'Quote', last_name: 'Caller', email: mine, phone: '+14035550123' },
        });

        // The steps in between are walked by the other cases; the flow they leave is written here, on top of what "Book this" opened.
        const answered = savedFlow({ answers: COMMERCIAL });
        // Seeded ahead of the confirm screen's first script: the schedule screen that is open saves its own flow, with its own empty dates, over anything written into its session.
        await seedFlow(page, { ...opened, whenAndWhere: answered.whenAndWhere, schedule: answered.schedule, details: answered.details, answers: answered.answers });
        await page.goto('/booking/confirm', { timeout: FIRST_VISIT_MS });
        await expect(page.getByLabel('First name')).toHaveValue('Quote', { timeout: FIRST_VISIT_MS });
        await expect(page.getByLabel('Last name')).toHaveValue('Caller');
        await expect(page.getByLabel('Email')).toHaveValue(mine);
        const create = page.getByRole('button', { name: /^Creat(e|ing) booking/ });
        await expect(totalOf(page)).toBeVisible({ timeout: FIRST_VISIT_MS });
        await create.click();
        await expect(page.getByRole('heading', { name: /^Booking .+ created$/, level: 2 })).toBeVisible({ timeout: 30_000 });
        const [booking] = await rows('SELECT id, booking_number FROM bookings WHERE customer_email = ?', [mine]);
        const [request] = await rows('SELECT booking_id FROM quote_requests WHERE id = ?', [requestId]);
        expect(request.booking_id, 'the request is answered by the booking').toBe(booking.id);

        await page.goto('/admin/jobs', { timeout: ADMIN_VISIT_MS });
        await expect(row.getByRole('link', { name: `Booked #${booking.booking_number}` })).toHaveAttribute('href', `/admin/bookings/${booking.id}`, { timeout: ADMIN_VISIT_MS });
        await expect(row.getByRole('button', { name: 'Book this' }), 'a request that has its booking is not offered again').toHaveCount(0);
    });

    // Mutant that turns this case red: a link that is not valid shows a form or a reason, the page can be indexed, it sends a referrer, or it shows the site's navigation.
    test('the card page of a link that is not valid says so and nothing else, asks not to be indexed, and sends no referrer', async ({ page }) => {
        test.setTimeout(120_000);
        await page.goto(`/card/${'a'.repeat(43)}`, { timeout: FIRST_VISIT_MS });
        const heading = page.getByRole('heading', { name: 'This link cannot be used', level: 2 });
        await expect(heading).toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(heading, 'focus moves to what happened').toBeFocused();
        await expect(page.getByText("This link isn't valid or has expired. Ask WorkOnTap for a new one.")).toBeVisible();
        await expect(page.getByText('Save card'), 'no card form').toHaveCount(0);
        await expect(page.getByRole('navigation'), 'no site navigation').toHaveCount(0);
        const robots = await page.locator('meta[name="robots"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('content')));
        expect(robots.length > 0 && robots.every((content) => /noindex/.test(String(content))), `every robots tag says noindex (${robots.join(' | ')})`).toBe(true);
        await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
    });

    // Mutant that turns this case red: the page asks for a card entry with no payment key (a try is spent), shows a form, leaves a bank's return query in the address, or leaves focus behind.
    test('with no payment key the card page of a valid link says card entry is not available, spends no try, and removes a bank\'s return query from the address', async ({ page }) => {
        test.setTimeout(120_000);
        const { id, token } = await seeded();
        await page.goto(`/card/${token}?setup_intent=seti_e2e_probe&setup_intent_client_secret=seti_e2e_probe_secret_x&redirect_status=succeeded`, { timeout: FIRST_VISIT_MS });
        const heading = page.getByRole('heading', { name: 'Card entry is not available', level: 2 });
        await expect(heading).toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(heading, 'focus moves to what happened').toBeFocused();
        await expect(page.getByText(UNAVAILABLE)).toBeVisible();
        await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
        await expect(page.getByText('Save card'), 'no card form').toHaveCount(0);
        expect(new URL(page.url()).search, 'the return query is cleared from the address').toBe('');
        expect(Number((await linkRow(id)).attempts), 'the link has no try spent').toBe(0);
    });

    // Mutant that turns this case red: the page of a link that has its card offers a second card, omits the card or the job, or shows who the customer is.
    test('the card page of a link that has its card shows the job, the card and the price, and nothing that names the customer', async ({ page }) => {
        test.setTimeout(120_000);
        const { token } = await seeded({ card: { brand: 'visa', last4: '4242' } });
        await page.goto(`/card/${token}`, { timeout: FIRST_VISIT_MS });
        const heading = page.getByRole('heading', { name: 'A card is already on file', level: 2 });
        await expect(heading).toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(heading, 'focus moves to what happened').toBeFocused();
        await expect(page.getByText('Visa •••• 4242 is on file for this booking.')).toBeVisible();
        await expect(page.getByText('Save card'), 'no second card form').toHaveCount(0);
        const shown = await page.locator('main').innerText();
        for (const part of [SERVICE_NAME, 'October 21, 2026', '09:00', '$135.00']) expect(shown, `the page shows ${part}`).toContain(part);
        for (const part of ['Behalf', '4035550123', 'Probe Street', '@workontap.test']) expect(shown, `the page does not show ${part}`).not.toContain(part);
    });
});

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

async function rows(sql, params) {
    const [found] = await (await db()).query(sql, params);
    return /** @type {any[]} */ (found);
}

// The number a one-column count query gives.
async function count(sql, params) {
    const [row] = await rows(sql, params);
    return Number(row.n);
}

// The database function src/lib/booking-card.js is given, as the routes are given theirs: the rows of a SELECT, the header of a write.
async function execute(sql, params) {
    const [found] = await (await db()).query(sql, params);
    return found;
}

// The bookings this file makes through the app, whose e-mail address is not always of this file's prefix (a booking for a fixture customer carries
// that customer's address).
const madeIds = new Set();

// Deletes everything this file made, after each case and before the first, so that a run that died halfway leaves nothing behind. The card links
// and the status history of a booking are deleted with it; the activity log has no key to a booking and is deleted by the booking's id.
async function clearRows() {
    const open = await db();
    const [byEmail] = await open.query('SELECT id FROM bookings WHERE customer_email LIKE ?', [`${EMAIL_PREFIX}%`]);
    const ids = [...new Set([...madeIds, .../** @type {any[]} */ (byEmail).map((row) => row.id)])];
    madeIds.clear();
    if (ids.length > 0) {
        await open.query("DELETE FROM activity_logs WHERE entity_type = 'booking' AND entity_id IN (?)", [ids]);
        await open.query('DELETE FROM booking_card_links WHERE booking_id IN (?)', [ids]);
        await open.query('DELETE FROM bookings WHERE id IN (?)', [ids]);
    }
    await open.query('DELETE FROM quote_requests WHERE customer_email LIKE ?', [`${EMAIL_PREFIX}%`]);
}

test.beforeAll(clearRows);
test.afterEach(clearRows);
test.afterAll(async () => {
    if (!connection) return;
    try {
        await connection.end();
    } finally {
        connection = null;
    }
});

const tag = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailOf = (what) => `${EMAIL_PREFIX}${what}-${tag()}@workontap.test`;
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A JSON column as the driver hands it over: parsed, or as the text when the server keeps it.
const parsed = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

// The credentials of the cases that ask the app: the three roles, each by its Bearer.
async function headersFor(baseURL) {
    const styles = await getCredentialHeaders(String(baseURL));
    return { admin: styles['admin-bearer'], customer: styles['customer-bearer'], provider: styles['provider-bearer'], anonymous: {} };
}

// One request to the app, with the retries and the timeout the other specs give a request that may meet a database reset.
function call(request, method, url, headers, data) {
    return request.fetch(url, { method, headers, data, maxRetries: RESET_RETRIES, timeout: 60_000 });
}

// The body of a booking an admin makes for a customer who phoned in; `fields` replaces or adds to it (undefined leaves a field out).
function behalfBody(fields = {}) {
    return {
        service_id: 1, first_name: 'E2E', last_name: 'Behalf', email: emailOf('caller'), phone: '+14035550123',
        job_date: WEDNESDAY, job_time_slot: '09:00', job_description: 'A job booked for a customer who phoned in, deleted by the case.',
        address_line1: '1 Probe Street', city: 'Calgary', answers: TWO_AND_ONE,
        ...fields,
    };
}

// Asks the admin's route to book; the booking it makes is remembered so that the case deletes it whatever the case asserts.
async function book(request, headers, fields = {}) {
    const response = await call(request, 'POST', '/api/admin/bookings', headers, behalfBody(fields));
    const answer = await response.json();
    if (response.status() === 201 && Number.isInteger(answer.booking_id)) madeIds.add(answer.booking_id);
    return { response, answer };
}

// The token of a card link path: '/card/<token>'.
const tokenOf = (path) => String(path).replace(/^\/card\//, '');

// A booking written with SQL, in the state the card cases need, with a customer address of this file's prefix.
async function seedBooking(status = 'pending') {
    const [made] = /** @type {any} */ (await (await db()).query(
        `INSERT INTO bookings (booking_number, service_id, service_name, service_price, customer_first_name, customer_last_name, customer_email, customer_phone,
          job_date, job_time_slot, job_description, address_line1, city, status, payment_status, standard_duration_minutes)
         VALUES (?, 1, ?, 135.00, 'E2E', 'Behalf', ?, '+14035550123', ?, '09:00', 'A booking for the card link cases, deleted by the case.', '1 Probe Street', 'Calgary', ?, 'pending', 200)`,
        [`E2EOB${tag()}`, SERVICE_NAME, emailOf('seed'), WEDNESDAY, status],
    ));
    return /** @type {number} */ (made.insertId);
}

// A card link for a booking, written with SQL. The token is made as the app makes one and only its hash is stored. `customer` is the Stripe customer
// the link already has; `expired` puts the expiry a minute in the past; `card` makes it a link that has taken its card; `setup` is the id of the open
// card entry a page was already handed (a link that has taken its card keeps the id of the SetupIntent that saved it instead).
async function seedLink(bookingId, { customer = null, attempts = 0, expired = false, card = null, setup = null } = {}) {
    const { token, hash } = newCardToken();
    const [made] = /** @type {any} */ (await (await db()).query(
        `INSERT INTO booking_card_links (booking_id, token_hash, expires_at, attempts, stripe_customer_id, setup_intent_id, payment_method_id, card_brand, card_last4, used_at)
         VALUES (?, ?, ${expired ? 'DATE_SUB(NOW(), INTERVAL 1 MINUTE)' : 'DATE_ADD(NOW(), INTERVAL 14 DAY)'}, ?, ?, ?, ?, ?, ?, ${card ? 'NOW()' : 'NULL'})`,
        [bookingId, hash, attempts, customer, card ? 'seti_e2e_seed' : setup, card ? 'pm_e2e_seed' : null, card ? card.brand : null, card ? card.last4 : null],
    ));
    return { id: /** @type {number} */ (made.insertId), token };
}

// A booking and a link on it, and the link as the routes read it (with its state).
async function seeded(options = {}, status = 'pending') {
    const bookingId = await seedBooking(status);
    const { id, token } = await seedLink(bookingId, options);
    const link = await findCardLink(execute, token);
    return { bookingId, id, token, link };
}

// What a card link row holds, for the cases that show that a call changed nothing or something.
async function linkRow(id) {
    const [row] = await rows(
        'SELECT attempts, used_at, stripe_customer_id, setup_intent_id, payment_method_id, card_brand, card_last4, token_hash FROM booking_card_links WHERE id = ?',
        [id],
    );
    expect(row, `card link ${id} is stored`).toBeDefined();
    return row;
}

// A scripted Stripe client: each method answers per `script` (a value, an error, or a function of the call) and every call is recorded as
// [method, ...arguments]. The payment intents namespace is present so that a call to it is recorded and counted; one that is not scripted throws.
function scriptedStripe(script = {}) {
    const calls = [];
    const wrap = (method) => async (...args) => {
        calls.push([method, ...args]);
        const step = script[method];
        if (step === undefined) throw new Error(`scripted Stripe: no answer scripted for ${method}`);
        if (step instanceof Error) throw step;
        return typeof step === 'function' ? step(...args) : step;
    };
    return {
        calls,
        customers: { create: wrap('customers.create') },
        setupIntents: { create: wrap('setupIntents.create'), retrieve: wrap('setupIntents.retrieve') },
        paymentMethods: { retrieve: wrap('paymentMethods.retrieve') },
        paymentIntents: { create: wrap('paymentIntents.create'), retrieve: wrap('paymentIntents.retrieve'), confirm: wrap('paymentIntents.confirm'), capture: wrap('paymentIntents.capture') },
    };
}

const paymentCalls = (stripe) => stripe.calls.filter(([method]) => method.startsWith('paymentIntents.'));
const callsTo = (stripe, method) => stripe.calls.filter(([name]) => name === method);

// The SetupIntent Stripe gives for a card that was saved from this link's page: the payment method arrives expanded, as the retrieve asks for.
function succeededIntent(linkId, over = {}) {
    return {
        id: 'seti_e2e_1', status: 'succeeded', customer: 'cus_e2e_1', usage: 'off_session', metadata: { card_link_id: String(linkId) },
        payment_method: { id: 'pm_e2e_1', type: 'card', customer: 'cus_e2e_1', card: { brand: 'visa', last4: '4242' } },
        ...over,
    };
}

// The SetupIntent Stripe gives for a card entry that is still open: waiting for a card, no failed confirm on it, on the link's customer, with its secret.
function openIntent(linkId, over = {}) {
    return {
        id: 'seti_e2e_1', status: 'requires_payment_method', customer: 'cus_e2e_1', usage: 'off_session', metadata: { card_link_id: String(linkId) },
        client_secret: 'seti_e2e_1_secret_abc', last_setup_error: null,
        ...over,
    };
}

// The activity log rows about a booking. The route writes its row without waiting for it, so the read tries for a few seconds.
async function activityOf(bookingId, action) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const found = await rows("SELECT actor_type, details FROM activity_logs WHERE entity_type = 'booking' AND entity_id = ? AND action = ?", [bookingId, action]);
        if (found.length > 0) return found;
        await pause(250);
    }
    return [];
}

// What the tables hold that a refused request must leave alone.
async function written() {
    return {
        bookings: await count('SELECT COUNT(*) AS n FROM bookings'),
        links: await count('SELECT COUNT(*) AS n FROM booking_card_links'),
        history: await count('SELECT COUNT(*) AS n FROM booking_status_history'),
    };
}

test.describe('On-behalf booking and the card link', () => {
    test('an admin books for a customer who phoned in: the price is the rule price, no payment is held, and a link that stores only a hash is made', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        const { response, answer } = await book(request, as.admin);
        expect(response.status(), 'the admin books for the customer').toBe(201);
        expect(response.headers()['cache-control'], 'the answer carries a link and must not be cached').toMatch(/no-store/);
        expect(answer.success).toBe(true);
        expect(Number(answer.service_price), 'the price the answer states').toBe(135);
        expect(answer.quoted_minutes, 'the quoted minutes the answer states').toBe(200);
        expect(answer.account_matched, 'a new address has no account').toBe(false);
        expect(answer.card_link.path, 'the link path').toMatch(/^\/card\/[A-Za-z0-9_-]{43}$/);

        const [stored] = await rows(
            `SELECT booking_number, user_id, service_price, standard_duration_minutes, price_breakdown, status, payment_status, payment_intent_id, authorized_amount,
              commission_percent, provider_amount FROM bookings WHERE id = ?`,
            [answer.booking_id],
        );
        expect(stored, `booking ${answer.booking_id} is stored`).toBeDefined();
        expect(stored.booking_number, 'the booking number the answer states').toBe(answer.booking_number);
        expect(Number(stored.service_price), 'the price the booking records').toBe(135);
        expect(Number(stored.standard_duration_minutes), 'the quoted minutes the booking records').toBe(200);
        expect(parsed(stored.price_breakdown).length, 'the lines the price is made of').toBeGreaterThan(0);
        expect(stored.status, 'the booking waits for the admin to confirm it').toBe('pending');
        expect(stored.payment_status, 'no payment is held').toBe('pending');
        expect(stored.payment_intent_id, 'no payment intent is bound').toBeNull();
        expect(stored.authorized_amount, 'no amount is authorized').toBeNull();
        expect(stored.user_id, 'a guest booking belongs to no account').toBeNull();
        expect(stored.commission_percent, 'the commission is set when a provider takes the job').toBeNull();
        expect(stored.provider_amount, 'the provider amount is set when a provider takes the job').toBeNull();

        const links = await rows(
            `SELECT token_hash, attempts, used_at, issued_by, stripe_customer_id, payment_method_id, TIMESTAMPDIFF(HOUR, NOW(), expires_at) AS hours_left
             FROM booking_card_links WHERE booking_id = ?`,
            [answer.booking_id],
        );
        expect(links.length, 'one link is made for the booking').toBe(1);
        expect(links[0].token_hash, 'the table holds the hash of the token, not the token').toBe(sha256(tokenOf(answer.card_link.path)));
        expect(Number(links[0].attempts), 'no card entry has been started').toBe(0);
        expect(links[0].used_at, 'no card is on file').toBeNull();
        expect(links[0].payment_method_id, 'no payment method is on file').toBeNull();
        expect(Number(links[0].hours_left), 'the link lives about fourteen days').toBeGreaterThanOrEqual(14 * 24 - 1);
        expect(Number(links[0].hours_left), 'the link lives about fourteen days').toBeLessThanOrEqual(14 * 24);
        const admins = (await rows("SELECT id FROM users WHERE role = 'admin'")).map((admin) => admin.id);
        expect(admins, 'the link records which admin made it').toContain(links[0].issued_by);

        const history = await rows('SELECT status, notes FROM booking_status_history WHERE booking_id = ?', [answer.booking_id]);
        expect(history.map((entry) => entry.status), 'the history starts at pending').toEqual(['pending']);
        expect(history[0].notes, "the history says the booking was made on the customer's behalf").toMatch(/on the customer's behalf/);
    });

    test('a price, an account, a payment or a status in the body of an admin booking is ignored', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        const { response, answer } = await book(request, as.admin, {
            service_price: 1, additional_price: 1, price: 1, total: 1, amount: 1, quoted_minutes: 1, standard_duration_minutes: 1, user_id: 1,
            payment_intent_id: 'pi_e2e_injected', authorized_amount: 1, commission_percent: 99, provider_amount: 99, status: 'confirmed', payment_status: 'paid',
        });
        expect(response.status(), 'the admin books with a body that carries figures it may not give').toBe(201);
        expect(Number(answer.service_price), 'the price the answer states').toBe(135);
        const [stored] = await rows(
            'SELECT user_id, service_price, standard_duration_minutes, status, payment_status, payment_intent_id, authorized_amount, commission_percent, provider_amount FROM bookings WHERE id = ?',
            [answer.booking_id],
        );
        expect(Number(stored.service_price), 'the price is the rule price').toBe(135);
        expect(Number(stored.standard_duration_minutes), 'the minutes are the rule minutes').toBe(200);
        expect(stored.user_id, 'the account is the one the address matches, and none does').toBeNull();
        expect(stored.status, 'the status is the server status').toBe('pending');
        expect(stored.payment_status, 'the payment status is the server status').toBe('pending');
        expect(stored.payment_intent_id, 'no payment intent can be given').toBeNull();
        expect(stored.authorized_amount, 'no authorized amount can be given').toBeNull();
        expect(stored.commission_percent, 'no commission can be given').toBeNull();
        expect(stored.provider_amount, 'no provider amount can be given').toBeNull();
    });

    test('a job that is normally a quote is priced from the rule by the admin booking, and the booking records the picks that made it a quote', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        const { response, answer } = await book(request, as.admin, { answers: COMMERCIAL });
        expect(response.status(), 'the admin books a job that the public checkout would send to a quote').toBe(201);
        expect(Number(answer.service_price), 'the price is the rule price of the service rows').toBe(135);
        expect(answer.quoted_minutes, 'the minutes are the rule minutes').toBe(200);
        const [stored] = await rows('SELECT service_price FROM bookings WHERE id = ?', [answer.booking_id]);
        expect(Number(stored.service_price), 'the booking records the rule price').toBe(135);
        const [note] = await rows('SELECT notes FROM booking_status_history WHERE booking_id = ?', [answer.booking_id]);
        expect(note.notes, 'the history names the picks that made it a quote').toMatch(/past a quote verdict/);
        const logged = await activityOf(answer.booking_id, 'BOOKING_CREATED');
        expect(logged.length, 'the activity log records the booking').toBe(1);
        const details = parsed(logged[0].details);
        expect(details.on_behalf, 'the activity log says it was made on a customer behalf').toBe(true);
        expect(details.quote_flags.map((flag) => flag.code), 'the activity log holds the picks that made it a quote').toEqual(['commercial']);
    });

    test('the admin pricing route prices a job past a quote, names the picks that make it a quote, and writes nothing', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        const before = await written();

        const plain = await call(request, 'POST', '/api/admin/pricing', as.admin, { service_id: 1, answers: { ...TWO_AND_ONE, date: WEDNESDAY } });
        expect(plain.status(), 'the admin prices a job that can be priced').toBe(200);
        const plainAnswer = await plain.json();
        expect(plainAnswer.success).toBe(true);
        expect(Number(plainAnswer.price), 'the price').toBe(135);
        expect(plainAnswer.quoted_minutes, 'the quoted minutes').toBe(200);
        expect(plainAnswer.quote_flags, 'no pick makes it a quote').toEqual([]);

        const quote = await call(request, 'POST', '/api/admin/pricing', as.admin, { service_id: 1, answers: { ...COMMERCIAL, date: WEDNESDAY } });
        expect(quote.status(), 'the admin prices a job that is normally a quote').toBe(200);
        const quoteAnswer = await quote.json();
        expect(Number(quoteAnswer.price), 'the price past the quote').toBe(135);
        expect(quoteAnswer.quoted_minutes, 'the quoted minutes past the quote').toBe(200);
        expect(quoteAnswer.quote_flags.map((flag) => flag.code), 'the picks that make it a quote').toEqual(['commercial']);
        expect(Array.isArray(quoteAnswer.choices), 'the service choices come back for the screen').toBe(true);
        expect(JSON.stringify(quoteAnswer.choices), 'the threshold that sends a job to a quote is not a choice').not.toMatch(/quote_from/);

        expect(await written(), 'pricing a job writes nothing').toEqual(before);
    });

    test('a booking for an e-mail address that is a customer account joins that account, and a new address stays a guest booking with no account made', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        const [account] = await rows("SELECT id FROM users WHERE email = ? AND role = 'user'", [CUSTOMER1.email]);
        expect(account, 'customer 1 has an account').toBeDefined();

        const matched = await book(request, as.admin, { email: CUSTOMER1.email.toUpperCase() });
        expect(matched.response.status(), 'the admin books for customer 1').toBe(201);
        expect(matched.answer.account_matched, 'the address matches an account, whatever its case').toBe(true);
        const [joined] = await rows('SELECT user_id, customer_email FROM bookings WHERE id = ?', [matched.answer.booking_id]);
        expect(joined.user_id, "the booking is on customer 1's account").toBe(account.id);
        expect(joined.customer_email, 'the address is stored in lower case').toBe(CUSTOMER1.email.toLowerCase());

        const email = emailOf('guest');
        const guest = await book(request, as.admin, { email });
        expect(guest.response.status(), 'the admin books for a customer with no account').toBe(201);
        expect(guest.answer.account_matched, 'a new address matches no account').toBe(false);
        const [guestRow] = await rows('SELECT user_id FROM bookings WHERE id = ?', [guest.answer.booking_id]);
        expect(guestRow.user_id, 'a guest booking belongs to no account').toBeNull();
        expect(await count('SELECT COUNT(*) AS n FROM users WHERE email = ?', [email]), 'no account is made from the admin route').toBe(0);
    });

    test('an admin booking is written to the activity log as made by an admin on the customer behalf, with the amount', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        const { response, answer } = await book(request, as.admin);
        expect(response.status(), 'the admin books for the customer').toBe(201);
        const logged = await activityOf(answer.booking_id, 'BOOKING_CREATED');
        expect(logged.length, 'one BOOKING_CREATED row is written about the booking').toBe(1);
        expect(logged[0].actor_type, 'the actor is an admin').toBe('admin');
        const details = parsed(logged[0].details);
        expect(details.on_behalf, 'the row says it was made on a customer behalf').toBe(true);
        expect(Number(details.amount), 'the row holds the price').toBe(135);
        expect(details.quote_flags, 'no pick made it a quote').toEqual([]);
        expect(JSON.stringify(logged[0]), 'the row holds no part of the link').not.toContain(tokenOf(answer.card_link.path));
    });

    test('an admin booking with a missing or malformed field is refused with the field named, and nothing is written', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        const refusals = [
            ['first_name', { first_name: '' }],
            ['last_name', { last_name: undefined }],
            ['email', { email: 'not-an-address' }],
            ['email', { email: undefined }],
            ['address_line1', { address_line1: '   ' }],
            ['service_id', { service_id: 'one' }],
            ['service_id', { service_id: 0 }],
            ['first_name', { first_name: 'x'.repeat(101) }],
            ['phone', { phone: '1'.repeat(51) }],
            ['parking_access', { parking_access: 'maybe' }],
            ['latitude', { latitude: 91 }],
            ['photos', { photos: ['javascript:alert(1)'] }],
            ['job_date', { job_date: 'tomorrow' }],
            ['quote_request_id', { quote_request_id: 'abc' }],
        ];
        const before = await written();
        for (const [field, change] of refusals) {
            const response = await call(request, 'POST', '/api/admin/bookings', as.admin, behalfBody(change));
            expect(response.status(), `the booking with ${JSON.stringify(change)} is refused`).toBe(400);
            const answer = await response.json();
            expect(answer.success, `the refusal of ${field} says it failed`).toBe(false);
            expect(answer.field, `the refusal names ${field}`).toBe(field);
        }
        const notAnObject = await call(request, 'POST', '/api/admin/bookings', as.admin, []);
        expect(notAnObject.status(), 'a body that is not an object is refused').toBe(400);

        // The empty body the route matrix probes both admin routes with: the booking route names the service, the pricing route says no service is
        // offered.
        const empty = await call(request, 'POST', '/api/admin/bookings', as.admin, {});
        expect(empty.status(), 'an empty body is refused by the booking route').toBe(400);
        expect((await empty.json()).field, 'the refusal names the service').toBe('service_id');
        const noService = await call(request, 'POST', '/api/admin/pricing', as.admin, {});
        expect(noService.status(), 'an empty body is refused by the pricing route').toBe(400);
        expect((await noService.json()).message, 'the refusal says no service is offered').toBe('This service is not available for booking');

        expect(await written(), 'no refusal writes a booking, a link or a history row').toEqual(before);
    });

    test('a repeating frequency in the answers is refused by both admin routes, naming the field, and nothing is written', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        const before = await written();
        const answers = { ...TWO_AND_ONE, frequency: 'weekly' };

        const booking = await call(request, 'POST', '/api/admin/bookings', as.admin, behalfBody({ answers }));
        expect(booking.status(), 'the admin booking refuses repeating visits').toBe(400);
        expect((await booking.json()).field, 'the booking refusal names the field').toBe('frequency');

        const pricing = await call(request, 'POST', '/api/admin/pricing', as.admin, { service_id: 1, answers: { ...answers, date: WEDNESDAY } });
        expect(pricing.status(), 'the admin pricing refuses repeating visits').toBe(400);
        expect((await pricing.json()).field, 'the pricing refusal names the field').toBe('frequency');

        expect(await written(), 'a refused frequency writes nothing').toEqual(before);
    });

    test('a customer, a provider and a caller with no credential are refused by the admin booking and pricing routes, and nothing is written', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        const before = await written();
        const email = emailOf('refused');
        for (const [who, headers, status] of [['a customer', as.customer, 403], ['a provider', as.provider, 403], ['a caller with no credential', as.anonymous, 401]]) {
            const booking = await call(request, 'POST', '/api/admin/bookings', headers, behalfBody({ email }));
            expect(booking.status(), `the admin booking route answers ${who}`).toBe(status);
            const pricing = await call(request, 'POST', '/api/admin/pricing', headers, { service_id: 1, answers: { ...TWO_AND_ONE, date: WEDNESDAY } });
            expect(pricing.status(), `the admin pricing route answers ${who}`).toBe(status);
        }
        expect(await count('SELECT COUNT(*) AS n FROM bookings WHERE customer_email = ?', [email]), 'no booking was made').toBe(0);
        expect(await written(), 'a refused caller writes nothing').toEqual(before);
    });

    test('a customer, a provider and a caller with no credential are refused by the card link routes of a booking, and the link is left as it was', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        const { bookingId, id } = await seeded();
        const before = await linkRow(id);
        for (const [who, headers, status] of [['a customer', as.customer, 403], ['a provider', as.provider, 403], ['a caller with no credential', as.anonymous, 401]]) {
            for (const method of ['GET', 'POST']) {
                const response = await call(request, method, `/api/admin/bookings/${bookingId}/card-link`, headers, undefined);
                expect(response.status(), `${method} card-link answers ${who}`).toBe(status);
            }
        }
        expect(await linkRow(id), 'the link row is as it was').toEqual(before);
    });

    test('a card link page shows the job and the price and nothing that names the customer, and it is not cached', async ({ request }) => {
        const { token } = await seeded();
        const response = await call(request, 'GET', `/api/card/${token}`, {}, undefined);
        expect(response.status(), 'the link opens with no credential').toBe(200);
        expect(response.headers()['cache-control'], 'the page is meant for one customer').toMatch(/no-store/);
        const answer = await response.json();
        expect(answer).toEqual({
            success: true, state: 'ok',
            booking: { service_name: SERVICE_NAME, job_date: WEDNESDAY, job_time_slot: '09:00', price: 135 },
            card: null,
        });
        const text = JSON.stringify(answer);
        expect(text, "the page holds no part of the customer's name").not.toMatch(/Behalf|E2E"/);
        expect(text, "the page holds no part of the customer's address").not.toMatch(/e2e-onbehalf|@/);
    });

    test('a malformed or unknown token is the same 404 on all three card routes', async ({ request }) => {
        const tokens = ['short', 'A'.repeat(43), 'A'.repeat(44)];
        const bodies = new Set();
        for (const token of tokens) {
            for (const [method, suffix, data] of [['GET', '', undefined], ['POST', '/setup', undefined], ['POST', '/confirm', { setup_intent_id: 'seti_e2e_1' }]]) {
                const response = await call(request, method, `/api/card/${token}${suffix}`, {}, data);
                expect(response.status(), `${method} ${suffix || '/'} with the token ${token.slice(0, 5)}`).toBe(404);
                expect(response.headers()['cache-control'], 'a refusal is not cached either').toMatch(/no-store/);
                bodies.add(JSON.stringify(await response.json()));
            }
        }
        expect([...bodies], 'every refusal says the same thing').toEqual([JSON.stringify(NOT_VALID)]);
    });

    test('with no payment key on the server a card entry answers 503 and the link keeps all its tries', async ({ request }) => {
        const { token, id } = await seeded();
        const before = await linkRow(id);
        const response = await call(request, 'POST', `/api/card/${token}/setup`, {}, undefined);
        expect(response.status(), 'a server with no payment key cannot start a card entry').toBe(503);
        expect(await response.json()).toEqual({ success: false, message: UNAVAILABLE });
        expect(await linkRow(id), 'no try was spent and nothing was saved').toEqual(before);
    });

    test('with no payment key on the server a confirm answers 503 and saves nothing, and an id that is not a SetupIntent id is 400', async ({ request }) => {
        const { token, id } = await seeded();
        const before = await linkRow(id);
        const url = `/api/card/${token}/confirm`;

        const unavailable = await call(request, 'POST', url, {}, { setup_intent_id: 'seti_e2e_1' });
        expect(unavailable.status(), 'a server with no payment key cannot read a SetupIntent').toBe(503);
        expect(await unavailable.json()).toEqual({ success: false, message: UNAVAILABLE });

        for (const data of [{}, { setup_intent_id: 12 }, { setup_intent_id: 'pi_e2e_1' }, { setup_intent_id: 'seti_a/b' }, { setup_intent_id: `seti_${'a'.repeat(300)}` }, ['seti_e2e_1']]) {
            const refused = await call(request, 'POST', url, {}, data);
            expect(refused.status(), `${JSON.stringify(data).slice(0, 40)} is refused`).toBe(400);
            expect(await refused.json()).toEqual({ success: false, message: NOT_SAVED });
        }
        const unreadable = await request.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, data: 'not json', maxRetries: RESET_RETRIES, timeout: 60_000 });
        expect(unreadable.status(), 'a body that is not JSON is refused').toBe(400);

        expect(await linkRow(id), 'nothing was saved').toEqual(before);
    });

    test('a link that has expired or whose booking is completed or cancelled is the same 404 on all three card routes', async ({ request }) => {
        const dead = [
            ['an expiry in the past', await seeded({ expired: true })],
            ['a completed booking', await seeded({}, 'completed')],
            ['a cancelled booking', await seeded({}, 'cancelled')],
        ];
        for (const [what, { token, id }] of dead) {
            const before = await linkRow(id);
            for (const [method, suffix, data] of [['GET', '', undefined], ['POST', '/setup', undefined], ['POST', '/confirm', { setup_intent_id: 'seti_e2e_1' }]]) {
                const response = await call(request, method, `/api/card/${token}${suffix}`, {}, data);
                expect(response.status(), `${method} ${suffix || '/'} on a link with ${what}`).toBe(404);
                expect(await response.json(), `the answer for ${what} is the one answer`).toEqual(NOT_VALID);
            }
            expect(await linkRow(id), `a link with ${what} is left as it was`).toEqual(before);
        }
    });

    test('a link whose ten tries are spent is a 404 for the page and for a new card entry, and still takes the confirm of the tenth entry', async ({ request }) => {
        // The tenth entry spends the last try, and the card that entry takes must still be saved, so the confirm route reads a spent link as live.
        // With no payment key on the dev server the confirm answers 503 and saves nothing; a bad id is still a 400.
        const { token, id } = await seeded({ attempts: CARD_LINK_ATTEMPTS });
        const before = await linkRow(id);

        const page = await call(request, 'GET', `/api/card/${token}`, {}, undefined);
        expect(page.status(), 'the page of a link with no tries left').toBe(404);
        expect(await page.json()).toEqual(NOT_VALID);
        const setup = await call(request, 'POST', `/api/card/${token}/setup`, {}, undefined);
        expect(setup.status(), 'a new card entry on a link with no tries left').toBe(404);
        expect(await setup.json()).toEqual(NOT_VALID);

        const confirm = await call(request, 'POST', `/api/card/${token}/confirm`, {}, { setup_intent_id: 'seti_e2e_1' });
        expect(confirm.status(), 'the confirm of the last entry goes on to the payment key check').toBe(503);
        expect(await confirm.json()).toEqual({ success: false, message: UNAVAILABLE });
        const refused = await call(request, 'POST', `/api/card/${token}/confirm`, {}, { setup_intent_id: 'pi_e2e_1' });
        expect(refused.status(), 'the confirm of the last entry still checks the id').toBe(400);

        expect(await linkRow(id), 'a link with no tries left is left as it was').toEqual(before);
    });

    test('a link that has its card shows the card, and a setup or a confirm on it answers 409 and changes nothing', async ({ request }) => {
        const { token, id } = await seeded({ card: { brand: 'visa', last4: '4242' } });
        const before = await linkRow(id);

        const page = await call(request, 'GET', `/api/card/${token}`, {}, undefined);
        expect(page.status(), 'the page of a link that is used still opens').toBe(200);
        const shown = await page.json();
        expect(shown.state, 'the page says a card is on file').toBe('used');
        expect(shown.card, 'the page shows the brand and the last four and nothing more').toEqual({ brand: 'visa', last4: '4242' });

        const setup = await call(request, 'POST', `/api/card/${token}/setup`, {}, undefined);
        expect(setup.status(), 'a card entry on a link that has its card').toBe(409);
        expect(await setup.json()).toEqual({ success: false, message: ALREADY_ON_FILE });

        const confirm = await call(request, 'POST', `/api/card/${token}/confirm`, {}, { setup_intent_id: 'seti_e2e_2' });
        expect(confirm.status(), 'a confirm on a link that has its card').toBe(409);
        expect(await confirm.json()).toEqual({ success: false, message: ALREADY_ON_FILE });

        expect(await linkRow(id), 'the card and the tries are as they were').toEqual(before);
    });

    test('starting a card entry creates one off-session card SetupIntent for the Stripe customer and makes no payment call', async () => {
        const { id, bookingId, link } = await seeded({ customer: 'cus_e2e_1' });
        const stripe = scriptedStripe({ 'setupIntents.create': { id: 'seti_e2e_1', client_secret: 'seti_e2e_1_secret_abc' } });
        const started = await startCardSetup(stripe, execute, link);
        expect(started, 'the entry starts and hands back the client secret').toEqual({ ok: true, client_secret: 'seti_e2e_1_secret_abc' });

        const created = stripe.calls.filter(([method]) => method === 'setupIntents.create');
        expect(created.length, 'one SetupIntent is created').toBe(1);
        expect(created[0][1], 'the SetupIntent is for later use of a card on the customer').toEqual({
            customer: 'cus_e2e_1', usage: 'off_session', payment_method_types: ['card'],
            metadata: { card_link_id: String(id), booking_id: String(bookingId) },
        });
        expect(stripe.calls.filter(([method]) => method === 'customers.create').length, 'the link already has its customer').toBe(0);
        expect(paymentCalls(stripe), 'a card entry holds and charges nothing').toEqual([]);
        expect(Number((await linkRow(id)).attempts), 'the entry spent one try').toBe(1);
    });

    test('the first card entry of a link that has no Stripe customer creates one under a key for the link, and a second entry reuses it', async () => {
        const { id, bookingId, token, link } = await seeded();
        const stripe = scriptedStripe({ 'customers.create': { id: 'cus_e2e_new' }, 'setupIntents.create': { id: 'seti_e2e_1', client_secret: 'seti_e2e_1_secret_abc' } });
        expect((await startCardSetup(stripe, execute, link)).ok, 'the first entry starts').toBe(true);

        const customers = stripe.calls.filter(([method]) => method === 'customers.create');
        expect(customers.length, 'one customer is created').toBe(1);
        expect(customers[0][1].metadata, 'the customer says which link and booking it is for').toEqual({ card_link_id: String(id), booking_id: String(bookingId) });
        expect(customers[0][2], 'the customer is created under a key for this link').toEqual({ idempotencyKey: `card-link-${id}-customer` });
        expect((await linkRow(id)).stripe_customer_id, 'the link keeps the customer').toBe('cus_e2e_new');

        const again = await findCardLink(execute, token);
        expect((await startCardSetup(stripe, execute, again)).ok, 'the second entry starts').toBe(true);
        expect(stripe.calls.filter(([method]) => method === 'customers.create').length, 'the second entry creates no second customer').toBe(1);
        const secondIntent = stripe.calls.filter(([method]) => method === 'setupIntents.create')[1];
        expect(secondIntent[1].customer, 'the second SetupIntent is for the same customer').toBe('cus_e2e_new');
        expect(paymentCalls(stripe), 'a card entry holds and charges nothing').toEqual([]);
    });

    test('a link allows ten card entries and the eleventh is refused as dead, with no SetupIntent created', async () => {
        const { id, token, link } = await seeded({ customer: 'cus_e2e_1' });
        const stripe = scriptedStripe({ 'setupIntents.create': { id: 'seti_e2e_1', client_secret: 'seti_e2e_1_secret_abc' } });
        for (let entry = 1; entry <= CARD_LINK_ATTEMPTS; entry += 1) {
            expect((await startCardSetup(stripe, execute, link)).ok, `entry ${entry} starts`).toBe(true);
        }
        expect(await startCardSetup(stripe, execute, link), 'the eleventh entry is refused').toEqual({ ok: false, reason: 'dead' });
        expect(stripe.calls.filter(([method]) => method === 'setupIntents.create').length, 'ten SetupIntents were created and no eleventh').toBe(CARD_LINK_ATTEMPTS);
        expect(Number((await linkRow(id)).attempts), 'the link counts ten tries').toBe(CARD_LINK_ATTEMPTS);
        expect((await findCardLink(execute, token)).state, 'the link now reads as spent').toBe('exhausted');
    });

    test('with no Stripe client a card entry counts no try and creates nothing', async () => {
        const { id, link } = await seeded({ customer: 'cus_e2e_1' });
        expect(await startCardSetup(null, execute, link), 'the entry is unavailable').toEqual({ ok: false, reason: 'unavailable' });
        expect(Number((await linkRow(id)).attempts), 'no try was spent').toBe(0);
    });

    test('(ENG-013 F7) a card entry on a link that already has an open SetupIntent is handed the same client secret and spends no try, however many times the page loads', async () => {
        const { id, token, link } = await seeded({ customer: 'cus_e2e_1' });
        const stripe = scriptedStripe({
            'setupIntents.create': { id: 'seti_e2e_1', client_secret: 'seti_e2e_1_secret_abc' },
            'setupIntents.retrieve': openIntent(link.id),
        });
        expect(await startCardSetup(stripe, execute, link), 'the first load starts an entry').toEqual({ ok: true, client_secret: 'seti_e2e_1_secret_abc' });
        expect((await linkRow(id)).setup_intent_id, 'the link keeps the SetupIntent its page was handed').toBe('seti_e2e_1');
        expect(callsTo(stripe, 'setupIntents.retrieve'), 'a first entry has nothing to read').toEqual([]);

        for (let reload = 1; reload <= 3; reload += 1) {
            const again = await findCardLink(execute, token);
            expect(await startCardSetup(stripe, execute, again), `reload ${reload} is handed the same entry`).toEqual({ ok: true, client_secret: 'seti_e2e_1_secret_abc' });
        }
        expect(callsTo(stripe, 'setupIntents.create').length, 'one SetupIntent was made for four loads').toBe(1);
        expect(callsTo(stripe, 'setupIntents.retrieve'), 'each reload read the kept SetupIntent by its id and nothing else').toEqual([
            ['setupIntents.retrieve', 'seti_e2e_1'], ['setupIntents.retrieve', 'seti_e2e_1'], ['setupIntents.retrieve', 'seti_e2e_1'],
        ]);
        expect(Number((await linkRow(id)).attempts), 'four loads spent one try').toBe(1);
        expect(paymentCalls(stripe), 'a card entry holds and charges nothing').toEqual([]);
    });

    test('(ENG-013 F7) a SetupIntent with a failed confirm on it is not handed out again: the next entry is a new SetupIntent, spends a try, and is the one the link keeps', async () => {
        const { id, link } = await seeded({ customer: 'cus_e2e_1', attempts: 1, setup: 'seti_e2e_old' });
        const stripe = scriptedStripe({
            'setupIntents.retrieve': openIntent(link.id, { id: 'seti_e2e_old', client_secret: 'seti_e2e_old_secret_abc', last_setup_error: { type: 'card_error', code: 'card_declined' } }),
            'setupIntents.create': { id: 'seti_e2e_new', client_secret: 'seti_e2e_new_secret_abc' },
        });
        expect(await startCardSetup(stripe, execute, link), 'the page is given a different entry').toEqual({ ok: true, client_secret: 'seti_e2e_new_secret_abc' });
        expect(callsTo(stripe, 'setupIntents.create').length, 'one new SetupIntent').toBe(1);
        const row = await linkRow(id);
        expect(Number(row.attempts), 'the failed confirm cost a try').toBe(2);
        expect(row.setup_intent_id, 'the link keeps the new SetupIntent').toBe('seti_e2e_new');
    });

    // A SetupIntent the link kept that is not an open entry of this link is never handed out. Each way it can fail to be one is a case of its own.
    const NOT_OPEN = [
        ['belongs to another link', { metadata: { card_link_id: '999999999' } }],
        ['has no metadata', { metadata: undefined }],
        ['is on another customer', { customer: 'cus_e2e_other' }],
        ['is on no customer', { customer: null }],
        ['is for on-session use', { usage: 'on_session' }],
        ['has succeeded', { status: 'succeeded' }],
        ['was canceled', { status: 'canceled' }],
        ['needs an action', { status: 'requires_action' }],
        ['is processing', { status: 'processing' }],
        ['has no client secret', { client_secret: undefined }],
        ['has a client secret that is not text', { client_secret: 12345 }],
        ['has an empty client secret', { client_secret: '' }],
    ];
    for (const [name, change] of NOT_OPEN) {
        test(`(ENG-013 F7) a kept SetupIntent that ${name} is not handed out: the page is given a new entry, which spends a try and is the one the link keeps`, async () => {
            const { id, link } = await seeded({ customer: 'cus_e2e_1', attempts: 1, setup: 'seti_e2e_kept' });
            const stripe = scriptedStripe({
                'setupIntents.retrieve': openIntent(link.id, { id: 'seti_e2e_kept', ...change }),
                'setupIntents.create': { id: 'seti_e2e_made', client_secret: 'seti_e2e_made_secret_abc' },
            });
            expect(await startCardSetup(stripe, execute, link), 'the page is given a new entry').toEqual({ ok: true, client_secret: 'seti_e2e_made_secret_abc' });
            const row = await linkRow(id);
            expect([Number(row.attempts), row.setup_intent_id], 'it spent a try and the link keeps the new SetupIntent').toEqual([2, 'seti_e2e_made']);
        });
    }

    test('(ENG-013 F7) a kept SetupIntent on a link that has no Stripe customer is not handed out: without a customer on the link there is no saying whose an entry is', async () => {
        const { id, link } = await seeded({ attempts: 1, setup: 'seti_e2e_kept' });
        const stripe = scriptedStripe({
            'setupIntents.retrieve': openIntent(link.id, { id: 'seti_e2e_kept' }),
            'customers.create': { id: 'cus_e2e_1' },
            'setupIntents.create': { id: 'seti_e2e_made', client_secret: 'seti_e2e_made_secret_abc' },
        });
        expect(await startCardSetup(stripe, execute, link), 'the page is given a new entry').toEqual({ ok: true, client_secret: 'seti_e2e_made_secret_abc' });
        const row = await linkRow(id);
        expect([Number(row.attempts), row.setup_intent_id], 'it spent a try and the link keeps the new SetupIntent').toEqual([2, 'seti_e2e_made']);
    });

    test('(ENG-013 F7) a kept SetupIntent that Stripe does not know or cannot be asked about is not handed out: the page is given a new entry, and a failed read is one fixed line', async () => {
        const unknown = Object.assign(new Error('No such setupintent: seti_e2e_kept'), { type: 'StripeInvalidRequestError', code: 'resource_missing', statusCode: 404 });
        const unreachable = Object.assign(new Error('An error occurred with our connection to Stripe for seti_e2e_kept'), { type: 'StripeConnectionError' });
        const logged = [];
        const original = console.error;
        console.error = (...args) => { logged.push(args.map(String).join(' ')); };
        try {
            for (const [name, failure] of [['Stripe does not know it', unknown], ['Stripe cannot be reached', unreachable]]) {
                const { id, link } = await seeded({ customer: 'cus_e2e_1', attempts: 1, setup: 'seti_e2e_kept' });
                const stripe = scriptedStripe({
                    'setupIntents.retrieve': failure,
                    'setupIntents.create': { id: 'seti_e2e_made', client_secret: 'seti_e2e_made_secret_abc' },
                });
                expect(await startCardSetup(stripe, execute, link), `${name}: the page is given a new entry`).toEqual({ ok: true, client_secret: 'seti_e2e_made_secret_abc' });
                const row = await linkRow(id);
                expect([Number(row.attempts), row.setup_intent_id], `${name}: it spent a try and the link keeps the new SetupIntent`).toEqual([2, 'seti_e2e_made']);
            }
        } finally {
            console.error = original;
        }
        expect(logged, 'Stripe not knowing the id is no line; a read that failed is one line with the error type and none of its text').toEqual(['A card entry could not be read: StripeConnectionError']);
    });

    test('(ENG-013 F7) a link its reader did not find usable is not handed its open entry: the count decides, the link is dead, and Stripe is not asked', async () => {
        const unusable = [
            ['expired', { expired: true }],
            ['used', { card: { brand: 'visa', last4: '4242' } }],
            ['exhausted', { attempts: CARD_LINK_ATTEMPTS }],
        ];
        for (const [state, options] of unusable) {
            const { id, link } = await seeded({ customer: 'cus_e2e_1', setup: 'seti_e2e_kept', ...options });
            expect(link.state, `${state}: the link reads as it is`).toBe(state);
            expect(link.setup_intent_id, `${state}: the link has an entry to hand out`).toBeTruthy();
            const before = await linkRow(id);
            const stripe = scriptedStripe({
                'setupIntents.retrieve': openIntent(link.id, { id: link.setup_intent_id }),
                'setupIntents.create': { id: 'seti_e2e_made', client_secret: 'seti_e2e_made_secret_abc' },
            });
            expect(await startCardSetup(stripe, execute, link), `${state}: no entry`).toEqual({ ok: false, reason: 'dead' });
            expect(stripe.calls, `${state}: nothing was asked of Stripe`).toEqual([]);
            expect(await linkRow(id), `${state}: the link is as it was`).toEqual(before);
        }
    });

    test('(ENG-013 F7) ten failed confirms use the ten tries, one new SetupIntent each, and the link is then spent', async () => {
        const { id, token, link } = await seeded({ customer: 'cus_e2e_1' });
        let made = 0;
        const stripe = scriptedStripe({
            'setupIntents.create': () => { made += 1; return { id: `seti_e2e_${made}`, client_secret: `seti_e2e_${made}_secret_abc` }; },
            'setupIntents.retrieve': (setupId) => openIntent(link.id, { id: setupId, last_setup_error: { type: 'card_error', code: 'card_declined' } }),
        });
        for (let entry = 1; entry <= CARD_LINK_ATTEMPTS; entry += 1) {
            const current = await findCardLink(execute, token);
            expect(current.state, `entry ${entry}: the link is still usable`).toBe('ok');
            expect((await startCardSetup(stripe, execute, current)).ok, `entry ${entry} starts`).toBe(true);
        }
        const spent = await findCardLink(execute, token);
        expect(spent.state, 'ten failures spend the link').toBe('exhausted');
        expect(await startCardSetup(stripe, execute, spent), 'an eleventh entry is refused').toEqual({ ok: false, reason: 'dead' });
        expect(callsTo(stripe, 'setupIntents.create').length, 'ten SetupIntents were made and no eleventh').toBe(CARD_LINK_ATTEMPTS);
        expect(Number((await linkRow(id)).attempts), 'the link counts ten tries').toBe(CARD_LINK_ATTEMPTS);
    });

    test('(ENG-013 F7) an entry whose id cannot be kept still starts, and so does one whose answer has no id; neither is kept', async () => {
        const logged = [];
        const original = console.error;
        console.error = (...args) => { logged.push(args.map(String).join(' ')); };
        try {
            const first = await seeded({ customer: 'cus_e2e_1' });
            const refusing = (sql, params) => (/SET setup_intent_id/.test(sql)
                ? Promise.reject(Object.assign(new Error('write refused for seti_e2e_1'), { code: 'ER_E2E_REFUSED' }))
                : execute(sql, params));
            const stripe = scriptedStripe({ 'setupIntents.create': { id: 'seti_e2e_1', client_secret: 'seti_e2e_1_secret_abc' } });
            expect(await startCardSetup(stripe, refusing, first.link), 'the entry starts although its id was not kept').toEqual({ ok: true, client_secret: 'seti_e2e_1_secret_abc' });
            const row = await linkRow(first.id);
            expect([Number(row.attempts), row.setup_intent_id], 'the try was spent and nothing was kept').toEqual([1, null]);

            const second = await seeded({ customer: 'cus_e2e_1' });
            const bare = scriptedStripe({ 'setupIntents.create': { client_secret: 'seti_e2e_2_secret_abc' } });
            expect(await startCardSetup(bare, execute, second.link), 'an answer with no id still starts the entry').toEqual({ ok: true, client_secret: 'seti_e2e_2_secret_abc' });
            expect((await linkRow(second.id)).setup_intent_id, 'an answer with no id keeps nothing').toBeNull();
        } finally {
            console.error = original;
        }
        expect(logged, 'a write that failed is one line with the error code and none of the error text').toEqual(['A card entry could not be kept: ER_E2E_REFUSED']);
    });

    test('(ENG-013 F7) an entry made while a card was being saved does not take the saved card\'s SetupIntent id from the link', async () => {
        const { id, link } = await seeded({ customer: 'cus_e2e_1' });
        const stripe = scriptedStripe({
            'setupIntents.create': async () => {
                await execute("UPDATE booking_card_links SET setup_intent_id = 'seti_e2e_saved', used_at = NOW() WHERE id = ?", [id]);
                return { id: 'seti_e2e_late', client_secret: 'seti_e2e_late_secret_abc' };
            },
        });
        expect((await startCardSetup(stripe, execute, link)).ok, 'the entry starts').toBe(true);
        const row = await linkRow(id);
        expect(row.setup_intent_id, 'the saved card keeps its SetupIntent').toBe('seti_e2e_saved');
        expect(row.used_at, 'and the link stays used').not.toBeNull();
    });

    test('(ENG-013 F7) a reissue drops the open entry of the old link, so the new link is never handed a client secret the old one was', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        const { bookingId, id, link } = await seeded({ customer: 'cus_e2e_1' });
        let made = 0;
        const stripe = scriptedStripe({
            'setupIntents.create': () => { made += 1; return { id: `seti_e2e_${made}`, client_secret: `seti_e2e_${made}_secret_abc` }; },
            'setupIntents.retrieve': (setupId) => openIntent(link.id, { id: setupId }),
        });
        expect((await startCardSetup(stripe, execute, link)).client_secret, 'the old link is handed an entry').toBe('seti_e2e_1_secret_abc');
        expect((await linkRow(id)).setup_intent_id, 'and keeps it').toBe('seti_e2e_1');

        const issued = await call(request, 'POST', `/api/admin/bookings/${bookingId}/card-link`, as.admin, undefined);
        expect(issued.status(), 'the admin reissues the link').toBe(200);
        const fresh = tokenOf((await issued.json()).card_link.path);
        const row = await linkRow(id);
        expect([row.setup_intent_id, Number(row.attempts)], 'the old entry is dropped and the tries are cleared').toEqual([null, 0]);

        const reissued = await findCardLink(execute, fresh);
        expect(await startCardSetup(stripe, execute, reissued), 'the new link is given an entry of its own').toEqual({ ok: true, client_secret: 'seti_e2e_2_secret_abc' });
        expect(callsTo(stripe, 'setupIntents.retrieve'), 'the old entry was never read for the new link').toEqual([]);
        expect(callsTo(stripe, 'setupIntents.create').length, 'two SetupIntents, one for each issue').toBe(2);
        expect(Number((await linkRow(id)).attempts), 'the new issue spent one try').toBe(1);
    });

    test('a succeeded SetupIntent saves the brand and last four that Stripe gives and marks the link used', async () => {
        const { id, token, link } = await seeded({ customer: 'cus_e2e_1' });
        const stripe = scriptedStripe({ 'setupIntents.retrieve': succeededIntent(link.id) });
        const saved = await saveCardSetup(stripe, execute, link, 'seti_e2e_1');
        expect(saved, 'the card is saved').toEqual({ ok: true, card: { brand: 'visa', last4: '4242' } });
        expect(stripe.calls[0], 'the SetupIntent is read from Stripe with its payment method').toEqual(['setupIntents.retrieve', 'seti_e2e_1', { expand: ['payment_method'] }]);
        expect(paymentCalls(stripe), 'saving a card holds and charges nothing').toEqual([]);
        const row = await linkRow(id);
        expect(row.setup_intent_id, 'the SetupIntent is kept').toBe('seti_e2e_1');
        expect(row.payment_method_id, 'the payment method is kept').toBe('pm_e2e_1');
        expect(row.card_brand, "the brand is Stripe's").toBe('visa');
        expect(row.card_last4, "the last four are Stripe's").toBe('4242');
        expect(row.used_at, 'the link is marked used').not.toBeNull();
        expect((await findCardLink(execute, token)).state, 'the link now reads as used').toBe('used');
    });

    const refusedIntents = [
        ['a SetupIntent that belongs to another link is refused as invalid and nothing is saved', (linkId) => ({ metadata: { card_link_id: String(linkId + 1) } })],
        ['a SetupIntent that belongs to another customer is refused as invalid and nothing is saved', () => ({ customer: 'cus_someone_else' })],
        ['a SetupIntent that has not succeeded is refused as invalid and nothing is saved', () => ({ status: 'requires_payment_method' })],
        ['a SetupIntent that holds no card is refused as invalid and nothing is saved', () => ({ payment_method: null })],
        ['a SetupIntent made for use on session is refused as invalid and nothing is saved', () => ({ usage: 'on_session' })],
    ];
    for (const [title, change] of refusedIntents) {
        test(title, async () => {
            const { id, link } = await seeded({ customer: 'cus_e2e_1' });
            const stripe = scriptedStripe({ 'setupIntents.retrieve': succeededIntent(link.id, change(link.id)) });
            expect(await saveCardSetup(stripe, execute, link, 'seti_e2e_1'), 'the SetupIntent is refused').toEqual({ ok: false, reason: 'invalid' });
            const row = await linkRow(id);
            expect([row.used_at, row.setup_intent_id, row.payment_method_id, row.card_brand, row.card_last4], 'nothing was saved').toEqual([null, null, null, null, null]);
        });
    }

    test('a second save on a link that has its card is refused as used, even from a stale read, and the first card stays', async () => {
        const { id, token, link } = await seeded({ customer: 'cus_e2e_1' });
        const stripe = scriptedStripe({ 'setupIntents.retrieve': succeededIntent(link.id) });
        expect((await saveCardSetup(stripe, execute, link, 'seti_e2e_1')).ok, 'the first save succeeds').toBe(true);

        const second = scriptedStripe({
            'setupIntents.retrieve': succeededIntent(link.id, { id: 'seti_e2e_2', payment_method: { id: 'pm_e2e_2', type: 'card', customer: 'cus_e2e_1', card: { brand: 'mastercard', last4: '4444' } } }),
        });
        const fresh = await findCardLink(execute, token);
        expect(await saveCardSetup(second, execute, fresh, 'seti_e2e_2'), 'a save on a link read as used').toEqual({ ok: false, reason: 'used' });
        expect(second.calls, 'a link that has its card does not ask Stripe').toEqual([]);
        expect(await saveCardSetup(second, execute, link, 'seti_e2e_2'), 'a save from a read made before the first save').toEqual({ ok: false, reason: 'used' });

        const row = await linkRow(id);
        expect([row.payment_method_id, row.card_brand, row.card_last4], 'the first card stays').toEqual(['pm_e2e_1', 'visa', '4242']);
    });

    test('after a reissue clears used_at and keeps the card, a replacement card is saved in its place', async () => {
        const { id, token, link } = await seeded({ customer: 'cus_e2e_1' });
        const first = scriptedStripe({ 'setupIntents.retrieve': succeededIntent(link.id) });
        expect((await saveCardSetup(first, execute, link, 'seti_e2e_1')).ok, 'the first card is saved').toBe(true);

        await execute('UPDATE booking_card_links SET used_at = NULL, attempts = 0 WHERE id = ?', [id]);
        const reissued = await findCardLink(execute, token);
        expect(reissued.state, 'a reissued link takes a card again').toBe('ok');
        expect(reissued.payment_method_id, 'the card stays on the booking until a replacement is saved').toBe('pm_e2e_1');

        const second = scriptedStripe({
            'setupIntents.retrieve': succeededIntent(link.id, { id: 'seti_e2e_2', payment_method: { id: 'pm_e2e_2', type: 'card', customer: 'cus_e2e_1', card: { brand: 'mastercard', last4: '4444' } } }),
        });
        expect(await saveCardSetup(second, execute, reissued, 'seti_e2e_2'), 'the replacement card is saved').toEqual({ ok: true, card: { brand: 'mastercard', last4: '4444' } });
        const row = await linkRow(id);
        expect([row.setup_intent_id, row.payment_method_id, row.card_brand, row.card_last4], 'the replacement is the card on file').toEqual(['seti_e2e_2', 'pm_e2e_2', 'mastercard', '4444']);
        expect(row.used_at, 'the link is used again').not.toBeNull();
    });

    test('an admin books from a quote request: the request names the booking, the list of requests shows it, and a second booking from the same request is refused and writes nothing', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        const email = emailOf('quote');
        const [made] = /** @type {any} */ (await (await db()).query(
            `INSERT INTO quote_requests (service_id, service_name, customer_name, customer_email, customer_phone, address, message, answers, picks)
             VALUES (1, ?, 'E2E Behalf', ?, '+14035550123', '1 Probe Street', 'A request for the booking cases, deleted by the case.', ?, '[]')`,
            [SERVICE_NAME, email, JSON.stringify(TWO_AND_ONE)],
        ));
        const quoteRequestId = /** @type {number} */ (made.insertId);

        const first = await book(request, as.admin, { email, quote_request_id: quoteRequestId });
        expect(first.response.status(), 'the admin books from the request').toBe(201);
        const [linked] = await rows('SELECT booking_id FROM quote_requests WHERE id = ?', [quoteRequestId]);
        expect(linked.booking_id, 'the request names the booking made from it').toBe(first.answer.booking_id);

        const listed = await call(request, 'GET', '/api/quote-requests?limit=200', as.admin, undefined);
        expect(listed.status(), 'the admin reads the requests').toBe(200);
        const entry = (await listed.json()).data.find((row) => row.id === quoteRequestId);
        expect(entry, 'the request is on the list').toBeDefined();
        expect([entry.booking_id, entry.booking_number], 'the list says which booking was made from the request').toEqual([first.answer.booking_id, first.answer.booking_number]);

        const before = await written();
        const again = await book(request, as.admin, { email: emailOf('quote-again'), quote_request_id: quoteRequestId });
        expect(again.response.status(), 'a second booking from the same request').toBe(409);
        expect(again.answer, 'the refusal').toEqual({ success: false, message: 'That quote request already has a booking.' });
        expect(await written(), 'the refused booking wrote nothing').toEqual(before);
        const [still] = await rows('SELECT booking_id FROM quote_requests WHERE id = ?', [quoteRequestId]);
        expect(still.booking_id, 'the request still names the first booking').toBe(first.answer.booking_id);

        for (const [what, id] of [['one no row has', 999999999], ['not a row id', 'abc'], ['zero', 0]]) {
            const refused = await book(request, as.admin, { email: emailOf('quote-none'), quote_request_id: id });
            expect(refused.response.status(), `a request id that is ${what}`).toBe(400);
            expect(refused.answer.field, `a request id that is ${what} names its field`).toBe('quote_request_id');
        }
        expect(await written(), 'no refused booking wrote anything').toEqual(before);
    });

    test('an admin reissues the card link of a booking: the old link stops working, the new one opens, a card on file stays, and no read of the link shows a token', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        const { bookingId, id, token } = await seeded({ customer: 'cus_e2e_1', card: { brand: 'visa', last4: '4242' } });

        const read = await call(request, 'GET', `/api/admin/bookings/${bookingId}/card-link`, as.admin, undefined);
        expect(read.status(), 'the admin reads the link').toBe(200);
        const readBody = await read.json();
        expect(readBody.card_link, 'a link that has its card').toMatchObject({ state: 'used', attempts: 0, card_on_file: true, card_brand: 'visa', card_last4: '4242' });
        expect(Object.keys(readBody.card_link).sort(), 'what a read of the link carries').toEqual(['attempts', 'card_brand', 'card_last4', 'card_on_file', 'expires_at', 'state']);
        expect(JSON.stringify(readBody), 'a read of the link never shows its token').not.toContain(token);

        const issued = await call(request, 'POST', `/api/admin/bookings/${bookingId}/card-link`, as.admin, undefined);
        expect(issued.status(), 'the admin reissues the link').toBe(200);
        expect(issued.headers()['cache-control'], 'the answer carries a link and must not be cached').toMatch(/no-store/);
        const reissued = (await issued.json()).card_link;
        expect(reissued.path, 'the new link path').toMatch(/^\/card\/[A-Za-z0-9_-]{43}$/);
        const fresh = tokenOf(reissued.path);
        expect(fresh, 'a new token').not.toBe(token);

        const old = await call(request, 'GET', `/api/card/${token}`, {}, undefined);
        expect([old.status(), await old.json()], 'the old link').toEqual([404, NOT_VALID]);
        const opened = await call(request, 'GET', `/api/card/${fresh}`, {}, undefined);
        expect(opened.status(), 'the new link opens').toBe(200);
        expect((await opened.json()).state, 'a reissued link takes a card again').toBe('ok');

        const row = await linkRow(id);
        expect(row.token_hash, 'the table holds the hash of the new token').toBe(sha256(fresh));
        expect([row.used_at, Number(row.attempts)], 'a reissued link is unused').toEqual([null, 0]);
        expect([row.stripe_customer_id, row.payment_method_id, row.card_brand, row.card_last4], 'the card on file stays').toEqual(['cus_e2e_1', 'pm_e2e_seed', 'visa', '4242']);
        const [logged] = await activityOf(bookingId, 'CARD_LINK_ISSUED');
        expect(logged && logged.actor_type, 'the reissue is logged as an admin act').toBe('admin');
    });

    test('the card link of a booking is not made for a booking that has none, nor reissued for a booking that is over, and an id that is not a row id is refused', async ({ request, baseURL }) => {
        const as = await headersFor(baseURL);
        const bare = await seedBooking();
        for (const method of ['GET', 'POST']) {
            const response = await call(request, method, `/api/admin/bookings/${bare}/card-link`, as.admin, undefined);
            expect([response.status(), (await response.json()).message], `${method} card-link on a booking that has no link`).toEqual([404, 'This booking has no card link']);
        }
        expect(await count('SELECT COUNT(*) AS n FROM booking_card_links WHERE booking_id = ?', [bare]), 'no link was made for it').toBe(0);

        for (const status of ['completed', 'cancelled', 'disputed']) {
            const { bookingId, id } = await seeded({}, status);
            const before = await linkRow(id);
            const read = await call(request, 'GET', `/api/admin/bookings/${bookingId}/card-link`, as.admin, undefined);
            expect([read.status(), (await read.json()).card_link.state], `GET card-link on a ${status} booking`).toEqual([200, 'closed']);
            const issued = await call(request, 'POST', `/api/admin/bookings/${bookingId}/card-link`, as.admin, undefined);
            expect(issued.status(), `POST card-link on a ${status} booking`).toBe(409);
            expect(await linkRow(id), `the link of a ${status} booking is as it was`).toEqual(before);
        }

        for (const bad of ['abc', '5abc', '1e3', '0', '-1']) {
            for (const method of ['GET', 'POST']) {
                const response = await call(request, method, `/api/admin/bookings/${bad}/card-link`, as.admin, undefined);
                expect(response.status(), `${method} card-link with the id ${bad}`).toBe(400);
            }
        }
    });
});
