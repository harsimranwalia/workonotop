// @ts-check
// ENG-015: the screens of the job link, in a browser. The "Screens" row of the design's "Cases and baseline" table
// (agents/architect/designs/ENG-015-secure-job-link-and-crew-check-in.md): /job/{token} in each state (not valid; a visitor with no way in; the code
// step; the job; before the window; a check-in at the address, far from it, and with the position refused), the provider's panel, the admin's panel, and
// the number check on /provider/crew. The server's cases are in the job-link, job-link-access and job-checkin specs; these cases drive the screens and
// read the database only to make a job and to find what a text would carry (no texting service is set up in dev).
// A job is made the way e2e/job-checkin.spec.js makes one: a booking of provider 1 inserted in SQL, the crew put on it through ENG-014's route and the
// link made through ENG-015's. A cleaner's session is made through the routes (a code asked for, found from its hash, given back) and its cookie put in the
// page's context, so the cases that are not about signing in start signed in. Every case uses the numbers +1 604 555 0160 to 0179 and the e-mail prefix
// below; the sweep before the first case, after every case and after the last removes the bookings of that prefix (their links, codes, check-ins, events
// and crew rows go with them), the crew members of that block and the sms_budget counters of those links, members and numbers.
// Failure messages name the case, never a token, a code or a cookie.
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { getCredentialHeaders } from './auth/credentials.js';
import { signInAs } from './support/auth.js';
import { providers } from '../database/fixtures/accounts.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';
import { sha256Hex } from '../src/lib/link-token.js';
import { PHONE_HINT } from '../src/lib/phone.js';
import { budgetScope } from '../src/lib/sms-budget.js';

// Every request carries a fixture account's session header and a trace records request headers: tracing is off, as in the specs next to this one.
test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

const [PROVIDER1] = providers;
const EMAIL_PREFIX = 'e2e-js-';
const FIRST = 160;
const LAST = 179;
const stored = (last3) => `+16045550${last3}`;
const typed = (last3) => `+1 604 555 0${last3}`;
const US_NUMBER = '+12125550170';
const FIRST_VISIT_MS = 45_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ADDRESS = { latitude: 51.04473, longitude: -114.07192 };
const AT_THE_ADDRESS = { latitude: ADDRESS.latitude, longitude: ADDRESS.longitude, accuracy: 12 };
const TWO_KM_OFF = { latitude: ADDRESS.latitude + 0.018, longitude: ADDRESS.longitude, accuracy: 30 };
const NOT_VALID = 'This link is not valid.';
const CODE_FAILED = "That code didn't work. Check it and try again, or ask for a new one.";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- the dev database, as the specs next to this one reach it ----

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

// Every statement of this file is prepared, with a ? for every value.
async function rows(sql, params = []) {
    const [found] = await (await db()).execute(sql, params);
    return /** @type {any[]} */ (found);
}
const countOf = async (sql, params = []) => Number((await rows(sql, params))[0].n);

async function resetBudgets(...scopes) {
    const open = await db();
    for (const scope of scopes) await open.execute('DELETE FROM sms_budget WHERE scope = ?', [scope]);
}

// Deletes what this file left. The Stripe flag goes back to 0, as the fixtures have it.
async function sweepOnce() {
    const open = await db();
    const links = await rows('SELECT l.id FROM job_links l JOIN bookings b ON b.id = l.booking_id WHERE b.customer_email LIKE ?', [`${EMAIL_PREFIX}%`]);
    const members = await rows('SELECT id, phone FROM provider_crew_members WHERE provider_id = ? AND (phone BETWEEN ? AND ? OR phone = ?)', [PROVIDER1.id, stored(String(FIRST)), stored(String(LAST)), US_NUMBER]);
    const scopes = [budgetScope('provider', PROVIDER1.id), budgetScope('number', US_NUMBER)];
    for (let last = FIRST; last <= LAST; last += 1) scopes.push(budgetScope('number', stored(String(last))));
    for (const member of members) scopes.push(budgetScope('check_ask', member.id));
    for (const link of links) {
        scopes.push(budgetScope('ask', link.id), budgetScope('verify', link.id));
        for (const member of members) scopes.push(budgetScope('cooldown', link.id, member.id));
    }
    for (let at = 0; at < scopes.length; at += 200) {
        const chunk = scopes.slice(at, at + 200);
        await open.execute(`DELETE FROM sms_budget WHERE scope IN (${chunk.map(() => '?').join(', ')})`, chunk);
    }
    await open.execute('UPDATE service_providers SET stripe_onboarding_complete = 0 WHERE id = ?', [PROVIDER1.id]);
    await open.execute('DELETE FROM bookings WHERE customer_email LIKE ?', [`${EMAIL_PREFIX}%`]);
    await open.execute('DELETE FROM provider_crew_members WHERE provider_id = ? AND (phone BETWEEN ? AND ? OR phone = ?)', [PROVIDER1.id, stored(String(FIRST)), stored(String(LAST)), US_NUMBER]);
}

