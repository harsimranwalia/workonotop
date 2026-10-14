// @ts-check
// The homepage's booking box (src/components/home/BookingStarter.jsx) and the page around it (src/app/HomeClient.js): the hero, the services the
// box lists and where its button leads, the promises, the four steps and the first FAQ entries, the buttons that scroll back to the box, the bar at
// the foot of a phone-width screen, use by keyboard alone, and what the first HTML holds. The header's Book now link, and the header at every width,
// are in header-book-now.spec.js.
//
// The box asks the catalog for the services flagged for the homepage (GET /api/services?homepage=true) and, when none is flagged, for all of them
// (GET /api/services). The cases that need a catalog the fixtures cannot make (ten services, none flagged, none at all, one that cannot be read)
// answer those two calls from the test and nothing else; the cases that follow the real path use the fixture catalog (database/fixtures/catalog.js):
// services 1 and 2 are flagged for the homepage, 1 is popular and 2 is trending, 3 is not flagged.
//
// The service chips are native radios hidden with sr-only inside a label. Read them by role; act on them by their text (a click on the label), by
// keyboard, or with check({ force: true }): getByRole('radio').check() and .click() time out on them ("label intercepts pointer events").
import { test, expect } from '@playwright/test';
import { catalog } from '../database/fixtures/catalog.js';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('@playwright/test').Locator} Locator */

// Every case starts with no stored cookies: a visitor who has not signed in.
test.use({ storageState: { cookies: [], origins: [] } });

// `next dev` compiles a route on its first visit.
const FIRST_VISIT_MS = 45_000;

const DESKTOP = { width: 1280, height: 720 };
const PHONE = { width: 390, height: 844 };

const FLAGGED = catalog.tables.services.filter((service) => service.is_homepage === 1);
const STANDARD_CLEAN = catalog.tables.services.find((service) => service.id === 1);
const DEEP_CLEAN = catalog.tables.services.find((service) => service.id === 2);

const seeMyPrice = (/** @type {Locator} */ box) => box.getByRole('link', { name: 'See my price' });
const chipNames = async (/** @type {Locator} */ box) => (await box.locator('label').allInnerTexts()).map((name) => name.trim());

/**
 * Opens the homepage at a viewport and waits until the box has its catalog (its placeholder pulses until the catalog has answered, and a box with
 * an empty catalog shows no group at all, so the placeholder is what tells loading from loaded).
 * @param {Page} page
 */
async function openHome(page, viewport = DESKTOP) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const box = page.locator('#book');
    await expect(box).toBeVisible();
    await expect(box.locator('.animate-pulse')).toHaveCount(0, { timeout: FIRST_VISIT_MS });
    return box;
}

const stubService = (id, name, flags = {}) => ({ id, name, slug: `stub-${id}`, is_active: 1, is_homepage: 1, is_popular: 0, is_trending: 0, ...flags });

/**
 * Answers the box's two catalog calls from the test: `flagged` answers the call with ?homepage=true and `all` the call with no parameter at all.
 * Any other call to the route (the footer asks for ?limit=6) goes through to the real API. mode 'ok' answers 200 with the lists, 'error' answers
 * 500 and 'drop' drops the connection. Returns the box's calls so far, in order, each kind once (the dev server runs every effect twice).
 * @param {Page} page
 */
async function stubCatalog(page, { flagged = [], all = [], mode = 'ok' }) {
    /** @type {string[]} */
    const asked = [];
    await page.route((url) => url.pathname === '/api/services' && (url.searchParams.get('homepage') === 'true' || [...url.searchParams].length === 0), async (route) => {
        const homepage = new URL(route.request().url()).searchParams.get('homepage') === 'true';
        asked.push(homepage ? 'homepage' : 'all');
        if (mode === 'drop') return route.abort('connectionreset');
        if (mode === 'error') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'stubbed' }) });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: homepage ? flagged : all }) });
    });
    return () => [...new Set(asked)];
}

/** @param {Page} page */
function collectPageErrors(page) {
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    return errors;
}

