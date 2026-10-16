// @ts-check
// ENG-017: the "Reports" list of the job record in a browser, in the two panels that share it. The last part of the "Screens" row of the design's "Cases and
// baseline" table (agents/architect/designs/ENG-017-on-site-reports-and-added-item-approval.md): the provider's panel on /provider/jobs/{id} and the admin's
// booking page on /admin/bookings/{id} show the Reports list, and the admin's activity says who sent which report. The cleaner's page and the office's queue
// are in e2e/job-reports-screens.spec.js; the routes' own cases are in e2e/job-reports.spec.js.
// These cases use a real job and real reports, so the page reads what the server really sends: a job is made the way e2e/job-timer-screens.spec.js makes one
// (a booking of provider 1 inserted in SQL, the crew put on it through ENG-014's route, the link made through ENG-015's), a cleaner signs in through the
// routes (a code asked for and found from its hash, since no texting service is set up in dev), checks in, and sends reports through ENG-017's route with a
// JPEG drawn on a canvas in the browser. The one thing a case does to the office's side is the route of the desk, to handle a report, so that the panel can
// show it as seen. Nothing here calls Stripe: no case approves an added item.
// Every case uses the numbers +1 604 555 0340 to 0359 and the e-mail prefix below. The cases run one at a time; the sweep before the first case of a describe,
// after every case and after the last removes the bookings of the prefix (their links, codes, check-ins, sessions, photos, reports and events go with them),
// the crew members of the block, the sms_budget counters of those links, members and numbers, and the photo files: those the rows of the prefix name and any
// file in the photo directory that was not there when the case began. Failure messages name the case, never a token, a code or a cookie.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { getCredentialHeaders } from './auth/credentials.js';
import { signInAs } from './support/auth.js';
import { providers } from '../database/fixtures/accounts.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';
import { sha256Hex } from '../src/lib/link-token.js';
import { budgetScope } from '../src/lib/sms-budget.js';
import { storedPhotos } from '../src/lib/job-photo-store.js';

// Every request carries a fixture account's session header and a trace records request headers: tracing is off, as in the specs next to this one.
test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

const [PROVIDER1] = providers;
const EMAIL_PREFIX = 'e2e-jrr-';
const FIRST = 340;
const LAST = 359;
const stored = (last3) => `+16045550${last3}`;
const typed = (last3) => `+1 604 555 0${last3}`;
const FIRST_VISIT_MS = 45_000;
// The admin's booking page asks for the person signed in, then the booking, then the job link, one after another, and on a cold dev server each step is a
// compile.
const ADMIN_FIRST_VISIT_MS = 120_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ADDRESS = { latitude: 51.04473, longitude: -114.07192 };
const AT_THE_ADDRESS = { latitude: ADDRESS.latitude, longitude: ADDRESS.longitude, accuracy: 12 };
// About five kilometres north of the address.
const FAR_AWAY = { latitude: ADDRESS.latitude + 0.045, longitude: ADDRESS.longitude, accuracy: 12 };
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PHOTO_DIR = path.join(ROOT, 'public', 'uploads', 'job-photos');
const photoUrlPattern = /^\/uploads\/job-photos\/[0-9a-f]{32}\.(jpg|png|webp)$/;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The words of the contract's five reports, in its order (REPORT_CHOICES of the page's kit holds the same).
const LABEL = { no_answer: 'Customer did not answer', details_wrong: 'Job details are incorrect', unhygienic: 'Unhygienic conditions', add_items: 'Add more items', cannot_complete: 'Unable to complete the job' };

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
    for (const report of await rows('SELECT r.photo_url FROM job_reports r JOIN bookings b ON b.id = r.booking_id WHERE b.customer_email LIKE ? AND r.photo_url IS NOT NULL', [`${EMAIL_PREFIX}%`])) {
        await removeFile(report.photo_url);
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
    await (await db()).execute('INSERT INTO crew_number_checks (crew_member_id, phone, code_hash, expires_at, used_at) VALUES (?, ?, ?, NOW(), NOW())', [member.id, member.phone, sha256Hex(`e2e-jrr:${member.id}:${member.phone}`)]);
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
        [`E2EJRR${id}`, `${EMAIL_PREFIX}${id}@example.invalid`, stored('359'), day, slotLabel(day), status, PROVIDER1.id, ADDRESS.latitude, ADDRESS.longitude, quote]
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

// Signs a cleaner in through the routes (the number checked, a code asked for, found from its hash and given back). The session comes back as the value of a
// `cookie` header for the actions the case takes as that phone. It is never printed.
async function signCleanerIn(ctx, job, member) {
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
        return `${name}=${rest.join('=')}`;
    } finally {
        await fresh.dispose();
    }
}