// The sweep is sent again when MySQL picks it as the victim of a deadlock or a lock wait against another spec's writes (1213, 1205).
async function clearRows() {
    for (let attempt = 1; ; attempt += 1) {
        try {
            return await sweepOnce();
        } catch (error) {
            if (attempt >= 3 || ![1213, 1205].includes(/** @type {any} */ (error)?.errno)) throw error;
            await sleep(300 * attempt);
        }
    }
}

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

// ---- making a job, a crew and a session ----

async function credentials(baseURL) {
    const styles = await getCredentialHeaders(String(baseURL));
    return { provider: styles['provider-cookie'], admin: styles['admin-cookie'] };
}

async function dataOf(response, status, who) {
    const body = await response.json().catch(() => null);
    expect(response.status(), `${who}: status (${body?.success === false ? body.message : 'no message'})`).toBe(status);
    expect(body?.success, `${who}: success`).toBe(true);
    return body.data;
}

// ENG-014's writes answer 409 "Something changed while that saved. Try again." when MySQL reports a lock wait against another spec's writes. The message
// says to try again, so a write that got it is sent again (three tries, a short pause).
const CHANGED = 'Something changed while that saved. Try again.';
async function writing(send) {
    let response = await send();
    for (let again = 0; again < 2 && response.status() === 409; again += 1) {
        const body = await response.json().catch(() => null);
        if (body?.message !== CHANGED) break;
        await sleep(400 * (again + 1));
        response = await send();
    }
    return response;
}

async function addMember(ctx, name, last3, phone = typed(last3)) {
    const added = await dataOf(await writing(() => ctx.request.post('/api/provider/crew', { headers: ctx.as.provider, data: { name, phone } })), 201, `provider 1 adds ${name}`);
    return { id: added.member.id, name, phone: added.member.phone };
}

// The proof ENG-015's number check leaves behind: a used row for the member and the number they have now.
async function markChecked(member) {
    await (await db()).execute('INSERT INTO crew_number_checks (crew_member_id, phone, code_hash, expires_at, used_at) VALUES (?, ?, ?, NOW(), NOW())', [member.id, member.phone, sha256Hex(`e2e-js:${member.id}:${member.phone}`)]);
}

