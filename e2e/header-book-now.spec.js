// @ts-check
// The shared header (src/components/Header.js) after ENG-026: the Book now link a visitor or a customer sees on desktop and on a phone and a
// provider or an admin does not, the outlined Sign Up button, the menu button's accessible name, and the header's fit at the widths the site is
// used at: no overflow, no overlap, no wrapped label, no page error. The homepage's booking box is in home-booking-box.spec.js.
//
// The header draws a skeleton until the session is known (src/context/AuthContext.js), so a case that expects the link to be absent first waits
// for something only the full header holds: the account button at desktop width, the menu button on a phone.
//
// Fixture accounts sign in through each role's own login route (e2e/support/auth.js); the cases write nothing to the database.
import { test, expect } from '@playwright/test';
import { signInAs } from './support/auth.js';

/** @typedef {import('@playwright/test').Page} Page */

// Every case starts with no stored cookies: a visitor who has not signed in.
test.use({ storageState: { cookies: [], origins: [] } });

// `next dev` compiles a route on its first visit.
const FIRST_VISIT_MS = 45_000;

const DESKTOP = { width: 1280, height: 720 };
const PHONE = { width: 390, height: 844 };

/** What the account button says about each fixture account, once the session is known. */
const ROLE_LABEL = { customer1: 'Customer', provider1: 'Pro Account', admin: 'Admin' };

const headerOf = (/** @type {Page} */ page) => page.locator('header');

