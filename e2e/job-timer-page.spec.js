// @ts-check
// ENG-016: the job link's photos, timer and check-out, and the panels' timer block, in a browser. The "Screens" row of the design's "Cases and baseline"
// table (agents/architect/designs/ENG-016-photos-and-countdown-timer-on-the-job-link.md): the page of a cleaner who takes a before photo, starts the job,
// sees the quoted time divided among the cleaners here, checks one out and another in, and sees the job past its quote; and the provider's and the admin's
// panels with the same job. The server's cases are in the job-photos, job-timer and job-photo-routes specs; these cases drive the screens and read the
// database only to make a job, to move the job's clock back and to see that nothing was billed.
// A job is made the way e2e/job-link-screens.spec.js makes one (a booking of provider 1 inserted in SQL, the crew put on it through ENG-014's route and
// the link made through ENG-015's) and a cleaner's session is made through the routes. Every case uses the numbers +1 604 555 0300 to 0319 and the
// e-mail prefix below; the sweep before the first case, after every case and after the last removes the bookings of that prefix (their links, photos,
// check-ins, sessions and events go with them), the crew members of that block and the sms_budget counters of those links, members and numbers. The
// picture files the cases add stay in public/uploads/job-photos, which git ignores and the retention sweep clears.
// Failure messages name the case, never a token, a code or a cookie.
import zlib from 'node:zlib';
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { getCredentialHeaders } from './auth/credentials.js';
import { signInAs } from './support/auth.js';
import { providers } from '../database/fixtures/accounts.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';
import { sha256Hex } from '../src/lib/link-token.js';
import { budgetScope } from '../src/lib/sms-budget.js';

// Every request carries a fixture account's session header and a trace records request headers: tracing is off, as in the specs next to this one.
test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

const [PROVIDER1] = providers;
const EMAIL_PREFIX = 'e2e-jtp-';
const FIRST = 300;
const LAST = 319;
const stored = (last3) => `+16045550${last3}`;
const typed = (last3) => `+1 604 555 0${last3}`;
const US_NUMBER = '+12125550170';
const FIRST_VISIT_MS = 45_000;
// The admin's booking page asks for the person signed in, then the booking, then the job link, one after another, and on a cold dev server each step
// is a compile: 75 seconds to the panel at a load average of 8 (2026-10-15, three steps of 20 to 30 seconds), where a page with one new route needs one.
const ADMIN_FIRST_VISIT_MS = 120_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ADDRESS = { latitude: 51.04473, longitude: -114.07192 };
const AT_THE_ADDRESS = { latitude: ADDRESS.latitude, longitude: ADDRESS.longitude, accuracy: 12 };
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
    await (await db()).execute('INSERT INTO crew_number_checks (crew_member_id, phone, code_hash, expires_at, used_at) VALUES (?, ?, ?, NOW(), NOW())', [member.id, member.phone, sha256Hex(`e2e-jtp:${member.id}:${member.phone}`)]);
}

const dayFrom = (offsetHours) => new Date(Date.now() + offsetHours * 3_600_000).toISOString().slice(0, 10);
const YESTERDAY = () => dayFrom(-48);
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
        [`E2EJTP${id}`, `${EMAIL_PREFIX}${id}@example.invalid`, stored(String(LAST)), day, slotLabel(day), PROVIDER1.id, coords ? ADDRESS.latitude : null, coords ? ADDRESS.longitude : null]
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

const statusSaying = (page, text) => page.getByRole('status').filter({ hasText: text });

// ---- a picture and a clock to move ----