/** True when the document is no wider than the screen. */
const fitsTheScreen = (/** @type {Page} */ page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** Waits until the page has stopped scrolling (an anchor jump may be animated). */
async function settled(/** @type {Page} */ page) {
    await expect.poll(async () => {
        const before = await page.evaluate(() => window.scrollY);
        await page.waitForTimeout(150);
        return before === (await page.evaluate(() => window.scrollY));
    }).toBe(true);
}

test.describe('Homepage hero and booking box', () => {
    for (const [name, viewport] of /** @type {const} */ ([['desktop width', DESKTOP], ['phone width', PHONE]])) {
        test(`${name}: the heading is kept, a line sits under it, the booking box is the main action and the search bar is below it`, async ({ page }) => {
            const errors = collectPageErrors(page);
            const box = await openHome(page, viewport);

            const heading = page.locator('h1');
            await expect(heading).toHaveCount(1);
            await expect(heading).toContainText('Cleaning, Moving & Handyman Services in Vancouver');
            // the new line sits directly under the heading
            await expect(page.locator('h1 + p')).toBeVisible();
            expect(((await page.locator('h1 + p').innerText()) || '').trim().length).toBeGreaterThan(20);

            await expect(box.getByText('What do you need done?')).toBeVisible();
            await expect(seeMyPrice(box)).toBeVisible();

            // the search bar is the secondary action: it sits below the box
            const search = page.getByRole('button', { name: 'Search', exact: true });
            await expect(search).toBeVisible();
            const boxArea = await box.boundingBox();
            const searchArea = await search.boundingBox();
            expect(boxArea && searchArea && searchArea.y > boxArea.y + boxArea.height).toBe(true);

            expect(await fitsTheScreen(page)).toBe(true);
            expect(errors).toEqual([]);
        });
    }

    test('lists at most eight services, the popular and trending ones first, and has the first already chosen', async ({ page }) => {
        // Ten services in the order the API gives them. The two that are flagged are the last two, so only a sort done before the cut puts them first.
        const ten = Array.from({ length: 10 }, (_, i) => stubService(101 + i, `Stub Service ${101 + i}`));
        ten[8] = { ...ten[8], is_popular: 1 };
        ten[9] = { ...ten[9], is_trending: 1 };
        // The rest of the catalog holds a service that is not flagged: it must not appear while the flagged list has services.
        const asked = await stubCatalog(page, { flagged: ten, all: [stubService(301, 'Stub Not Flagged', { is_homepage: 0 })] });
        const box = await openHome(page);

        const names = await chipNames(box);
        expect(names).toHaveLength(8);
        expect(names.slice(0, 2)).toEqual(['Stub Service 109', 'Stub Service 110']);
        await expect(box.getByRole('radio', { checked: true })).toHaveCount(1);
        await expect(box.getByRole('radio', { name: 'Stub Service 109' })).toBeChecked();
        await expect(seeMyPrice(box)).toHaveAttribute('href', '/booking/schedule?service=109');
        expect(names).not.toContain('Stub Not Flagged');
        // the flagged list had services, so the box did not ask for the whole catalog
        expect(asked()).toEqual(['homepage']);
    });

    test('lists the whole catalog when no service is flagged for the homepage', async ({ page }) => {
        const all = [
            stubService(201, 'Stub Clean', { is_homepage: 0 }),
            stubService(202, 'Stub Move', { is_homepage: 0, is_trending: 1 }),
            stubService(203, 'Stub Fix', { is_homepage: 0 }),
        ];
        const asked = await stubCatalog(page, { flagged: [], all });
        const box = await openHome(page);

        expect(await chipNames(box)).toEqual(['Stub Move', 'Stub Clean', 'Stub Fix']);
        await expect(box.getByRole('radio', { name: 'Stub Move' })).toBeChecked();
        await expect(seeMyPrice(box)).toHaveAttribute('href', '/booking/schedule?service=202');
        expect(asked()).toEqual(['homepage', 'all']);
    });

    test('with an empty catalog the button leads to /services', async ({ page }) => {
        // the click ends on a route `next dev` may still have to compile
        test.slow();
        const errors = collectPageErrors(page);
        await stubCatalog(page, { flagged: [], all: [] });
        const box = await openHome(page);

        await expect(box.getByRole('radiogroup')).toHaveCount(0);
        await expect(seeMyPrice(box)).toHaveAttribute('href', '/services');
        await seeMyPrice(box).click();
        await expect(page).toHaveURL(/\/services$/, { timeout: FIRST_VISIT_MS });
        expect(errors).toEqual([]);
    });

    for (const [how, mode] of /** @type {const} */ ([['answers 500', 'error'], ['is dropped', 'drop']])) {
        test(`when the catalog request ${how} the page raises no error and the button leads to /services`, async ({ page }) => {
            const errors = collectPageErrors(page);
            await stubCatalog(page, { mode });
            const box = await openHome(page);

            await expect(box.getByRole('radiogroup')).toHaveCount(0);
            await expect(seeMyPrice(box)).toHaveAttribute('href', '/services');
            expect(errors).toEqual([]);
        });
    }

    test('See my price arrives in the guided flow for the service that was chosen', async ({ page }) => {
        // the click ends on a route `next dev` may still have to compile
        test.slow();
        const box = await openHome(page);

        // the fixture catalog: the two flagged services, the popular one first and already chosen
        expect(await chipNames(box)).toEqual(FLAGGED.map((service) => service.name));
        await expect(box.getByRole('radio', { name: STANDARD_CLEAN.name })).toBeChecked();
        await expect(seeMyPrice(box)).toHaveAttribute('href', `/booking/schedule?service=${STANDARD_CLEAN.id}`);

        await box.getByText(DEEP_CLEAN.name).click();
        await expect(box.getByRole('radio', { name: DEEP_CLEAN.name })).toBeChecked();
        await expect(box.getByRole('radio', { name: STANDARD_CLEAN.name })).not.toBeChecked();
        await expect(seeMyPrice(box)).toHaveAttribute('href', `/booking/schedule?service=${DEEP_CLEAN.id}`);

        await seeMyPrice(box).click();
        await expect(page).toHaveURL(new RegExp(`/booking/schedule\\?service=${DEEP_CLEAN.id}$`), { timeout: FIRST_VISIT_MS });
        // the flow is open for that service, with the price of the answers on screen
        await expect(page.getByRole('region', { name: 'Your price' }).first()).toBeVisible({ timeout: FIRST_VISIT_MS });
    });

    test('the link carries the chosen service id alone, encoded, so it cannot add a query parameter', async ({ page }) => {
        await stubCatalog(page, { flagged: [stubService('9&service=1#x', 'Stub Odd Id')] });
        const box = await openHome(page);

        await expect(seeMyPrice(box)).toHaveAttribute('href', '/booking/schedule?service=9%26service%3D1%23x');
    });
});

test.describe('Homepage content', () => {
    test('carries the promises, the four steps and, at the top of the FAQ, the answers about the price and the charge', async ({ page }) => {
        await page.goto('/');

        const promises = page.locator('section', { has: page.getByRole('heading', { name: 'Protection Promise', exact: true }) });
        for (const promise of ['Your price before you book', 'Pay when the job is done', 'Protection Promise', 'Metro Vancouver']) {
            await expect(promises.getByRole('heading', { name: promise, exact: true })).toBeVisible();
        }
        await expect(promises.locator('a[href="/guarantee"]')).toHaveCount(1);

        await expect(page.getByRole('heading', { name: 'Booked in Four Short Steps' })).toBeVisible();
        const steps = page.locator('section', { has: page.getByRole('heading', { name: 'Booked in Four Short Steps' }) });
        await expect(steps.locator('ol > li')).toHaveCount(4);

        const faq = page.locator('section', { has: page.getByRole('heading', { name: 'Frequently Asked Questions' }) });
        const questions = faq.getByRole('button');
        await expect(questions.nth(0)).toHaveText('How do I get a price?');
        await expect(questions.nth(1)).toHaveText('When am I charged?');
        await questions.nth(1).click();
        await expect(faq.getByText('Payment is taken once the job is done.')).toBeVisible();
    });

    test('makes no claim of ratings, customer counts, "from" prices or a time to a price, and the one promise it makes is on /guarantee', async ({ page, request }) => {
        const box = await openHome(page);
        await expect(box.getByRole('radiogroup')).toBeVisible();
        const text = await page.locator('body').innerText();

        /** @type {Record<string, RegExp>} */
        const claims = {
            'a dollar amount': /\$\s?\d/,
            'a "from" price': /\bfrom\s+\$|\bstarting at\b|\bstarts? at\b/i,
            'a star rating': /★|⭐|\d(\.\d)?\s*(\/\s*5|stars?)\b/i,
            'a customer or booking count': /\d[\d,]*\+?\s+(happy\s+)?(customers|clients|bookings|reviews|ratings|homes|jobs)\b/i,
            'a time to a price': /\bminutes?\b/i,
        };
        for (const [what, pattern] of Object.entries(claims)) {
            expect(text.match(pattern), `the homepage text holds ${what}`).toBeNull();
        }

        // The Protection Promise says "within 48 hours": the site's own guarantee page has to say so too.
        expect(text).toMatch(/within 48 hours/);
        const guarantee = await (await request.get('/guarantee')).text();
        expect(guarantee).toMatch(/48\s*hours/);
    });

    test('has dropped the "Make Your Service Request More Accurate" section', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByRole('heading', { name: 'Frequently Asked Questions' })).toBeVisible();
        await expect(page.getByText('Make Your Service Request More Accurate')).toHaveCount(0);
    });

    for (const [name, viewport] of /** @type {const} */ ([['desktop width', DESKTOP], ['phone width', PHONE]])) {
        test(`${name}: every main button scrolls to the booking box and each section keeps its Explore link`, async ({ page }) => {
            const box = await openHome(page, viewport);
            // the five buttons of the sections and the closing banner; the phone-width bar (outside every section) is the next case's
            const mains = page.locator('section a[href="#book"]:visible');
            await expect(mains).toHaveText(
                ['See my price', 'Get a cleaning price', 'Get a moving price', 'Get a handyman price', 'See my price'].map((label) => new RegExp(`^\\s*${label}\\s*$`)),
            );

            const count = await mains.count();
            for (let i = 0; i < count; i += 1) {
                const button = mains.nth(i);
                await button.scrollIntoViewIfNeeded();
                // the box is out of view when the button is reached, so the click is what brings it back
                await expect(box).not.toBeInViewport();
                await button.click();
                await settled(page);
                // the box is at the top of the screen, clear of the 80 px sticky header
                const area = await box.boundingBox();
                expect(area, `after button ${i + 1} the box is on the screen`).not.toBeNull();
                expect(area?.y ?? -1).toBeGreaterThanOrEqual(80);
                expect(area?.y ?? 1e6).toBeLessThanOrEqual(200);
                expect(page.url()).toMatch(/#book$/);
            }

            const explore = [
                ['Explore Cleaning Services', '/services?category=cleaning'],
                ['Explore Moving Services', '/services?category=movers'],
                ['Explore Handyman Services', '/services?category=handyman'],
                ['Explore All Services', '/services'],
            ];
            for (const [label, href] of explore) {
                await expect(page.getByRole('link', { name: label, exact: true })).toHaveAttribute('href', href);
            }
        });
    }
});

