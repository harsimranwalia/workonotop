// @ts-check
// ENG-017: the on-site report routes and the office's desk. The pure parts are other files' cases (e2e/report-desk.spec.js holds priceExtras and
// collectAddedItems with a scripted Stripe client); this file is what needs the dev database and the running app:
//   the cleaner's report   the five types kept with the photo, the row (open, no charge), the report_added event without the note or the photo, and no money
//                          word in the answer; a send made again with the same client_token answered with the saved report and nothing written; every
//                          refusal (401, not multipart, no file, a type that is none of the five, a note empty or too long, bytes that are not a photo, a
//                          client_token that is not a token, a cleaner not checked in, a job not under way, the 21st report) with its status, its message,
//                          Cache-Control: no-store and the proof that nothing was written (no row, no event, no new file);
//   the views              the cleaner's page, the provider's panel (without the sender's position) and the admin's view (with it);
//   the desk over HTTP     the queue and its filters, handle once, decline, approve on a server with no payment key (503 and nothing recorded), the
//                          admin gate on both routes, the 400 and 404 answers, and one report read with the service's catalogue;
//   the money edges        decideReport in this process, against the dev database and a scripted Stripe client (the dev app holds no payment key, and
//                          no case here calls Stripe): the server prices the lines and the admin's sum must match (price_changed with the server's
//                          cents), a booking that can not be charged, the charge on a PaymentIntent of its own with the report's key, a declined card
//                          left failed with its reason and a retry that continues the saved intent, Stripe out of reach left pending, no card on file.
// Rows: every booking belongs to the e-mail prefix e2e-jrp- (provider 1's, so the foreign keys hold) and every cleaner to the number block
// +1 403 555 0300 to 0328; the customer number of the probe bookings is +1 403 555 0329. The describes sweep, before their first case, after every
// case and after their last, the crew members of the block, the bookings of the prefix (links, codes, check-ins, sessions, photos, reports and events
// go with them), the files those report rows named, any file the case added to public/uploads/job-photos, and the sms_budget counters of the
// numbers, links and members. A failure message names the case, the status and the figures, never a cookie, a token or a code.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import mysql from 'mysql2/promise';
import { getCredentialHeaders } from './auth/credentials.js';
import { providers, users } from '../database/fixtures/accounts.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';
import { sha256Hex } from '../src/lib/link-token.js';
import { budgetScope } from '../src/lib/sms-budget.js';
import { CODE_MESSAGES } from '../src/lib/job-link-code.js';
import { REPORT_MESSAGES, REPORT_NOTE_MAX, REPORTS_MAX_PER_BOOKING } from '../src/lib/job-reports.js';
import { DECISION_NOTE_MAX, DESK_MESSAGES, decideReport, queueFor } from '../src/lib/report-desk.js';

// Every request carries a fixture account's session header and a trace records request headers: tracing is off, as in e2e/provider-crew.spec.js.
test.use({ trace: 'off' });

const [PROVIDER1] = providers;
// The two customers of the fixtures: a series' visits belong to one of them, and a first visit of the other is a stranger's.
const [CUSTOMER1, CUSTOMER2, ADMIN] = users;
const EMAIL_PREFIX = 'e2e-jrp-';
// The number block of this file: the digits after '+1 403 555 0'. The last number is the customer's, the others are cleaners'.
const NUMBER_FIRST = 300;
const NUMBER_LAST = 329;
const stored = (n) => `+14035550${n}`;
const typed = (n) => `+1 403 555 0${n}`;

// The first request to a route is compiled by the dev server, so every request is given a minute.
const REQUEST_TIMEOUT = 60_000;

// The code of the extra worth a quarter that the minimum-sum case adds to service 1 and removes again; the quote assertion of the refused-approvals case adds it with a quote_from the same way.
const QUARTER_CODE = 'probe_quarter';

// The address of every probe booking (Calgary) and the phone at the address.
const ADDRESS = { latitude: 51.04473, longitude: -114.07192 };
const HERE = { latitude: ADDRESS.latitude, longitude: ADDRESS.longitude, accuracy: 12.4 };

const PHOTO_DIRECTORY = path.join(process.cwd(), 'public', 'uploads', 'job-photos');
const STORED_NAME = /^[0-9a-f]{32}\.(jpg|png|webp)$/;
const photoUrlPattern = /^\/uploads\/job-photos\/[0-9a-f]{32}\.(jpg|png|webp)$/;


// ---- the job's own clock: every probe booking falls in America/Toronto ----

