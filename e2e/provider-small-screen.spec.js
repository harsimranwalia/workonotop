// @ts-check
// ENG-031: the provider layout on a small screen, in a browser signed in as provider 1. Cases 5 and 6 settle BUG-013 (below 1024 px the menu that slides in
// from the left was only moved off the screen when it was closed, so its eleven controls stayed tab stops and a screen reader read them), case 7 settles
// BUG-014 (the job page of a job with a long reference and a long e-mail address scrolled sideways at 375 px, because the layout's column could not shrink below
// its content). Each title starts as the design's list does (agents/architect/designs/ENG-031-six-low-severity-page-bugs-behave-as-their-bug-files-expect.md,
// "The cases"), and the file's name, the describe and the title together are the baseline key.
// The pages under /provider/jobs are shut to a provider whose Stripe account is not connected (the layout sends them to the dashboard) and neither fixture provider has
// one connected, so every case connects provider 1 first and the sweep puts the flag back. The jobs of case 7 are made through the public checkout and the admin's route,
// then given the reference and the status the case needs by SQL, and the sweep deletes them again with the other rows of this file's e-mail prefix.
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { getCredentialHeaders } from './auth/credentials.js';
import { signInAs } from './support/auth.js';
import { warm } from './support/warm.js';
import { providers } from '../database/fixtures/accounts.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';

/** @typedef {import('@playwright/test').Page} Page */

// The admin's session goes into a request header and a trace records request headers: tracing is off, as in e2e/provider-crew.spec.js. A failure message names the
// case and the figures, never a header, a token or a cookie. No stored session is wanted, since each case signs in through the route.
test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

const [PROVIDER1] = providers;
const DB = { host: '127.0.0.1', port: 3307, user: 'root', password: 'root123', database: 'workontap_db' };
const EMAIL_PREFIX = 'e2e-small-';

// `next dev` compiles a page or a route on its first request, and again on the first after it has been idle for a minute (11 to 16 s here), so the first assertion that
// waits on a request the page makes gets this budget and not the 10 s of the config.
const FIRST_VISIT_MS = 45_000;
const DASHBOARD_PATHS = ['/provider/dashboard', '/api/provider/me', '/api/provider/dashboard-stats', '/api/provider/payouts', '/api/provider/available-jobs'];
const SIDEBAR_LINKS = ['Dashboard', 'Available Jobs', 'My Jobs', 'My Crew', 'Messages', 'Earnings', 'Ratings', 'Profile'];

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

// Provider 1's Stripe flag is 1 for the length of a case and 0, as the fixtures have it, after it (clearRows).
async function connectStripe() {
    await (await db()).execute('UPDATE service_providers SET stripe_onboarding_complete = 1 WHERE id = ?', [PROVIDER1.id]);
}

// Gives a booking the reference and the status a case needs; every statement of this file is prepared, with a ? for every value.
async function setReferenceAndStatus(bookingId, reference, status) {
    await (await db()).execute('UPDATE bookings SET booking_number = ?, status = ? WHERE id = ?', [reference, status, bookingId]);
}

// Deletes what this file left: the bookings of its e-mail prefix, and sets the Stripe flag of provider 1 back to 0.
async function clearRows() {
    const open = await db();
    await open.execute('UPDATE service_providers SET stripe_onboarding_complete = 0 WHERE id = ?', [PROVIDER1.id]);
    await open.execute('DELETE FROM bookings WHERE customer_email LIKE ?', [`${EMAIL_PREFIX}%`]);
}

