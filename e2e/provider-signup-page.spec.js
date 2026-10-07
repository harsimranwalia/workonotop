// @ts-check
// The provider sign-up page (/provider/signup) sends its form in its first response, shows the form while the provider session check has not
// answered, and creates a provider account from valid details. Three cases, numbered 9 to 11 of the ticket's eleven:
//   9   GET /provider/signup answers 200 and its HTML holds a form with inputs named firstName, lastName, email, phone, password and
//       confirmPassword (a plain request: no script runs);
//   10  in a new browser context, with GET /api/provider/me held open and never answered, the e-mail input is visible within 10 s;
//   11  valid details submitted on the page open /provider/verify-email-pending for the address and store one service_providers row with
//       status 'inactive'; the same body posted to POST /api/provider/signup answers 400 and the table still holds one row for the address.
//       The row is deleted in `finally`; the PROVIDER_REGISTERED activity_logs row that the sign-up writes for it stays.
// Case 11 reads the stored row with a small database helper that checks the target before it connects (assertDevTarget: a local host and
// the database workontap_db) and the rows once connected (assertNoRealPeople: no e-mail address outside the reserved test names), the two
// guards the fixture loader uses. It reaches the database the way the department's test command lets it: that container runs with
// --network host, so the published port 127.0.0.1:3307 is the dev database. The account is e2e-eng006-<6 hex>@workontap.test (32
// characters: the verification token stored for an address overflows its varchar(255) column from about 40), with no phone. The case skips,
// with its reason, when the app's environment names SMTP credentials (E2E_APP_ENV_NAMES, the runner's list of the app's variable names, as
// in e2e/ownership.spec.js) or the runner gave no list: the sign-up route then mails an admin notice to ADMIN_EMAIL or its built-in address.
import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { RESET_RETRIES } from './support/auth.js';
import { CREDENTIALS } from './support/credentials.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';

// Every case starts with no stored cookies: the sign-up page is what a visitor with no session sees.
test.use({ storageState: { cookies: [], origins: [] } });

const FORM_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'password', 'confirmPassword'];
// The names under which the app can hold e-mail credentials (SMTP_USER or EMAIL_USER, SMTP_PASS or EMAIL_PASS: src/lib/email.js).
const SMTP_NAMES = CREDENTIALS.email.flatMap((requirement) => requirement.split('|'));

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

// The form is in the page's own HTML, so its fields can be typed into before the page's scripts have attached to them. React marks each
// element it has attached to with a __reactProps$ property: wait until the page's six inputs and its submit button each carry one.
async function waitForScripts(page) {
    await expect.poll(
        () => page.evaluate((names) => {
            const parts = [...names.map((name) => document.querySelector(`input[name="${name}"]`)), document.querySelector('form button[type="submit"]')];
            return parts.every((part) => part !== null && Object.keys(part).some((key) => key.startsWith('__reactProps$')));
        }, FORM_FIELDS),
        { message: 'the scripts of the sign-up page attach to its form', timeout: 30_000 },
    ).toBe(true);
}

test.describe('Provider sign-up page', () => {
    // The page's own HTML is what a visitor receives before any script has run, and a plain request reads exactly that.
    test('the provider sign-up page sends its form in the first response', async ({ request }) => {
        const response = await request.get('/provider/signup', { maxRetries: RESET_RETRIES, timeout: 60_000 });
        expect(response.status(), 'GET /provider/signup').toBe(200);
        const html = await response.text();
        expect(html.includes('<form'), 'the first response holds a form').toBe(true);
        for (const name of FORM_FIELDS) {
            expect(new RegExp(`<input\\s[^>]*\\bname="${name}"`).test(html), `the first response holds an input named ${name}`).toBe(true);
        }
    });

    // The provider pages ask GET /api/provider/me who the visitor is. The handler takes that request and never answers it, so the session
    // check stays open for the whole case; the form is on screen all the same.
    test('the provider sign-up page shows its form while the session check has not answered', async ({ page }) => {
        await page.route('**/api/provider/me', () => {});
        await page.goto('/provider/signup');
        await expect(page.locator('input[name="email"]')).toBeVisible({ timeout: 10_000 });
    });

    // The whole sign-up through the page: the fields are filled by the names the page gives them, the button is the page's own
    // 'Create Pro Account', and the page opens /provider/verify-email-pending?email=<address> when the route accepts the details. The route
    // is then asked for the same sign-up again.
    test('valid details on the provider sign-up page create a provider account waiting for e-mail verification', async ({ page, request }) => {
        // A cold `next dev` compiles the page, the sign-up route and the pending page on their first requests.
        test.setTimeout(120_000);
        const names = process.env.E2E_APP_ENV_NAMES;
        test.skip(names === undefined || names.split(',').some((name) => SMTP_NAMES.includes(name.trim())), 'the app names SMTP credentials, or the runner gave no list of the variable names the app has: the sign-up route would mail an admin notice');
        // The guard and the connection come first, so a database that cannot be reached stops the case before an account exists.
        await db();

        const tag = randomBytes(3).toString('hex');
        const password = `Pw-${randomBytes(4).toString('hex')}!`;
        // The body is what the page posts: its six fields, the phone empty.
        /** @type {Record<string, string>} */
        const body = { firstName: 'E2E', lastName: `Signup ${tag}`, email: `e2e-eng006-${tag}@workontap.test`, phone: '', password, confirmPassword: password };
        try {
            await page.goto('/provider/signup');
            await waitForScripts(page);
            // The phone is optional and stays empty; every other field takes the value of the body.
            for (const [name, value] of Object.entries(body)) {
                if (value !== '') await page.locator(`input[name="${name}"]`).fill(value);
            }
            await page.getByRole('button', { name: 'Create Pro Account' }).click();
            await expect(page, 'the page opens the verification-pending page').toHaveURL(/\/provider\/verify-email-pending\?email=/, { timeout: 45_000 });
            expect(new URL(page.url()).searchParams.get('email'), 'the pending page is for the address that signed up').toBe(body.email);

            const stored = await rows('SELECT name, status, email_verified FROM service_providers WHERE email = ?', [body.email]);
            expect(stored.length, 'one service_providers row for the address').toBe(1);
            expect(stored[0].status, 'the new account is inactive').toBe('inactive');
            expect(Number(stored[0].email_verified), 'the address is not verified yet').toBe(0);
            expect(stored[0].name, 'the name is the first and last name that were entered').toBe(`${body.firstName} ${body.lastName}`);

            // The route finds the address already registered.
            const again = await request.post('/api/provider/signup', { data: body, maxRetries: RESET_RETRIES, timeout: 60_000 });
            expect(again.status(), 'the same sign-up posted again').toBe(400);
            expect((await again.json()).message, 'the second sign-up is refused because the address is registered').toBe('Email already registered');
            const left = await rows('SELECT id FROM service_providers WHERE email = ?', [body.email]);
            expect(left.length, 'the table still holds one row for the address').toBe(1);
        } finally {
            await (await db()).query('DELETE FROM service_providers WHERE email = ?', [body.email]);
        }
    });
});