test.describe('The bar at the foot of a phone-width screen', () => {
    /**
     * The bar is the "See my price" link whose parent is position: fixed. `shown` means it is displayed and inside the screen (it is moved just
     * below the screen's edge while the box is in view, and not displayed at all from 768 px up).
     * @param {Page} page
     */
    const barState = (page) => page.evaluate(() => {
        const link = [...document.querySelectorAll('a[href="#book"]')].find((a) => a.parentElement && getComputedStyle(a.parentElement).position === 'fixed');
        if (!link || !link.parentElement) return null;
        const bar = link.parentElement;
        const area = bar.getBoundingClientRect();
        return {
            shown: getComputedStyle(bar).display !== 'none' && area.top < window.innerHeight && area.bottom > 0,
            text: (link.textContent || '').trim(),
            bottom: Math.round(area.bottom),
            innerHeight: window.innerHeight,
        };
    });

    const scrollPastTheBox = (/** @type {Page} */ page) => page.evaluate(() => {
        const area = /** @type {HTMLElement} */ (document.getElementById('book')).getBoundingClientRect();
        window.scrollTo(0, window.scrollY + area.bottom + 300);
    });

    test('phone width: the bar shows See my price once the box has scrolled out of view, and goes when the box is back', async ({ page }) => {
        const box = await openHome(page, PHONE);

        // at the top the box is in view: no bar
        await expect.poll(() => barState(page)).toMatchObject({ shown: false });

        await scrollPastTheBox(page);
        await expect.poll(() => barState(page)).toMatchObject({ shown: true, text: 'See my price', bottom: PHONE.height });

        // the bar leads back to the box, and goes again once the box is in view
        await page.locator('.fixed > a[href="#book"]').click();
        await settled(page);
        await expect(box).toBeInViewport();
        await expect.poll(() => barState(page)).toMatchObject({ shown: false });
    });

    test('from 768 px up there is no bar, however far the page is scrolled; at 767 px there is', async ({ page }) => {
        await openHome(page, { width: 767, height: 900 });
        await scrollPastTheBox(page);
        await expect.poll(() => barState(page)).toMatchObject({ shown: true });

        await page.setViewportSize({ width: 768, height: 900 });
        await expect.poll(() => barState(page)).toMatchObject({ shown: false });

        await page.setViewportSize(DESKTOP);
        await scrollPastTheBox(page);
        await expect.poll(() => barState(page)).toMatchObject({ shown: false });
    });
});

