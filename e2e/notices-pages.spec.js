// @ts-check
// e2e/notices-pages.spec.js
//
// ENG-018, step 8: the two pages whose address is a credential, /job/{token} and /card/{token}, run no site-wide script and answer with a
// Content-Security-Policy (src/lib/link-pages.js, src/middleware.js, src/app/layout.js; the design's Interfaces 8). This is the design's "Pages" row of the
// "Cases and baseline" table: six cases, two on each page's HTML (no site-wide script; the policy and its nonce) and one for each page in a browser.
//
// The site-wide scripts are whatever an admin pastes into the `global` row of seo_settings, and the four third-party tags in the root layout. This file
// places a global row whose header script is an element with an id of its own and no code in it (so it does nothing where it does appear), asks the home
// page for it (the CONTROL: a case that never placed the marker would find it on no page and pass for the wrong reason), and then asks each link page,
// which must not hold it and must name none of the three hosts of the layout's tags. No real link is needed: a token no one holds gets the same page shell.
//
// The browser cases load each page and fail on a securitypolicyviolation event, a console message about the policy, a page error, or a request of the page
// to any host but the app's own (the card page's one allowance is Stripe.js). The page asks the server about its token once it has loaded, so the case
// also waits for the page's "not valid" answer: that is the proof that the scripts ran under the policy, hydrated, and reached the app's own API. The card
// page imports @stripe/stripe-js, which puts Stripe.js on the page as soon as it is imported, with or without a key, so that load is held to the policy
// here (the script, and its controller frame, which Stripe's own frames then fill). A card ENTRY needs the publishable key the dev stack does not have
// (credentialGap family 'stripeJs'), so that case is ATTEMPTED: the page and Stripe.js under the policy are proved, the card field is not.
//
// The database is the dev database the way e2e/notices-routes.spec.js reaches it. The one row this file makes is the global seo_settings row (or, if
// there was one, its header script, put back after): the file restores it before the first case, after the last, and a leftover marker from a run that was
// killed is taken out first.
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { credentialGap } from './support/credentials.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';
import { newLinkToken } from '../src/lib/link-token.js';

test.use({ trace: 'off' });

const MARKER_ID = 'eng018-marker';
const MARKER = `<script id="${MARKER_ID}"></script>`;
// The hosts the layout's four third-party tags load from; the home page names them, a link page must not.
const HOSTS = ['unpkg.com', 'accounts.google.com', 'maps.googleapis.com'];
// A page's first visit after an edit is a compile, and the home page is a big one: 45 seconds is what a load average of 8 has taken.
const FIRST_VISIT_MS = 120_000;

const TOKEN = newLinkToken();
const TARGETS = [
    { kind: 'job', label: '/job/{token}', path: `/job/${TOKEN}`, invalid: 'This link is not valid.' },
    { kind: 'card', label: '/card/{token}', path: `/card/${TOKEN}`, invalid: "This link isn't valid or has expired. Ask WorkOnTap for a new one." },
];

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
        throw new Error(`the dev database did not accept a connection at ${DB.host}:${DB.port} (${/** @type {any} */ (error).code || 'no code'}); the test command runs the container with --network host`);
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

/** The header script a global row held before this file, or null when there was no such row. */
let original = null;

async function putTheGlobalRowBack() {
    const open = await db();
    if (original) {
        await open.execute('UPDATE seo_settings SET header_scripts = ? WHERE id = ?', [original.headerScripts, original.id]);
    } else {
        await open.execute("DELETE FROM seo_settings WHERE LOWER(page_name) = 'global' AND header_scripts = ?", [MARKER]);
    }
}

async function placeTheMarker() {
    const open = await db();
    // A marker a killed run left is not "what was there before": take it out first, so it is not restored as if it were.
    await open.execute("DELETE FROM seo_settings WHERE LOWER(page_name) = 'global' AND header_scripts = ?", [MARKER]);
    const [found] = /** @type {any[]} */ (await open.execute("SELECT id, header_scripts FROM seo_settings WHERE LOWER(page_name) = 'global' LIMIT 1"));
    if (found.length > 0) {
        original = { id: found[0].id, headerScripts: found[0].header_scripts };
        await open.execute('UPDATE seo_settings SET header_scripts = ? WHERE id = ?', [MARKER, found[0].id]);
    } else {
        original = null;
        await open.execute("INSERT INTO seo_settings (page_name, header_scripts) VALUES ('global', ?)", [MARKER]);
    }
}