// The hooks of a describe that uses the database: a sweep before its first case, after every case (also a case that failed or timed out) and after its last, then the
// connection is closed.
function sweepAround() {
    test.beforeAll(clearRows);
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

// A guest booking made through the public checkout, with a customer e-mail of 45 characters (QA's reproduction in BUG-014 uses about that many). The booking is given to
// provider 1 by the admin, and the case then sets its reference and its status.
/**
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {Record<string, string>} admin
 */
async function makeJobOfProvider1(request, admin) {
    const tag = `${Date.now()}-${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
    const email = `${EMAIL_PREFIX}${tag}@workontap.test`;
    const created = await request.post('/api/bookings', {
        data: {
            service_id: 1, service_name: 'Fixture Standard Clean', service_price: 80, additional_price: 40,
            first_name: 'E2E', last_name: 'Small', email, phone: '+14035550198',
            job_date: '2026-02-01', job_time_slot: '09:00', job_description: 'E2E small-screen probe booking, deleted by the case.',
            address_line1: '1 Probe Street', city: 'Calgary', payment_intent_id: `pi_e2e_small_${tag}`,
        },
    });
    expect(created.status(), 'checkout makes the probe booking').toBe(200);
    const id = (await created.json()).booking_id;
    expect(Number.isInteger(id), 'the probe booking has an id').toBe(true);
    const given = await request.put(`/api/bookings?id=${id}`, { headers: admin, data: { provider_id: PROVIDER1.id, status: 'matching' } });
    expect(given.status(), `admin gives booking ${id} to provider 1`).toBe(200);
    return { id, email };
}

/**
 * Presses `key` `count` times from where the page stands and answers what has the focus after each press.
 * @param {Page} page
 * @param {number} count
 * @param {string} [key]
 */
async function stopsAfter(page, count, key = 'Tab') {
    const stops = [];
    for (let pressed = 0; pressed < count; pressed += 1) {
        await page.keyboard.press(key);
        stops.push(await page.evaluate(() => {
            const focus = document.activeElement || document.body;
            const label = focus.getAttribute('aria-label') || focus.textContent || (focus.querySelector('img') && focus.querySelector('img')?.getAttribute('alt')) || '';
            return {
                tag: focus.tagName.toLowerCase(),
                label: label.replace(/\s+/g, ' ').trim().slice(0, 40),
                inHeader: Boolean(focus.closest('header')),
                inAside: Boolean(focus.closest('aside')),
            };
        }));
    }
    return stops;
}

/**
 * The names of the links and buttons inside an aside that the browser's accessibility tree holds as readable, which is what a screen reader reads there. The tree is read
 * from the browser itself (the Chrome DevTools protocol), not through getByRole or ariaSnapshot, so that what the page marks `inert` is judged by the browser and not by the
 * test's own idea of what is hidden.
 * @param {Page} page
 */
async function readableInAside(page) {
    const cdp = await page.context().newCDPSession(page);
    try {
        const { nodes } = await cdp.send('Accessibility.getFullAXTree');
        const found = [];
        for (const node of nodes) {
            if (node.ignored || !node.backendDOMNodeId || !['link', 'button'].includes(node.role?.value)) continue;
            const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: node.backendDOMNodeId });
            const { result } = await cdp.send('Runtime.callFunctionOn', {
                objectId: object.objectId,
                functionDeclaration: 'function () { return Boolean(this.closest("aside")); }',
                returnByValue: true,
            });
            if (result.value) found.push(node.name?.value || `unnamed ${node.role.value}`);
            await cdp.send('Runtime.releaseObject', { objectId: object.objectId });
        }
        return found;
    } finally {
        await cdp.detach();
    }
}

test.describe('Provider layout: the small screen', () => {
    sweepAround();

    // BUG-013 (ENG-031). On the old code the drawer was only translated off the screen, so a keyboard user met its eleven controls (the logo, Close, the eight links and Logout) before the menu
    // button, and a screen reader read them. The walk and the accessibility tree are read from a fresh load, then the menu is opened with the keyboard and closed by its button and by the backdrop.
    // Mutant that turns this case red: the closed menu is not `inert` (a stop of the twelve is in it, or the accessibility tree holds its links), the menu button has no name or does not say
    // whether the menu is open, opening the menu leaves the focus where it was, or closing it by the button or by the backdrop leaves the focus on the page start.
    test('A closed menu below 1024 px is not a tab stop and not read by a screen reader, and opening it moves focus into it', async ({ page }) => {
        test.setTimeout(240_000);
        await connectStripe();
        await signInAs(page, 'provider1');
        await page.setViewportSize({ width: 375, height: 812 });
        await warm(page.request, DASHBOARD_PATHS);
        await page.goto('/provider/dashboard', { timeout: FIRST_VISIT_MS });
        const menuButton = page.locator('header button').first();
        await expect(menuButton, 'the layout is up').toBeVisible({ timeout: FIRST_VISIT_MS });

        // The drawer comes before the header in the document, so a Tab from the top of the page meets it first, if it can be met.
        const stops = await stopsAfter(page, 12);
        expect(stops[0], 'the first stop of the page is the menu button in the header').toMatchObject({ tag: 'button', inHeader: true, inAside: false });
        expect(stops.filter((stop) => stop.inAside).map((stop) => stop.label || stop.tag), 'none of the first 12 stops is in the closed menu').toEqual([]);
        expect(await readableInAside(page), 'the accessibility tree holds no link or button of the closed menu').toEqual([]);

        const drawer = page.locator('#provider-menu');
        await expect(drawer, 'the closed menu is inert').toHaveAttribute('inert', '');
        await expect(menuButton, 'the menu button is named').toHaveAccessibleName('Open menu');
        await expect(menuButton, 'and says which menu it opens').toHaveAttribute('aria-controls', 'provider-menu');
        await expect(menuButton, 'and that it is closed').toHaveAttribute('aria-expanded', 'false');

        // Opened with the keyboard: the focus is in the menu, on its close button.
        const closeButton = drawer.getByRole('button', { name: 'Close menu' });
        await menuButton.focus();
        await page.keyboard.press('Enter');
        await expect(menuButton, 'the menu button says the menu is open').toHaveAttribute('aria-expanded', 'true');
        await expect(drawer, 'the open menu is not inert').not.toHaveAttribute('inert');
        await expect(closeButton, 'opening the menu moves the focus to its close button').toBeFocused();

        // Closed by its button: the focus is on the menu button and the menu is out of the tab order again (a Shift+Tab from the menu button goes to the end of the page, where the menu is
        // not, and not back into the menu that comes before the header).
        await closeButton.click();
        await expect(menuButton, 'closing the menu by its button returns the focus to the menu button').toBeFocused();
        await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
        await expect(drawer, 'the closed menu is inert again').toHaveAttribute('inert', '');
        const [back] = await stopsAfter(page, 1, 'Shift+Tab');
        expect(back.inAside, 'Shift+Tab from the menu button does not go back into the closed menu').toBe(false);

        // Closed by the backdrop (to the right of the 256 px menu): the same.
        await menuButton.focus();
        await page.keyboard.press('Enter');
        await expect(closeButton, 'the menu opens again').toBeFocused();
        await page.mouse.click(340, 500);
        await expect(menuButton, 'closing the menu by its backdrop returns the focus to the menu button').toBeFocused();
        await expect(drawer, 'and the menu is inert again').toHaveAttribute('inert', '');
    });

    // BUG-013 (ENG-031), the guard of the other side. From 1024 px the sidebar is the menu and the small-screen menu is not shown, so what `inert` does to the small screen must cost the wide
    // layout nothing: the sidebar's links are tab stops in the order they are listed, as they were. This case is green on the code before the change; it is there to stay green.
    // Mutant that turns this case red: a sidebar link is missing or out of order, a stop is in the header (which is not shown from 1024 px), or the small-screen menu is shown from 1024 px.
    test('From 1024 px the sidebar links are reached by Tab as before', async ({ page, context }) => {
        test.setTimeout(240_000);
        await connectStripe();
        await signInAs(page, 'provider1');
        await warm(page.request, DASHBOARD_PATHS);
        for (const [width, height] of [[1280, 800], [1024, 768]]) {
            const wide = width === 1280 ? page : await context.newPage();
            await wide.setViewportSize({ width, height });
            await wide.goto('/provider/dashboard', { timeout: FIRST_VISIT_MS });
            await expect(wide.getByRole('link', { name: 'Available Jobs' }).first(), `${width} px: the layout is up`).toBeVisible({ timeout: FIRST_VISIT_MS });
            const displays = await wide.evaluate(() => [...document.querySelectorAll('aside')].map((aside) => getComputedStyle(aside).display));
            expect(displays, `${width} px: the sidebar is shown and the small-screen menu is not`).toEqual(['flex', 'none']);

            // The logo, the button that narrows the sidebar, the eight links and Logout: eleven stops in the sidebar before the page's own.
            const stops = await stopsAfter(wide, 12);
            expect(stops.map((stop) => stop.label).slice(2, 11), `${width} px: the sidebar's links are tab stops in the order they are listed, and Logout is the last`).toEqual([...SIDEBAR_LINKS, 'Logout']);
            expect(stops.slice(0, 11).every((stop) => stop.inAside), `${width} px: the first eleven stops are in the sidebar`).toBe(true);
            expect(stops.some((stop) => stop.inHeader), `${width} px: no stop is in the header, which is not shown`).toBe(false);
            if (wide !== page) await wide.close();
        }
    });

    // BUG-014 (ENG-031). A booking reference of 18 characters and a customer e-mail of 45 made the job page of a completed job 8 to 19 px wider than a 375 px window, because the layout's column is a
    // flex item that cannot shrink below its content. The page-level measure is the criterion; the other is the check whether the rows need classes of their own once the column can shrink: the reference,
    // its status badge and the e-mail link each end inside the card they are in (a page-level measure cannot see a row that runs into the card's padding or out of the card).
    // Mutant that turns this case red: the layout's column or its main loses `min-w-0` (the page is wider than the window), or a row of the card at the top or of the customer's contact box grows past its card.
    test('A completed job and an open job do not scroll the page sideways at 375 px', async ({ page, request, baseURL }) => {
        test.setTimeout(300_000);
        const styles = await getCredentialHeaders(String(baseURL));
        const admin = styles['admin-cookie'];
        const jobs = [];
        for (const [status, last] of [['completed', '1'], ['confirmed', '2']]) {
            const { id, email } = await makeJobOfProvider1(request, admin);
            // 'BK' and 16 digits, as QA's probes have it; the digits of the checkout's own number are 15 to 18 characters long, so this one is set.
            const reference = `BK${Date.now()}00${last}`;
            expect(reference.length, 'the reference is 18 characters').toBe(18);
            await setReferenceAndStatus(id, reference, status);
            jobs.push({ status, id, email, reference });
        }

        await connectStripe();
        await signInAs(page, 'provider1');
        await page.setViewportSize({ width: 375, height: 812 });
        await warm(page.request, ['/provider/jobs/1', '/api/provider/me', '/api/provider/jobs/1', '/api/provider/jobs/photos', '/api/provider/crew', '/api/provider/jobs/1/crew']);
        for (const { status, id, email, reference } of jobs) {
            await page.goto(`/provider/jobs/${id}`, { timeout: FIRST_VISIT_MS });
            await expect(page.getByRole('heading', { name: 'Fixture Standard Clean', level: 1 }), `the ${status} job's page loads`).toBeVisible({ timeout: FIRST_VISIT_MS });
            await expect(page.getByRole('link', { name: email }), `the ${status} job shows the customer's e-mail`).toBeVisible();
            const fit = await page.evaluate(({ reference: wanted, email: address }) => {
                const cardOf = (/** @type {Element} */ element) => element.closest('[class*="rounded-"][class*="border"]');
                // How far an element ends past the right edge of the card it is in: 0 or less is inside the card, null is an element that is not on the page.
                const past = (/** @type {Element | null | undefined} */ element) => {
                    const card = element && cardOf(element);
                    return element && card ? Math.round((element.getBoundingClientRect().right - card.getBoundingClientRect().right) * 10) / 10 : null;
                };
                const referenceRow = [...document.querySelectorAll('p')].find((element) => (element.textContent || '').trim() === `#${wanted}`);
                const link = [...document.querySelectorAll('a[href^="mailto:"]')].find((element) => (element.textContent || '').trim() === address);
                return {
                    page: document.documentElement.scrollWidth,
                    window: window.innerWidth,
                    over: [...document.querySelectorAll('body *')]
                        .filter((el) => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible')
                        .map((el) => `${el.tagName.toLowerCase()}[${String(el.className).slice(0, 60)}] "${(el.textContent || '').trim().slice(0, 20)}" ${el.clientWidth}<${el.scrollWidth}`)
                        .slice(-6),
                    reference: past(referenceRow),
                    badge: past(referenceRow && referenceRow.nextElementSibling),
                    email: past(link),
                };
            }, { reference, email });
            expect(fit.page, `375 px, the ${status} job: the page is no wider than the window${fit.over.length ? ` (content runs past: ${fit.over.join(' | ')})` : ''}`).toBeLessThanOrEqual(fit.window);
            expect(fit.reference, `the ${status} job: the reference is on the page, in a card`).not.toBeNull();
            expect(fit.badge, `the ${status} job: the status badge is on the page, in a card`).not.toBeNull();
            expect(fit.email, `the ${status} job: the e-mail link is on the page, in a card`).not.toBeNull();
            expect(fit.reference, `the ${status} job: the reference ends inside its card`).toBeLessThanOrEqual(0);
            expect(fit.badge, `the ${status} job: the status badge ends inside its card`).toBeLessThanOrEqual(0);
            expect(fit.email, `the ${status} job: the e-mail link ends inside its card`).toBeLessThanOrEqual(0);
        }
    });
});