test.describe('The booking box by keyboard and screen reader', () => {
    test('keyboard alone: one tab stop on the chosen service, the arrow keys choose, and See my price is the next stop', async ({ page }) => {
        // the click ends on a route `next dev` may still have to compile
        test.slow();
        const box = await openHome(page);
        const standard = box.getByRole('radio', { name: STANDARD_CLEAN.name });
        const deep = box.getByRole('radio', { name: DEEP_CLEAN.name });
        const link = seeMyPrice(box);

        // From the top of the page, Tab reaches the group at the chosen service, never at the other one.
        for (let presses = 0; presses < 40 && !(await box.evaluate((node) => node.contains(document.activeElement))); presses += 1) {
            await page.keyboard.press('Tab');
        }
        await expect(standard).toBeFocused();
        await expect(standard).toBeChecked();

        // The next stop is the button: the other service is not a tab stop, and Shift+Tab comes back to the chosen one.
        await page.keyboard.press('Tab');
        await expect(link).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(standard).toBeFocused();

        // The arrow keys move the choice, and the button's destination follows it.
        await page.keyboard.press('ArrowDown');
        await expect(deep).toBeFocused();
        await expect(deep).toBeChecked();
        await expect(standard).not.toBeChecked();
        await expect(link).toHaveAttribute('href', `/booking/schedule?service=${DEEP_CLEAN.id}`);
        await page.keyboard.press('ArrowUp');
        await expect(standard).toBeFocused();
        await expect(link).toHaveAttribute('href', `/booking/schedule?service=${STANDARD_CLEAN.id}`);
        await page.keyboard.press('ArrowRight');
        await expect(deep).toBeChecked();

        // Tab, then Enter: the flow for the service the keys chose.
        await page.keyboard.press('Tab');
        await expect(link).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(new RegExp(`/booking/schedule\\?service=${DEEP_CLEAN.id}$`), { timeout: FIRST_VISIT_MS });
    });

    test('the accessibility tree: one radio group named "What do you need done?" with the services in it and exactly one checked', async ({ page }) => {
        const box = await openHome(page);

        const group = box.getByRole('radiogroup', { name: 'What do you need done?' });
        await expect(group).toHaveCount(1);
        await expect(group.getByRole('radio')).toHaveCount(FLAGGED.length);
        await expect(group.getByRole('radio', { checked: true })).toHaveCount(1);
        await expect(group).toMatchAriaSnapshot(`
          - radiogroup "What do you need done?":
            - radio "${STANDARD_CLEAN.name}" [checked]
            - radio "${DEEP_CLEAN.name}"
        `);

        // the choice is announced from the tree: after choosing the other service the checked radio is that one
        await group.getByRole('radio', { name: DEEP_CLEAN.name }).check({ force: true });
        await expect(group.getByRole('radio', { checked: true })).toHaveCount(1);
        await expect(group.getByRole('radio', { name: DEEP_CLEAN.name })).toBeChecked();
    });
});

test.describe('The first HTML', () => {
    test('carries the booking box and its See my price link and no Book now link, which the header draws once the session is known', async ({ request }) => {
        const html = await (await request.get('/')).text();

        expect(html).toContain('id="book"');
        expect(html).toContain('What do you need done?');
        expect(html).toMatch(/<a[^>]*href="[^"]*"[^>]*>See my price/);
        expect(html).not.toMatch(/>Book now</);
    });
});