test.beforeAll(placeTheMarker);
test.afterAll(async () => {
    if (!connection) return;
    try {
        await putTheGlobalRowBack();
    } finally {
        await connection.end();
        connection = null;
    }
});

/** The directives of a policy: { 'script-src': ["'self'", ...], ... }. */
function directivesOf(policy) {
    return Object.fromEntries(policy.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
        const [name, ...values] = part.split(/\s+/);
        return [name, values];
    }));
}
const nonceOf = (values) => (values.map((value) => /^'nonce-([^']+)'$/.exec(value)).find(Boolean) || [])[1];

test.describe('ENG-018 step 8: the link pages run no site-wide script and answer with a policy', () => {
    test.describe.configure({ timeout: FIRST_VISIT_MS });

    for (const target of TARGETS) {
        test(`${target.label}: the site-wide scripts are not in the page (the home page holds them)`, async ({ request }) => {
            const control = await request.get('/', { timeout: FIRST_VISIT_MS });
            expect(control.status(), 'control: the home page answers').toBe(200);
            const home = await control.text();
            expect(home, 'control: the home page holds the marker this case placed (a row for the page itself would shadow the global row)').toContain(`id="${MARKER_ID}"`);
            for (const host of HOSTS) expect(home, `control: the home page names ${host}`).toContain(host);

            const res = await request.get(target.path, { timeout: FIRST_VISIT_MS });
            expect(res.status(), `${target.label} answers`).toBe(200);
            const html = await res.text();
            expect(html, 'the marker is not in the page').not.toContain(MARKER_ID);
            for (const host of HOSTS) expect(html, `the page does not name ${host}`).not.toContain(host);
            const sources = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]*)"/g)].map((match) => match[1]);
            expect(sources.length, 'the page loads its own scripts').toBeGreaterThan(0);
            expect(sources.filter((source) => !source.startsWith('/')), 'every script the page loads is one of the app\'s own').toEqual([]);
        });

        test(`${target.label}: the policy, and a nonce that is on every script of the page`, async ({ request }) => {
            const first = await request.get(target.path, { timeout: FIRST_VISIT_MS });
            expect(first.status(), `${target.label} answers`).toBe(200);
            const policy = first.headers()['content-security-policy'];
            expect(policy, 'the page answers with a Content-Security-Policy').toBeTruthy();
            const directives = directivesOf(policy);

            expect(directives['default-src'], 'default-src').toEqual(["'none'"]);
            expect(directives['frame-ancestors'], 'frame-ancestors').toEqual(["'none'"]);
            expect(directives['object-src'], 'object-src').toEqual(["'none'"]);
            expect(directives['base-uri'], 'base-uri').toEqual(["'none'"]);
            expect(directives['form-action'], 'form-action').toEqual(["'self'"]);

            const nonce = nonceOf(directives['script-src'] || []);
            expect(nonce, 'script-src carries a nonce').toBeTruthy();
            const stripeScript = target.kind === 'card' ? ['https://js.stripe.com'] : [];
            const allowed = ["'self'", `'nonce-${nonce}'`, "'unsafe-eval'", ...stripeScript];
            expect(directives['script-src'].filter((value) => !allowed.includes(value)), 'script-src names nothing else: never unsafe-inline, never another host').toEqual([]);
            expect(directives['script-src'], 'script-src').toEqual(expect.arrayContaining(["'self'", `'nonce-${nonce}'`, ...stripeScript]));

            if (target.kind === 'card') {
                expect(directives['connect-src'], 'the card page may reach Stripe\'s API').toEqual(["'self'", 'https://api.stripe.com']);
                expect(directives['frame-src'], 'the card page may frame Stripe\'s two origins').toEqual(['https://js.stripe.com', 'https://hooks.stripe.com']);
            } else {
                expect(directives['connect-src'], 'the job page reaches only the app').toEqual(["'self'"]);
                expect(directives['frame-src'], 'the job page frames nothing').toEqual(["'none'"]);
            }
            expect(target.kind === 'card' || !/stripe/i.test(policy), 'no Stripe origin in the job page\'s policy').toBe(true);

            // Next puts the nonce on its own inline scripts when the request carried the policy: every inline script of the page, and the others as well.
            const html = await first.text();
            const tags = html.match(/<script\b[^>]*>/g) || [];
            const inline = tags.filter((tag) => !/\bsrc=/.test(tag));
            expect(inline.length, 'the page has inline scripts of Next\'s own, so the nonce has something to be on').toBeGreaterThan(0);
            for (const tag of tags) expect(tag, 'every script of the page carries the nonce of the policy').toContain(`nonce="${nonce}"`);

            const second = await request.get(target.path, { timeout: FIRST_VISIT_MS });
            const secondNonce = nonceOf(directivesOf(second.headers()['content-security-policy'] || '')['script-src'] || []);
            expect(secondNonce, 'a second response has a nonce').toBeTruthy();
            expect(secondNonce, 'a nonce is made for each response').not.toBe(nonce);
        });
    }

    for (const target of TARGETS) {
        test(`${target.label} in a browser: no policy violation, no page error, no request to another host`, async ({ page }, testInfo) => {
            // A card entry (the field Stripe draws) needs the publishable key: where it is missing the case says what it did not prove.
            if (target.kind === 'card') credentialGap(testInfo, 'stripeJs');

            /** @type {string[]} */ const consoleProblems = [];
            /** @type {string[]} */ const pageErrors = [];
            /** @type {string[]} */ const foreign = [];
            page.on('console', (message) => {
                if (/content security policy|refused to (load|execute|connect|frame|apply)/i.test(message.text())) consoleProblems.push(message.text().slice(0, 200));
            });
            page.on('pageerror', (error) => pageErrors.push(String(error.message).slice(0, 200)));
            // What the PAGE asks for is held to its policy; what Stripe's own frames ask for (m.stripe.com, m.stripe.network) is Stripe's, under Stripe's.
            page.on('request', (request) => {
                const url = new URL(request.url());
                if (['data:', 'blob:', 'about:'].includes(url.protocol)) return;
                if (!['localhost', '127.0.0.1'].includes(url.hostname) && request.frame() === page.mainFrame()) foreign.push(url.host);
            });
            await page.addInitScript(() => {
                // @ts-ignore
                window.__policyViolations = [];
                document.addEventListener('securitypolicyviolation', (event) => {
                    // @ts-ignore
                    window.__policyViolations.push(`${event.violatedDirective} ${event.blockedURI}`.slice(0, 200));
                });
            });

            await page.goto(target.path, { waitUntil: 'load', timeout: FIRST_VISIT_MS });
            // The page asks the app about its token once it has loaded: its answer on screen is the proof that the scripts ran under the policy.
            await expect(page.getByText(target.invalid).first(), 'the page ran and the app answered it').toBeVisible({ timeout: 60_000 });
            // A violation is reported as it happens, but a late one (an image, a font, a frame) gets a second to arrive.
            await page.waitForTimeout(1000);

            // @ts-ignore
            const violations = await page.evaluate(() => window.__policyViolations);
            expect(violations, 'securitypolicyviolation events').toEqual([]);
            expect(consoleProblems, 'console messages about the policy').toEqual([]);
            expect(pageErrors, 'page errors').toEqual([]);
            // The job page asks for nothing but the app's own and frames nothing. The card page's policy names Stripe.js, which loads as soon as the page's
            // code is imported (a key is not needed for that), and its controller frame: those two, and no other host, and no other frame.
            const allowedHosts = target.kind === 'card' ? ['js.stripe.com'] : [];
            const allowedFrameHosts = target.kind === 'card' ? ['js.stripe.com', 'hooks.stripe.com'] : [];
            expect(foreign.filter((host) => !allowedHosts.includes(host)), 'requests of the page to a host other than the app\'s own').toEqual([]);
            const frameHosts = page.mainFrame().childFrames().map((frame) => (frame.url().startsWith('about:') ? '' : new URL(frame.url()).host)).filter(Boolean);
            expect(frameHosts.filter((host) => !allowedFrameHosts.includes(host)), 'frames of the page from any other host').toEqual([]);
            if (target.kind === 'job') expect(page.mainFrame().childFrames().length, 'the job page frames nothing').toBe(0);
            expect(await page.locator(`#${MARKER_ID}`).count(), 'the marker is not in the page').toBe(0);
        });
    }
});