test.describe('Book now in the header', () => {
    test('visitor at desktop width: a green Book now link to /#book, and Sign Up is an outlined button', async ({ page }) => {
        await page.setViewportSize(DESKTOP);
        await page.goto('/');
        const header = headerOf(page);

        const book = header.getByRole('link', { name: 'Book now' });
        await expect(book).toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(book).toHaveAttribute('href', '/#book');
        const [red, green, blue] = (await book.evaluate((link) => getComputedStyle(link).backgroundColor)).match(/\d+/g)?.map(Number) ?? [0, 0, 0];
        expect(green, 'the link is filled green').toBeGreaterThan(Math.max(red, blue) + 40);

        // Sign Up is outlined: a border and no fill.
        const signUp = header.getByRole('button', { name: 'Sign Up' });
        await expect(signUp).toBeVisible();
        const look = await signUp.evaluate((button) => {
            const style = getComputedStyle(button);
            return { fill: style.backgroundColor, border: parseFloat(style.borderTopWidth) };
        });
        expect(look.border).toBeGreaterThan(0);
        expect(look.fill).toBe('rgba(0, 0, 0, 0)');
    });

    test('visitor on a phone: Book now sits beside a menu button that has a name, and pressing it closes an open menu on the way to the box', async ({ page }) => {
        await page.setViewportSize(PHONE);
        await page.goto('/');
        const header = headerOf(page);

        const menu = header.getByRole('button', { name: 'Open menu' });
        await expect(menu).toBeVisible({ timeout: FIRST_VISIT_MS });
        const book = header.getByRole('link', { name: 'Book now' });
        await expect(book).toBeVisible();
        await expect(book).toHaveAttribute('href', '/#book');

        await menu.click();
        await expect(header.getByRole('button', { name: 'Close menu' })).toBeVisible();
        await book.click();
        await expect(page).toHaveURL(/\/#book$/);
        await expect(header.getByRole('button', { name: 'Open menu' })).toBeVisible();
        await expect(page.locator('#book')).toBeInViewport();
    });

    for (const [who, canBook] of /** @type {const} */ ([['customer1', true], ['provider1', false], ['admin', false]])) {
        for (const [name, viewport] of /** @type {const} */ ([['desktop', DESKTOP], ['phone', PHONE]])) {
            test(`${who} at ${name} width: Book now ${canBook ? 'shows' : 'does not show'}`, async ({ page }) => {
                await signInAs(page, who);
                await page.setViewportSize(viewport);
                await page.goto('/');
                const header = headerOf(page);

                // Wait for the session to be known, so that "no link" is not just the skeleton.
                if (name === 'desktop') {
                    await expect(header.getByText(ROLE_LABEL[who], { exact: true })).toBeVisible({ timeout: FIRST_VISIT_MS });
                } else {
                    await expect(header.getByRole('button', { name: 'Open menu' })).toBeVisible({ timeout: FIRST_VISIT_MS });
                }

                const book = header.getByRole('link', { name: 'Book now' });
                if (canBook) {
                    await expect(book).toBeVisible();
                    await expect(book).toHaveAttribute('href', '/#book');
                } else {
                    await expect(book).toHaveCount(0);
                }
            });
        }
    }

    test('from another page the link lands on the booking box, clear of the sticky header', async ({ page }) => {
        test.slow();
        await page.setViewportSize(DESKTOP);
        await page.goto('/guarantee');

        await headerOf(page).getByRole('link', { name: 'Book now' }).click();
        await expect(page).toHaveURL(/\/#book$/, { timeout: FIRST_VISIT_MS });
        const box = page.locator('#book');
        await expect(box).toBeInViewport();
        await expect.poll(async () => (await box.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(80);
    });
});

// ---- The header's fit (criterion 8) ---------------------------------------------------------------------------------------------------------
//
// "Fits" is: nothing in the nav or on the page is wider than the screen, no two controls overlap, no label breaks onto a second line, and the page
// raises no error. The header has two layouts and switches at 768 px (md:), so "desktop width" is every width from 768 up and a phone is every
// width below it. The standard for a label that wraps is "no worse than the merge base 9c59846": the table below lists the labels that already
// wrapped there (measured on a copy of that commit; the head is measured against it, and no width of a signed-out visitor wrapped at the base).

/** The labels that wrapped at the merge base 9c59846 at a width, by state. Anything else that wraps now was caused by the change. */
const WRAPPED_AT_BASE = {
    'signed-out': { 768: [], 810: [], 834: [], 896: [] },
    customer1: { 768: ['Explore Services', 'Help Center'], 810: [], 834: [], 896: [] },
};

/**
 * What the shared header looks like on the page that is open: how wide the page and the nav are against the screen, which labels take more than one
 * line (the lines of the TEXT, so an icon beside a label is not a second line), which controls overlap, and how far the menu button is from the right
 * edge of a phone.
 * @param {Page} page
 */
function measureHeader(page) {
    return page.evaluate(() => {
        const shown = (/** @type {Element} */ element) => {
            const area = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return area.width > 0 && area.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const linesOf = (/** @type {Element} */ element) => {
            const tops = new Set();
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            for (let text = walker.nextNode(); text; text = walker.nextNode()) {
                if (!text.textContent?.trim()) continue;
                const range = document.createRange();
                range.selectNodeContents(text);
                for (const area of range.getClientRects()) if (area.width > 0) tops.add(Math.round(area.top));
            }
            return tops.size;
        };
        const nav = /** @type {HTMLElement} */ (document.querySelector('header nav'));
        const page = document.documentElement;
        const controls = [...nav.querySelectorAll('a, button')].filter(shown);
        const wrapped = [...nav.querySelectorAll('*')]
            .filter((element) => shown(element) && [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent?.trim()) && linesOf(element) > 1)
            .map((element) => (element.textContent || '').trim().replace(/\s+/g, ' '));
        const overlaps = [];
        for (let i = 0; i < controls.length; i += 1) {
            for (let j = i + 1; j < controls.length; j += 1) {
                if (controls[i].contains(controls[j]) || controls[j].contains(controls[i])) continue;
                const a = controls[i].getBoundingClientRect();
                const b = controls[j].getBoundingClientRect();
                if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) {
                    overlaps.push(`${(controls[i].textContent || controls[i].getAttribute('aria-label') || '').trim()} / ${(controls[j].textContent || controls[j].getAttribute('aria-label') || '').trim()}`);
                }
            }
        }
        // On a phone the nav holds the logo, Book now and one button: the menu button (its accessible name is criterion 7's, not this check's).
        const menu = window.innerWidth < 768 ? controls.filter((control) => control.tagName === 'BUTTON').pop() : undefined;
        const book = controls.find((control) => control.tagName === 'A' && (control.textContent || '').trim() === 'Book now');
        return {
            screen: window.innerWidth,
            pageScroll: page.scrollWidth,
            pageClient: page.clientWidth,
            navScroll: nav.scrollWidth,
            navClient: nav.clientWidth,
            wrapped,
            overlaps,
            menuInset: menu ? Math.round((window.innerWidth - menu.getBoundingClientRect().right) * 10) / 10 : null,
            bookLines: book ? linesOf(book) : null,
        };
    });
}

/**
 * Opens a page at a width, as a visitor or as a fixture account, and waits for the whole header: its nav (the skeleton has none), its logo and the fonts.
 * @param {Page} page
 * @param {string} path
 * @param {number} width
 * @param {'signed-out'|'customer1'|'provider1'|'admin'} who
 */
async function openWithHeader(page, path, width, who) {
    const errors = /** @type {string[]} */ ([]);
    page.on('pageerror', (error) => errors.push(error.message));
    if (who !== 'signed-out') await signInAs(page, who);
    await page.setViewportSize({ width, height: 800 });
    await page.goto(path);
    await page.locator('header nav').waitFor({ timeout: FIRST_VISIT_MS });
    await page.waitForFunction(() => {
        const logo = document.querySelector('header nav img');
        return !logo || (/** @type {HTMLImageElement} */ (logo)).complete;
    });
    await page.evaluate(() => document.fonts.ready);
    return errors;
}

/**
 * The header fits: no overflow, no overlap, no wrapped label beyond `mayWrap`, and on a phone the menu button at least 8 px inside the screen and
 * Book now (when it is there) on one line.
 * @param {Page} page
 * @param {string[]} errors
 * @param {{ phone: boolean, mayWrap?: string[] }} options
 */
async function expectHeaderFits(page, errors, { phone, mayWrap = [] }) {
    const header = await measureHeader(page);
    expect(header.pageScroll, `the page is wider than the ${header.screen} px screen`).toBeLessThanOrEqual(header.pageClient);
    expect(header.navScroll, `the nav is wider than the ${header.screen} px screen`).toBeLessThanOrEqual(header.navClient);
    expect(header.overlaps, 'controls overlap').toEqual([]);
    expect(header.wrapped.filter((label) => !mayWrap.includes(label)), 'labels that break onto a second line').toEqual([]);
    if (phone) {
        expect(header.menuInset, 'the menu button is not inside the screen').not.toBeNull();
        expect(header.menuInset ?? -1, 'the menu button ends this far inside the screen').toBeGreaterThanOrEqual(8);
        if (header.bookLines !== null) expect(header.bookLines, 'lines of Book now').toBe(1);
    }
    expect(errors, 'page errors').toEqual([]);
}

test.describe('The header fits', () => {
    for (const width of [320, 360, 375, 390, 412]) {
        for (const who of /** @type {const} */ (['signed-out', 'customer1'])) {
            test(`${who === 'signed-out' ? 'signed out' : 'as a customer'} at ${width} px (phone): the menu button is inside the screen and nothing overflows, overlaps or wraps`, async ({ page }) => {
                const errors = await openWithHeader(page, '/', width, who);
                await expectHeaderFits(page, errors, { phone: true });
            });
        }
    }

    for (const width of [1024, 1280]) {
        for (const who of /** @type {const} */ (['signed-out', 'customer1', 'provider1', 'admin'])) {
            test(`${who === 'signed-out' ? 'signed out' : `as ${who}`} at ${width} px (desktop): nothing overflows, overlaps or wraps`, async ({ page }) => {
                const errors = await openWithHeader(page, '/', width, who);
                await expectHeaderFits(page, errors, { phone: false });
            });
        }
    }

    // The band from 768 up to where the row has room again: the desktop row at its narrowest, where the Book now button is a hundred pixels the row did not
    // have at the base. A customer's "Explore Services" and "Help Center" already wrapped at 768 at the base, and nothing else did.
    for (const width of [768, 810, 834, 896]) {
        for (const who of /** @type {const} */ (['signed-out', 'customer1'])) {
            test(`${who === 'signed-out' ? 'signed out' : 'as a customer'} at ${width} px (tablet): no worse than the merge base, nothing overflows or overlaps`, async ({ page }) => {
                const errors = await openWithHeader(page, '/', width, who);
                await expectHeaderFits(page, errors, { phone: false, mayWrap: WRAPPED_AT_BASE[who][width] });
            });
        }
    }

    // Pages other than / and /services: the sign-in pages, the account pages and the booking flow all draw the same header, and unlike the homepage
    // (which clips its own overflow) they scroll sideways when the header is too wide.
    for (const [who, path] of /** @type {const} */ ([
        ['signed-out', '/guarantee'],
        ['signed-out', '/booking/schedule?service=1'],
        ['customer1', '/my-bookings'],
        ['customer1', '/booking/schedule?service=1'],
        ['customer1', '/services'],
    ])) {
        for (const width of [375, 768, 834]) {
            test(`${who === 'signed-out' ? 'signed out' : 'as a customer'} on ${path} at ${width} px: the header fits, as at the merge base`, async ({ page }) => {
                // the account pages and the booking flow may be cold routes for `next dev`
                test.slow();
                const errors = await openWithHeader(page, path, width, who);
                const phone = width < 768;
                await expectHeaderFits(page, errors, { phone, mayWrap: phone ? [] : WRAPPED_AT_BASE[who][/** @type {768|834} */ (width)] });
            });
        }
    }
});

// ---- Which header each role gets at tablet width (BUG-008's fix) ----------------------------------------------------------------------------
//
// With Book now in it the desktop row is 763 px wide for a visitor and 848 px for a customer, and 768 px leaves it 720, so whoever can book keeps the
// phone header (Book now and a menu button) until 1024 px (lg:). A provider or an admin has no Book now and keeps the desktop row from 768 px (md:),
// exactly as before the ticket. These cases pin both halves, the edge of the band at 1024, and that the phone header still reaches every link the
// desktop row has (a visitor on a tablet has nothing else to reach them with).

/** The links the phone menu holds for someone who can book: everything the desktop row and its two dropdowns offer. */
const MENU_LINKS = {
    'signed-out': ['Explore Services', 'Help Center', 'Customer Login', 'Customer Sign Up', 'Provider Login', 'Become a Provider'],
    customer1: ['Explore Services', 'Dashboard', 'Help Center'],
};

test.describe('The header by role at tablet width', () => {
    for (const width of [768, 1000, 1023]) {
        for (const who of /** @type {const} */ (['signed-out', 'customer1'])) {
            test(`${who === 'signed-out' ? 'signed out' : 'as a customer'} at ${width} px: the phone header, and a menu that holds every link the desktop row has`, async ({ page }) => {
                const errors = await openWithHeader(page, '/', width, who);
                const header = headerOf(page);

                await expect(header.getByRole('link', { name: 'Book now' })).toBeVisible();
                // The desktop row is not drawn: its links are in the document, hidden, and a role query leaves hidden elements out.
                await expect(header.getByRole('link', { name: 'Help Center' })).toHaveCount(0);
                const menu = header.getByRole('button', { name: 'Open menu' });
                await expect(menu).toBeVisible();

                await menu.click();
                await expect(header.getByRole('button', { name: 'Close menu' })).toBeVisible();
                for (const name of MENU_LINKS[who]) await expect(header.getByRole('link', { name, exact: true }), name).toBeVisible();
                expect(errors, 'page errors').toEqual([]);
            });
        }
    }

    for (const who of /** @type {const} */ (['signed-out', 'customer1'])) {
        test(`${who === 'signed-out' ? 'signed out' : 'as a customer'} at 1024 px: the desktop row, with Book now in it and no menu button`, async ({ page }) => {
            await openWithHeader(page, '/', 1024, who);
            const header = headerOf(page);

            await expect(header.getByRole('link', { name: 'Book now' })).toBeVisible();
            await expect(header.getByRole('link', { name: 'Help Center' })).toBeVisible();
            await expect(header.getByRole('button', { name: 'Open menu' })).toHaveCount(0);
        });
    }

    for (const width of [768, 1000]) {
        for (const who of /** @type {const} */ (['provider1', 'admin'])) {
            test(`${who} at ${width} px: the desktop row as before the ticket, with no Book now and no menu button`, async ({ page }) => {
                await openWithHeader(page, '/', width, who);
                const header = headerOf(page);

                await expect(header.getByText(ROLE_LABEL[who], { exact: true })).toBeVisible();
                await expect(header.getByRole('link', { name: 'Help Center' })).toBeVisible();
                await expect(header.getByRole('link', { name: 'Book now' })).toHaveCount(0);
                await expect(header.getByRole('button', { name: 'Open menu' })).toHaveCount(0);
            });
        }
    }
});
