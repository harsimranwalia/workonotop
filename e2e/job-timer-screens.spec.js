// @ts-check
// ENG-016: the screens of the photos and the countdown timer on the job link, in a browser. The "Screens" row of the design's "Cases and baseline"
// table (agents/architect/designs/ENG-016-photos-and-countdown-timer-on-the-job-link.md): on /job/{token} the Crew card's check-out, the Photos card and
// the Timer card, and in the provider's and the admin's panel the "Job timer and photos" block. The routes' own cases are in the job-photos, job-timer and
// job-timer-access specs; these cases drive the screens and read the database only to make a job, to find what a text would carry (no texting service is
// set up in dev) and to set the clock back where a case needs hours to have passed (the rows are moved, nothing sleeps).
// A job is made the way e2e/job-link-screens.spec.js makes one: a booking of provider 1 inserted in SQL, the crew put on it through ENG-014's route and
// the link made through ENG-015's. A cleaner's session is made through the routes (a code asked for, found from its hash, given back); its cookie goes
// in the page's context for the cases that drive the page, and into a `cookie` header for the actions a case takes as another phone. A photo is a JPEG
// drawn on a canvas in the browser, because the page shrinks every picture through a canvas and a file the browser cannot decode never reaches the server.
// Every case uses the numbers +1 604 555 0180 to 0199 and the e-mail prefix below. The cases run one at a time, so a case that needs more numbers than
// its turn has in the block takes numbers from the start of it again; the sweep before the first case of a describe, after every case and after the last
// removes the bookings of the prefix (their links, codes, check-ins, sessions, photos and events go with them), the crew members of the block, the
// sms_budget counters of those links, members and numbers, and the photo files: those the rows of the prefix name and any file in the photo directory that
// was not there when the case began. Failure messages name the case, never a token, a code or a cookie.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { getCredentialHeaders } from './auth/credentials.js';
import { signInAs } from './support/auth.js';
import { resendingOnReset } from './support/reset-retries.js';
import { providers } from '../database/fixtures/accounts.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';
import { sha256Hex } from '../src/lib/link-token.js';
import { budgetScope } from '../src/lib/sms-budget.js';
import { storedPhotos } from '../src/lib/job-photo-store.js';
import { PHOTOS_MAX_PER_TYPE } from '../src/lib/job-photos.js';

// Every request carries a fixture account's session header and a trace records request headers: tracing is off, as in the specs next to this one.
test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

const [PROVIDER1] = providers;
const EMAIL_PREFIX = 'e2e-jts-';
const FIRST = 180;
const LAST = 199;
const stored = (last3) => `+16045550${last3}`;
const typed = (last3) => `+1 604 555 0${last3}`;
const FIRST_VISIT_MS = 45_000;
// The admin's booking page asks for the person signed in, then the booking, then the job link, one after another, and on a cold dev server each step is a
// compile.
const ADMIN_FIRST_VISIT_MS = 120_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ADDRESS = { latitude: 51.04473, longitude: -114.07192 };
const AT_THE_ADDRESS = { latitude: ADDRESS.latitude, longitude: ADDRESS.longitude, accuracy: 12 };
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PHOTO_DIR = path.join(ROOT, 'public', 'uploads', 'job-photos');
const photoUrlPattern = /^\/uploads\/job-photos\/[0-9a-f]{32}\.(jpg|png|webp)$/;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The sentences of the screens (the UI contract of the ticket); a case that reads one off the page names it from here.
const SAYS = {
    hint: 'Take a before photo of the rooms you will clean. The job can not start without one.',
    notHere: 'Check in first, then add a photo.',
    started: 'The job has started, so more "before" photos can not be added.',
    notStarted: 'Start the job before adding "after" photos.',
    full: 'This job has all the photos it can hold.',
    unusable: 'That file is not a photo we can use. Take it again.',
    storeDown: 'Photos can not be saved right now. Try again in a minute.',
    location: "We need your phone's location to start the job. Allow location for this page and try again.",
    noPhoto: 'Take a before photo first.',
    nobodyHere: 'Check in who is here first.',
    notConfirmed: 'This job is not ready to start.',
    checkInFirst: 'Check in first.',
};

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

// The files of the photo directory when the case began: what a case adds is what the sweep finds beyond these.
/** @type {Set<string> | null} */
let photosBefore = null;

async function removeFile(url) {
    if (photoUrlPattern.test(url)) await fs.rm(path.join(ROOT, 'public', url), { force: true });
}