const dayFrom = (offsetHours) => new Date(Date.now() + offsetHours * 3_600_000).toISOString().slice(0, 10);
const YESTERDAY = () => dayFrom(-48);
const NEXT_WEEK = () => dayFrom(24 * 7);
const slotLabel = (day) => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}: Morning`;

let sequence = 0;
const tag = () => `${Date.now().toString(36)}${(sequence += 1)}`;

// A confirmed booking of provider 1 in Calgary, on the given day, with or without a position.
async function insertBooking({ day, coords = true }) {
    const id = tag();
    const [made] = /** @type {any[]} */ (await (await db()).execute(
        `INSERT INTO bookings (booking_number, service_id, service_name, service_price, customer_first_name, customer_last_name, customer_email, customer_phone,
           job_date, job_time_slot, job_description, address_line1, city, postal_code, status, payment_status, provider_id, latitude, longitude)
         VALUES (?, 1, 'Probe service', 100.00, 'E2E', 'Probe', ?, ?, ?, ?, 'Bring the long-handled duster.', '1 Probe Street', 'Calgary', 'T2P 1J9', 'confirmed', 'pending', ?, ?, ?)`,
        [`E2EJS${id}`, `${EMAIL_PREFIX}${id}@example.invalid`, stored('179'), day, slotLabel(day), PROVIDER1.id, coords ? ADDRESS.latitude : null, coords ? ADDRESS.longitude : null]
    ));
    return Number(made.insertId);
}

// A job of provider 1 with its crew and its link: { bookingId, token, linkId }. `members` are made and put on the job in the order given.
async function makeJob(ctx, { day = YESTERDAY(), coords = true, members, link = true }) {
    const bookingId = await insertBooking({ day, coords });
    await dataOf(await writing(() => ctx.request.put(`/api/provider/jobs/${bookingId}/crew`, { headers: ctx.as.provider, data: { crew_ids: members.map((member) => member.id) } })), 200, `provider 1 crews job ${bookingId}`);
    const job = { bookingId, token: '', linkId: 0 };
    if (link) {
        const made = await dataOf(await ctx.request.post(`/api/provider/jobs/${bookingId}/job-link`, { headers: ctx.as.provider, data: { action: 'create' } }), 200, 'provider 1 makes the link');
        job.token = String(made.job_link?.path ?? '').slice('/job/'.length);
        expect(/^[A-Za-z0-9_-]{43}$/.test(job.token), 'the link has a token of 43 characters').toBe(true);
        job.linkId = (await rows('SELECT id FROM job_links WHERE booking_id = ?', [bookingId]))[0].id;
    }
    return job;
}

// The six digits whose SHA-256, with the given prefix, is the stored hash, or null.
function crack(prefix, hash) {
    for (let n = 0; n < 1_000_000; n += 1) {
        const digits = String(n).padStart(6, '0');
        if (sha256Hex(prefix + digits) === hash) return digits;
    }
    return null;
}

async function signInCode(job, member) {
    const [row] = await rows('SELECT code_hash FROM job_link_codes WHERE link_id = ? AND crew_member_id = ? AND used_at IS NULL AND expires_at > NOW() ORDER BY id DESC LIMIT 1', [job.linkId, member.id]);
    expect(row !== undefined, `a live sign-in code exists for ${member.name} (a text cannot be read in dev)`).toBe(true);
    const code = crack(`${job.linkId}:${member.id}:`, row.code_hash);
    expect(code !== null, `the sign-in code of ${member.name} is found from its hash`).toBe(true);
    return /** @type {string} */ (code);
}

async function checkCode(member) {
    const [row] = await rows('SELECT code_hash FROM crew_number_checks WHERE crew_member_id = ? AND phone = ? AND used_at IS NULL AND expires_at > NOW() ORDER BY id DESC LIMIT 1', [member.id, member.phone]);
    expect(row !== undefined, `a live number-check code exists for ${member.name}`).toBe(true);
    const code = crack(`check:${member.id}:${member.phone}:`, row.code_hash);
    expect(code !== null, `the number-check code of ${member.name} is found from its hash`).toBe(true);
    return /** @type {string} */ (code);
}

const otherThan = (code) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

// Signs a cleaner in through the routes (the number checked, a code asked for, found from its hash and given back) and puts the session cookie in the
// page's context. The cookie is never printed.
async function signCleanerIn(page, ctx, job, member) {
    await markChecked(member);
    await resetBudgets(budgetScope('ask', job.linkId), budgetScope('cooldown', job.linkId, member.id), budgetScope('number', member.phone));
    const asked = await ctx.request.post(`/api/job/${job.token}/code`, { data: { phone: member.phone } });
    expect(asked.status(), `${member.name} asks for a code`).toBe(200);
    const code = await signInCode(job, member);
    const fresh = await ctx.playwright.request.newContext({ baseURL: ctx.baseURL });
    try {
        const verified = await fresh.post(`/api/job/${job.token}/verify`, { data: { phone: member.phone, code } });
        expect(verified.status(), `${member.name} gives the code back`).toBe(200);
        const line = verified.headersArray().filter((header) => header.name.toLowerCase() === 'set-cookie').map((header) => header.value).find((value) => value.startsWith(`jls_${job.linkId}=`));
        expect(line !== undefined, 'the answer sets the session cookie of the link').toBe(true);
        const [name, ...rest] = String(line).split(';')[0].split('=');
        await page.context().addCookies([{ name, value: rest.join('='), url: ctx.baseURL }]);
    } finally {
        await fresh.dispose();
    }
}

async function setup(playwright, request, baseURL) {
    return { playwright, request, baseURL: String(baseURL), as: await credentials(baseURL) };
}

async function openJob(page, job) {
    await page.goto(`/job/${job.token}`, { timeout: FIRST_VISIT_MS });
}

const alertSaying = (page, text) => page.getByRole('alert').filter({ hasText: text });
const statusSaying = (page, text) => page.getByRole('status').filter({ hasText: text });

// ---- the job link page ----

test.describe('Job link: the page', () => {
    sweepAround();

    // Mutant that turns this case red: a link that is not a link gets a form, a different sentence, or a page a search engine may list.
    test('Screens: a link that is not valid says so in one sentence, asks for nothing, and asks search engines to skip the page', async ({ page }) => {
        test.setTimeout(120_000);
        await page.goto(`/job/${'a'.repeat(43)}`, { timeout: FIRST_VISIT_MS });
        await expect(page.getByRole('heading', { name: NOT_VALID, level: 1 }), 'the one sentence').toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(page.getByText('Ask your provider for the current link.'), 'what to do next').toBeVisible();
        await expect(page.getByRole('textbox'), 'nothing is asked for').toHaveCount(0);
        await expect(page.locator('meta[name="robots"]'), 'search engines are asked to skip the page').toHaveAttribute('content', /noindex/);
        await expect(page.locator('meta[name="referrer"]'), 'browsers are asked to send no referrer').toHaveAttribute('content', 'no-referrer');
    });

    // Mutant that turns this case red: the page shows the job (or any part of it) before anyone has signed in, a blank number is sent, or the refusal is
    // not beside the field and read out.
    test('Screens: a visitor with no way in is asked for a mobile number, a blank number is refused beside the field, and no part of the job is on the page', async ({ page, request, baseURL, playwright }) => {
        test.setTimeout(120_000);
        const ctx = await setup(playwright, request, baseURL);
        const ann = await addMember(ctx, 'Ann', '160');
        const job = await makeJob(ctx, { members: [ann] });
        await openJob(page, job);
        await expect(page.getByRole('heading', { name: 'Open your job.', level: 1 })).toBeVisible({ timeout: FIRST_VISIT_MS });
        const field = page.getByLabel('Mobile number');
        await expect(field, 'the number field is labelled').toBeVisible();
        await expect(page.getByText(PHONE_HINT, { exact: true }), 'the field says how to type a number').toBeVisible();
        await expect(page.getByText('Provider or WorkOnTap admin? Sign in to your account in this browser, then reload this page.')).toBeVisible();
        await page.getByRole('button', { name: 'Text me a code' }).click();
        await expect(alertSaying(page, 'Enter your mobile number.'), 'a blank number is refused on the page').toBeVisible();
        await expect(field.and(page.locator('[aria-invalid="true"]')), 'the field is marked invalid').toBeVisible();
        for (const word of ['Probe Street', 'Probe service', 'Ann', 'long-handled duster']) {
            await expect(page.locator('body'), `"${word}" is not on the page of a visitor`).not.toContainText(word);
        }
    });

    // Mutant that turns this case red: the code step says something different for a number that is not on the job (the page would tell a visitor which
    // numbers are), the new-code button does not wait, a wrong code is not refused in the server's words, or the right code does not open the job.
    test('Screens: the code step says the same words for a number on the job and a number that is not, asks for a new code only after a wait, refuses a wrong code and opens the job for the right one', async ({ page, request, baseURL, playwright }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const ann = await addMember(ctx, 'Ann', '161');
        const job = await makeJob(ctx, { members: [ann] });
        await markChecked(ann);
        await openJob(page, job);
        await expect(page.getByLabel('Mobile number')).toBeVisible({ timeout: FIRST_VISIT_MS });
        const sent = page.getByText('If that number is on this job, a code is on its way. It lasts 10 minutes.');

        await page.getByLabel('Mobile number').fill(typed('162'));
        await page.getByRole('button', { name: 'Text me a code' }).click();
        await expect(sent, 'a number nobody has gets the same words').toBeVisible({ timeout: FIRST_VISIT_MS });
        const strangerText = await page.getByRole('status').filter({ hasText: 'a code is on its way' }).innerText();
        await page.getByRole('button', { name: 'Use a different number' }).click();

        await page.getByLabel('Mobile number').fill(typed('161'));
        await page.getByRole('button', { name: 'Text me a code' }).click();
        await expect(sent, "Ann's number gets the words too").toBeVisible();
        expect(await page.getByRole('status').filter({ hasText: 'a code is on its way' }).innerText(), 'the same words for both').toBe(strangerText);
        await expect(page.getByLabel('6-digit code'), 'the code field is labelled and has focus').toBeFocused();
        await expect(page.getByText('No code after five minutes? Ask your provider to check that your number is verified.')).toBeVisible();
        const again = page.getByRole('button', { name: /^Ask for a new code/ });
        await expect(again, 'the new-code button waits').toHaveAttribute('aria-disabled', 'true');
        await expect(again, 'and counts down').toHaveText(/Ask for a new code \(\d+\)/);

        const code = await signInCode(job, ann);
        await page.getByLabel('6-digit code').fill(otherThan(code));
        await page.getByRole('button', { name: 'Open the job' }).click();
        await expect(alertSaying(page, CODE_FAILED), 'a wrong code is refused in the server\'s words').toBeVisible();
        await expect(page.getByRole('heading', { name: 'Probe service' }), 'a wrong code opens nothing').toHaveCount(0);

        await page.getByLabel('6-digit code').fill(code);
        await page.getByRole('button', { name: 'Open the job' }).click();
        await expect(page.getByRole('heading', { name: 'Probe service', level: 1 }), 'the right code opens the job').toBeVisible();
        await expect(page.getByText('Signed in as Ann', { exact: true })).toBeVisible();
    });

    // Mutant that turns this case red: the page leaves out the days, the address, a detail or a cleaner, shows who the customer is, what they paid or
    // anyone's phone number, or lists a cleaner as checked in who is not.
    test('Screens: a signed-in cleaner sees the days, the address, the details and the whole crew, and not the customer, the price or a phone number', async ({ page, request, baseURL, playwright }) => {
        test.setTimeout(120_000);
        const ctx = await setup(playwright, request, baseURL);
        const ann = await addMember(ctx, 'Ann', '163');
        const bea = await addMember(ctx, 'Bea', '164');
        const job = await makeJob(ctx, { members: [ann, bea] });
        await signCleanerIn(page, ctx, job, ann);
        await openJob(page, job);
        await expect(page.getByRole('heading', { name: 'Probe service', level: 1 })).toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(page.getByText('Signed in as Ann', { exact: true })).toBeVisible();
        const card = (name) => page.getByRole('region', { name, exact: true });
        await expect(card('When').getByRole('listitem'), 'the day of the job').toHaveCount(1);
        await expect(card('Where'), 'the address on its own lines').toContainText('1 Probe Street');
        await expect(card('Where')).toContainText('Calgary');
        await expect(card('Details'), 'the description').toContainText('Bring the long-handled duster.');
        await expect(card('Crew').getByRole('checkbox', { name: 'Ann' }), 'each cleaner who is not checked in has a box').toBeVisible();
        await expect(card('Crew').getByRole('checkbox', { name: 'Bea' })).toBeVisible();
        for (const word of ['E2E', '$', '100.00', '555', 'e2e-js-']) {
            await expect(page.locator('body'), `"${word}" is not on the page`).not.toContainText(word);
        }
    });

    // Mutant that turns this case red: the tick list is live before the window opens, or the page does not say when it opens.
    test('Screens: before the window the tick list is shut and the page says when check-in opens', async ({ page, request, baseURL, playwright }) => {
        test.setTimeout(120_000);
        const ctx = await setup(playwright, request, baseURL);
        const ann = await addMember(ctx, 'Ann', '165');
        const job = await makeJob(ctx, { day: NEXT_WEEK(), members: [ann] });
        await signCleanerIn(page, ctx, job, ann);
        await openJob(page, job);
        await expect(page.getByText(/^Check-in opens at .+\.$/), 'the opening time').toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(page.getByRole('checkbox', { name: 'Ann' }), 'the box is shut').toBeDisabled();
        await expect(page.getByRole('button', { name: /^Check in/ }), 'and so is the button').toHaveAttribute('aria-disabled', 'true');
        expect(await countOf('SELECT COUNT(*) AS n FROM job_checkins WHERE booking_id = ?', [job.bookingId]), 'nothing was recorded').toBe(0);
    });

    // Mutant that turns this case red: the position is not sent, a tick checks in someone who was not ticked, the page does not say who is in, or the
    // late-comer and everyone-in lines are missing.
    test("Screens: at the address a tick checks in the people ticked, with the phone's position, and the page says who is in", async ({ page, request, baseURL, playwright, context }) => {
        test.setTimeout(150_000);
        const ctx = await setup(playwright, request, baseURL);
        const ann = await addMember(ctx, 'Ann', '166');
        const bea = await addMember(ctx, 'Bea', '167');
        const cat = await addMember(ctx, 'Cat', '168');
        const job = await makeJob(ctx, { members: [ann, bea, cat] });
        await signCleanerIn(page, ctx, job, ann);
        await context.grantPermissions(['geolocation'], { origin: String(baseURL) });
        await context.setGeolocation(AT_THE_ADDRESS);
        await openJob(page, job);
        const crew = page.getByRole('region', { name: 'Crew', exact: true });
        const button = page.getByRole('button', { name: /^Check in/ });
        await expect(button, 'nothing ticked, nothing to send').toHaveAttribute('aria-disabled', 'true', { timeout: FIRST_VISIT_MS });
        await expect(page.getByText("We record your phone's location when you check in. The office can see if it is not at the job address.")).toBeVisible();

        await crew.getByRole('checkbox', { name: 'Ann' }).check();
        await crew.getByRole('checkbox', { name: 'Bea' }).check();
        await expect(button, 'two ticked').toHaveText('Check in 2');
        await button.click();
        await expect(statusSaying(page, 'Checked in: Ann and Bea.'), 'the page says who is in').toBeVisible();
        await expect(crew.getByRole('listitem').filter({ hasText: 'Ann' }), 'Ann is listed as in').toContainText('checked in');
        await expect(crew.getByRole('checkbox', { name: 'Ann' }), 'and has no box any more').toHaveCount(0);
        await expect(crew.getByRole('checkbox', { name: 'Cat' }), 'Cat is yet to come').toBeVisible();
        await expect(page.getByText('Someone arriving late? Tick them and check them in the same way.')).toBeVisible();
        const ticks = await rows('SELECT crew_member_id, away, latitude, longitude FROM job_checkins WHERE booking_id = ? ORDER BY crew_member_id', [job.bookingId]);
        expect(ticks.map((row) => row.crew_member_id), 'two rows, for the two ticked').toEqual([ann.id, bea.id].sort((a, b) => a - b));
        expect(ticks.every((row) => !row.away && Math.abs(Number(row.latitude) - ADDRESS.latitude) < 0.0001), "the phone's position was sent and is at the address").toBe(true);

        await crew.getByRole('checkbox', { name: 'Cat' }).check();
        await button.click();
        await expect(statusSaying(page, 'Checked in: Cat.')).toBeVisible();
        await expect(statusSaying(page, 'Everyone on the crew is checked in.'), 'the last one closes the list').toBeVisible();
        await expect(page.getByRole('checkbox'), 'no box is left').toHaveCount(0);
    });

    // Mutant that turns this case red: a position far from the address blocks the check-in, or the page does not say how far.
    test('Screens: the check-in goes through two kilometres from the address and the page says how far, so the office can see it', async ({ page, request, baseURL, playwright, context }) => {
        test.setTimeout(120_000);
        const ctx = await setup(playwright, request, baseURL);
        const ann = await addMember(ctx, 'Ann', '169');
        const job = await makeJob(ctx, { members: [ann] });
        await signCleanerIn(page, ctx, job, ann);
        await context.grantPermissions(['geolocation'], { origin: String(baseURL) });
        await context.setGeolocation(TWO_KM_OFF);
        await openJob(page, job);
        await page.getByRole('checkbox', { name: 'Ann' }).check({ timeout: FIRST_VISIT_MS });
        await page.getByRole('button', { name: 'Check in 1' }).click();
        await expect(statusSaying(page, 'Checked in: Ann.')).toBeVisible();
        await expect(statusSaying(page, /Your phone puts you about \d+(\.\d)? km from the job address\. The office can see this\./), 'the distance').toBeVisible();
        const [tick] = await rows('SELECT away FROM job_checkins WHERE booking_id = ?', [job.bookingId]);
        expect(Boolean(tick?.away), 'the row says away').toBe(true);
    });

    // Mutant that turns this case red: a refused or missing position checks the cleaner in anyway, or the page does not say why nobody was checked in.
    test("Screens: when the phone will not give its position the page says why and checks nobody in", async ({ page, request, baseURL, playwright, context }) => {
        test.setTimeout(120_000);
        const ctx = await setup(playwright, request, baseURL);
        const ann = await addMember(ctx, 'Ann', '170');
        const job = await makeJob(ctx, { members: [ann] });
        await signCleanerIn(page, ctx, job, ann);
        await context.clearPermissions();
        await openJob(page, job);
        await page.getByRole('checkbox', { name: 'Ann' }).check({ timeout: FIRST_VISIT_MS });
        await page.getByRole('button', { name: 'Check in 1' }).click();
        await expect(alertSaying(page, "We need your location to check in. Allow location for this page in your phone's settings, then try again."), 'the reason, and what to do').toBeVisible({ timeout: 30_000 });
        await expect(page.getByRole('checkbox', { name: 'Ann' }), 'Ann is waiting to be checked in').toBeVisible();
        expect(await countOf('SELECT COUNT(*) AS n FROM job_checkins WHERE booking_id = ?', [job.bookingId]), 'nobody was checked in').toBe(0);
    });

    // Mutant that turns this case red: the provider or an admin is asked for a code, or the page does not say who is looking.
    test('Screens: the job\'s provider and an admin open the link signed in as themselves, with no code', async ({ page, request, baseURL, playwright }) => {
        test.setTimeout(150_000);
        const ctx = await setup(playwright, request, baseURL);
        const ann = await addMember(ctx, 'Ann', '171');
        const job = await makeJob(ctx, { members: [ann] });
        await signInAs(page, 'provider1');
        await openJob(page, job);
        await expect(page.getByText(/^Signed in as .+ \(provider\)$/), 'the provider is let in').toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(page.getByRole('heading', { name: 'Probe service', level: 1 })).toBeVisible();
        await expect(page.getByLabel('Mobile number'), 'no code is asked for').toHaveCount(0);
        await page.context().clearCookies();
        await signInAs(page, 'admin');
        await openJob(page, job);
        await expect(page.getByText(/^Signed in as .+ \(admin\)$/), 'an admin is let in').toBeVisible({ timeout: FIRST_VISIT_MS });
    });
});

// ---- the panels and the number check ----

test.describe('Job link: the panels', () => {
    sweepAround();

    // Mutant that turns this case red: the panel is missing, makes a link for a job with no crew, shows the wrong number states, copies something else, or
    // switches off or issues a new link without asking first or leaves the replaced link working.
    test("Screens: the provider's panel makes the link, copies it, asks before it switches off or issues a new one, ends the link it replaces, and shows each cleaner's number", async ({ page, request, baseURL, playwright, context }) => {
        test.setTimeout(240_000);
        const ctx = await setup(playwright, request, baseURL);
        const ann = await addMember(ctx, 'Ann', '172');
        const bea = await addMember(ctx, 'Bea', '173');
        await markChecked(ann);
        const job = await makeJob(ctx, { members: [ann, bea], link: false });
        await (await db()).execute('UPDATE service_providers SET stripe_onboarding_complete = 1 WHERE id = ?', [PROVIDER1.id]);
        await signInAs(page, 'provider1');
        await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: String(baseURL) });
        await page.goto(`/provider/jobs/${job.bookingId}`, { timeout: FIRST_VISIT_MS });
        const panel = page.getByRole('region', { name: 'Job link for your crew', exact: true });
        await expect(panel.getByText('No link yet.'), 'no link yet').toBeVisible({ timeout: FIRST_VISIT_MS });
        await panel.getByRole('button', { name: 'Create link' }).click();
        await expect(panel.getByText('Link created.')).toBeVisible();
        const field = panel.getByLabel('Link for your crew');
        await expect(field, 'the address of the link').toHaveValue(/\/job\/[A-Za-z0-9_-]{43}$/);
        const first = await field.inputValue();
        const firstToken = first.slice(first.lastIndexOf('/') + 1);

        await expect(panel.getByRole('listitem').filter({ hasText: 'Ann' }), "Ann's number is checked").toContainText('Number checked');
        const beaRow = panel.getByRole('listitem').filter({ hasText: 'Bea' });
        await expect(beaRow, "Bea's is not, and the panel says so").toContainText("Number not checked — we can't text them yet");
        await expect(beaRow.getByRole('link', { name: 'Check this number in My Crew' })).toHaveAttribute('href', '/provider/crew');
        await expect(beaRow, 'nobody has checked in').toContainText('Not checked in');

        await panel.getByRole('button', { name: 'Copy link' }).click();
        await expect(panel.getByText('Link copied.')).toBeVisible();
        expect(await page.evaluate(() => navigator.clipboard.readText()), 'the clipboard holds the link').toBe(first);

        await panel.getByRole('button', { name: 'Switch off' }).click();
        const off = panel.getByRole('group', { name: 'Switch off the link? It stops working at once.' });
        await expect(off, 'switching off is asked about first').toBeVisible();
        await expect(off.getByRole('button', { name: 'Keep it on' }), 'the safe answer has focus').toBeFocused();
        await off.getByRole('button', { name: 'Keep it on' }).click();
        await expect(off).toHaveCount(0);
        expect((await request.get(`/api/job/${firstToken}`)).status(), 'the link works').toBe(200);
        await panel.getByRole('button', { name: 'Switch off' }).click();
        await off.getByRole('button', { name: 'Switch off' }).click();
        await expect(panel.getByText('Link switched off.')).toBeVisible();
        await expect(panel.getByText('This link is switched off.')).toBeVisible();
        expect((await request.get(`/api/job/${firstToken}`)).status(), 'a switched-off link is not valid').toBe(404);

        await panel.getByRole('button', { name: 'Issue a new link' }).click();
        await expect(panel.getByText('New link issued.')).toBeVisible();
        await expect(field, 'a new link, on the screen when the announcement is').not.toHaveValue(first);
        const second = await field.inputValue();
        await panel.getByRole('button', { name: 'Issue a new link' }).click();
        const question = panel.getByRole('group', { name: /^Issue a new link\? The current link stops working at once/ });
        await expect(question, 'a new link is asked about first').toBeVisible();
        await question.getByRole('button', { name: 'Issue a new link' }).click();
        await expect(panel.getByText('New link issued. Send it to your crew.')).toBeVisible();
        await expect(field, 'another new link, on the screen when the announcement is').not.toHaveValue(second);
        const third = await field.inputValue();
        expect((await request.get(`/api/job/${second.slice(second.lastIndexOf('/') + 1)}`)).status(), 'the link it replaced is not valid').toBe(404);
        expect((await request.get(`/api/job/${third.slice(third.lastIndexOf('/') + 1)}`)).status(), 'the new one is').toBe(200);
    });

    // Mutant that turns this case red: the admin's panel is missing, leaves out a check-in, says "At the address" for one that was not, or leaves the
    // distance out.
    test('Screens: the admin\'s panel lists each check-in and says when one was not at the address, and how far away it was', async ({ page, request, baseURL, playwright, context }) => {
        test.setTimeout(240_000);
        const ctx = await setup(playwright, request, baseURL);
        const ann = await addMember(ctx, 'Ann', '174');
        const bea = await addMember(ctx, 'Bea', '175');
        const job = await makeJob(ctx, { members: [ann, bea] });
        const session = await ctx.playwright.request.newContext({ baseURL: ctx.baseURL });
        try {
            await markChecked(ann);
            await resetBudgets(budgetScope('ask', job.linkId), budgetScope('cooldown', job.linkId, ann.id), budgetScope('number', ann.phone));
            expect((await session.post(`/api/job/${job.token}/code`, { data: { phone: ann.phone } })).status()).toBe(200);
            const code = await signInCode(job, ann);
            expect((await session.post(`/api/job/${job.token}/verify`, { data: { phone: ann.phone, code } })).status(), 'Ann signs in').toBe(200);
            const tick = async (ids, location) => {
                const response = await session.post(`/api/job/${job.token}/check-in`, { data: { crew_ids: ids, location } });
                expect(response.status(), 'a check-in').toBe(200);
            };
            await tick([ann.id], AT_THE_ADDRESS);
            await tick([bea.id], TWO_KM_OFF);
        } finally {
            await session.dispose();
        }
        await signInAs(page, 'admin');
        await page.goto(`/admin/bookings/${job.bookingId}`, { timeout: FIRST_VISIT_MS });
        const panel = page.getByRole('region', { name: 'Job link', exact: true });
        await expect(panel.getByRole('heading', { name: 'Check-ins', level: 3 })).toBeVisible({ timeout: FIRST_VISIT_MS });
        const row = (name) => panel.getByRole('heading', { name: 'Check-ins', level: 3 }).locator('xpath=following-sibling::ul[1]/li').filter({ hasText: new RegExp(`^${name},`) });
        await expect(row('Ann'), 'Ann was at the address').toContainText('At the address');
        await expect(row('Bea'), 'Bea was not').toContainText(/Not at the address — about \d+(\.\d)? km away/);
        await expect(panel.getByRole('heading', { name: 'Recent activity', level: 3 })).toBeVisible();
        await expect(panel.getByText('Ann signed in'), 'the activity list').toBeVisible();
    });

    // Mutant that turns this case red: a number's state is missing or wrong, a number that cannot be texted offers a check, the code field opens when the
    // text was not sent, a wrong code checks the number, or the chip does not turn to checked after the right code.
    test('Screens: My Crew shows the state of each number, and "Check this number" takes a code from the cleaner and turns the number to checked', async ({ page, request, baseURL, playwright }) => {
        test.setTimeout(240_000);
        const ctx = await setup(playwright, request, baseURL);
        const ann = await addMember(ctx, 'Ann', '176');
        const bea = await addMember(ctx, 'Bea', '177');
        const cy = await addMember(ctx, 'Cy', '178', US_NUMBER.replace('+1212555', '+1 212 555 '));
        await markChecked(ann);
        await signInAs(page, 'provider1');
        // No texting service is set up in dev, so the ask answers sent: false there. The ask goes through to the route (the code is made), and the answer is
        // changed to say what the case needs it to say.
        let sentIs = false;
        await page.route('**/api/provider/crew/*/number-check', async (route) => {
            if (route.request().postDataJSON()?.action !== 'ask') return route.continue();
            const response = await route.fetch();
            const body = await response.json();
            if (body?.data) body.data.sent = sentIs;
            // The body is read decoded and written again, so the headers that describe the first body go.
            const headers = { ...response.headers() };
            delete headers['content-length'];
            delete headers['content-encoding'];
            return route.fulfill({ status: response.status(), headers, json: body });
        });
        await page.goto('/provider/crew', { timeout: FIRST_VISIT_MS });
        const row = (name) => page.getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) });
        await expect(row('Ann'), "Ann's number is checked").toContainText('Number checked', { timeout: FIRST_VISIT_MS });
        await expect(row('Ann').getByRole('button', { name: /^Check / }), 'and offers no check').toHaveCount(0);
        await expect(row('Bea'), "Bea's is not").toContainText("Number not checked — we can't text them yet");
        await expect(row('Cy'), "Cy's cannot be texted").toContainText("Can't text this number");
        await expect(row('Cy'), 'and the page says what to do').toContainText("We can't text this number, so it can't be checked.");
        await expect(row('Cy').getByRole('button', { name: /^Check / }), 'a number that cannot be texted offers no check').toHaveCount(0);

        const check = row('Bea').getByRole('button', { name: "Check Bea's number" });
        await check.click();
        await expect(alertSaying(page, "We couldn't send the text just now. Wait a minute, then try again."), 'a text that did not go opens no code field').toBeVisible();
        await expect(page.getByLabel(/^6-digit code from Bea/)).toHaveCount(0);

        await resetBudgets(budgetScope('check_ask', bea.id), budgetScope('number', bea.phone));
        sentIs = true;
        await check.click();
        const field = page.getByLabel(/^6-digit code from Bea/);
        await expect(field, 'the code field opens and has focus').toBeFocused();
        await expect(page.getByText(/We texted a code to \(604\) 555-0177\. Ask Bea to read it out/)).toBeVisible();
        const code = await checkCode(bea);
        await field.fill(otherThan(code));
        await page.getByRole('button', { name: 'Confirm' }).click();
        await expect(alertSaying(page, 'That code is not right.'), "a wrong code is refused in the route's words").toBeVisible();
        await expect(row('Bea'), 'and checks nothing').toContainText('Number not checked');
        await field.fill(code);
        await page.getByRole('button', { name: 'Confirm' }).click();
        await expect(statusSaying(page, 'Checked Bea, (604) 555-0177.'), 'the right code is announced').toBeVisible();
        await expect(row('Bea'), "Bea's chip turns").toContainText('Number checked');
        await expect(row('Bea').getByRole('button', { name: /^Check / }), 'and the check goes').toHaveCount(0);
    });
});