const ZONE = 'America/Toronto';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function today() {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const get = (type) => parts.find((part) => part.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
}

const plusDays = (day, count) => new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + count)).toISOString().slice(0, 10);
const slotLabel = (day, slot) => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}: ${slot}`;
// A job dated yesterday: its check-in window is open for good.
const yesterday = () => plusDays(today(), -1);

// ---- the dev database, the way e2e/provider-crew.spec.js reaches it ----

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

// Every statement of this file is prepared, with a ? for every value.
async function rows(sql, params = []) {
    const [found] = await (await db()).execute(sql, params);
    return /** @type {any[]} */ (found);
}

const countOf = async (sql, params = []) => Number((await rows(sql, params))[0].n);

// The stored photo files of the directory, by name; [] when the directory is not there yet, or is a plain file (the 503 case puts one there).
async function photoFiles() {
    try {
        return (await fs.readdir(PHOTO_DIRECTORY)).filter((name) => STORED_NAME.test(name)).sort();
    } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes(/** @type {any} */ (error).code)) return [];
        throw error;
    }
}

// The files that were in the directory when a case began: whatever else is there when it ends is the case's own.
let filesBefore = new Set();

async function removeNewFiles() {
    for (const name of await photoFiles()) {
        if (!filesBefore.has(name)) await fs.rm(path.join(PHOTO_DIRECTORY, name), { force: true });
    }
}

// Deletes what this file left: the files of the report photos its bookings hold, the sms_budget counters of its numbers, links and members, the bookings
// of its e-mail prefix (links, codes, check-ins, sessions, photos, logs, events and crew rows go with them) and the crew members of its number block.
async function clearRows() {
    const open = await db();
    // The photo store makes its directory when it first needs one, and the dev container runs as root: a directory made here first is the test
    // user's, and the sweep below can remove the files the app writes into it.
    await fs.mkdir(PHOTO_DIRECTORY, { recursive: true });
    const [photos] = /** @type {any[]} */ (await open.execute('SELECT r.photo_url FROM job_reports r JOIN bookings b ON b.id = r.booking_id WHERE b.customer_email LIKE ? AND r.photo_url IS NOT NULL', [`${EMAIL_PREFIX}%`]));
    for (const photo of photos) {
        if (photoUrlPattern.test(photo.photo_url)) await fs.rm(path.join(process.cwd(), 'public', photo.photo_url), { force: true });
    }
    const [links] = /** @type {any[]} */ (await open.execute('SELECT l.id FROM job_links l JOIN bookings b ON b.id = l.booking_id WHERE b.customer_email LIKE ?', [`${EMAIL_PREFIX}%`]));
    const [members] = /** @type {any[]} */ (await open.execute('SELECT id FROM provider_crew_members WHERE phone BETWEEN ? AND ?', [stored(NUMBER_FIRST), stored(NUMBER_LAST)]));
    const scopes = [budgetScope('provider', PROVIDER1.id)];
    for (let n = NUMBER_FIRST; n <= NUMBER_LAST; n += 1) scopes.push(budgetScope('number', stored(n)));
    for (const link of links) {
        scopes.push(budgetScope('ask', link.id), budgetScope('verify', link.id));
        for (const member of members) scopes.push(budgetScope('cooldown', link.id, member.id));
    }
    for (let from = 0; from < scopes.length; from += 200) {
        const chunk = scopes.slice(from, from + 200);
        await open.execute(`DELETE FROM sms_budget WHERE scope IN (${chunk.map(() => '?').join(', ')})`, chunk);
    }
    await open.execute('DELETE FROM bookings WHERE customer_email LIKE ?', [`${EMAIL_PREFIX}%`]);
    await open.execute('DELETE FROM provider_crew_members WHERE phone BETWEEN ? AND ?', [stored(NUMBER_FIRST), stored(NUMBER_LAST)]);
    // The one extra a case adds to service 1's catalogue (a sum under the payment minimum), taken out again if the case did not get to.
    await open.execute("DELETE FROM service_pricing_items WHERE service_id = 1 AND kind = 'extra' AND code = ?", [QUARTER_CODE]);
}

// The hooks of a describe that uses the database: a sweep before its first case, after every case (also a case that failed or timed out) and after
// its last, then the connection is closed. Every case also notes the photo files there are when it begins and removes the ones it added.
function sweepAround() {
    test.beforeAll(clearRows);
    test.beforeEach(async () => {
        filesBefore = new Set(await photoFiles());
    });
    test.afterEach(async () => {
        try {
            await removeNewFiles();
        } finally {
            await clearRows();
        }
    });
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

// ---- requests ----

// The credentials a case sends, as request headers (the cookie styles of getCredentialHeaders).
async function credentials(baseURL) {
    const styles = await getCredentialHeaders(String(baseURL));
    return { none: {}, provider: styles['provider-cookie'], admin: styles['admin-cookie'] };
}

async function setup(playwright, request, baseURL) {
    return { playwright, request, baseURL: String(baseURL), as: await credentials(baseURL) };
}

async function answerOf(response) {
    return { status: response.status(), body: await response.json().catch(() => null), cache: response.headers()['cache-control'] ?? '' };
}

// The data of an answer that succeeded. The message of a refusal is named, never the whole body (a success holds a link's path).
async function dataOf(response, status, who) {
    const answer = await answerOf(response);
    expect(answer.status, `${who}: status (${answer.body?.success === false ? answer.body.message : 'no message'})`).toBe(status);
    expect(answer.body?.success, `${who}: success`).toBe(true);
    return answer.body.data;
}

let sequence = 0;
const tag = () => `${Date.now().toString(36)}${(sequence += 1)}`;

// The next cleaner number of the block, 0300 to 0328, wrapping round once the whole block has been walked (the rows are swept after every case).
let nextNumber = NUMBER_FIRST;
function takeNumber() {
    const number = nextNumber;
    nextNumber = nextNumber >= NUMBER_LAST - 1 ? NUMBER_FIRST : nextNumber + 1;
    return number;
}

// A booking of provider 1 that is confirmed, in Calgary, dated yesterday, quoted for an hour.
async function insertBooking() {
    const id = tag();
    const day = yesterday();
    const [made] = /** @type {any[]} */ (await (await db()).execute(
        `INSERT INTO bookings (booking_number, service_id, service_name, service_price, customer_first_name, customer_last_name, customer_email, customer_phone,
           job_date, job_time_slot, job_description, address_line1, city, status, payment_status, provider_id, latitude, longitude, standard_duration_minutes)
         VALUES (?, 1, 'Probe service', 100.00, 'E2E', 'Probe', ?, ?, ?, ?, 'ENG-017 report probe, deleted by the case', '1 Probe Street', 'Calgary', 'confirmed', 'pending', ?, ?, ?, 60)`,
        [`E2ERP${id}`, `${EMAIL_PREFIX}${id}@example.invalid`, stored(NUMBER_LAST), day, slotLabel(day, 'Morning'), PROVIDER1.id, ADDRESS.latitude, ADDRESS.longitude]
    ));
    return Number(made.insertId);
}

// Provider 1 adds the cleaners through ENG-014's route, one number of the block each.
async function addMembers(ctx, names) {
    const made = [];
    for (const name of names) {
        const number = takeNumber();
        const data = await dataOf(await ctx.request.post('/api/provider/crew', { headers: ctx.as.provider, data: { name, phone: typed(number) } }), 201, `provider 1 adds ${name}`);
        made.push({ id: data.member.id, name, number, checked: false });
    }
    return made;
}

// Provider 1 sets the crew of a job (ENG-014's PUT, which replaces the set and keeps the rows of those who stay).
async function setCrew(ctx, bookingId, ids) {
    await dataOf(await ctx.request.put(`/api/provider/jobs/${bookingId}/crew`, { headers: ctx.as.provider, data: { crew_ids: ids } }), 200, `provider 1 puts ${ids.length} cleaners on job ${bookingId}`);
}

// The proof ENG-015's number-check routes leave behind: a used row for the member and the number they have now.
async function markChecked(member) {
    if (member.checked) return;
    const [current] = await rows('SELECT phone FROM provider_crew_members WHERE id = ?', [member.id]);
    await (await db()).execute('INSERT INTO crew_number_checks (crew_member_id, phone, code_hash, expires_at, used_at) VALUES (?, ?, ?, NOW(), NOW())', [member.id, current.phone, sha256Hex(`jrp-probe:${tag()}`)]);
    member.checked = true;
}

// The six digits of the member's live code on a link, found by hashing every candidate against code_hash.
async function findCode(linkId, memberId) {
    const [row] = await rows('SELECT code_hash FROM job_link_codes WHERE link_id = ? AND crew_member_id = ? AND used_at IS NULL AND expires_at > NOW() ORDER BY id DESC LIMIT 1', [linkId, memberId]);
    expect(row !== undefined, 'a live code row exists for the member (a text cannot be read in dev)').toBe(true);
    for (let n = 0; n < 1_000_000; n += 1) {
        const candidate = String(n).padStart(6, '0');
        if (sha256Hex(`${linkId}:${memberId}:${candidate}`) === row.code_hash) return candidate;
    }
    throw new Error('no six-digit code fits the stored hash');
}

// A cleaner opens the link: the number is checked, a code is asked for through the route, found from its hash and given back. The cookie comes
// from a context of its own so that no jar carries it into the next request; it is returned as a `cookie` header value and never printed.
async function signInWith(ctx, job, member) {
    await markChecked(member);
    const asked = await ctx.request.post(`/api/job/${job.token}/code`, { data: { phone: typed(member.number) } });
    expect(asked.status(), `${member.name} asks for a code`).toBe(200);
    const code = await findCode(job.linkId, member.id);
    const fresh = await ctx.playwright.request.newContext({ baseURL: ctx.baseURL });
    try {
        const verified = await fresh.post(`/api/job/${job.token}/verify`, { data: { phone: typed(member.number), code } });
        expect(verified.status(), `${member.name} gives the code back`).toBe(200);
        const line = verified.headersArray().filter((header) => header.name.toLowerCase() === 'set-cookie').map((header) => header.value).find((value) => value.startsWith(`jls_${job.linkId}=`));
        expect(line !== undefined, `the answer sets the session cookie of link ${job.linkId}`).toBe(true);
        return String(line).split(';')[0];
    } finally {
        await fresh.dispose();
    }
}

// A probe job of provider 1 with its crew, a link made by the provider's route and, with `signIn`, that member signed in (job.cookie).
async function makeJob(ctx, { members, signIn = null }) {
    const bookingId = await insertBooking();
    await setCrew(ctx, bookingId, members.map((member) => member.id));
    const created = await dataOf(await ctx.request.post(`/api/provider/jobs/${bookingId}/job-link`, { headers: ctx.as.provider, data: { action: 'create' } }), 200, 'provider 1 makes the job link');
    const linkPath = created.job_link?.path;
    expect(typeof linkPath === 'string' && /^\/job\/[A-Za-z0-9_-]{43}$/.test(linkPath), 'the link has a path of 43 base64url characters').toBe(true);
    const [link] = await rows('SELECT id FROM job_links WHERE booking_id = ?', [bookingId]);
    /** @type {{ bookingId: number, token: string, linkId: number, cookie: string | null }} */
    const job = { bookingId, token: String(linkPath).slice('/job/'.length), linkId: link.id, cookie: null };
    if (signIn) job.cookie = await signInWith(ctx, job, signIn);
    return job;
}

const asCleaner = (job) => ({ cookie: String(job.cookie) });

async function okOf(answer, who) {
    expect(answer.status, `${who}: status (${answer.body?.success === false ? answer.body.message : 'no message'})`).toBe(200);
    expect(answer.body?.success, `${who}: success`).toBe(true);
    return answer.body.data;
}

// A check-in with the body as it is given.
const tick = async (request, job, headers, ids, location = HERE) => answerOf(await request.post(`/api/job/${job.token}/check-in`, { headers, data: { crew_ids: ids, location }, timeout: REQUEST_TIMEOUT }));
const tickOk = async (request, job, headers, ids, who) => okOf(await tick(request, job, headers, ids), `${who} ticks ${JSON.stringify(ids)}`);

// A probe job with one cleaner (Ann) signed in and, unless `checkIn` is false, checked in.
async function probeJob(ctx, { checkIn = true } = {}) {
    const [member] = await addMembers(ctx, ['Ann']);
    const job = await makeJob(ctx, { members: [member], signIn: member });
    const cleaner = asCleaner(job);
    if (checkIn) await tickOk(ctx.request, job, cleaner, [member.id], 'the cleaner');
    return { member, job, cleaner };
}

const setStatus = async (bookingId, status) => {
    await (await db()).execute('UPDATE bookings SET status = ? WHERE id = ?', [status, bookingId]);
};

// ---- the bytes ----

// A minimal JPEG the photo store accepts: start of image, a JFIF header, a start of scan with two bytes of data and the end of image.
const TINY_JPEG = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0x34, 0xff, 0xd9,
]);

const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1');

// ---- multipart bodies, built by hand so that their length is exact ----

// parts: { name, value } for a field, { name, filename, type, bytes } for a file. The framing is the boundary lines and the part headers.
function multipartBody(parts, boundary = `----jrp${tag()}`) {
    const chunks = [];
    for (const part of parts) {
        const head = part.filename === undefined
            ? `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"\r\n\r\n`
            : `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: ${part.type}\r\n\r\n`;
        chunks.push(Buffer.from(head, 'latin1'), part.filename === undefined ? Buffer.from(String(part.value), 'utf8') : part.bytes, Buffer.from('\r\n', 'latin1'));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`, 'latin1'));
    return { contentType: `multipart/form-data; boundary=${boundary}`, body: Buffer.concat(chunks) };
}

const typePart = (value) => ({ name: 'type', value });
const photoPart = (bytes, { name = 'photo.jpg', type = 'image/jpeg' } = {}) => ({ name: 'photo', filename: name, type, bytes });


// ---- reports ----

const TYPES = ['no_answer', 'details_wrong', 'unhygienic', 'add_items', 'cannot_complete'];
const reportParts = (type, note = 'ENG-017 probe note', bytes = TINY_JPEG, more = []) => [typePart(type), { name: 'note', value: note }, photoPart(bytes), ...more];

async function postReport(request, job, headers, parts) {
    const { contentType, body } = multipartBody(parts);
    return answerOf(await request.post(`/api/job/${job.token}/reports`, { headers: { ...headers, 'content-type': contentType }, data: body, timeout: REQUEST_TIMEOUT }));
}

// What a refused report must not change: the report rows, the report_added events and the files.
async function watched(bookingId) {
    return {
        reports: await countOf('SELECT COUNT(*) AS n FROM job_reports WHERE booking_id = ?', [bookingId]),
        events: await countOf("SELECT COUNT(*) AS n FROM job_link_events WHERE booking_id = ? AND kind = 'report_added'", [bookingId]),
        files: await photoFiles(),
    };
}

const reportRow = async (id) => (await rows('SELECT * FROM job_reports WHERE id = ?', [id]))[0];
const MONEY_WORDS = /price|amount|charge|decision|cents|stripe|commission|payment/i;

// ---- calls that meet at a lock ----

// Waits until `count` transactions are waiting on a row lock, as InnoDB reports them, and fails after 60 seconds naming how many there were (the first request to a route on a
// freshly started dev server compiles it first: the two-sends case takes 14 to 16 seconds there and 4 on a warm one, so 20 left too little). The server
// serves innodb_trx from a copy it renews only when nobody has read it for 100 ms, so a poll faster than that reads the first copy for ever: 150 ms apart.
async function waitForLockWaiters(count) {
    const deadline = Date.now() + 60_000;
    let seen = 0;
    while (Date.now() < deadline) {
        seen = await countOf("SELECT COUNT(*) AS n FROM information_schema.innodb_trx WHERE trx_state = 'LOCK WAIT'");
        if (seen >= count) return seen;
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`${seen} of ${count} transactions are waiting on the row lock`);
}

// Calls that run at the same moment, met at a lock and not by luck: a third connection (not the pool's, not the app's) holds `lockSql` (a
// SELECT ... FOR UPDATE of one row), `starts` are called in order, each once the ones before it are waiting on that lock, and the lock is let go only
// when every call is. They then go through the guard under the lock together. Resolves with the answers in the order the calls were started.
async function meetAtLock(lockSql, lockParams, starts) {
    const holder = await mysql.createConnection(DB);
    const calls = [];
    let failure = null;
    try {
        await holder.beginTransaction();
        await holder.execute(lockSql, lockParams);
        for (const [index, start] of starts.entries()) {
            calls.push(start());
            await waitForLockWaiters(index + 1);
        }
    } catch (error) {
        failure = error;
    } finally {
        // A release that fails is written down, by its code alone, and does not throw here: the case's own failure is the one to report.
        await holder.rollback().catch((error) => console.error('Error releasing the lock the case holds:', error?.code || error?.name));
        await holder.end().catch((error) => console.error('Error closing the connection that held the lock:', error?.code || error?.name));
    }
    if (failure) {
        const settled = await Promise.allSettled(calls);
        const outcomes = settled.map((one) => (one.status === 'rejected' ? `threw ${one.reason?.message ?? one.reason}` : `answered ${JSON.stringify(one.value?.ok ?? null)} ${one.value?.reason ?? ''}`.trim()));
        throw new Error(`${failure.message} (the calls started: ${outcomes.join('; ') || 'none'})`, { cause: failure });
    }
    return Promise.all(calls);
}

test.describe('POST /api/job/{token}/reports: the cleaner\'s one-tap report', () => {
    test.describe.configure({ timeout: 180_000 });
    sweepAround();

    test('each of the five reports is kept with its photo, its event and no money in the answer', async ({ playwright, request, baseURL }) => {
        const ctx = await setup(playwright, request, baseURL);
        const { member, job, cleaner } = await probeJob(ctx);
        let expected = 0;
        for (const type of TYPES) {
            const before = await watched(job.bookingId);
            const answer = await postReport(request, job, cleaner, reportParts(type, `Note for ${type}`, TINY_JPEG, [{ name: 'latitude', value: String(ADDRESS.latitude) }, { name: 'longitude', value: String(ADDRESS.longitude) }, { name: 'accuracy', value: '12.4' }]));
            const data = await okOf(answer, `a ${type} report`);
            expected += 1;
            expect(answer.cache, 'no-store').toBe('no-store');
            expect(Object.keys(data).sort(), 'the answer holds the report, the list and again').toEqual(['again', 'report', 'reports']);
            expect(Object.keys(data.report).sort(), 'the report as the page shows it').toEqual(['at', 'by', 'id', 'label', 'note', 'photo', 'seen', 'type']);
            expect([data.report.type, data.report.note, data.report.seen, data.report.by, data.again]).toEqual([type, `Note for ${type}`, false, { kind: 'cleaner', name: member.name }, false]);
            expect(photoUrlPattern.test(data.report.photo), 'the photo is an address of the store').toBe(true);
            expect(data.reports.length, 'the list holds every report of the job').toBe(expected);
            expect(JSON.stringify(data), 'no price, amount, charge or decision is in the answer').not.toMatch(MONEY_WORDS);
            const row = await reportRow(data.report.id);
            expect([row.status, row.charge_status, row.reporter_kind, row.reporter_ref, row.report_type, row.approved_cents, row.charge_intent_id]).toEqual(['open', 'none', 'cleaner', member.id, type, null, null]);
            expect([row.away, row.distance_m !== null], 'the position was read').toEqual([0, true]);
            const after = await watched(job.bookingId);
            expect([after.reports - before.reports, after.events - before.events, after.files.length - before.files.length], 'one row, one event and one file').toEqual([1, 1, 1]);
            const [event] = await rows("SELECT actor_kind, actor_ref, crew_member_id, detail FROM job_link_events WHERE booking_id = ? AND kind = 'report_added' ORDER BY id DESC LIMIT 1", [job.bookingId]);
            expect([event.actor_kind, event.crew_member_id, event.detail], 'the event holds the person and the type and no note').toEqual(['cleaner', member.id, type]);
        }
    });

    test('a send made again with the same client_token is answered with the saved report and writes nothing', async ({ playwright, request, baseURL }) => {
        const ctx = await setup(playwright, request, baseURL);
        const { job, cleaner } = await probeJob(ctx);
        const parts = reportParts('unhygienic', 'Dirty again', TINY_JPEG, [{ name: 'client_token', value: 'tok-AAAAAAAA-1' }]);
        const first = await okOf(await postReport(request, job, cleaner, parts), 'the first send');
        const before = await watched(job.bookingId);
        const second = await okOf(await postReport(request, job, cleaner, parts), 'the send made again');
        expect([first.again, second.again, second.report.id]).toEqual([false, true, first.report.id]);
        expect(await watched(job.bookingId), 'nothing more was written').toEqual(before);
        // Whatever has changed since: a report that was saved is saved, so the retry does not meet a status that moved on.
        await setStatus(job.bookingId, 'pending');
        const third = await okOf(await postReport(request, job, cleaner, parts), 'the send made a third time, after the job went back to pending');
        expect([third.again, third.report.id]).toEqual([true, first.report.id]);
        expect(await watched(job.bookingId), 'nothing more was written').toEqual(before);
    });

    test('two sends made at the same moment with one client_token save one report, one event and one file, and the other is answered as saved', async ({ playwright, request, baseURL }) => {
        const ctx = await setup(playwright, request, baseURL);
        const { job, cleaner } = await probeJob(ctx);
        const parts = reportParts('unhygienic', 'Dirty, sent twice at once', TINY_JPEG, [{ name: 'client_token', value: 'tok-AAAAAAAA-2' }]);
        const before = await watched(job.bookingId);
        // Both requests are held at the booking's row, which the library locks first, until both are waiting on it: they meet the token check together.
        const answers = await meetAtLock('SELECT id FROM bookings WHERE id = ? FOR UPDATE', [job.bookingId], [
            () => postReport(request, job, cleaner, parts),
            () => postReport(request, job, cleaner, parts),
        ]);
        const [one, other] = [await okOf(answers[0], 'the first of the two sends'), await okOf(answers[1], 'the second of the two sends')];
        expect([one.again, other.again].sort(), 'one send saved the report and the other was told it was saved').toEqual([false, true]);
        expect(other.report.id, 'both answers name the one report').toBe(one.report.id);
        const after = await watched(job.bookingId);
        expect([after.reports - before.reports, after.events - before.events, after.files.length - before.files.length], 'one row, one event and one file').toEqual([1, 1, 1]);
        expect(await countOf('SELECT COUNT(*) AS n FROM job_reports WHERE booking_id = ? AND client_token = ?', [job.bookingId, 'tok-AAAAAAAA-2']), 'one row holds the token').toBe(1);
    });

    test('every refusal says no-store, names its message and writes nothing', async ({ playwright, request, baseURL }) => {
        const ctx = await setup(playwright, request, baseURL);
        const { job, cleaner } = await probeJob(ctx);
        const long = 'x'.repeat(REPORT_NOTE_MAX + 1);
        const refusals = [
            ['no access', {}, reportParts('unhygienic'), 401, CODE_MESSAGES.signIn],
            ['a type that is none of the five', cleaner, reportParts('broken_pipe'), 400, REPORT_MESSAGES.type],
            ['no type', cleaner, [{ name: 'note', value: 'x' }, photoPart(TINY_JPEG)], 400, REPORT_MESSAGES.type],
            ['an empty note', cleaner, reportParts('unhygienic', '   '), 400, REPORT_MESSAGES.note],
            ['a note one character too long', cleaner, reportParts('unhygienic', long), 400, REPORT_MESSAGES.note],
            ['a file that is empty', cleaner, reportParts('unhygienic', 'x', Buffer.alloc(0)), 400, REPORT_MESSAGES.photo],
            ['a file that is not a photo', cleaner, reportParts('unhygienic', 'x', GIF), 400, REPORT_MESSAGES.image],
            ['a client_token that is not a token', cleaner, reportParts('unhygienic', 'x', TINY_JPEG, [{ name: 'client_token', value: 'short' }]), 400, 'Invalid request.'],
            ['no file at all', cleaner, [typePart('unhygienic'), { name: 'note', value: 'x' }], 400, 'Invalid request.'],
        ];
        for (const [label, headers, parts, status, message] of refusals) {
            const before = await watched(job.bookingId);
            const answer = await postReport(request, job, headers, parts);
            expect([answer.status, answer.body?.success, answer.body?.message, answer.cache], label).toEqual([status, false, message, 'no-store']);
            expect(await watched(job.bookingId), `${label}: nothing was written`).toEqual(before);
        }
        const before = await watched(job.bookingId);
        const notMultipart = await answerOf(await request.post(`/api/job/${job.token}/reports`, { headers: cleaner, data: { type: 'unhygienic' }, timeout: REQUEST_TIMEOUT }));
        expect([notMultipart.status, notMultipart.body?.message]).toEqual([400, 'Invalid request.']);
        expect(await watched(job.bookingId)).toEqual(before);
    });

    test('a cleaner who is not checked in, a job that is not under way and a full job are each the 409 of their own', async ({ playwright, request, baseURL }) => {
        const ctx = await setup(playwright, request, baseURL);
        const away = await probeJob(ctx, { checkIn: false });
        const notHere = await postReport(request, away.job, away.cleaner, reportParts('unhygienic'));
        expect([notHere.status, notHere.body?.message, notHere.cache]).toEqual([409, REPORT_MESSAGES.notHere, 'no-store']);

        const here = await probeJob(ctx);
        await setStatus(here.job.bookingId, 'pending');
        const early = await postReport(request, here.job, here.cleaner, reportParts('unhygienic'));
        expect([early.status, early.body?.message]).toEqual([409, REPORT_MESSAGES.status]);

        await setStatus(here.job.bookingId, 'confirmed');
        for (let n = 0; n < REPORTS_MAX_PER_BOOKING; n += 1) {
            await (await db()).execute("INSERT INTO job_reports (booking_id, link_id, report_type, note, reporter_kind, reporter_ref) VALUES (?, ?, 'unhygienic', 'planted', 'cleaner', ?)", [here.job.bookingId, here.job.linkId, here.member.id]);
        }
        const before = await watched(here.job.bookingId);
        const full = await postReport(request, here.job, here.cleaner, reportParts('unhygienic'));
        expect([full.status, full.body?.message]).toEqual([409, REPORT_MESSAGES.tooMany]);
        expect(await watched(here.job.bookingId), 'a refusal after the file was judged leaves no file behind').toEqual(before);

        await setStatus(here.job.bookingId, 'completed');
        const closed = await postReport(request, here.job, here.cleaner, reportParts('unhygienic'));
        expect([closed.status, closed.body?.message]).toEqual([404, 'This link is not valid.']);
    });

    test('the page, the provider\'s panel and the admin\'s view carry the report, the first two without the sender\'s position', async ({ playwright, request, baseURL }) => {
        const ctx = await setup(playwright, request, baseURL);
        const { job, cleaner } = await probeJob(ctx);
        const page0 = await okOf(await answerOf(await request.get(`/api/job/${job.token}`, { headers: cleaner })), 'the page before a report');
        expect([page0.reports, page0.report_can]).toEqual([[], true]);
        await okOf(await postReport(request, job, cleaner, reportParts('details_wrong', 'The door is on the other side', TINY_JPEG, [{ name: 'latitude', value: String(ADDRESS.latitude) }, { name: 'longitude', value: String(ADDRESS.longitude) }])), 'a report');
        const page = await okOf(await answerOf(await request.get(`/api/job/${job.token}`, { headers: cleaner })), 'the page after a report');
        expect(page.reports.map((report) => [report.type, report.seen, 'away' in report])).toEqual([['details_wrong', false, false]]);
        const panel = await okOf(await answerOf(await request.get(`/api/provider/jobs/${job.bookingId}/job-link`, { headers: ctx.as.provider })), 'the provider\'s panel');
        expect(panel.reports.map((report) => [report.type, 'away' in report, 'distance_m' in report])).toEqual([['details_wrong', false, false]]);
        const admin = await okOf(await answerOf(await request.get(`/api/admin/bookings/${job.bookingId}/job-link`, { headers: ctx.as.admin })), 'the admin\'s view');
        expect(admin.reports.map((report) => [report.type, report.away, report.distance_m !== null]), 'the flag is 0 or 1 as the check-ins have it').toEqual([['details_wrong', 0, true]]);
        const anon = await answerOf(await request.get(`/api/job/${job.token}`));
        expect(Object.keys(anon.body.data ?? {}), 'a visitor with no access sees neither key').toEqual(['access']);
    });
});

// ---- the office's desk, over HTTP ----

// A report from a probe job's cleaner, saved through the route.
async function sendReport(ctx, type, note = 'ENG-017 desk probe') {
    const made = await probeJob(ctx);
    const data = await okOf(await postReport(ctx.request, made.job, made.cleaner, reportParts(type, note)), `a ${type} report`);
    return { ...made, reportId: data.report.id };
}

const decide = async (ctx, id, body, headers = ctx.as.admin) => answerOf(await ctx.request.post(`/api/admin/reports/${id}`, { headers, data: body, timeout: REQUEST_TIMEOUT }));

test.describe('the admin\'s queue and decisions over HTTP', () => {
    test.describe.configure({ timeout: 180_000 });
    sweepAround();

    test('the queue lists the report with its job and the customer\'s name only, and refuses a caller who is not an admin', async ({ playwright, request, baseURL }) => {
        const ctx = await setup(playwright, request, baseURL);
        const made = await sendReport(ctx, 'unhygienic');
        const queue = await okOf(await answerOf(await request.get('/api/admin/reports?status=open&limit=50', { headers: ctx.as.admin })), 'the queue');
        expect(Object.keys(queue).sort()).toEqual(['next_before', 'open_count', 'reports']);
        const found = queue.reports.find((report) => report.id === made.reportId);
        expect(found !== undefined, 'the new report is waiting').toBe(true);
        expect([found.type, found.status, found.added_items, found.decision, found.booking.customer, found.booking.id]).toEqual(['unhygienic', 'open', null, null, 'E2E Probe', made.job.bookingId]);
        expect(JSON.stringify(found), 'no phone number and no e-mail address is in it').not.toMatch(/4035550|@example\.invalid/);
        expect(queue.open_count, 'the count of reports waiting on the office is the count the database holds').toBe(await countOf("SELECT COUNT(*) AS n FROM job_reports WHERE status = 'open' OR (status = 'approved' AND charge_status IN ('pending', 'failed'))"));

        for (const [style, headers, status] of [['no credential', {}, 401], ['a provider', ctx.as.provider, 403]]) {
            const refused = await answerOf(await request.get('/api/admin/reports', { headers }));
            expect(refused.status, style).toBe(status);
        }
        for (const query of ['?status=bogus', '?booking_id=abc', '?before=0', '?limit=-1']) {
            const bad = await answerOf(await request.get(`/api/admin/reports${query}`, { headers: ctx.as.admin }));
            expect([bad.status, bad.body?.message, bad.cache], query).toEqual([400, 'Invalid request.', 'no-store']);
        }
    });

    test('handle closes an information report once, a second admin is told it was decided, and an add-items report can not be handled', async ({ playwright, request, baseURL }) => {
        const ctx = await setup(playwright, request, baseURL);
        const info = await sendReport(ctx, 'no_answer');
        const handled = await okOf(await decide(ctx, info.reportId, { action: 'handle', note: 'Called the customer' }), 'handle');
        expect([handled.report.status, handled.report.decision.note, handled.report.decision.by, handled.report.added_items]).toEqual(['handled', 'Called the customer', `${ADMIN.first_name} ${ADMIN.last_name}`, null]);
        const again = await decide(ctx, info.reportId, { action: 'handle' });
        expect([again.status, again.body.message, again.body.report.status, again.cache]).toEqual([409, DESK_MESSAGES.decided, 'handled', 'no-store']);
        const page = await okOf(await answerOf(await request.get(`/api/job/${info.job.token}`, { headers: info.cleaner })), 'the page after the decision');
        expect(page.reports.map((report) => report.seen), 'the cleaner sees that it was seen and nothing of the decision').toEqual([true]);
        expect(JSON.stringify(page.reports)).not.toMatch(/Called the customer|decision/);

        const items = await sendReport(ctx, 'add_items');
        const wrong = await decide(ctx, items.reportId, { action: 'handle' });
        expect([wrong.status, wrong.body.message]).toEqual([409, DESK_MESSAGES.wrongType]);
        expect((await reportRow(items.reportId)).status, 'the report is open').toBe('open');
    });

    test('decline closes any open report, sends nothing to Stripe and keeps the lines empty', async ({ playwright, request, baseURL }) => {
        const ctx = await setup(playwright, request, baseURL);
        const items = await sendReport(ctx, 'add_items');
        const declined = await okOf(await decide(ctx, items.reportId, { action: 'decline', note: 'Not agreed with the customer' }), 'decline');
        expect([declined.report.status, declined.report.added_items.charge, declined.report.added_items.cents]).toEqual(['declined', 'none', null]);
        const row = await reportRow(items.reportId);
        expect([row.charge_status, row.charge_intent_id, row.approved_cents]).toEqual(['none', null, null]);
        const queue = await okOf(await answerOf(await request.get(`/api/admin/reports?booking_id=${items.job.bookingId}`, { headers: ctx.as.admin })), 'the queue for the job');
        expect(queue.reports, 'a declined report is not waiting on the office').toEqual([]);
        const all = await okOf(await answerOf(await request.get(`/api/admin/reports?status=all&booking_id=${items.job.bookingId}`, { headers: ctx.as.admin })), 'every report of the job');
        expect(all.reports.map((report) => report.status)).toEqual(['declined']);
    });

    // The case sends an approval, which is a real charge on an app that holds a payment key: it runs only when the runner has listed the NAMES of the app's
    // variables (E2E_APP_ENV_NAMES, never values, as e2e/ownership.spec.js has it) and STRIPE_SECRET_KEY is not one of them.
    test('approving on a server with no payment key is a 503 that records nothing', async ({ playwright, request, baseURL }) => {
        const names = process.env.E2E_APP_ENV_NAMES;
        test.skip(names === undefined || names.split(',').map((name) => name.trim()).includes('STRIPE_SECRET_KEY'), 'the app has a payment key (or the runner did not list the names): an approval would reach Stripe');
        const ctx = await setup(playwright, request, baseURL);
        const items = await sendReport(ctx, 'add_items');
        const answer = await decide(ctx, items.reportId, { action: 'approve', extras: [{ code: 'oven', quantity: 1 }], expected_cents: 3500 });
        expect([answer.status, answer.body.message]).toEqual([503, DESK_MESSAGES.notConfigured]);
        const row = await reportRow(items.reportId);
        expect([row.status, row.charge_status, row.approved_cents, row.decided_by, row.charge_intent_id]).toEqual(['open', 'none', null, null, null]);
    });

    test('a decision is for an admin, names a known action and a known report, and one report is read with its catalogue', async ({ playwright, request, baseURL }) => {
        const ctx = await setup(playwright, request, baseURL);
        const items = await sendReport(ctx, 'add_items');
        for (const [style, headers, status] of [['no credential', {}, 401], ['a provider', ctx.as.provider, 403]]) {
            const refused = await decide(ctx, items.reportId, { action: 'decline' }, headers);
            expect(refused.status, style).toBe(status);
        }
        expect((await reportRow(items.reportId)).status, 'neither wrote').toBe('open');
        for (const body of [{}, { action: 'explode' }, { action: 'approve', extras: 'oven' }, { action: 'approve', expected_cents: 'x' }, { action: 'handle', note: 5 }]) {
            const bad = await decide(ctx, items.reportId, body);
            expect([bad.status, bad.body.message], JSON.stringify(body)).toEqual([400, DESK_MESSAGES.action]);
        }
        const long = await decide(ctx, items.reportId, { action: 'decline', note: 'n'.repeat(DECISION_NOTE_MAX + 1) });
        expect([long.status, long.body.message]).toEqual([400, DESK_MESSAGES.note]);
        for (const id of ['999999999', 'abc', '0']) {
            const missing = await decide(ctx, id, { action: 'decline' });
            expect([missing.status, missing.body.message], id).toEqual([404, DESK_MESSAGES.notFound]);
            const read = await answerOf(await request.get(`/api/admin/reports/${id}`, { headers: ctx.as.admin }));
            expect([read.status, read.body.message], id).toEqual([404, DESK_MESSAGES.notFound]);
        }
        const detail = await okOf(await answerOf(await request.get(`/api/admin/reports/${items.reportId}`, { headers: ctx.as.admin })), 'one report');
        expect(Object.keys(detail).sort()).toEqual(['catalogue', 'report']);
        expect(detail.catalogue.map((one) => [one.code, one.amount]).sort()).toEqual([['fridge', 30], ['oven', 35]]);
        expect(detail.report.id).toBe(items.reportId);
    });
});

// ---- the money edges, in this process against the dev database and a scripted Stripe ----

// A pool of this file's own, shaped as src/lib/db.js is: execute(sql, params) -> rows, and withConnection(work) with a connection that has its own transaction.
let pool = null;
const poolOf = () => (pool ??= mysql.createPool(DB));
const run = async (sql, params = []) => (await poolOf().execute(sql, params))[0];
const withConnection = async (work) => {
    const held = await poolOf().getConnection();
    try {
        return await work(held);
    } finally {
        held.release();
    }
};

function scriptedClient(script = {}) {
    const calls = [];
    const wrap = (method) => async (...args) => {
        calls.push([method, ...args]);
        const queue = script[method] || [];
        const step = queue.length > 1 ? queue.shift() : queue[0];
        if (step === undefined) throw new Error(`scripted client: no answer scripted for ${method}`);
        if (step instanceof Error) throw step;
        return typeof step === 'function' ? step(...args) : step;
    };
    return { calls, paymentIntents: { retrieve: wrap('retrieve'), capture: wrap('capture'), create: wrap('create'), confirm: wrap('confirm') }, charges: { retrieve: wrap('charge') } };
}

const cardError = (code) => Object.assign(new Error('card error'), { type: 'StripeCardError', code });
const connError = () => Object.assign(new Error('connection'), { type: 'StripeConnectionError' });
const callsOf = (stripe, method) => stripe.calls.filter(([name]) => name === method);

// A booking and a report planted in SQL, the booking holding the checkout payment the card comes from: the desk is judged here, not the page.
// `owner` is the customer's user id (the booking has none by default); `ownPayment: false` leaves the booking with no payment of its own, as a visit
// of a series or a booking made for a customer is; `series` is { of: the first visit's booking id, visit: its number }; `type` and `note` are the report's.
async function plantItemsReport({ bookingStatus = 'completed', commission = null, type = 'add_items', note = 'Oven and fridge too', owner = null, ownPayment = true, series = null } = {}) {
    const bookingId = await insertBooking();
    // payment_intent_id is unique across bookings, so each planted booking holds a checkout payment of its own.
    const checkoutId = `pi_checkout_${tag()}`;
    await run('UPDATE bookings SET status = ?, payment_intent_id = ?, commission_percent = ?, user_id = ?, series_id = ?, series_visit = ? WHERE id = ?',
        [bookingStatus, ownPayment ? checkoutId : null, commission, owner, series ? series.of : null, series ? series.visit : null, bookingId]);
    const [link] = await run('SELECT id FROM job_links WHERE booking_id = ?', [bookingId]);
    let linkId = link?.id;
    if (!linkId) {
        const made = await run("INSERT INTO job_links (booking_id, token, generation) VALUES (?, ?, 1)", [bookingId, randomBytes(32).toString('base64url').slice(0, 43)]);
        linkId = made.insertId;
    }
    const added = await run("INSERT INTO job_reports (booking_id, link_id, report_type, note, reporter_kind, reporter_ref) VALUES (?, ?, ?, ?, 'provider', ?)", [bookingId, linkId, type, note, PROVIDER1.id]);
    return { bookingId, reportId: added.insertId, checkout: { id: checkoutId, status: 'succeeded', customer: 'cus_probe', payment_method: 'pm_probe' } };
}

// What a report's decision must leave as it found it, as one object to compare before and after: the booking's money fields and the number of rows in
// the two tables that hold what the platform owes a provider and what it bills (counted whole, so a row written for any booking shows).
const BOOKING_MONEY_FIELDS = ['service_price', 'status', 'payment_status', 'payment_intent_id', 'commission_percent', 'authorized_amount', 'provider_amount', 'final_provider_amount'];
async function untouched(bookingId) {
    const [booking] = await run(`SELECT ${BOOKING_MONEY_FIELDS.join(', ')} FROM bookings WHERE id = ?`, [bookingId]);
    const [{ n: payouts }] = await run('SELECT COUNT(*) AS n FROM provider_payouts');
    const [{ n: invoices }] = await run('SELECT COUNT(*) AS n FROM invoices');
    return { booking, payouts: Number(payouts), invoices: Number(invoices) };
}

const intentFor = (planted, over = {}) => ({ id: 'pi_extra_probe', status: 'requires_confirmation', payment_method: 'pm_probe', metadata: { booking_id: String(planted.bookingId), report_id: String(planted.reportId) }, ...over });
const takenFor = (planted, cents) => intentFor(planted, { status: 'succeeded', amount_received: cents, latest_charge: 'ch_extra_probe' });
const desk = (planted, stripe, over = {}) => decideReport({ withConnection, execute: run, stripe, currency: 'cad', id: planted.reportId, admin: { id: 1 }, action: 'approve', note: 'Agreed on site', extras: [{ code: 'oven', quantity: 1 }, { code: 'fridge', quantity: 2 }], expectedCents: 9500, ...over });

test.describe('approving an add-items report: the server prices it, the admin\'s sum must match, and the charge is taken once, on its own intent', () => {
    test.describe.configure({ timeout: 120_000 });
    sweepAround();
    test.afterAll(async () => {
        if (pool) await pool.end();
        pool = null;
    });

    test('an approval is priced here, recorded, then charged for exactly those cents on a PaymentIntent of its own', async () => {
        const planted = await plantItemsReport({ commission: '20.00' });
        const stripe = scriptedClient({ retrieve: [planted.checkout, takenFor(planted, 9500)], create: [intentFor(planted)], confirm: [{}] });
        const before = await untouched(planted.bookingId);
        const result = await desk(planted, stripe);
        expect(result.ok, JSON.stringify(result)).toBe(true);
        expect(result.report.status).toBe('approved');
        expect(result.report.added_items).toMatchObject({ cents: 9500, charge: 'paid', reason: null, provider_share_cents: 7600 });
        expect(result.report.added_items.lines.map((line) => [line.code, line.quantity, line.amount])).toEqual([['oven', 1, '35.00'], ['fridge', 2, '60.00']]);
        const created = callsOf(stripe, 'create');
        expect(created.length, 'one intent').toBe(1);
        expect(created[0][1]).toMatchObject({ amount: 9500, currency: 'cad', customer: 'cus_probe', payment_method: 'pm_probe', confirm: false });
        expect(created[0][2]).toEqual({ idempotencyKey: `report-${planted.reportId}-added-items-charge` });
        const row = await reportRow(planted.reportId);
        expect([row.status, row.charge_status, row.approved_cents, row.charge_intent_id, row.charge_id, row.decision_note]).toEqual(['approved', 'paid', 9500, 'pi_extra_probe', 'ch_extra_probe', 'Agreed on site']);
        const [booking] = await run('SELECT service_price, payment_intent_id FROM bookings WHERE id = ?', [planted.bookingId]);
        expect([Number(booking.service_price), booking.payment_intent_id], 'the booking\'s own price and payment are untouched').toEqual([100, planted.checkout.id]);
        expect(await untouched(planted.bookingId), 'the booking\'s money fields and the rows of provider_payouts and invoices are as they were: the charge is the only money that moved').toEqual(before);
        expect(callsOf(stripe, 'capture'), 'the booking\'s own payment was not captured').toEqual([]);
    });

    test('declining an add-items report and handling an information report call no Stripe and change no booking field, payout or invoice', async () => {
        const items = await plantItemsReport();
        const info = await plantItemsReport({ type: 'unhygienic', note: 'Dirty kitchen' });
        const stripe = scriptedClient();
        const itemsBefore = await untouched(items.bookingId);
        const infoBefore = await untouched(info.bookingId);
        const declined = await decideReport({ withConnection, execute: run, stripe, id: items.reportId, admin: { id: 1 }, action: 'decline', note: 'Not needed' });
        expect([declined.ok, declined.report.status, declined.report.added_items.charge], JSON.stringify(declined)).toEqual([true, 'declined', 'none']);
        const handled = await decideReport({ withConnection, execute: run, stripe, id: info.reportId, admin: { id: 1 }, action: 'handle', note: 'Called the customer' });
        expect([handled.ok, handled.report.status], JSON.stringify(handled)).toEqual([true, 'handled']);
        expect(stripe.calls, 'no call to Stripe for either').toEqual([]);
        expect(await untouched(items.bookingId), 'the declined report\'s booking').toEqual(itemsBefore);
        expect(await untouched(info.bookingId), 'the handled report\'s booking').toEqual(infoBefore);
        const rowsOf = await run('SELECT id, status, charge_status, approved_cents, charge_intent_id FROM job_reports WHERE id IN (?, ?) ORDER BY id', [items.reportId, info.reportId]);
        expect(rowsOf.map((row) => [row.status, row.charge_status, row.approved_cents, row.charge_intent_id])).toEqual([['declined', 'none', null, null], ['handled', 'none', null, null]]);
    });

    test('a sum that is not the one the admin was shown, extras that are not the service\'s and a quote are refused before anything is recorded', async () => {
        const planted = await plantItemsReport();
        const stripe = scriptedClient({ retrieve: [planted.checkout], create: [intentFor(planted)], confirm: [{}] });
        const wrongSum = await desk(planted, stripe, { expectedCents: 9400 });
        expect([wrongSum.ok, wrongSum.reason, wrongSum.cents]).toEqual([false, 'price_changed', 9500]);
        const notOffered = await desk(planted, stripe, { extras: [{ code: 'garage', quantity: 1 }] });
        expect([notOffered.ok, notOffered.reason]).toEqual([false, 'extras']);
        const none = await desk(planted, stripe, { extras: [] });
        expect([none.ok, none.reason]).toEqual([false, 'extras']);
        const notAList = await desk(planted, stripe, { extras: 'oven' });
        expect([notAList.ok, notAList.reason]).toEqual([false, 'extras']);
        // A quote: an extra picked as many times as its quote_from has no price to charge. The quarter's row is planted with one and taken out again.
        await run("INSERT INTO service_pricing_items (service_id, kind, code, label, amount, minutes, quote_from, is_placeholder, sort_order) VALUES (1, 'extra', ?, 'Probe quote', 0.25, 0, 1, 0, 99)", [QUARTER_CODE]);
        try {
            const quote = await desk(planted, stripe, { extras: [{ code: QUARTER_CODE, quantity: 1 }] });
            expect([quote.ok, quote.reason]).toEqual([false, 'quote']);
        } finally {
            await run("DELETE FROM service_pricing_items WHERE service_id = 1 AND kind = 'extra' AND code = ?", [QUARTER_CODE]);
        }
        expect(stripe.calls, 'Stripe was not called for any of them').toEqual([]);
        const row = await reportRow(planted.reportId);
        expect([row.status, row.charge_status, row.approved_cents, row.decided_by]).toEqual(['open', 'none', null, null]);
    });

    test('a booking that can not be charged and a report that was already decided are refused, and the second admin\'s approval writes nothing', async () => {
        const cancelled = await plantItemsReport({ bookingStatus: 'cancelled' });
        const blocked = await desk(cancelled, scriptedClient());
        expect([blocked.ok, blocked.reason]).toEqual([false, 'status']);
        expect((await reportRow(cancelled.reportId)).status).toBe('open');

        const planted = await plantItemsReport();
        const stripe = scriptedClient({ retrieve: [planted.checkout, takenFor(planted, 9500)], create: [intentFor(planted)], confirm: [{}] });
        expect((await desk(planted, stripe)).ok).toBe(true);
        const second = await desk(planted, stripe);
        expect([second.ok, second.reason, second.report.status]).toEqual([false, 'decided', 'approved']);
        expect(callsOf(stripe, 'create').length, 'one intent').toBe(1);
        const info = await decideReport({ withConnection, execute: run, stripe, id: planted.reportId, admin: { id: 1 }, action: 'handle' });
        expect([info.ok, info.reason], 'handle is for information reports').toEqual([false, 'wrong_type']);
    });

    test('a declined card leaves the report failed with its reason, and a retry continues the saved intent and never creates a second', async () => {
        const planted = await plantItemsReport();
        const stripe = scriptedClient({ retrieve: [planted.checkout], create: [intentFor(planted)], confirm: [cardError('card_declined')] });
        stripe.paymentIntents.retrieve = (() => {
            const original = stripe.paymentIntents.retrieve;
            let n = 0;
            return async (id, ...rest) => {
                n += 1;
                if (n === 1) return original(id, ...rest);
                return intentFor(planted, { status: 'requires_payment_method', last_payment_error: { code: 'card_declined' } });
            };
        })();
        const refused = await desk(planted, stripe);
        expect([refused.ok, refused.reason, refused.report.added_items.charge, refused.report.added_items.reason]).toEqual([false, 'declined', 'failed', 'declined']);
        let row = await reportRow(planted.reportId);
        expect([row.status, row.charge_status, row.charge_reason, row.charge_intent_id]).toEqual(['approved', 'failed', 'declined', 'pi_extra_probe']);
        expect((await queueFor(run, { bookingId: planted.bookingId })).reports.length, 'a failed charge waits on the office').toBe(1);

        const retry = scriptedClient({ retrieve: [intentFor(planted, { status: 'requires_payment_method' }), takenFor(planted, 9500)], confirm: [{}] });
        const paid = await decideReport({ withConnection, execute: run, stripe: retry, currency: 'cad', id: planted.reportId, admin: { id: 1 }, action: 'retry' });
        expect(paid.ok, JSON.stringify(paid)).toBe(true);
        expect(callsOf(retry, 'create'), 'the saved intent is continued: none is created').toEqual([]);
        expect(paid.report.added_items).toMatchObject({ cents: 9500, charge: 'paid', reason: null });
        row = await reportRow(planted.reportId);
        expect([row.status, row.charge_status, row.charge_id, row.charge_reason]).toEqual(['approved', 'paid', 'ch_extra_probe', null]);

        const again = await decideReport({ withConnection, execute: run, stripe: retry, currency: 'cad', id: planted.reportId, admin: { id: 1 }, action: 'retry' });
        expect([again.ok, again.reason], 'a paid report can not be retried or declined').toEqual([false, 'decided']);
        const decline = await decideReport({ withConnection, execute: run, stripe: retry, id: planted.reportId, admin: { id: 1 }, action: 'decline' });
        expect([decline.ok, decline.reason]).toEqual([false, 'decided']);
    });

    test('Stripe out of reach leaves the charge pending, and a retry is safe; a failed charge can be declined', async () => {
        const planted = await plantItemsReport();
        const stripe = scriptedClient({ retrieve: [planted.checkout], create: [connError()] });
        const result = await desk(planted, stripe);
        expect([result.ok, result.reason, result.report.added_items.charge]).toEqual([false, 'unavailable', 'pending']);
        const row = await reportRow(planted.reportId);
        expect([row.status, row.charge_status, row.charge_intent_id]).toEqual(['approved', 'pending', null]);

        const declinedCard = await plantItemsReport();
        const bad = scriptedClient({ retrieve: [declinedCard.checkout, intentFor(declinedCard, { status: 'requires_payment_method' })], create: [intentFor(declinedCard)], confirm: [cardError('card_declined')] });
        expect((await desk(declinedCard, bad)).reason).toBe('declined');
        const closed = await decideReport({ withConnection, execute: run, stripe: bad, id: declinedCard.reportId, admin: { id: 1 }, action: 'decline', note: 'Customer will pay another way' });
        expect([closed.ok, closed.report.status, closed.report.added_items.charge]).toEqual([true, 'declined', 'failed']);
        expect((await queueFor(run, { bookingId: declinedCard.bookingId })).reports, 'a declined report is not waiting').toEqual([]);
    });

    test('a customer with no card on file is no_payment_method, recorded as failed, and nothing is created', async () => {
        const planted = await plantItemsReport();
        await run('UPDATE bookings SET payment_intent_id = NULL WHERE id = ?', [planted.bookingId]);
        const stripe = scriptedClient();
        const result = await desk(planted, stripe);
        expect([result.ok, result.reason, result.report.added_items.charge]).toEqual([false, 'no_payment_method', 'failed']);
        expect(stripe.calls).toEqual([]);
    });

    // ---- whose card: a visit of a series, and a booking made for a customer, hold no payment of their own ----

    test('a series visit with no payment of its own is charged on the card of the same customer\'s first visit', async () => {
        const first = await plantItemsReport({ owner: CUSTOMER1.id });
        const planted = await plantItemsReport({ owner: CUSTOMER1.id, ownPayment: false, series: { of: first.bookingId, visit: 2 } });
        const card = { ...first.checkout, customer: 'cus_series_first', payment_method: 'pm_series_first' };
        const stripe = scriptedClient({ retrieve: [card, takenFor(planted, 9500)], create: [intentFor(planted, { payment_method: 'pm_series_first' })], confirm: [{}] });
        const result = await desk(planted, stripe);
        expect(result.ok, JSON.stringify(result)).toBe(true);
        expect(callsOf(stripe, 'retrieve')[0][1], 'the card is read from the first visit\'s payment').toBe(first.checkout.id);
        expect(callsOf(stripe, 'create').length, 'one intent').toBe(1);
        expect(callsOf(stripe, 'create')[0][1]).toMatchObject({ amount: 9500, customer: 'cus_series_first', payment_method: 'pm_series_first' });
        expect(callsOf(stripe, 'confirm').length, 'one confirm').toBe(1);
        const row = await reportRow(planted.reportId);
        expect([row.status, row.charge_status, row.charge_intent_id]).toEqual(['approved', 'paid', 'pi_extra_probe']);
        const [visit] = await run('SELECT payment_intent_id FROM bookings WHERE id = ?', [planted.bookingId]);
        expect(visit.payment_intent_id, 'the visit still has no payment of its own').toBeNull();
    });

    test('a series visit is never charged on the card of a first visit that belongs to another customer', async () => {
        const stranger = await plantItemsReport({ owner: CUSTOMER2.id });
        const planted = await plantItemsReport({ owner: CUSTOMER1.id, ownPayment: false, series: { of: stranger.bookingId, visit: 2 } });
        // Everything Stripe would need to charge the other customer's card is scripted; the case is that none of it is asked for.
        const stripe = scriptedClient({ retrieve: [stranger.checkout, takenFor(planted, 9500)], create: [intentFor(planted)], confirm: [{}] });
        const result = await desk(planted, stripe);
        expect([result.ok, result.reason, result.report.added_items.charge]).toEqual([false, 'no_payment_method', 'failed']);
        expect(stripe.calls, 'no call to Stripe: the other customer\'s card was neither read nor charged').toEqual([]);
        const row = await reportRow(planted.reportId);
        expect([row.status, row.charge_status, row.charge_reason, row.charge_intent_id]).toEqual(['approved', 'failed', 'no_payment_method', null]);
    });

    test('a booking with no payment of its own is charged on the card its customer put on file from the link', async () => {
        const planted = await plantItemsReport({ ownPayment: false });
        await run(
            "INSERT INTO booking_card_links (booking_id, token_hash, expires_at, used_at, stripe_customer_id, payment_method_id) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 DAY), NOW(), 'cus_link', 'pm_link')",
            [planted.bookingId, sha256Hex(`jrp-card:${tag()}`)]
        );
        const stripe = scriptedClient({ retrieve: [takenFor(planted, 9500)], create: [intentFor(planted, { payment_method: 'pm_link' })], confirm: [{}] });
        const result = await desk(planted, stripe);
        expect(result.ok, JSON.stringify(result)).toBe(true);
        expect(callsOf(stripe, 'create')[0][1]).toMatchObject({ amount: 9500, customer: 'cus_link', payment_method: 'pm_link' });
        expect(callsOf(stripe, 'retrieve').map(([, id]) => id), 'only the new intent is read: the card came from the link').toEqual(['pi_extra_probe']);
        expect((await reportRow(planted.reportId)).charge_status).toBe('paid');
    });

    // ---- the bounds of a sum: judged by the desk, before anything is recorded ----

    test('a sum under the payment minimum and a sum over its ceiling are refused with their own reasons, before anything is recorded or charged', async () => {
        await run("INSERT INTO service_pricing_items (service_id, kind, code, label, amount, minutes, is_placeholder, sort_order) VALUES (1, 'extra', ?, 'Probe quarter', 0.25, 0, 0, 99)", [QUARTER_CODE]);
        try {
            const planted = await plantItemsReport();
            const stripe = scriptedClient({ retrieve: [planted.checkout, takenFor(planted, 9500)], create: [intentFor(planted)], confirm: [{}] });
            const before = await untouched(planted.bookingId);
            const refusals = [
                ['an extra worth a quarter (25 cents)', [{ code: QUARTER_CODE, quantity: 1 }], 25, 'below_minimum'],
                ['2,000,000 ovens (7,000,000,000 cents, over the payment ceiling and under the pricing one)', [{ code: 'oven', quantity: 2_000_000 }], 7_000_000_000, 'too_large'],
                ['3,000,000 ovens (over the pricing ceiling too)', [{ code: 'oven', quantity: 3_000_000 }], 10_500_000_000, 'too_large'],
            ];
            for (const [label, extras, expectedCents, reason] of refusals) {
                const refused = await desk(planted, stripe, { extras, expectedCents });
                expect([refused.ok, refused.reason], label).toEqual([false, reason]);
                const row = await reportRow(planted.reportId);
                expect([row.status, row.charge_status, row.approved_cents, row.decided_by, row.charge_intent_id], `${label}: the report is as it was`).toEqual(['open', 'none', null, null, null]);
            }
            expect(stripe.calls, 'Stripe was not called for any of them').toEqual([]);
            expect(await untouched(planted.bookingId), 'the booking is as it was').toEqual(before);
        } finally {
            await run("DELETE FROM service_pricing_items WHERE service_id = 1 AND kind = 'extra' AND code = ?", [QUARTER_CODE]);
        }
    });

    // ---- the same report decided at the same moment: held at the report row's lock by a third connection until every call is waiting on it ----

    const LOCK_REPORT = 'SELECT id FROM job_reports WHERE id = ? FOR UPDATE';

    test('ten approvals made at the same moment: one is recorded and charged, with one intent and one confirm, and nine are refused as decided', async () => {
        const planted = await plantItemsReport();
        const stripe = scriptedClient({ retrieve: [planted.checkout, takenFor(planted, 9500)], create: [intentFor(planted)], confirm: [{}] });
        const answers = await meetAtLock(LOCK_REPORT, [planted.reportId], Array.from({ length: 10 }, () => () => desk(planted, stripe)));
        expect(answers.length, 'ten answers').toBe(10);
        expect(answers.filter((answer) => answer.ok).length, 'one approval went through').toBe(1);
        expect(answers.filter((answer) => !answer.ok).map((answer) => answer.reason), 'the others were told it was decided').toEqual(Array(9).fill('decided'));
        expect(callsOf(stripe, 'create').length, 'one intent').toBe(1);
        expect(callsOf(stripe, 'confirm').length, 'one confirm').toBe(1);
        const row = await reportRow(planted.reportId);
        expect([row.status, row.charge_status, row.approved_cents, row.charge_intent_id]).toEqual(['approved', 'paid', 9500, 'pi_extra_probe']);
    });

    test('an approval and a decline made at the same moment, in either order: the report is what the one that got in first made it, and the other is refused as decided', async () => {
        // Which call the lock lets in first is the lock's to say, so the case is run with each call started first and asserts the report against whoever won.
        for (const order of ['the decline first', 'the approval first']) {
            const planted = await plantItemsReport();
            const stripe = scriptedClient({ retrieve: [planted.checkout, takenFor(planted, 9500)], create: [intentFor(planted)], confirm: [{}] });
            const approve = () => desk(planted, stripe);
            const decline = () => decideReport({ withConnection, execute: run, stripe, id: planted.reportId, admin: { id: 1 }, action: 'decline', note: 'Not needed' });
            const answers = await meetAtLock(LOCK_REPORT, [planted.reportId], order === 'the decline first' ? [decline, approve] : [approve, decline]);
            const [declined, approved] = order === 'the decline first' ? answers : [answers[1], answers[0]];
            expect([approved.ok, declined.ok].filter(Boolean).length, `${order}: exactly one of the two went through`).toBe(1);
            const row = await reportRow(planted.reportId);
            if (approved.ok) {
                expect(declined.reason, `${order}: the approval won and the decline was refused`).toBe('decided');
                expect([row.status, row.charge_status, row.approved_cents], order).toEqual(['approved', 'paid', 9500]);
                expect([callsOf(stripe, 'create').length, callsOf(stripe, 'confirm').length], `${order}: one intent and one confirm`).toEqual([1, 1]);
            } else {
                expect(approved.reason, `${order}: the decline won and the approval was refused`).toBe('decided');
                expect([row.status, row.charge_status, row.approved_cents, row.charge_intent_id], order).toEqual(['declined', 'none', null, null]);
                expect(stripe.calls, `${order}: a declined report is never charged`).toEqual([]);
            }
        }
    });
});