// Deletes what this file left. The Stripe flag goes back to 0, as the fixtures have it.
async function sweepOnce() {
    const open = await db();
    // The photo store makes its directory when it first needs one; the listing below needs it to be there.
    await fs.mkdir(PHOTO_DIR, { recursive: true });
    for (const photo of await rows('SELECT p.photo_url FROM job_photos p JOIN bookings b ON b.id = p.booking_id WHERE b.customer_email LIKE ?', [`${EMAIL_PREFIX}%`])) {
        await removeFile(photo.photo_url);
    }
    if (photosBefore) {
        for (const photo of await storedPhotos()) {
            if (!photosBefore.has(photo.url)) await removeFile(photo.url);
        }
    }
    const links = await rows('SELECT l.id FROM job_links l JOIN bookings b ON b.id = l.booking_id WHERE b.customer_email LIKE ?', [`${EMAIL_PREFIX}%`]);
    const members = await rows('SELECT id, phone FROM provider_crew_members WHERE provider_id = ? AND phone BETWEEN ? AND ?', [PROVIDER1.id, stored(String(FIRST)), stored(String(LAST))]);
    const scopes = [budgetScope('provider', PROVIDER1.id)];
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
    await open.execute('DELETE FROM provider_crew_members WHERE provider_id = ? AND phone BETWEEN ? AND ?', [PROVIDER1.id, stored(String(FIRST)), stored(String(LAST))]);
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

// The hooks of a describe that uses the database: a sweep before its first case, a listing of the photo files before every case, a sweep after every
// case (also a case that failed or timed out) and after the last, then the connection is closed.
function sweepAround() {
    test.beforeAll(async () => {
        photosBefore = null;
        await clearRows();
    });
    test.beforeEach(async () => {
        await fs.mkdir(PHOTO_DIR, { recursive: true });
        photosBefore = new Set((await storedPhotos()).map((photo) => photo.url));
    });
    test.afterEach(clearRows);
    test.afterAll(async () => {
        if (!connection) return;
        try {
            await clearRows();
        } finally {
            photosBefore = null;
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
    await (await db()).execute('INSERT INTO crew_number_checks (crew_member_id, phone, code_hash, expires_at, used_at) VALUES (?, ?, ?, NOW(), NOW())', [member.id, member.phone, sha256Hex(`e2e-jts:${member.id}:${member.phone}`)]);
}

const dayFrom = (offsetHours) => new Date(Date.now() + offsetHours * 3_600_000).toISOString().slice(0, 10);
const YESTERDAY = () => dayFrom(-48);
const slotLabel = (day) => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}: Morning`;

let sequence = 0;
const tag = () => `${Date.now().toString(36)}${(sequence += 1)}`;

// A booking of provider 1 in Calgary with its position, dated so that its check-in window is open, quoted for `quote` minutes.
async function insertBooking({ day, quote, status }) {
    const id = tag();
    const [made] = /** @type {any[]} */ (await (await db()).execute(
        `INSERT INTO bookings (booking_number, service_id, service_name, service_price, customer_first_name, customer_last_name, customer_email, customer_phone,
           job_date, job_time_slot, job_description, address_line1, city, postal_code, status, payment_status, provider_id, latitude, longitude, standard_duration_minutes)
         VALUES (?, 1, 'Probe service', 100.00, 'E2E', 'Probe', ?, ?, ?, ?, 'Bring the long-handled duster.', '1 Probe Street', 'Calgary', 'T2P 1J9', ?, 'pending', ?, ?, ?, ?)`,
        [`E2EJTS${id}`, `${EMAIL_PREFIX}${id}@example.invalid`, stored('199'), day, slotLabel(day), status, PROVIDER1.id, ADDRESS.latitude, ADDRESS.longitude, quote]
    ));
    return Number(made.insertId);
}

// A job of provider 1 with its crew and its link: { bookingId, token, linkId }. `members` are made and put on the job in the order given.
async function makeJob(ctx, { members, quote = 360, status = 'confirmed', day = YESTERDAY() }) {
    const bookingId = await insertBooking({ day, quote, status });
    await dataOf(await writing(() => ctx.request.put(`/api/provider/jobs/${bookingId}/crew`, { headers: ctx.as.provider, data: { crew_ids: members.map((member) => member.id) } })), 200, `provider 1 crews job ${bookingId}`);
    const made = await dataOf(await ctx.request.post(`/api/provider/jobs/${bookingId}/job-link`, { headers: ctx.as.provider, data: { action: 'create' } }), 200, 'provider 1 makes the link');
    const token = String(made.job_link?.path ?? '').slice('/job/'.length);
    expect(/^[A-Za-z0-9_-]{43}$/.test(token), 'the link has a token of 43 characters').toBe(true);
    const [link] = await rows('SELECT id FROM job_links WHERE booking_id = ?', [bookingId]);
    return { bookingId, token, linkId: Number(link.id) };
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

// Signs a cleaner in through the routes (the number checked, a code asked for, found from its hash and given back). The session cookie goes in the page's
// context when a page is given, and comes back as the value of a `cookie` header for the actions the case takes as that phone. It is never printed.
async function signCleanerIn(ctx, job, member, page = null) {
    await markChecked(member);
    await resetBudgets(budgetScope('ask', job.linkId), budgetScope('cooldown', job.linkId, member.id), budgetScope('number', member.phone));
    const asked = await ctx.request.post(`/api/job/${job.token}/code`, { data: { phone: member.phone } });
    expect(asked.status(), `${member.name} asks for a code`).toBe(200);
    const code = await signInCode(job, member);
    const fresh = resendingOnReset(await ctx.playwright.request.newContext({ baseURL: ctx.baseURL }));
    try {
        const verified = await fresh.post(`/api/job/${job.token}/verify`, { data: { phone: member.phone, code } });
        expect(verified.status(), `${member.name} gives the code back`).toBe(200);
        const line = verified.headersArray().filter((header) => header.name.toLowerCase() === 'set-cookie').map((header) => header.value).find((value) => value.startsWith(`jls_${job.linkId}=`));
        expect(line !== undefined, 'the answer sets the session cookie of the link').toBe(true);
        const [name, ...rest] = String(line).split(';')[0].split('=');
        const value = rest.join('=');
        if (page) await page.context().addCookies([{ name, value, url: ctx.baseURL }]);
        return `${name}=${value}`;
    } finally {
        await fresh.dispose();
    }
}

// The case's `request` sends a call again when the connection it was written to is closed before any answer: the first call of a case can be written to
// a connection the previous case left unused for about six seconds (e2e/support/reset-retries.js; BUG-019).
async function setup(playwright, request, baseURL) {
    return { playwright, request: resendingOnReset(request), baseURL: String(baseURL), as: await credentials(baseURL) };
}

async function openJob(page, job) {
    await page.goto(`/job/${job.token}`, { timeout: FIRST_VISIT_MS });
}

// ---- actions taken as another phone, through the routes ----

const here = (members) => ({ crew_ids: members.map((member) => member.id), location: AT_THE_ADDRESS });
const viaLink = async (ctx, job, cookie, route, body, who) => dataOf(await ctx.request.post(`/api/job/${job.token}/${route}`, { headers: { cookie }, data: body }), 200, who);
const checkIn = (ctx, job, cookie, members, who) => viaLink(ctx, job, cookie, 'check-in', here(members), who);
const checkOut = (ctx, job, cookie, members, who) => viaLink(ctx, job, cookie, 'check-out', here(members), who);
const timerAct = async (ctx, job, cookie, action, who) => (await viaLink(ctx, job, cookie, 'timer', { action, location: AT_THE_ADDRESS }, who)).timer;
const timerNow = async (ctx, job, cookie, who) => (await dataOf(await ctx.request.get(`/api/job/${job.token}/timer`, { headers: { cookie } }), 200, who)).timer;

async function addPhoto(ctx, job, cookie, type, bytes, who) {
    return dataOf(await ctx.request.post(`/api/job/${job.token}/photos`, {
        headers: { cookie },
        multipart: { type, latitude: String(AT_THE_ADDRESS.latitude), longitude: String(AT_THE_ADDRESS.longitude), accuracy: String(AT_THE_ADDRESS.accuracy), photo: { name: 'room.jpg', mimeType: 'image/jpeg', buffer: bytes } },
    }), 200, who);
}

// One JPEG that every browser decodes, drawn on a canvas once and kept.
/** @type {Buffer | null} */
let jpeg = null;
async function jpegBytes(page) {
    if (jpeg) return jpeg;
    const text = await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 96;
        canvas.height = 72;
        const pen = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
        pen.fillStyle = '#2f6f6a';
        pen.fillRect(0, 0, 96, 72);
        pen.fillStyle = '#f2c14e';
        pen.fillRect(12, 12, 40, 28);
        const blob = /** @type {Blob} */ (await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9)));
        let binary = '';
        for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte);
        return btoa(binary);
    });
    jpeg = Buffer.from(text, 'base64');
    return jpeg;
}

// ---- what the page shows ----

const card = (page, name) => page.getByRole('region', { name, exact: true });
const alertSaying = (page, text) => page.getByRole('alert').filter({ hasText: text });
const statusSaying = (page, text) => page.getByRole('status').filter({ hasText: text });

// The seconds on the clock of the Timer card ("H:MM:SS"), or NaN when it reads anything else.
async function clockSeconds(page) {
    const match = /^(\d+):(\d{2}):(\d{2})$/.exec((await page.getByRole('timer').innerText()).trim());
    return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : NaN;
}

// ---- the photos ----

test.describe('Job timer: the photos', () => {
    sweepAround();

    // Mutant that turns this case red: an add button is on for a cleaner who is not checked in, an off button is not marked aria-disabled, the reason
    // under a button is missing or wrong, the card does not say a before photo is needed, or an off button opens the camera.
    test('Screens: before the cleaner checks in both add buttons are off with their reasons as text, and the card says a before photo is needed', async ({ page, request, baseURL, playwright }) => {
        test.setTimeout(150_000);
        const ctx = await setup(playwright, request, baseURL);
        const ann = await addMember(ctx, 'Ann', '180');
        const job = await makeJob(ctx, { members: [ann] });
        await signCleanerIn(ctx, job, ann, page);
        await openJob(page, job);
        const photos = card(page, 'Photos');
        const before = photos.getByRole('button', { name: 'Add a before photo', exact: true });
        const after = photos.getByRole('button', { name: 'Add an after photo', exact: true });
        await expect(before, 'the before button is off').toHaveAttribute('aria-disabled', 'true', { timeout: FIRST_VISIT_MS });
        await expect(after, 'the after button is off').toHaveAttribute('aria-disabled', 'true');
        await expect(photos.getByText(SAYS.notHere, { exact: true }), 'the reason under the before button').toBeVisible();
        await expect(photos.getByText(SAYS.notStarted, { exact: true }), 'the reason under the after button').toBeVisible();
        await expect(photos.getByText(SAYS.hint, { exact: true }), 'the card says a before photo is needed').toBeVisible();
        await expect(photos.getByText('0 of 20', { exact: true }), 'both lists are empty and the limit shows').toHaveCount(2);

        let opened = false;
        page.on('filechooser', () => { opened = true; });
        await before.click({ force: true });
        await after.click({ force: true });
        // A file chooser is announced within a tick of the click; this is the time for it.
        await page.waitForTimeout(400);
        expect(opened, 'an off button opens no file chooser').toBe(false);
        expect(await countOf('SELECT COUNT(*) AS n FROM job_photos WHERE booking_id = ?', [job.bookingId]), 'nothing was saved').toBe(0);
    });

    // Mutant that turns this case red: the before button stays off for a checked-in cleaner, the file input does not ask for the camera, the photo is not
    // listed with the cleaner's name and a time, its link opens in the same tab or leaves the page's address with the new tab, the count or the hint does not
    // follow, the row names the wrong person, or the screen reader is not told.
    test('Screens: a checked-in cleaner adds a before photo and sees it with their name and the time, in a link that opens a new tab, and the row says a cleaner took it', async ({ page, request, baseURL, playwright, context }) => {
        test.setTimeout(150_000);
        const ctx = await setup(playwright, request, baseURL);
        const ann = await addMember(ctx, 'Ann', '181');
        const job = await makeJob(ctx, { members: [ann] });
        const cookie = await signCleanerIn(ctx, job, ann, page);
        await checkIn(ctx, job, cookie, [ann], 'Ann checks in');
        await context.grantPermissions(['geolocation'], { origin: ctx.baseURL });
        await context.setGeolocation(AT_THE_ADDRESS);
        const bytes = await jpegBytes(page);
        await openJob(page, job);
        const photos = card(page, 'Photos');
        await expect(photos.getByRole('button', { name: 'Add a before photo', exact: true }), 'the before button is on').not.toHaveAttribute('aria-disabled', 'true', { timeout: FIRST_VISIT_MS });
        await expect(photos.getByRole('button', { name: 'Add an after photo', exact: true }), 'the after button is off').toHaveAttribute('aria-disabled', 'true');
        await expect(photos.getByText(SAYS.notStarted, { exact: true }), 'and says the job has to start first').toBeVisible();
        await expect(photos.getByText(SAYS.hint, { exact: true }), 'the card says a before photo is needed').toBeVisible();

        const input = photos.locator('input[type="file"][data-photo-type="before"]');
        await expect(input, 'the file input takes pictures').toHaveAttribute('accept', 'image/*');
        await expect(input, 'and opens the back camera').toHaveAttribute('capture', 'environment');
        await input.setInputFiles({ name: 'front-room.jpg', mimeType: 'image/jpeg', buffer: bytes });
        const thumbnail = photos.getByRole('link', { name: /^Before photo by Ann, / });
        await expect(thumbnail, 'the photo is on the page').toBeVisible({ timeout: 30_000 });
        await expect(thumbnail, 'its link opens a new tab').toHaveAttribute('target', '_blank');
        await expect(thumbnail, 'without handing the page over to it').toHaveAttribute('rel', /noopener/);
        await expect(thumbnail, 'or telling it where it came from').toHaveAttribute('rel', /noreferrer/);
        await expect(photos.getByText(/^Ann · \d{1,2}:\d{2}/), "under it, the cleaner's name and a time").toBeVisible();
        await expect(photos.getByText('1 of 20', { exact: true }), 'one before photo is counted').toBeVisible();
        await expect(photos.getByText(SAYS.hint, { exact: true }), 'the hint goes').toHaveCount(0);
        await expect(statusSaying(page, 'Photo added'), 'a screen reader is told').toBeVisible();

        const saved = await rows('SELECT photo_type, taken_by_kind, taken_by_ref FROM job_photos WHERE booking_id = ?', [job.bookingId]);
        expect(saved.length, 'one photo row').toBe(1);
        expect(saved[0].photo_type, 'a before photo').toBe('before');
        expect(saved[0].taken_by_kind, 'taken by a cleaner').toBe('cleaner');
        expect(Number(saved[0].taken_by_ref), 'and the cleaner is Ann').toBe(ann.id);
    });

    // Mutant that turns this case red: a file that is not a picture is sent anyway or offered a retry, a 503 shows no sentence or no Try again, the retry
    // does not send the picture again, or a second row is written.
    test('Screens: a file that is not a picture is refused with no retry, and a photo the server could not keep shows its sentence and Try again sends it once more', async ({ page, request, baseURL, playwright, context }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const ann = await addMember(ctx, 'Ann', '182');
        const job = await makeJob(ctx, { members: [ann] });
        const cookie = await signCleanerIn(ctx, job, ann, page);
        await checkIn(ctx, job, cookie, [ann], 'Ann checks in');
        await context.grantPermissions(['geolocation'], { origin: ctx.baseURL });
        await context.setGeolocation(AT_THE_ADDRESS);
        const bytes = await jpegBytes(page);
        await openJob(page, job);
        const photos = card(page, 'Photos');
        const input = photos.locator('input[type="file"][data-photo-type="before"]');
        const retry = photos.getByRole('button', { name: 'Try again', exact: true });
        await expect(photos.getByRole('button', { name: 'Add a before photo', exact: true })).not.toHaveAttribute('aria-disabled', 'true', { timeout: FIRST_VISIT_MS });

        await input.setInputFiles({ name: 'notes.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('a note about the rooms, not a picture') });
        await expect(alertSaying(page, SAYS.unusable), 'the file is refused in one sentence').toBeVisible({ timeout: 30_000 });
        await expect(retry, 'a file that is not a picture is not offered again').toHaveCount(0);
        expect(await countOf('SELECT COUNT(*) AS n FROM job_photos WHERE booking_id = ?', [job.bookingId]), 'nothing was saved').toBe(0);

        let refused = 0;
        await page.route('**/api/job/*/photos', async (route) => {
            if (route.request().method() !== 'POST' || refused > 0) return route.continue();
            refused += 1;
            return route.fulfill({ status: 503, json: { success: false, message: SAYS.storeDown } });
        });
        await input.setInputFiles({ name: 'front-room.jpg', mimeType: 'image/jpeg', buffer: bytes });
        await expect(alertSaying(page, SAYS.storeDown), "the server's sentence").toBeVisible({ timeout: 30_000 });
        await expect(retry, 'and a way to send the picture again').toBeVisible();
        expect(await countOf('SELECT COUNT(*) AS n FROM job_photos WHERE booking_id = ?', [job.bookingId]), 'the refused photo was not saved').toBe(0);
        await retry.click();
        await expect(photos.getByRole('link', { name: /^Before photo by Ann, / }), 'the second send puts the photo on the page').toBeVisible({ timeout: 30_000 });
        await expect(alertSaying(page, SAYS.storeDown), 'the sentence goes').toHaveCount(0);
        await expect(retry, 'and so does the button').toHaveCount(0);
        expect(refused, 'the route refused once').toBe(1);
        expect(await countOf('SELECT COUNT(*) AS n FROM job_photos WHERE booking_id = ?', [job.bookingId]), 'one photo was saved').toBe(1);
    });

    // Mutant that turns this case red: a refusal of the server (the job started on another phone) is shown with a Try again, is not shown at all, or leaves
    // the before button on when the page reads the link again.
    test('Screens: a refusal because the job has started shows the server\'s sentence with no Try again, and the before button turns off with the reason', async ({ page, request, baseURL, playwright, context }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const ann = await addMember(ctx, 'Ann', '183');
        const job = await makeJob(ctx, { members: [ann] });
        const cookie = await signCleanerIn(ctx, job, ann, page);
        await checkIn(ctx, job, cookie, [ann], 'Ann checks in');
        await context.grantPermissions(['geolocation'], { origin: ctx.baseURL });
        await context.setGeolocation(AT_THE_ADDRESS);
        const bytes = await jpegBytes(page);
        await openJob(page, job);
        const photos = card(page, 'Photos');
        const before = photos.getByRole('button', { name: 'Add a before photo', exact: true });
        await expect(before, 'the page offers the before button').not.toHaveAttribute('aria-disabled', 'true', { timeout: FIRST_VISIT_MS });

        // Another phone adds the before photo and starts the job; the page on this phone was drawn before that.
        await addPhoto(ctx, job, cookie, 'before', bytes, 'a before photo from another phone');
        await timerAct(ctx, job, cookie, 'start', 'the job is started from another phone');
        await photos.locator('input[type="file"][data-photo-type="before"]').setInputFiles({ name: 'second.jpg', mimeType: 'image/jpeg', buffer: bytes });
        await expect(alertSaying(page, SAYS.started), "the server's sentence").toBeVisible({ timeout: 30_000 });
        await expect(photos.getByRole('button', { name: 'Try again', exact: true }), 'a refusal is not offered again').toHaveCount(0);
        await expect(before, 'the page reads the link again and the button is off').toHaveAttribute('aria-disabled', 'true');
        await expect(photos.getByText(SAYS.started, { exact: true }).first(), 'with the reason as text').toBeVisible();
        expect(await countOf("SELECT COUNT(*) AS n FROM job_photos WHERE booking_id = ? AND photo_type = 'before'", [job.bookingId]), 'only the first before photo is saved').toBe(1);
    });

    // BUG-020 (ENG-031). The page counts the photos it lists, and the lists leave out the rows whose address the page may not link, so a type could be full while the page held fewer than 20
    // and told a cleaner who is checked in to check in first. The answer now says which types are full (photo_full) and the page gives that as the reason, ahead of the others, as the
    // server's refusal does. Mutant that turns this case red: the reason is worked out from the photos that are listed (a checked-in cleaner is told to check in), from the other type's fact
    // or from both types together, the full type's reason depends on the check-in or the state of the job, or the other type's reason changes.
    test('Screens: a checked-in cleaner is told the job has all the photos it can hold when a type holds 20 rows the page does not list', async ({ page, request, baseURL, playwright }) => {
        test.setTimeout(150_000);
        const ctx = await setup(playwright, request, baseURL);
        const ann = await addMember(ctx, 'Ann', '184');
        const job = await makeJob(ctx, { members: [ann] });
        const cookie = await signCleanerIn(ctx, job, ann, page);
        await checkIn(ctx, job, cookie, [ann], 'Ann checks in');
        // Twenty before rows whose address the page may not link (not one the photo store gave out), so the lists show none of them and the server counts all of them.
        for (let n = 1; n <= PHOTOS_MAX_PER_TYPE; n += 1) {
            await (await db()).execute('INSERT INTO job_photos (booking_id, photo_url, photo_type, uploaded_by) VALUES (?, ?, ?, ?)', [job.bookingId, `/uploads/${n}-b.svg`, 'before', PROVIDER1.id]);
        }
        await openJob(page, job);
        const photos = card(page, 'Photos');
        const before = photos.getByRole('button', { name: 'Add a before photo', exact: true });
        const after = photos.getByRole('button', { name: 'Add an after photo', exact: true });
        await expect(before, 'the before button is off').toHaveAttribute('aria-disabled', 'true', { timeout: FIRST_VISIT_MS });
        await expect(photos.getByRole('link'), 'the page lists no photo').toHaveCount(0);
        await expect(before, 'its reason is that the job holds all the photos it can').toHaveAccessibleDescription(SAYS.full);
        await expect(photos.getByText(SAYS.full, { exact: true }), 'the card says so once, under the type that is full').toHaveCount(1);
        await expect(photos.getByText(SAYS.notHere, { exact: true }), 'the cleaner is checked in and is not told to check in').toHaveCount(0);
        await expect(after, 'the after button is off').toHaveAttribute('aria-disabled', 'true');
        await expect(after, 'for the reason it had: the job has not started').toHaveAccessibleDescription(SAYS.notStarted);
        await expect(photos.getByText('0 of 20', { exact: true }), 'the count line is of the photos the page lists, as it was').toHaveCount(2);
    });
});

// ---- the Timer card ----

test.describe('Job timer: the timer card', () => {
    sweepAround();

    // Mutant that turns this case red: Start is on while the server would refuse it, the reason under it is missing or is another reason's sentence, the
    // quoted time is missing, or pressing the off button writes something.
    test('Screens: while the job has not started the Start button is off and says why for each reason the server gives, and the quoted time shows', async ({ page, request, baseURL, playwright }) => {
        test.setTimeout(360_000);
        const ctx = await setup(playwright, request, baseURL);
        const ann = await addMember(ctx, 'Ann', '184');
        const bea = await addMember(ctx, 'Bea', '185');
        const bytes = await jpegBytes(page);

        const shows = async (why, job, sentence) => {
            await openJob(page, job);
            const timer = card(page, 'Job timer');
            const start = timer.getByRole('button', { name: 'Start the job', exact: true });
            await expect(start, `${why}: Start is off`).toHaveAttribute('aria-disabled', 'true', { timeout: FIRST_VISIT_MS });
            await expect(timer.getByText(sentence, { exact: true }), `${why}: the reason is text under it`).toBeVisible();
            await expect(timer.getByText('Quoted time: 6 h for the job', { exact: true }), `${why}: the quoted time shows`).toBeVisible();
            await start.click({ force: true });
            await expect(timer.getByRole('alert'), `${why}: pressing an off Start says nothing`).toHaveCount(0);
            expect(await countOf('SELECT COUNT(*) AS n FROM job_sessions WHERE booking_id = ?', [job.bookingId]), `${why}: nothing started`).toBe(0);
        };

        // No before photo: Ann is checked in and has taken none.
        const noPhoto = await makeJob(ctx, { members: [ann] });
        const annOnOne = await signCleanerIn(ctx, noPhoto, ann, page);
        await checkIn(ctx, noPhoto, annOnOne, [ann], 'Ann checks in');
        await shows('no before photo', noPhoto, SAYS.noPhoto);

        // Nobody checked in: Ann took a before photo and checked out; Bea has the page.
        const nobody = await makeJob(ctx, { members: [ann, bea] });
        const annOnTwo = await signCleanerIn(ctx, nobody, ann);
        await checkIn(ctx, nobody, annOnTwo, [ann], 'Ann checks in');
        await addPhoto(ctx, nobody, annOnTwo, 'before', bytes, 'Ann adds the before photo');
        await checkOut(ctx, nobody, annOnTwo, [ann], 'Ann checks out');
        await signCleanerIn(ctx, nobody, bea, page);
        await shows('nobody checked in', nobody, SAYS.nobodyHere);

        // The job is not confirmed: Ann is checked in and the booking is pending.
        const pending = await makeJob(ctx, { members: [ann] });
        const annOnThree = await signCleanerIn(ctx, pending, ann, page);
        await checkIn(ctx, pending, annOnThree, [ann], 'Ann checks in');
        await (await db()).execute("UPDATE bookings SET status = 'pending' WHERE id = ?", [pending.bookingId]);
        await shows('job not confirmed', pending, SAYS.notConfirmed);

        // A cleaner who is not checked in while another is: Ann is in with a photo, Bea has the page.
        const other = await makeJob(ctx, { members: [ann, bea] });
        const annOnFour = await signCleanerIn(ctx, other, ann);
        await checkIn(ctx, other, annOnFour, [ann], 'Ann checks in');
        await addPhoto(ctx, other, annOnFour, 'before', bytes, 'Ann adds the before photo');
        await signCleanerIn(ctx, other, bea, page);
        await shows('another cleaner is in and this one is not', other, SAYS.checkInFirst);
    });

    // Mutant that turns this case red: Start does not send the phone's position or does not start, the clock does not start at the time each cleaner has
    // (the quote shared between the cleaners who are in), the label names the wrong crew, Pause does not take Start's place, the screen reader is not
    // told, or the clock does not move.
    test('Screens: Start the job takes the phone\'s position and starts the clock at the time each of the two cleaners has, counting down, with Pause in its place', async ({ page, request, baseURL, playwright, context }) => {
        test.setTimeout(240_000);
        const ctx = await setup(playwright, request, baseURL);
        const ann = await addMember(ctx, 'Ann', '186');
        const bea = await addMember(ctx, 'Bea', '187');
        const job = await makeJob(ctx, { members: [ann, bea], quote: 360 });
        const cookie = await signCleanerIn(ctx, job, ann, page);
        await checkIn(ctx, job, cookie, [ann, bea], 'Ann checks in with Bea');
        await addPhoto(ctx, job, cookie, 'before', await jpegBytes(page), 'Ann adds the before photo');
        await context.grantPermissions(['geolocation'], { origin: ctx.baseURL });
        await context.setGeolocation(AT_THE_ADDRESS);
        await openJob(page, job);
        const timer = card(page, 'Job timer');
        await expect(timer.getByText('Quoted time: 6 h for the job', { exact: true })).toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(timer.getByText('With 2 cleaners here that is 3 h each', { exact: true }), 'the time each cleaner has').toBeVisible();
        const start = timer.getByRole('button', { name: 'Start the job', exact: true });
        await expect(start, 'Start is on').not.toHaveAttribute('aria-disabled', 'true');

        await start.click();
        await expect(page.getByRole('timer'), 'the clock reads H:MM:SS').toHaveText(/^\d:\d{2}:\d{2}$/, { timeout: 30_000 });
        const first = await clockSeconds(page);
        expect(first, 'the clock starts near three hours').toBeGreaterThan(10_700);
        expect(first, 'and not above them').toBeLessThanOrEqual(10_800);
        await expect(timer.getByText('left for each of the 2 cleaners here', { exact: true }), 'the label names the crew that is here').toBeVisible();
        await expect(timer.getByRole('button', { name: 'Pause the job', exact: true }), 'Pause takes the place of Start').toBeVisible();
        await expect(timer.getByRole('button', { name: 'Start the job', exact: true })).toHaveCount(0);
        await expect(statusSaying(page, 'Job started'), 'a screen reader is told').toBeVisible();
        await expect.poll(() => clockSeconds(page), { message: 'the clock counts down', timeout: 8_000 }).toBeLessThan(first);
        const [booking] = await rows('SELECT status FROM bookings WHERE id = ?', [job.bookingId]);
        expect(booking.status, 'the job is in progress').toBe('in_progress');
    });

    // Mutant that turns this case red: a refused position starts the job anyway, the page does not say why or what to do, or the Start button is gone.
    test('Screens: when the phone will not give its position Start says why and starts nothing', async ({ page, request, baseURL, playwright, context }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const ann = await addMember(ctx, 'Ann', '188');
        const job = await makeJob(ctx, { members: [ann] });
        const cookie = await signCleanerIn(ctx, job, ann, page);
        await checkIn(ctx, job, cookie, [ann], 'Ann checks in');
        await addPhoto(ctx, job, cookie, 'before', await jpegBytes(page), 'Ann adds the before photo');
        await context.clearPermissions();
        await openJob(page, job);
        const timer = card(page, 'Job timer');
        const start = timer.getByRole('button', { name: 'Start the job', exact: true });
        await expect(start).not.toHaveAttribute('aria-disabled', 'true', { timeout: FIRST_VISIT_MS });
        await start.click();
        await expect(alertSaying(page, SAYS.location), 'the reason, and what to do').toBeVisible({ timeout: 30_000 });
        await expect(start, 'Start is offered again').toBeVisible();
        await expect(page.getByRole('timer'), 'no clock runs').toHaveCount(0);
        const [booking] = await rows('SELECT status FROM bookings WHERE id = ?', [job.bookingId]);
        expect(booking.status, 'the booking is as it was').toBe('confirmed');
        expect(await countOf('SELECT COUNT(*) AS n FROM job_sessions WHERE booking_id = ?', [job.bookingId]), 'nothing started').toBe(0);
    });

    // Mutant that turns this case red: Pause needs the phone's position, the clock moves while paused, the word Paused is missing, Resume does not
    // start the clock again, or the server and the page disagree about the state.
    test('Screens: Pause stops the clock and says Paused with no position needed, and Resume starts it again', async ({ page, request, baseURL, playwright, context }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const ann = await addMember(ctx, 'Ann', '189');
        const job = await makeJob(ctx, { members: [ann] });
        const cookie = await signCleanerIn(ctx, job, ann, page);
        await checkIn(ctx, job, cookie, [ann], 'Ann checks in');
        await addPhoto(ctx, job, cookie, 'before', await jpegBytes(page), 'Ann adds the before photo');
        await timerAct(ctx, job, cookie, 'start', 'Ann starts the job');
        await context.clearPermissions();
        await openJob(page, job);
        const timer = card(page, 'Job timer');
        const pause = timer.getByRole('button', { name: 'Pause the job', exact: true });
        await expect(pause, 'a running job offers Pause').toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(page.getByRole('timer')).toHaveText(/^\d:\d{2}:\d{2}$/);

        await pause.click();
        await expect(page.getByText(/Paused/), 'the word Paused shows').toBeVisible({ timeout: 30_000 });
        await expect(timer.getByRole('button', { name: 'Resume the job', exact: true }), 'Resume takes the place of Pause').toBeVisible();
        await expect(statusSaying(page, 'Job paused'), 'a screen reader is told').toBeVisible();
        const frozen = await clockSeconds(page);
        await page.waitForTimeout(1500);
        expect(await clockSeconds(page), 'a paused clock does not move').toBe(frozen);
        expect((await timerNow(ctx, job, cookie, 'the server reads the timer')).state, 'the server says paused').toBe('paused');

        await timer.getByRole('button', { name: 'Resume the job', exact: true }).click();
        await expect(timer.getByRole('button', { name: 'Pause the job', exact: true }), 'Pause is back').toBeVisible({ timeout: 30_000 });
        await expect(page.getByText(/Paused/), 'the word goes').toHaveCount(0);
        await expect(statusSaying(page, 'Job resumed'), 'a screen reader is told').toBeVisible();
        await expect.poll(() => clockSeconds(page), { message: 'the clock counts down again', timeout: 10_000 }).toBeLessThan(frozen);
        expect((await timerNow(ctx, job, cookie, 'the server reads the timer')).state, 'the server says running').toBe('running');
    });
});

// ---- the Crew card's check-out and the quote used up ----

async function rewind(bookingId, seconds) {
    const open = await db();
    await open.execute('UPDATE job_sessions SET clock_in = clock_in - INTERVAL ? SECOND, clock_out = clock_out - INTERVAL ? SECOND WHERE booking_id = ?', [seconds, seconds, bookingId]);
    await open.execute('UPDATE job_checkins SET checked_in_at = checked_in_at - INTERVAL ? SECOND, checked_out_at = checked_out_at - INTERVAL ? SECOND WHERE booking_id = ?', [seconds, seconds, bookingId]);
}

test.describe('Job timer: the crew card and the quote', () => {
    sweepAround();

    // Mutant that turns this case red: Check out writes at once with no question, Stay writes or leaves the question open, the question is not a group
    // with the sentence, Check out does not check the cleaner out, the row keeps its button, or the checked-out cleaner is back in the tick list.
    test('Screens: Check out asks first, Stay writes nothing, and Check out leaves a Checked out row with no button and no tick box', async ({ page, request, baseURL, playwright, context }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const ann = await addMember(ctx, 'Ann', '190');
        const bea = await addMember(ctx, 'Bea', '191');
        const job = await makeJob(ctx, { members: [ann, bea] });
        const cookie = await signCleanerIn(ctx, job, ann, page);
        await checkIn(ctx, job, cookie, [ann, bea], 'Ann checks in with Bea');
        await context.grantPermissions(['geolocation'], { origin: ctx.baseURL });
        await context.setGeolocation(AT_THE_ADDRESS);
        const requested = [];
        page.on('request', (made) => { if (made.method() === 'POST' && made.url().includes('/check-out')) requested.push(made.url()); });
        await openJob(page, job);
        const crew = card(page, 'Crew');
        await expect(crew.getByRole('button', { name: 'Check out Ann', exact: true }), 'each cleaner who is in has a Check out button').toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(crew.getByRole('button', { name: 'Check out Bea', exact: true })).toBeVisible();

        await crew.getByRole('button', { name: 'Check out Ann', exact: true }).click();
        const question = crew.getByRole('group', { name: /^Check out Ann\?/ });
        await expect(question, 'the question is a group').toBeVisible();
        await expect(question.getByText('Check out Ann? They can not check in again on this job.'), 'with its sentence').toBeVisible();
        await expect(question.getByRole('button', { name: 'Stay', exact: true }), 'the safe answer has focus').toBeFocused();
        await question.getByRole('button', { name: 'Stay', exact: true }).click();
        await expect(question, 'Stay closes the question').toHaveCount(0);
        await expect(crew.getByRole('button', { name: 'Check out Ann', exact: true }), 'and the row has its button').toBeVisible();
        expect(requested, 'Stay sent nothing').toEqual([]);
        expect(await countOf('SELECT COUNT(*) AS n FROM job_checkins WHERE booking_id = ? AND checked_out_at IS NOT NULL', [job.bookingId]), 'and wrote nothing').toBe(0);

        await crew.getByRole('button', { name: 'Check out Ann', exact: true }).click();
        await question.getByRole('button', { name: 'Check out', exact: true }).click();
        await expect(statusSaying(page, 'Checked out: Ann.'), 'the page says who is out').toBeVisible({ timeout: 30_000 });
        const row = crew.getByRole('listitem').filter({ hasText: 'Ann' });
        await expect(row, "Ann's row says when").toContainText(/Checked out at \d{1,2}:\d{2}/);
        await expect(crew.getByRole('button', { name: 'Check out Ann' }), 'and has no button').toHaveCount(0);
        await expect(crew.getByRole('checkbox', { name: 'Ann' }), 'and no tick box').toHaveCount(0);
        await expect(crew.getByRole('button', { name: 'Check out Bea', exact: true }), "Bea's row is as it was").toBeVisible();
        const [out] = await rows('SELECT COUNT(*) AS n FROM job_checkins WHERE booking_id = ? AND crew_member_id = ? AND checked_out_at IS NOT NULL', [job.bookingId, ann.id]);
        expect(Number(out.n), 'the row of Ann has the time she left').toBe(1);
    });

    // Mutant that turns this case red: the banner or the Over by clock is missing when the labour used reaches the quote, the clock keeps counting down, or
    // the first look does not record the moment.
    test('Screens: when the crew time used reaches the quote the page says so, the clock reads Over by, and nothing else is promised', async ({ page, request, baseURL, playwright, context }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const ann = await addMember(ctx, 'Ann', '195');
        const job = await makeJob(ctx, { members: [ann], quote: 60 });
        const cookie = await signCleanerIn(ctx, job, ann, page);
        await checkIn(ctx, job, cookie, [ann], 'Ann checks in');
        await addPhoto(ctx, job, cookie, 'before', await jpegBytes(page), 'Ann adds the before photo');
        await timerAct(ctx, job, cookie, 'start', 'Ann starts the job');
        await rewind(job.bookingId, 7200);
        await context.clearPermissions();
        await openJob(page, job);
        const timer = card(page, 'Job timer');
        await expect(statusSaying(page, 'This job has used its quoted time. It is flagged for the office. Time past the quote is recorded and nothing extra is charged.'), 'the banner').toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(page.getByRole('timer'), 'the clock says how far over').toHaveText(/Over by \d+:\d{2}:\d{2}/);
        const text = await page.getByRole('timer').innerText();
        const over = /Over by (\d+):(\d{2}):(\d{2})/.exec(text);
        const seconds = over ? Number(over[1]) * 3600 + Number(over[2]) * 60 + Number(over[3]) : NaN;
        expect(seconds, 'an hour over a one-hour quote, within a minute').toBeGreaterThanOrEqual(3600);
        expect(seconds).toBeLessThan(3660);
        await expect(timer.getByText(/^left for /), 'no time is left to show').toHaveCount(0);
        const [booking] = await rows('SELECT over_quote_at FROM bookings WHERE id = ?', [job.bookingId]);
        expect(booking.over_quote_at, 'the first look recorded the moment').not.toBeNull();
    });
});

// ---- the poll and the small screens ----

test.describe('Job timer: the poll and the small screens', () => {
    sweepAround();

    // Mutant that turns this case red: the page does not ask again after 30 seconds, a cleaner who checked in on another phone does not change the label,
    // an unreachable server changes the page (or says nothing), or a link that stops being valid leaves the clock on the page.
    test('Screens: the page asks the timer again every 30 seconds, shows a crew that changed on another phone, says nothing is lost when the server is out of reach, and leaves for the invalid screen on a 404', async ({ page, request, baseURL, playwright, context }) => {
        test.setTimeout(240_000);
        const ctx = await setup(playwright, request, baseURL);
        const ann = await addMember(ctx, 'Ann', '192');
        const bea = await addMember(ctx, 'Bea', '193');
        const cat = await addMember(ctx, 'Cat', '194');
        const job = await makeJob(ctx, { members: [ann, bea, cat], quote: 360 });
        const cookie = await signCleanerIn(ctx, job, ann, page);
        await checkIn(ctx, job, cookie, [ann, bea], 'Ann checks in with Bea');
        await addPhoto(ctx, job, cookie, 'before', await jpegBytes(page), 'Ann adds the before photo');
        await timerAct(ctx, job, cookie, 'start', 'Ann starts the job');
        await context.clearPermissions();
        await page.clock.install();
        await openJob(page, job);
        const timer = card(page, 'Job timer');
        await expect(timer.getByText('left for each of the 2 cleaners here', { exact: true })).toBeVisible({ timeout: FIRST_VISIT_MS });

        await checkIn(ctx, job, cookie, [cat], 'Ann checks Cat in from another phone');
        await page.clock.fastForward(31_000);
        await expect(timer.getByText('left for each of the 3 cleaners here', { exact: true }), 'the next poll shows the crew that is here').toBeVisible();
        await expect(card(page, 'Crew').getByRole('button', { name: 'Check out Cat', exact: true }), 'and the read of the whole link that the poll starts has put Cat on the Crew card').toBeVisible();

        await page.route('**/api/job/*/timer', async (route) => (route.request().method() === 'GET' ? route.abort() : route.continue()));
        await page.clock.fastForward(31_000);
        await expect(timer.getByText("Can't reach the server. The clock keeps counting here.", { exact: true }), 'a poll that did not arrive is said, quietly').toBeVisible();
        await expect(timer.getByText('left for each of the 3 cleaners here', { exact: true }), 'and changes nothing else').toBeVisible();

        await page.unroute('**/api/job/*/timer');
        await page.route('**/api/job/*/timer', async (route) => (route.request().method() === 'GET' ? route.fulfill({ status: 404, json: { success: false, message: 'This link is not valid.' } }) : route.continue()));
        await page.clock.fastForward(31_000);
        await expect(page.getByRole('heading', { name: 'This link is not valid.', level: 1 }), 'a link that is not valid sends the page to the invalid screen').toBeVisible();
        await expect(page.getByRole('timer'), 'with no clock').toHaveCount(0);
    });

    // Mutant that turns this case red: a read of the whole link that is answered after the page has gone to the invalid screen is drawn, so the job and its Timer
    // card come back over a link that is not valid (BUG-017, the reviewer's N25). The case holds that read where the browser makes it and lets it go after the 404.
    test('Screens: a read of the whole job that is answered after the poll got its 404 does not put the job and its Timer card back over the invalid screen', async ({ page, request, baseURL, playwright, context }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const ann = await addMember(ctx, 'Ann', '192');
        const bea = await addMember(ctx, 'Bea', '193');
        const cat = await addMember(ctx, 'Cat', '194');
        const job = await makeJob(ctx, { members: [ann, bea, cat], quote: 360 });
        const cookie = await signCleanerIn(ctx, job, ann, page);
        await checkIn(ctx, job, cookie, [ann, bea], 'Ann checks in with Bea');
        await addPhoto(ctx, job, cookie, 'before', await jpegBytes(page), 'Ann adds the before photo');
        await timerAct(ctx, job, cookie, 'start', 'Ann starts the job');
        await context.clearPermissions();
        await page.clock.install();
        await openJob(page, job);
        const timer = card(page, 'Job timer');
        await expect(timer.getByText('left for each of the 2 cleaners here', { exact: true })).toBeVisible({ timeout: FIRST_VISIT_MS });

        // The read of the whole link that the next poll starts (it finds Cat on the clock and not on the Crew card) is held until the page has the 404.
        const held = [];
        await page.route((url) => url.pathname === `/api/job/${job.token}`, async (route) => {
            if (route.request().method() === 'GET') held.push(route);
            else await route.continue();
        });
        await checkIn(ctx, job, cookie, [cat], 'Ann checks Cat in from another phone');
        await page.clock.fastForward(31_000);
        await expect(timer.getByText('left for each of the 3 cleaners here', { exact: true }), 'the poll shows the crew that is here').toBeVisible();
        await expect.poll(() => held.length, { message: 'the page asks for the whole link again and that read is held', timeout: 15_000 }).toBe(1);

        await page.route('**/api/job/*/timer', async (route) => (route.request().method() === 'GET' ? route.fulfill({ status: 404, json: { success: false, message: 'This link is not valid.' } }) : route.continue()));
        await page.clock.fastForward(31_000);
        const invalid = page.getByRole('heading', { name: 'This link is not valid.', level: 1 });
        await expect(invalid, 'the next poll is answered 404 and the page goes to the invalid screen').toBeVisible();
        await expect(page.getByRole('timer'), 'with no clock').toHaveCount(0);

        const answered = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/job/${job.token}` && response.request().method() === 'GET');
        for (const route of held) await route.continue();
        await answered;
        await sleep(2_500);
        await expect(invalid, 'the late answer does not take the invalid screen away').toBeVisible();
        await expect(page.getByRole('timer'), 'no clock comes back').toHaveCount(0);
        await expect(card(page, 'Crew'), 'and no job').toHaveCount(0);
    });

    // Mutant that turns this case red: a poll answered 401 does not send the page back to the sign-in step, so the Timer card goes on counting for a cleaner
    // whose session has ended, with the job on the page.
    test('Screens: when the session ends in the middle of a countdown the next poll is answered 401 and the page goes back to the sign-in step, with no clock and nothing of the job on it', async ({ page, request, baseURL, playwright, context }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const ann = await addMember(ctx, 'Ann', '192');
        const bea = await addMember(ctx, 'Bea', '193');
        const job = await makeJob(ctx, { members: [ann, bea], quote: 360 });
        const cookie = await signCleanerIn(ctx, job, ann, page);
        await checkIn(ctx, job, cookie, [ann, bea], 'Ann checks in with Bea');
        await addPhoto(ctx, job, cookie, 'before', await jpegBytes(page), 'Ann adds the before photo');
        await timerAct(ctx, job, cookie, 'start', 'Ann starts the job');
        await context.clearPermissions();
        await page.clock.install();
        await openJob(page, job);
        await expect(card(page, 'Job timer').getByText('left for each of the 2 cleaners here', { exact: true })).toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(page.getByRole('timer'), 'the clock counts').toHaveText(/^\d:\d{2}:\d{2}$/);
        await expect(page.getByRole('heading', { name: 'Probe service', level: 1 }), 'with the job on the page').toBeVisible();

        // The browser keeps no session for the link (it ran out, or it was cleared), so the server answers the next poll 401.
        await context.clearCookies();
        await page.clock.fastForward(31_000);
        await expect(page.getByRole('heading', { name: 'Open your job.', level: 1 }), 'a poll answered 401 sends the page back to the sign-in step').toBeVisible();
        await expect(page.getByLabel('Mobile number'), 'with the field to sign in again').toBeVisible();
        await expect(page.getByRole('timer'), 'the clock goes with the card').toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'Probe service', level: 1 }), 'and nothing of the job stays on the page').toHaveCount(0);
    });

    // Mutant that turns this case red: a long name or a card makes the page scroll sideways at a phone's width, a button or link in the three cards is
    // smaller than 44 px at 360 px, or a thumbnail is not 96 px.
    test('Screens: with a 104-letter name the page does not scroll sideways from 320 to 1280 px, and at 360 px every button and link of the Crew, Photos and Timer cards is a target of 44 px', async ({ page, request, baseURL, playwright, context }) => {
        test.setTimeout(240_000);
        const ctx = await setup(playwright, request, baseURL);
        const longName = `${'Abcdefghij'.repeat(10)}klmn`;
        expect(longName.length, 'the name is 104 letters').toBe(104);
        const ann = await addMember(ctx, longName, '180');
        const bea = await addMember(ctx, 'Bea', '181');
        const job = await makeJob(ctx, { members: [ann, bea], quote: 360 });
        const cookie = await signCleanerIn(ctx, job, ann, page);
        await checkIn(ctx, job, cookie, [ann], 'the cleaner checks in');
        await addPhoto(ctx, job, cookie, 'before', await jpegBytes(page), 'the cleaner adds the before photo');
        await context.clearPermissions();
        await page.setViewportSize({ width: 360, height: 800 });
        await openJob(page, job);
        const crew = card(page, 'Crew');
        const photos = card(page, 'Photos');
        const timer = card(page, 'Job timer');
        await expect(timer, 'the Timer card shows').toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(photos.getByRole('link', { name: /^Before photo by Abcdefghij/ }), 'and the photo is listed').toBeVisible();

        for (const width of [320, 360, 375, 768, 1280]) {
            await page.setViewportSize({ width, height: 800 });
            const widths = await page.evaluate(() => ({
                page: document.documentElement.scrollWidth,
                window: window.innerWidth,
                over: [...document.querySelectorAll('body *')]
                    .filter((el) => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible')
                    .map((el) => `${el.tagName.toLowerCase()}[${String(el.className).slice(0, 60)}] "${(el.textContent || '').trim().slice(0, 20)}" ${el.clientWidth}<${el.scrollWidth}`)
                    .slice(-6),
            }));
            expect(widths.page, `${width} px: the page is no wider than the window${widths.over.length ? ` (content runs past: ${widths.over.join(' | ')})` : ''}`).toBeLessThanOrEqual(widths.window);
        }

        await page.setViewportSize({ width: 360, height: 800 });
        for (const [name, region] of [['Crew', crew], ['Photos', photos], ['Job timer', timer]]) {
            for (const role of ['button', 'link']) {
                const targets = region.getByRole(role);
                for (let at = 0; at < await targets.count(); at += 1) {
                    const box = await targets.nth(at).boundingBox();
                    const label = (await targets.nth(at).innerText()).trim().slice(0, 30) || (await targets.nth(at).getAttribute('aria-label')) || `${role} ${at}`;
                    expect(box, `${name}: "${label}" is on the page`).not.toBeNull();
                    expect(box?.height, `${name}: "${label}" is 44 px high`).toBeGreaterThanOrEqual(44);
                    expect(box?.width, `${name}: "${label}" is 44 px wide`).toBeGreaterThanOrEqual(44);
                }
            }
        }
        const picture = await photos.getByRole('link', { name: /^Before photo by Abcdefghij/ }).locator('img').boundingBox();
        expect(picture?.width, 'a thumbnail is 96 px wide').toBe(96);
        expect(picture?.height, 'and 96 px high').toBe(96);
    });
});