// A PNG of the given size, drawn from a seed, so each picture in a case differs. The page shrinks it to a JPEG before it sends it.
function png(width, height, seed) {
    const raw = Buffer.alloc((width * 3 + 1) * height);
    for (let y = 0; y < height; y += 1) {
        const row = y * (width * 3 + 1);
        for (let x = 0; x < width; x += 1) {
            const at = row + 1 + x * 3;
            raw[at] = Math.floor((x * 255) / width + seed * 40) % 256;
            raw[at + 1] = Math.floor((y * 255) / height) % 256;
            raw[at + 2] = Math.floor(((x + y) * 255) / (width + height) + seed * 90) % 256;
        }
    }
    const table = new Uint32Array(256).map((_, n) => {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        return c >>> 0;
    });
    const crc = (buf) => {
        let c = 0xffffffff;
        for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type, data) => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type), data]);
        const sum = Buffer.alloc(4);
        sum.writeUInt32BE(crc(body));
        return Buffer.concat([len, body, sum]);
    };
    const head = Buffer.alloc(13);
    head.writeUInt32BE(width, 0);
    head.writeUInt32BE(height, 4);
    head[8] = 8;
    head[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Puts everything the job's clock has recorded `seconds` further back, as if the work had started that long ago.
async function rewind(bookingId, seconds) {
    const open = await db();
    await open.execute('UPDATE job_sessions SET clock_in = clock_in - INTERVAL ? SECOND, clock_out = clock_out - INTERVAL ? SECOND WHERE booking_id = ?', [seconds, seconds, bookingId]);
    await open.execute('UPDATE job_checkins SET checked_in_at = checked_in_at - INTERVAL ? SECOND, checked_out_at = checked_out_at - INTERVAL ? SECOND WHERE booking_id = ?', [seconds, seconds, bookingId]);
}

const region = (page, name) => page.getByRole('region', { name, exact: true });
// A name of 99 letters with no space in it: the Crew card has to wrap it inside the screen.
const LONG_NAME = `W${'o'.repeat(98)}`;

// ---- the job link page ----

test.describe('Job timer: the page', () => {
    sweepAround();

    // Mutant that turns this case red: the Start button is on with no before photo, or a Start that is off sends a request, or a photo is on the page
    // without the name of whoever took it, or "before" photos can be added once the job has started.
    test('Screens: the job can not be started until a before photo is taken, the photo shows who took it, and then the clock starts', async ({ page, playwright, request, baseURL }) => {
        test.setTimeout(240_000);
        const ctx = await setup(playwright, request, baseURL);
        const ana = await addMember(ctx, 'Ana Reyes', '301');
        const bo = await addMember(ctx, 'Bo Tran', '302');
        const job = await makeJob(ctx, { members: [ana, bo] });
        await page.context().grantPermissions(['geolocation'], { origin: String(baseURL) });
        await page.context().setGeolocation(AT_THE_ADDRESS);
        await signCleanerIn(page, ctx, job, ana);
        let timerPosts = 0;
        page.on('request', (call) => {
            if (call.method() === 'POST' && call.url().includes(`/api/job/${job.token}/timer`)) timerPosts += 1;
        });
        await openJob(page, job);
        const photos = region(page, 'Photos');
        const timer = region(page, 'Job timer');
        await expect(timer).toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(photos.getByText('Take a before photo of the rooms you will clean. The job can not start without one.')).toBeVisible();

        await page.getByRole('checkbox', { name: 'Ana Reyes' }).check();
        await page.getByRole('button', { name: 'Check in 1' }).click();
        await expect(page.getByRole('button', { name: 'Check out Ana Reyes' })).toBeVisible({ timeout: 30_000 });

        const start = timer.getByRole('button', { name: 'Start the job' });
        await expect(start, 'Start is off with no before photo').toHaveAttribute('aria-disabled', 'true');
        await expect(timer.getByText('Take a before photo first.', { exact: true }), 'the reason is text on the page').toBeVisible();
        await start.click({ force: true });
        await expect(timer.getByRole('timer'), 'no clock is shown for a job that has not started').toHaveCount(0);
        expect(timerPosts, 'a Start that is off asks the server for nothing').toBe(0);

        await page.locator('input[data-photo-type="before"]').setInputFiles({ name: 'room.png', mimeType: 'image/png', buffer: png(900, 600, 1) });
        await expect(photos.getByAltText(/^Before photo by Ana Reyes, /), 'the photo is on the page with the name of whoever took it').toBeVisible({ timeout: 30_000 });
        const before = photos.getByRole('group', { name: 'Before' });
        await expect(before).toContainText('1 of 20');
        await expect(before).toContainText('Ana Reyes');
        await expect(statusSaying(page, 'Photo added')).toBeVisible();
        await expect(start, 'Start is on once a before photo exists').not.toHaveAttribute('aria-disabled', 'true');

        await start.click();
        await expect(timer.getByRole('timer')).toHaveText(/^(1:00:00|0:59:\d\d)$/, { timeout: 30_000 });
        await expect(timer).toContainText('left for the cleaner here');
        await expect(statusSaying(page, 'Job started')).toBeVisible();
        await expect(timer.getByRole('button', { name: 'Pause the job' })).toBeVisible();
        await expect(photos.getByText('The job has started, so more "before" photos can not be added.')).toBeVisible();
        await expect(photos.getByRole('button', { name: 'Add a before photo' })).toHaveAttribute('aria-disabled', 'true');
        await expect(photos.getByRole('button', { name: 'Add an after photo' }), 'after photos are open once the job has started').not.toHaveAttribute('aria-disabled', 'true');
        expect(timerPosts, 'one Start was sent').toBe(1);
    });

    // Mutant that turns this case red: the clock is not the quoted time divided by the cleaners here, or it is not divided again on a check-out or a check-in,
    // or a check-out is made with no question, or a cleaner who has checked out is offered a check-in or a check-out again, or the time worked and the overrun
    // are not on the page, or the page scrolls sideways.
    test('Screens: the clock divides the quoted time among the cleaners here, divides it again when one checks out or another checks in, and a check-out is asked about first', async ({ page, playwright, request, baseURL }) => {
        test.setTimeout(420_000);
        const ctx = await setup(playwright, request, baseURL);
        const ana = await addMember(ctx, 'Ana Reyes', '303');
        const bo = await addMember(ctx, 'Bo Tran', '304');
        const cy = await addMember(ctx, 'Cy Park', '305');
        const dee = await addMember(ctx, LONG_NAME, '306');
        const job = await makeJob(ctx, { members: [ana, bo, cy, dee] });
        await page.context().grantPermissions(['geolocation'], { origin: String(baseURL) });
        await page.context().setGeolocation(AT_THE_ADDRESS);
        await page.setViewportSize({ width: 375, height: 812 });
        await signCleanerIn(page, ctx, job, ana);
        await openJob(page, job);
        const crew = region(page, 'Crew');
        const photos = region(page, 'Photos');
        const timer = region(page, 'Job timer');
        const face = timer.getByRole('timer');
        await expect(timer).toBeVisible({ timeout: FIRST_VISIT_MS });

        await page.getByRole('checkbox', { name: 'Ana Reyes' }).check();
        await page.getByRole('checkbox', { name: 'Bo Tran' }).check();
        await page.getByRole('button', { name: 'Check in 2' }).click();
        await expect(crew.getByRole('button', { name: 'Check out Bo Tran' })).toBeVisible({ timeout: 30_000 });
        await expect(timer, 'before the start the page says what each cleaner will have').toContainText('With 2 cleaners here that is 30 min each');
        await page.locator('input[data-photo-type="before"]').setInputFiles({ name: 'room.png', mimeType: 'image/png', buffer: png(800, 600, 2) });
        await expect(photos.getByAltText(/^Before photo by Ana Reyes, /)).toBeVisible({ timeout: 30_000 });
        await timer.getByRole('button', { name: 'Start the job' }).click();
        await expect(face, 'one hour quoted and two cleaners here: half an hour each').toHaveText(/^(0:30:00|0:29:\d\d)$/, { timeout: 30_000 });
        await expect(timer).toContainText('left for each of the 2 cleaners here');

        const leave = crew.getByRole('button', { name: 'Check out Bo Tran' });
        const ask = crew.getByRole('group', { name: /^Check out Bo Tran\?/ });
        await leave.click();
        await expect(ask).toContainText('They can not check in again on this job.');
        await expect(ask.getByRole('button', { name: 'Stay' }), 'focus is on the safe choice').toBeFocused();
        await page.keyboard.press('Escape');
        await expect(ask).toHaveCount(0);
        await expect(leave, 'focus goes back to the button that asked').toBeFocused();
        await leave.click();
        await ask.getByRole('button', { name: 'Stay' }).click();
        await expect(ask).toHaveCount(0);
        await expect(face, 'Stay changes nothing: the clock is shared by two').toHaveText(/^0:(29|30):\d\d$/);

        await leave.click();
        await ask.getByRole('button', { name: 'Check out', exact: true }).click();
        await expect(page.getByText('Checked out: Bo Tran.')).toBeVisible({ timeout: 30_000 });
        await expect(timer).toContainText('left for the cleaner here');
        await expect(face, 'what is left is Ana\'s alone once Bo has gone').toHaveText(/^0:(4[5-9]|5[0-9]):\d\d$/);
        await expect(crew.getByText(/^Checked out at /)).toBeVisible();
        await expect(crew.getByRole('button', { name: 'Check out Bo Tran' }), 'a cleaner who has checked out has no check-out').toHaveCount(0);
        await expect(crew.getByRole('checkbox', { name: 'Bo Tran' }), 'a cleaner who has checked out is not offered a check-in').toHaveCount(0);

        await crew.getByRole('checkbox', { name: 'Cy Park' }).check();
        await crew.getByRole('button', { name: 'Check in 1' }).click();
        await expect(timer).toContainText('left for each of the 2 cleaners here', { timeout: 30_000 });
        await expect(face, 'what is left is shared by Ana and Cy').toHaveText(/^0:(1[5-9]|2[0-9]|30):\d\d$/);

        // Two hours back: Ana and Cy have each been on the job for two hours against a quote of one.
        await rewind(job.bookingId, 7200);
        await page.reload();
        await expect(page.getByText(/This job has used its quoted time/)).toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(face).toHaveText(/Over by \d+:\d\d:\d\d$/);
        await expect(page.getByRole('status').filter({ hasText: 'nothing extra is charged' })).toBeVisible();
        const worked = timer.locator('details');
        await worked.locator('summary').click();
        const person = (name) => worked.getByRole('listitem').filter({ hasText: name });
        await expect(person('Ana Reyes'), 'two hours on the job').toContainText(/2 h/);
        await expect(person('Cy Park'), 'two hours on the job').toContainText(/2 h/);
        await expect(person('Bo Tran'), 'a few minutes at most, and when Bo went').toContainText(/Bo Tran\s*\d+ min\s*out at /);

        const [booking] = await rows('SELECT service_price, payment_status, over_quote_at FROM bookings WHERE id = ?', [job.bookingId]);
        expect(Number(booking.service_price), 'nothing was billed: the price is the one the booking was made with').toBe(100);
        expect(booking.payment_status, 'no payment was taken').toBe('pending');
        expect(booking.over_quote_at, 'the overrun is flagged for the office').not.toBeNull();

        for (const width of [320, 375, 1280]) {
            await page.setViewportSize({ width, height: 800 });
            await expect(timer).toBeVisible();
            const wide = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
            expect(wide.scroll, `the page is no wider than the screen at ${width} px, with a name of 99 letters on the crew`).toBeLessThanOrEqual(wide.inner);
        }
    });
});

// ---- the panels ----

test.describe('Job timer: the panels', () => {
    sweepAround();

    // Mutant that turns this case red: a panel leaves out the timer, the time each cleaner worked, the photos or one of the new kinds of activity, names the
    // wrong cleaner in a sentence, or shows a cleaner who has checked out as "Not checked in".
    test('Screens: the admin\'s and the provider\'s panels show the job\'s timer, who worked how long and the photos, and the admin\'s panel says who did what', async ({ page, playwright, request, baseURL }) => {
        test.setTimeout(360_000);
        const ctx = await setup(playwright, request, baseURL);
        const ann = await addMember(ctx, 'Ann', '307');
        const bea = await addMember(ctx, 'Bea', '308');
        const job = await makeJob(ctx, { members: [ann, bea] });
        const session = await ctx.playwright.request.newContext({ baseURL: ctx.baseURL });
        try {
            await markChecked(ann);
            await resetBudgets(budgetScope('ask', job.linkId), budgetScope('cooldown', job.linkId, ann.id), budgetScope('number', ann.phone));
            expect((await session.post(`/api/job/${job.token}/code`, { data: { phone: ann.phone } })).status()).toBe(200);
            const code = await signInCode(job, ann);
            expect((await session.post(`/api/job/${job.token}/verify`, { data: { phone: ann.phone, code } })).status(), 'Ann signs in').toBe(200);
            const send = async (step, data, what) => {
                const response = await session.post(`/api/job/${job.token}/${step}`, { data });
                expect(response.status(), what).toBe(200);
            };
            await send('check-in', { crew_ids: [ann.id, bea.id], location: AT_THE_ADDRESS }, 'Ann checks in with Bea');
            const added = await session.post(`/api/job/${job.token}/photos`, { multipart: { type: 'before', photo: { name: 'room.png', mimeType: 'image/png', buffer: png(640, 480, 3) } } });
            expect(added.status(), 'Ann adds a before photo').toBe(200);
            await send('timer', { action: 'start', location: AT_THE_ADDRESS }, 'Ann starts the job');
            await send('check-out', { crew_ids: [bea.id] }, 'Ann checks Bea out');
        } finally {
            await session.dispose();
        }

        // The same block is on both panels; the admin's panel also has the activity list.
        const checkBlock = async (panel, timeout) => {
            await expect(panel.getByRole('heading', { name: 'Job timer and photos', level: 3 })).toBeVisible({ timeout });
            await expect(panel.getByText('Running', { exact: true })).toBeVisible();
            await expect(panel.getByRole('timer'), 'one hour quoted, Ann alone here').toHaveText(/^0:(4[5-9]|5[0-9]):\d\d$/);
            await expect(panel.getByText('left for the cleaner here')).toBeVisible();
            const table = panel.getByRole('table', { name: 'Time worked by each cleaner' });
            await expect(table.getByRole('row', { name: /^Ann/ }), 'Ann is on the job').toContainText('here now');
            await expect(table.getByRole('row', { name: /^Bea/ }), 'Bea left').not.toContainText('here now');
            await expect(panel.getByRole('heading', { name: 'Before (1)', level: 4 })).toBeVisible();
            await expect(panel.getByRole('heading', { name: 'After (0)', level: 4 })).toBeVisible();
            await expect(panel.getByAltText(/^Before photo by Ann, /)).toHaveCount(1);
            await expect(panel.getByText(/^As of /)).toBeVisible();
            await expect(panel.getByText(/^Checked out \d/), 'Bea is shown as checked out, not as "Not checked in"').toBeVisible();
        };

        await signInAs(page, 'admin');
        await page.goto(`/admin/bookings/${job.bookingId}`, { timeout: ADMIN_FIRST_VISIT_MS });
        const admin = page.getByRole('region', { name: 'Job link', exact: true });
        await checkBlock(admin, ADMIN_FIRST_VISIT_MS);
        await expect(admin.getByRole('heading', { name: 'Recent activity', level: 3 })).toBeVisible();
        await expect(admin.getByText('Ann added a before photo')).toBeVisible();
        await expect(admin.getByText('Ann started the job')).toBeVisible();
        await expect(admin.getByText('Ann checked out Bea')).toBeVisible();
        await admin.getByRole('button', { name: 'Refresh' }).click();
        await expect(admin.getByText('Updated.')).toBeVisible({ timeout: 30_000 });

        // The provider layout sends a provider whose Stripe account is not connected from the job page to the dashboard; the sweep puts the flag back to 0.
        await (await db()).execute('UPDATE service_providers SET stripe_onboarding_complete = 1 WHERE id = ?', [PROVIDER1.id]);
        await signInAs(page, 'provider1');
        await page.goto(`/provider/jobs/${job.bookingId}`, { timeout: ADMIN_FIRST_VISIT_MS });
        await checkBlock(page.getByRole('region', { name: 'Job link for your crew', exact: true }), ADMIN_FIRST_VISIT_MS);
    });
});