async function setup(playwright, request, baseURL) {
    return { playwright, request, baseURL: String(baseURL), as: await credentials(baseURL) };
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

// ---- actions taken as another phone, through the routes ----

async function checkIn(ctx, job, cookie, members, who) {
    return dataOf(await ctx.request.post(`/api/job/${job.token}/check-in`, { headers: { cookie }, data: { crew_ids: members.map((member) => member.id), location: AT_THE_ADDRESS } }), 200, who);
}

// One report as the cleaner whose cookie is given, with a position when `where` is given. Returns the id the desk knows it by.
async function sendReport(ctx, job, cookie, bytes, type, note, where) {
    const multipart = { type, note, photo: { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: bytes } };
    if (where) Object.assign(multipart, { latitude: String(where.latitude), longitude: String(where.longitude), accuracy: String(where.accuracy) });
    const sent = await dataOf(await ctx.request.post(`/api/job/${job.token}/reports`, { headers: { cookie }, multipart }), 200, `Ann sends "${LABEL[type]}"`);
    return Number(sent.report.id);
}

// The office handles a report through the desk's route, as the admin's page does.
async function handle(ctx, id, note) {
    await dataOf(await ctx.request.post(`/api/admin/reports/${id}`, { headers: ctx.as.admin, data: { action: 'handle', note } }), 200, `the admin handles report ${id}`);
}

// ---- what the page shows ----

// The list item of a report in a panel, found by the name of its type.
const reportIn = (panel, type) => panel.getByRole('listitem').filter({ hasText: LABEL[type] });

// The block of the list: the nearest element that holds the "Reports" heading and the list under it. The heading is looked for from the page, because a
// `has` locator is searched for inside each candidate and one that starts at the panel would find nothing there.
const reportsBlock = (panel) => panel.locator('div').filter({ has: panel.page().getByRole('heading', { name: 'Reports', level: 3 }) }).last();

// At 360 px the list ends inside the window, nothing in it runs past its own box, and every button and link of it is at least 44 px by 44 px. The shells
// around the list move to their phone layout in a render after the resize (the admin's slides its content over in 300 ms), so the list is measured again
// until it fits or five seconds are up; a list that never fits fails with the last thing measured.
async function checkLayout(page, region, what) {
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(region, `${what}: the block of the list is on the page`).toBeVisible();
    await expect.poll(() => region.evaluate((block) => ({
        inWindow: block.getBoundingClientRect().right <= window.innerWidth,
        over: [block, ...block.querySelectorAll('*')]
            .filter((el) => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible')
            .map((el) => `${el.tagName.toLowerCase()}[${String(el.className).slice(0, 60)}] "${(el.textContent || '').trim().slice(0, 20)}" ${el.clientWidth}<${el.scrollWidth}`)
            .slice(0, 6),
    })), { message: `${what}: the list ends inside a 360 px window and nothing in it runs past its own box`, timeout: 5_000 }).toEqual({ inWindow: true, over: [] });
    for (const role of ['button', 'link']) {
        const targets = region.getByRole(role);
        for (let at = 0; at < await targets.count(); at += 1) {
            const box = await targets.nth(at).boundingBox();
            const label = (await targets.nth(at).innerText()).trim().slice(0, 30) || (await targets.nth(at).getAttribute('aria-label')) || `${role} ${at}`;
            expect(box, `${what}: "${label}" is on the page`).not.toBeNull();
            expect(box?.height, `${what}: "${label}" is 44 px high`).toBeGreaterThanOrEqual(44);
            expect(box?.width, `${what}: "${label}" is 44 px wide`).toBeGreaterThanOrEqual(44);
        }
    }
}

// A job with Ann checked in, and the cookie she sends as.
async function jobWithAnn(ctx, page, first) {
    const ann = await addMember(ctx, 'Ann', String(first));
    const job = await makeJob(ctx, { members: [ann], quote: 60 });
    const cookie = await signCleanerIn(ctx, job, ann);
    await checkIn(ctx, job, cookie, [ann], 'Ann checks in');
    return { ann, job, cookie, bytes: await jpegBytes(page) };
}

test.describe('Reports in the job record', () => {
    sweepAround();

    // The provider's panel carries the list, and neither where the phone was nor what the office decided: the link-facing answer holds none of it.
    // Mutant that turns this case red: the list is missing, a report loses its type, its reporter, its time, its note or its photo link, the provider is shown
    // the position, the link to Job Requests, the activity or any word of the office's decision, a report reads as seen before the office has handled it, or
    // Refresh does not read the reports again.
    test("Screens: the provider's panel lists the reports with who, when, the note and the photo, says which the office has seen, and shows neither the position nor the decision", async ({ page, request, baseURL, playwright }) => {
        test.setTimeout(300_000);
        const ctx = await setup(playwright, request, baseURL);
        const made = await jobWithAnn(ctx, page, 340);
        const dirty = await sendReport(ctx, made.job, made.cookie, made.bytes, 'unhygienic', 'Mould along the shower seal.', AT_THE_ADDRESS);
        await sendReport(ctx, made.job, made.cookie, made.bytes, 'add_items', 'The fridge needs doing inside.', FAR_AWAY);
        await (await db()).execute('UPDATE service_providers SET stripe_onboarding_complete = 1 WHERE id = ?', [PROVIDER1.id]);
        await signInAs(page, 'provider1');
        await page.goto(`/provider/jobs/${made.job.bookingId}`, { timeout: FIRST_VISIT_MS });

        const panel = page.getByRole('region', { name: 'Job link for your crew', exact: true });
        await expect(panel.getByRole('heading', { name: 'Reports', level: 3 }), 'the list has its heading').toBeVisible({ timeout: FIRST_VISIT_MS });
        const first = reportIn(panel, 'unhygienic');
        const second = reportIn(panel, 'add_items');
        await expect(first, 'the first report is listed').toHaveCount(1);
        await expect(second, 'the second report is listed').toHaveCount(1);
        await expect(first.getByText('Mould along the shower seal.'), 'with its note').toBeVisible();
        await expect(second.getByText('The fridge needs doing inside.'), 'and the other with its own').toBeVisible();
        await expect(first.getByText(/^Ann · \S/), 'who sent it and when').toBeVisible();
        await expect(first.getByText('Not seen yet', { exact: true }), 'the office has not seen it').toBeVisible();
        await expect(second.getByText('Not seen yet', { exact: true }), 'nor the other').toBeVisible();

        const thumbnail = first.getByRole('link', { name: 'Photo sent with the report: Unhygienic conditions' });
        await expect(thumbnail, 'the photo is a link').toBeVisible();
        await expect(thumbnail).toHaveAttribute('target', '_blank');
        await expect(thumbnail).toHaveAttribute('rel', /noopener/);
        await expect(thumbnail).toHaveAttribute('href', /^\/uploads\/job-photos\/[0-9a-f]{32}\.(jpg|png|webp)$/);
        const picture = await thumbnail.locator('img').boundingBox();
        expect([picture?.width, picture?.height], 'a thumbnail is 96 px by 96 px').toEqual([96, 96]);

        for (const report of [first, second]) {
            await expect(report.getByText(/At the address|Not at the address|Location not shared/), 'the provider is not told where the phone was').toHaveCount(0);
        }
        await expect(panel.getByRole('link', { name: /Job Requests/ }), 'the provider has no link to the admin\'s queue').toHaveCount(0);
        await expect(panel.getByRole('heading', { name: 'Recent activity', level: 3 }), 'the provider has no activity list').toHaveCount(0);
        await expect(panel.getByText(/sent a report/), 'and none of its sentences').toHaveCount(0);

        await handle(ctx, dirty, 'Called the customer about the mould.');
        await panel.getByRole('button', { name: 'Refresh', exact: true }).click();
        await expect(first.getByText('Seen by the office', { exact: true }), 'Refresh reads that the office has handled it').toBeVisible({ timeout: 30_000 });
        await expect(second.getByText('Not seen yet', { exact: true }), 'and that it has not handled the other').toBeVisible();
        await expect(panel.getByText(/Called the customer|Handled by|Charged|Declined/), 'the provider is not told what the office decided').toHaveCount(0);

        await checkLayout(page, reportsBlock(panel), "the provider's Reports list");
    });

    // The admin's booking page carries the list with the position line and a way to the queue, and the activity says who sent which report.
    // Mutant that turns this case red: the position line is missing or wrong for a report at the address, one far away and one with no position, the link to
    // Job Requests is missing or points elsewhere, or the activity leaves out the sentence for a report.
    test("Screens: the admin's booking page lists the same reports with where the phone was, links to Job Requests, and the activity says who sent which", async ({ page, request, baseURL, playwright }) => {
        test.setTimeout(300_000);
        const ctx = await setup(playwright, request, baseURL);
        const made = await jobWithAnn(ctx, page, 342);
        await sendReport(ctx, made.job, made.cookie, made.bytes, 'unhygienic', 'Mould along the shower seal.', AT_THE_ADDRESS);
        await sendReport(ctx, made.job, made.cookie, made.bytes, 'cannot_complete', 'The door to the kitchen is locked.', FAR_AWAY);
        await sendReport(ctx, made.job, made.cookie, made.bytes, 'no_answer', 'Nobody came to the door.');
        await signInAs(page, 'admin');
        await page.goto(`/admin/bookings/${made.job.bookingId}`, { timeout: ADMIN_FIRST_VISIT_MS });

        const panel = page.getByRole('region', { name: 'Job link', exact: true });
        await expect(panel.getByRole('heading', { name: 'Reports', level: 3 }), 'the list has its heading').toBeVisible({ timeout: ADMIN_FIRST_VISIT_MS });
        await expect(reportIn(panel, 'unhygienic').getByText('At the address', { exact: true }), 'a report from the address says so').toBeVisible();
        await expect(reportIn(panel, 'cannot_complete').getByText(/^Not at the address — about \d+(\.\d)? km away$/), 'a report from five kilometres off says how far').toBeVisible();
        await expect(reportIn(panel, 'no_answer').getByText('Location not shared', { exact: true }), 'a report with no position says that it has none').toBeVisible();
        await expect(reportIn(panel, 'no_answer').getByText('Nobody came to the door.'), 'with its note').toBeVisible();
        for (const type of ['unhygienic', 'cannot_complete', 'no_answer']) {
            await expect(reportIn(panel, type).getByText('Not seen yet', { exact: true }), `${LABEL[type]}: not seen yet`).toBeVisible();
        }

        const toQueue = panel.getByRole('link', { name: 'Open Job Requests to act on a report' });
        await expect(toQueue, 'the admin can go to the queue').toBeVisible();
        await expect(toQueue).toHaveAttribute('href', '/admin/jobs');

        await expect(panel.getByRole('heading', { name: 'Recent activity', level: 3 }), 'the admin has the activity').toBeVisible();
        for (const type of ['unhygienic', 'cannot_complete', 'no_answer']) {
            await expect(panel.getByText(`Ann sent a report: ${LABEL[type]}`, { exact: true }), `the activity says who sent "${LABEL[type]}"`).toBeVisible();
        }

        await checkLayout(page, reportsBlock(panel), "the admin's Reports list");
    });

    // The two states the list has besides success: nothing sent yet, and an answer that holds no reports.
    // Mutant that turns this case red: a job with no reports shows an empty list, no sentence or the link to the queue, or an answer without reports takes the
    // rest of the block with it or is read as "no reports yet".
    test('Screens: a job with no reports says so, and an answer that holds none says that it could not show them and still shows the timer', async ({ page, request, baseURL, playwright }) => {
        test.setTimeout(300_000);
        const ctx = await setup(playwright, request, baseURL);
        const ann = await addMember(ctx, 'Ann', '344');
        const job = await makeJob(ctx, { members: [ann], quote: 60 });
        await (await db()).execute('UPDATE service_providers SET stripe_onboarding_complete = 1 WHERE id = ?', [PROVIDER1.id]);
        await signInAs(page, 'provider1');
        await page.goto(`/provider/jobs/${job.bookingId}`, { timeout: FIRST_VISIT_MS });

        const panel = page.getByRole('region', { name: 'Job link for your crew', exact: true });
        await expect(panel.getByRole('heading', { name: 'Reports', level: 3 }), 'the list has its heading').toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(panel.getByText('No reports yet.', { exact: true }), 'and says that nothing has been sent').toBeVisible();
        await expect(panel.getByRole('listitem').filter({ hasText: /Seen by the office|Not seen yet/ }), 'with no report in it').toHaveCount(0);
        await expect(panel.getByText(/Couldn't show/), 'and nothing is said to be missing').toHaveCount(0);

        // The same page when the answer holds no reports at all (as when the server is older than the page).
        await page.route(new RegExp(`/api/provider/jobs/${job.bookingId}/job-link(\\?.*)?$`), async (route) => {
            if (route.request().method() !== 'GET') return route.continue();
            const real = await route.fetch();
            const body = await real.json();
            delete body.data.reports;
            return route.fulfill({ response: real, json: body });
        });
        await page.reload({ timeout: FIRST_VISIT_MS });
        const again = page.getByRole('region', { name: 'Job link for your crew', exact: true });
        await expect(again.getByText("Couldn't show the reports.", { exact: true }), 'the page says what it could not show').toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(again.getByRole('heading', { name: 'Job timer and photos', level: 3 }), 'and the timer is still there').toBeVisible();
        await expect(again.getByText('No reports yet.', { exact: true }), 'it does not claim that nothing was sent').toHaveCount(0);
    });
});