// ---- the panels ----

// A job told through the routes by one phone: Ann and Bea check in, Ann takes a before photo, starts the job and takes an after photo, Bea is checked out,
// the job is paused and resumed. The quote is one hour.
async function panelJob(ctx, page, first) {
    const ann = await addMember(ctx, 'Ann', String(first));
    const bea = await addMember(ctx, 'Bea', String(first + 1));
    const job = await makeJob(ctx, { members: [ann, bea], quote: 60 });
    const cookie = await signCleanerIn(ctx, job, ann);
    const bytes = await jpegBytes(page);
    await checkIn(ctx, job, cookie, [ann, bea], 'Ann checks in with Bea');
    await addPhoto(ctx, job, cookie, 'before', bytes, 'Ann adds a before photo');
    await timerAct(ctx, job, cookie, 'start', 'Ann starts the job');
    await addPhoto(ctx, job, cookie, 'after', bytes, 'Ann adds an after photo');
    await checkOut(ctx, job, cookie, [bea], 'Ann checks Bea out');
    await timerAct(ctx, job, cookie, 'pause', 'Ann pauses the job');
    await timerAct(ctx, job, cookie, 'resume', 'Ann resumes the job');
    return { ann, bea, job };
}

// What a manager's panel shows of such a job, then the figure after the rows are set back (Refresh), the quote used up, and a cleaner taken off the crew.
async function checkBlock(page, ctx, panel, { ann, bea, job }, wait, { activity }) {
    await expect(panel.getByRole('heading', { name: 'Job timer and photos', level: 3 }), 'the block').toBeVisible({ timeout: wait });
    await expect(panel.getByText('Running', { exact: true }).first(), 'the state as a word').toBeVisible();
    await expect(panel.getByRole('timer'), 'the clock').toHaveText(/^\d+:\d{2}:\d{2}$/);
    await expect(panel.getByText('left for the cleaner here', { exact: true }), 'for the cleaner who is here').toBeVisible();
    await expect(panel.getByText(/^As of \d{1,2}:\d{2}/), 'the age of the figure').toBeVisible();
    const refresh = panel.getByRole('button', { name: 'Refresh', exact: true });
    await expect(refresh).toBeVisible();

    const table = panel.getByRole('table', { name: 'Time worked by each cleaner' });
    for (const column of ['Cleaner', 'Here since', 'Out at', 'Time worked']) {
        await expect(table.getByRole('columnheader', { name: column, exact: true }), `the ${column} column`).toBeVisible();
    }
    const annRow = table.getByRole('row').filter({ hasText: 'Ann' });
    await expect(annRow, 'Ann is here now').toContainText('here now');
    await expect(table.getByRole('row').filter({ hasText: 'Bea' }), 'Bea has left').not.toContainText('here now');

    await expect(panel.getByRole('heading', { name: 'Before (1)', level: 4 })).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'After (1)', level: 4 })).toBeVisible();
    const thumbnail = panel.getByRole('link', { name: /^Before photo by Ann, / });
    await expect(thumbnail, 'the photo is a link').toBeVisible();
    await expect(thumbnail).toHaveAttribute('target', '_blank');
    await expect(thumbnail).toHaveAttribute('rel', /noopener/);
    await expect(panel.getByRole('link', { name: /^After photo by Ann, / })).toBeVisible();
    if (activity) {
        for (const sentence of ['Ann added a before photo', 'Ann added an after photo', 'Ann started the job', 'Ann paused the job', 'Ann resumed the job', 'Ann checked out Bea']) {
            await expect(panel.getByText(sentence), `the activity says "${sentence}"`).toBeVisible();
        }
    } else {
        await expect(panel.getByRole('heading', { name: 'Recent activity', level: 3 }), 'the provider has no activity list').toHaveCount(0);
        await expect(panel.getByText('Ann started the job'), 'and none of its sentences').toHaveCount(0);
    }

    const figure = await annRow.innerText();
    await rewind(job.bookingId, 600);
    await refresh.click();
    await expect.poll(() => annRow.innerText(), { message: 'Refresh reads the rows again', timeout: 30_000 }).not.toBe(figure);

    await rewind(job.bookingId, 4000);
    await refresh.click();
    await expect(panel.getByText(/Over the quote since /), 'the chip').toBeVisible({ timeout: 30_000 });
    await expect(panel.getByRole('timer'), 'the clock says how far over').toHaveText(/Over by \d+:\d{2}:\d{2}/);
    if (activity) await expect(panel.getByText('The job went over its quoted time'), 'the activity says so').toBeVisible();

    await dataOf(await writing(() => ctx.request.put(`/api/provider/jobs/${job.bookingId}/crew`, { headers: ctx.as.provider, data: { crew_ids: [bea.id] } })), 200, 'provider 1 takes Ann off the crew');
    await refresh.click();
    if (activity) {
        await expect(panel.getByText(/Ann was taken off the crew while checked in; checked out when .+ looked/), 'the removal').toBeVisible({ timeout: 30_000 });
        await expect(panel.getByText('The job paused when the last cleaner checked out'), 'the pause when the last one left').toBeVisible();
    } else {
        await expect(annRow, 'the cleaner taken off the crew is stamped out').not.toContainText('here now', { timeout: 30_000 });
    }
    await expect(panel.getByText('Paused', { exact: true }).first(), 'the state as a word').toBeVisible();
}

test.describe('Job timer: the panels', () => {
    sweepAround();

    // The provider's panel carries no activity list (the audit trail is the admin's, ENG-015), so this case pins the block and the photos, and that the list is absent.
    // Mutant that turns this case red: the block is missing, shows another state, leaves out a column or a photo, the provider is shown the activity, Refresh does
    // not read again, the chip or the Over by clock is missing once the quote is used, or a cleaner taken off the crew is not stamped out.
    test("Screens: the provider's panel shows the timer and the photos of a job with no activity list, and follows Refresh, the quote used up and a cleaner taken off the crew", async ({ page, request, baseURL, playwright }) => {
        test.setTimeout(420_000);
        const ctx = await setup(playwright, request, baseURL);
        const made = await panelJob(ctx, page, 196);
        await (await db()).execute('UPDATE service_providers SET stripe_onboarding_complete = 1 WHERE id = ?', [PROVIDER1.id]);
        await signInAs(page, 'provider1');
        await page.goto(`/provider/jobs/${made.job.bookingId}`, { timeout: FIRST_VISIT_MS });
        await checkBlock(page, ctx, page.getByRole('region', { name: 'Job link for your crew', exact: true }), made, FIRST_VISIT_MS, { activity: false });
    });

    // Mutant that turns this case red: the admin's panel leaves the block out, shows it differently from the provider's, or leaves out a sentence of the activity
    // that only the admin's panel carries.
    test("Screens: the admin's panel shows the same block and the same sentences, and follows Refresh, the quote used up and a cleaner taken off the crew", async ({ page, request, baseURL, playwright }) => {
        test.setTimeout(480_000);
        const ctx = await setup(playwright, request, baseURL);
        const made = await panelJob(ctx, page, 198);
        await signInAs(page, 'admin');
        await page.goto(`/admin/bookings/${made.job.bookingId}`, { timeout: ADMIN_FIRST_VISIT_MS });
        await checkBlock(page, ctx, page.getByRole('region', { name: 'Job link', exact: true }), made, ADMIN_FIRST_VISIT_MS, { activity: true });
    });
});

// ---- the sentences the page and the server share ----

// The text of the braces that follow `name = {` in a source file, or null.
function objectAfter(source, name) {
    const from = source.indexOf(`${name} = {`);
    return from < 0 ? null : source.slice(from, source.indexOf('}', from));
}

// The sentence given to `key` in the text of an object, or null.
function sentenceIn(objectText, key) {
    const found = new RegExp(`\\b${key}:\\s*(?:'([^']*)'|"([^"]*)")`).exec(objectText ?? '');
    return found ? (found[1] ?? found[2]) : null;
}

test.describe('Job timer: the sentences the page and the server share', () => {
    // Mutant that turns this case red: the page words a reason for an off Start differently from the server's refusal, the page's photo limit is not the
    // server's, or a file input loses the camera hints.
    test('Screens: the reasons under an off Start are the sentences the server refuses with, the photo limit is the server\'s, and the file inputs ask for the camera', async () => {
        const read = (file) => fs.readFile(path.join(ROOT, file), 'utf8');
        const kit = await read('src/components/job/jobLinkKit.js');
        const server = await read('src/lib/job-timer.js');
        const blocked = objectAfter(kit, 'BLOCKED_TEXT');
        const messages = objectAfter(server, 'TIMER_MESSAGES');
        expect(blocked, 'the page kit has BLOCKED_TEXT').not.toBeNull();
        expect(messages, 'the server has TIMER_MESSAGES').not.toBeNull();
        for (const key of ['not_confirmed', 'no_before_photos', 'nobody_here', 'not_here']) {
            const onPage = sentenceIn(blocked, key);
            expect(onPage, `${key} has a sentence on the page`).not.toBeNull();
            expect(onPage, `${key}: the page says what the server says`).toBe(sentenceIn(messages, key));
        }

        const limitOf = (source) => /PHOTOS_MAX_PER_TYPE\s*=\s*(\d+)/.exec(source)?.[1];
        const limit = limitOf(await read('src/lib/job-photos.js'));
        expect(limit, 'the server has a limit').toBeDefined();
        expect(limitOf(kit), 'the page has the same limit').toBe(limit);

        const photos = await read('src/components/job/JobPhotos.jsx');
        expect(photos, 'the file input takes pictures and opens the back camera').toMatch(/<input[\s\S]{0,300}?type="file"[\s\S]{0,200}?accept="image\/\*"[\s\S]{0,200}?capture="environment"/);
    });
});
