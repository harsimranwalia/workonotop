// @ts-check
// ENG-019: the two routes of the job link that start a job and report on it, asked of every caller who must be turned away, and W5 (a job starts only
// from its link, within the check-in window, with the location recorded) one conjunct at a time. W5 and W12 are two of the contract's five hard gates
// (e2e/acceptance/contract.js); the gate names these cases by their title prefix, "Links:", and the file's name, the describe and the title together are
// the baseline key. The model is e2e/job-timer-access.spec.js (a table of routes, one `ask`, the rows and the files held against a change), which asks
// the photo route, the timer's two verbs and check-out; it does not ask the routes below.
//   check-in and reports   POST /api/job/{token}/check-in and POST /api/job/{token}/reports are the one 401 CODE_MESSAGES.signIn with no-store, and write
//                          nothing, for a caller with no credential or a customer (cookie, Bearer); for provider 2 and for the job's previous provider
//                          after a reassign (cookie, Bearer); and for a cleaner who is not on this job's crew now (the cleaner of another job, that
//                          session under this link's cookie name, a cleaner taken off the crew since signing in, a session set back past its 12 hours).
//                          One case for every family and every route, so a failure names both;
//   the controls           the cleaner with the code, the job's provider and an admin each get the success of both routes, in the same file and the same
//                          run, so that a refusal is read beside an acceptance;
//   W5, one at a time      a start of a job on which exactly one of five things is wrong: no before photo (an after photo is there), no one checked in,
//                          the job pending, the window shut (a job dated tomorrow, where the tick-in itself is the 409 with opens_at), no position (none,
//                          0 and 0, words, a latitude of 91). The caller is one who gets in (the provider), so the refusal is the conjunct's and not the
//                          caller's. Every row ends with three reads: the answer, the status of the booking, and no row added to job_sessions,
//                          booking_time_logs or booking_status_history. job-timer.spec.js holds all of them in one case, where the first failing expect
//                          hides the ones after it;
//   W5, the caller         the same start on a job with all five met, from the three families of callers above: the link's one 401, nothing written;
//   W5, the way in         the cleaner with the code, the provider and an admin each start a job with all five met;
//   W5.one-door            the provider's own start at POST /api/provider/jobs/time-tracking starts a confirmed job that has a before photo with no
//                          check-in and no position, which W5 does not allow. This case passes while the door is open, as job-timer.spec.js:399-403
//                          does; the gate reads the clause as a departure (it exits 1 until the door is closed or the approver accepts it). Whoever closes
//                          the door edits this case, in the same change.
// The rows of a job are made the way e2e/job-timer-access.spec.js makes them (the crew through ENG-014's routes, the link through the provider's route,
// the booking in SQL: yesterday, the Morning slot, so that the check-in window is open), a cleaner signs in the way that file does it (SMS is not
// configured in dev, so a case asks for a code through the route, reads code_hash in SQL and finds the six digits by hashing all 10^6 candidates) and a
// before photo is planted in SQL where the case is not about the photo route. The config runs one worker, so the cases run one at a time and in order.
// The describe sweeps, before its first case, after every case and after its last, the crew members whose number is in this file's block (+1 403 555 0700
// to 0719), the bookings whose e-mail address starts with the prefix below (their links, codes, check-ins, sessions, photos, reports, events and crew rows
// go with them), the photo files those rows named, the notice rows of those bookings and the sms_budget counters of those numbers, links and members. A
// failure message names the case, the route, the caller and the status, never a cookie, a token or a code. No case sleeps and none reads a clock.
import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import mysql from 'mysql2/promise';
import { getCredentialHeaders } from './auth/credentials.js';
import { RESET_RETRIES } from './support/auth.js';
import { providers, FIXTURE_LOGINS } from '../database/fixtures/accounts.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';
import { CODE_MESSAGES } from '../src/lib/job-link-code.js';
import { sha256Hex } from '../src/lib/link-token.js';
import { budgetScope } from '../src/lib/sms-budget.js';

// Every request carries a fixture account's session header or a cleaner's cookie and a trace records request headers: tracing is off, as in
// e2e/job-timer-access.spec.js.
test.use({ trace: 'off' });

const [PROVIDER1, PROVIDER2] = providers;
const EMAIL_PREFIX = 'e2e-acl-';
// The number block of this file: the digits after '+1 403 555 0'. The probe customer's number is the last of it.
const NUMBER_FIRST = 700;
const NUMBER_LAST = 719;
const stored = (n) => `+14035550${n}`;
const typed = (n) => `+1 403 555 0${n}`;

// The address of every probe booking (Calgary) and the phone at the address.
const ADDRESS = { latitude: 51.04473, longitude: -114.07192 };
const HERE = { latitude: ADDRESS.latitude, longitude: ADDRESS.longitude, accuracy: 12.4 };

// The answers this file is about, as the routes give them (src/lib/job-link-code.js CODE_MESSAGES.signIn; the timer's start refusals as
// e2e/job-timer.spec.js reads them).
const SIGN_IN = { success: false, message: CODE_MESSAGES.signIn };
const NO_STORE = 'no-store';
const MESSAGES = {
    photo: 'Take a before photo first.',
    nobodyHere: 'Check in who is here first.',
    notConfirmed: 'This job is not ready to start.',
    location: "We need your phone's location to start the job. Allow location for this page and try again.",
};
// A token, wherever it turns up in a failure message, is hidden.
const TOKEN_SHAPE = /[A-Za-z0-9_-]{43}/g;
// `next dev` compiles a route on its first request, which can take a while.
const REQUEST_TIMEOUT = 60_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A minimal JPEG the photo store accepts: start of image, a JFIF header, a start of scan with two bytes of data and the end of image.
const TINY_JPEG = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0x34, 0xff, 0xd9,
]);
const photoUrlPattern = /^\/uploads\/job-photos\/[0-9a-f]{32}\.(jpg|png|webp)$/;

// ---- the job's own clock: every probe booking falls in America/Toronto (Calgary has no cluster) ----

const ZONE = 'America/Toronto';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The calendar day in Toronto of an instant: 'YYYY-MM-DD'.
function torontoDay(instant) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
    const get = (type) => parts.find((part) => part.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
}

const plusDays = (day, count) => new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + count)).toISOString().slice(0, 10);
// A label as the checkout writes one day's slot: 'Oct 17: Morning'.
const slotLabel = (day, slot) => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}: ${slot}`;
// Yesterday: a job dated then has its check-in window open now, whatever the hour. Tomorrow: a job dated then has it shut.
const yesterday = () => plusDays(torontoDay(new Date()), -1);
const tomorrow = () => plusDays(torontoDay(new Date()), 1);

// ---- the dev database, the way e2e/job-timer-access.spec.js reaches it ----

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

// Every statement of this file is prepared, with a ? for every value (the table names of the watch list below are constants of this file).
async function rows(sql, params = []) {
    const [found] = await (await db()).execute(sql, params);
    return /** @type {any[]} */ (found);
}

const countOf = async (sql, params = []) => Number((await rows(sql, params))[0].n);

// The directory the photo route stores into, from the working directory of the run.
const PHOTO_DIR = path.resolve(process.cwd(), 'public/uploads/job-photos');

// The names of the files under PHOTO_DIR, sorted; a directory that is not there is a list of nothing.
async function photoFiles() {
    try {
        return (await fs.readdir(PHOTO_DIR, { recursive: true })).map(String).sort();
    } catch (error) {
        if (/** @type {any} */ (error)?.code === 'ENOENT') return [];
        throw error;
    }
}

// Deletes what this file left: the files of the photos and reports its bookings hold, the sms_budget counters of its numbers, links and members, the
// notice rows of its bookings, the bookings of its e-mail prefix (links, codes, check-ins, sessions, photos, reports, events and crew rows go with
// them) and the crew members of its number block (their number checks go with them).
async function sweepOnce() {
    const open = await db();
    // The photo store makes its directory when it first needs one, and the dev container runs as root: a directory made here first is the test
    // user's, and the sweep below can remove the files the app writes into it.
    await fs.mkdir(PHOTO_DIR, { recursive: true });
    const [photos] = /** @type {any[]} */ (await open.execute('SELECT p.photo_url FROM job_photos p JOIN bookings b ON b.id = p.booking_id WHERE b.customer_email LIKE ?', [`${EMAIL_PREFIX}%`]));
    const [reports] = /** @type {any[]} */ (await open.execute('SELECT r.photo_url FROM job_reports r JOIN bookings b ON b.id = r.booking_id WHERE b.customer_email LIKE ? AND r.photo_url IS NOT NULL', [`${EMAIL_PREFIX}%`]));
    for (const photo of [...photos, ...reports]) {
        if (photoUrlPattern.test(photo.photo_url)) await fs.rm(path.join(process.cwd(), 'public', photo.photo_url), { force: true });
    }
    const [links] = /** @type {any[]} */ (await open.execute('SELECT l.id FROM job_links l JOIN bookings b ON b.id = l.booking_id WHERE b.customer_email LIKE ?', [`${EMAIL_PREFIX}%`]));
    const [members] = /** @type {any[]} */ (await open.execute('SELECT id FROM provider_crew_members WHERE phone BETWEEN ? AND ?', [stored(NUMBER_FIRST), stored(NUMBER_LAST)]));
    const scopes = [budgetScope('provider', PROVIDER1.id), budgetScope('provider', PROVIDER2.id)];
    for (let n = NUMBER_FIRST; n <= NUMBER_LAST; n += 1) scopes.push(budgetScope('number', stored(n)));
    for (const link of links) {
        scopes.push(budgetScope('ask', link.id), budgetScope('verify', link.id));
        for (const member of members) scopes.push(budgetScope('cooldown', link.id, member.id));
    }
    for (let from = 0; from < scopes.length; from += 200) {
        const chunk = scopes.slice(from, from + 200);
        await open.execute(`DELETE FROM sms_budget WHERE scope IN (${chunk.map(() => '?').join(', ')})`, chunk);
    }
    await open.execute('DELETE FROM notice_attempts WHERE booking_id IN (SELECT id FROM bookings WHERE customer_email LIKE ?)', [`${EMAIL_PREFIX}%`]);
    await open.execute('DELETE FROM bookings WHERE customer_email LIKE ?', [`${EMAIL_PREFIX}%`]);
    await open.execute('DELETE FROM provider_crew_members WHERE phone BETWEEN ? AND ?', [stored(NUMBER_FIRST), stored(NUMBER_LAST)]);
}

// The sweep is sent again when MySQL picks it as the victim of a deadlock or a lock wait against another request's writes (1213, 1205).
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

// The hooks of a describe that uses the database: a sweep before its first case, after every case (also a case that failed or timed out) and after
// its last, then the connection is closed.
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

// ---- what a refused call must not touch ----

// The tables whose rows of a job a refused call must not change.
const WATCHED = ['job_checkins', 'job_link_events', 'job_sessions', 'booking_time_logs', 'booking_status_history', 'job_reports', 'job_photos', 'notice_attempts'];

// The row counts of a job in the watched tables, its status and timer columns, and the photo files.
async function watched(bookingId) {
    /** @type {Record<string, number>} */
    const counts = {};
    for (const table of WATCHED) counts[table] = await countOf(`SELECT COUNT(*) AS n FROM ${table} WHERE booking_id = ?`, [bookingId]);
    const [booking] = await rows('SELECT status, provider_id, job_timer_status, UNIX_TIMESTAMP(start_time) AS started FROM bookings WHERE id = ?', [bookingId]);
    return { counts, booking: booking ?? null, files: await photoFiles() };
}

// Runs the calls and holds the world against a change: what `watched` finds after them is what it found before them. Returns what `run` returned.
async function writesNothing(label, bookingId, run) {
    const before = await watched(bookingId);
    const result = await run();
    expect(await watched(bookingId), `${label}: the rows and the files are the same before and after the calls`).toEqual(before);
    return result;
}

// What a start writes and the status it moves: counted, so that a refusal can be seen to have written nothing.
async function writesOf(bookingId) {
    const [booking] = await rows('SELECT status, job_timer_status FROM bookings WHERE id = ?', [bookingId]);
    return {
        sessions: await countOf('SELECT COUNT(*) AS n FROM job_sessions WHERE booking_id = ?', [bookingId]),
        logs: await countOf('SELECT COUNT(*) AS n FROM booking_time_logs WHERE booking_id = ?', [bookingId]),
        history: await countOf('SELECT COUNT(*) AS n FROM booking_status_history WHERE booking_id = ?', [bookingId]),
        status: booking.status,
        timer: booking.job_timer_status,
    };
}

// ---- requests ----

// Playwright's own errors name the URL of the call that failed (a token) and, below their first line, its headers (a cookie): every request this file
// sends goes through a context whose errors are cut to their first line, with anything shaped like a token hidden.
function guarded(context) {
    const through = (verb) => async (url, options) => {
        try {
            return await context[verb](url, options);
        } catch (error) {
            throw new Error(`${verb.toUpperCase()} ${String(url).replace(TOKEN_SHAPE, '{token}')} could not be sent: ${String(/** @type {any} */ (error)?.message ?? error).split('\n')[0].replace(TOKEN_SHAPE, '{token}')}`);
        }
    };
    return { get: through('get'), post: through('post'), put: through('put') };
}

// The credentials a case sends, as request headers (the cookie and Bearer styles of getCredentialHeaders).
async function setup(playwright, request, baseURL) {
    const styles = await getCredentialHeaders(String(baseURL));
    return {
        playwright,
        request: guarded(request),
        baseURL: String(baseURL),
        as: {
            none: {},
            provider: styles['provider-cookie'],
            providerBearer: styles['provider-bearer'],
            admin: styles['admin-cookie'],
            adminBearer: styles['admin-bearer'],
            customer: styles['customer-cookie'],
            customerBearer: styles['customer-bearer'],
        },
    };
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

// Signs provider 2 in through its own login route and returns its session cookie as a request header. The token is never printed.
async function provider2Cookie(playwright, baseURL) {
    const login = FIXTURE_LOGINS.provider2;
    const context = await playwright.request.newContext({ baseURL: String(baseURL) });
    try {
        const response = await guarded(context).post(login.loginRoute, { data: { email: login.email, password: login.password }, maxRetries: RESET_RETRIES, timeout: REQUEST_TIMEOUT });
        expect(response.status(), 'provider 2 signs in').toBe(200);
        const held = (await context.storageState()).cookies.find((entry) => entry.name === 'provider_token');
        expect(held !== undefined, "provider 2's session cookie").toBe(true);
        return { cookie: `provider_token=${held?.value}` };
    } finally {
        await context.dispose();
    }
}

// ---- the rows of a job ----

let sequence = 0;
const tag = () => `${Date.now().toString(36)}${(sequence += 1)}`;

// A booking of provider 1 that is confirmed, in Calgary, in the Morning slot of the day given (yesterday unless a case says otherwise), with a position.
async function insertBooking(day = yesterday()) {
    const id = tag();
    const [made] = /** @type {any[]} */ (await (await db()).execute(
        `INSERT INTO bookings (booking_number, service_id, service_name, service_price, customer_first_name, customer_last_name, customer_email, customer_phone,
           job_date, job_time_slot, job_description, address_line1, city, status, payment_status, provider_id, latitude, longitude)
         VALUES (?, 1, 'Probe service', 100.00, 'E2E', 'Probe', ?, ?, ?, ?, 'ENG-019 job link acceptance probe, deleted by the case', '1 Probe Street', 'Calgary', 'confirmed', 'pending', ?, ?, ?)`,
        [`E2EACL${id}`, `${EMAIL_PREFIX}${id}@example.invalid`, stored(NUMBER_LAST), day, slotLabel(day, 'Morning'), PROVIDER1.id, ADDRESS.latitude, ADDRESS.longitude]
    ));
    return Number(made.insertId);
}

// The numbers a case has used so far from the block: every cleaner a case adds takes the next.
let numbersUsed = 0;
test.beforeEach(() => {
    numbersUsed = 0;
});

// A provider adds the cleaners through ENG-014's route, one number each from this file's block (provider 1 unless the headers are another's).
async function addMembers(ctx, names, headers = ctx.as.provider, who = 'provider 1') {
    const made = [];
    for (const name of names) {
        const number = NUMBER_FIRST + numbersUsed;
        numbersUsed += 1;
        if (number > NUMBER_LAST - 1) throw new Error('the case needs more numbers than the block has');
        const data = await dataOf(await ctx.request.post('/api/provider/crew', { headers, data: { name, phone: typed(number) } }), 201, `${who} adds ${name}`);
        made.push({ id: data.member.id, name, number, checked: false });
    }
    return made;
}

// A provider sets the crew of a job (ENG-014's PUT, which replaces the set and keeps the rows of those who stay).
async function setCrew(ctx, bookingId, ids, headers = ctx.as.provider, who = 'provider 1') {
    await dataOf(await ctx.request.put(`/api/provider/jobs/${bookingId}/crew`, { headers, data: { crew_ids: ids } }), 200, `${who} puts ${ids.length} cleaners on job ${bookingId}`);
}

// The proof ENG-015's number-check routes leave behind: a used row for the member and the number they have now.
async function markChecked(member) {
    if (member.checked) return;
    const [current] = await rows('SELECT phone FROM provider_crew_members WHERE id = ?', [member.id]);
    await (await db()).execute('INSERT INTO crew_number_checks (crew_member_id, phone, code_hash, expires_at, used_at) VALUES (?, ?, ?, NOW(), NOW())', [member.id, current.phone, sha256Hex(`acl-probe:${tag()}`)]);
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

// A cleaner opens the link: the number is checked, a code is asked for through the route, found from its hash and given back. The cookie comes from a
// context of its own so that no jar carries it into the next request; it is returned as a `jls_{link id}={value}` string for a `cookie` header, and
// never printed.
async function signInWith(ctx, job, member) {
    await markChecked(member);
    const asked = await ctx.request.post(`/api/job/${job.token}/code`, { data: { phone: typed(member.number) }, timeout: REQUEST_TIMEOUT });
    expect(asked.status(), `${member.name} asks for a code`).toBe(200);
    const code = await findCode(job.linkId, member.id);
    const fresh = await ctx.playwright.request.newContext({ baseURL: ctx.baseURL });
    try {
        const verified = await guarded(fresh).post(`/api/job/${job.token}/verify`, { data: { phone: typed(member.number), code }, timeout: REQUEST_TIMEOUT });
        expect(verified.status(), `${member.name} gives the code back`).toBe(200);
        const line = verified.headersArray().filter((header) => header.name.toLowerCase() === 'set-cookie').map((header) => header.value).find((value) => value.startsWith(`jls_${job.linkId}=`));
        expect(line !== undefined, `the answer sets the session cookie of link ${job.linkId}`).toBe(true);
        return String(line).split(';')[0];
    } finally {
        await fresh.dispose();
    }
}

const cookieValue = (cookie) => cookie.slice(cookie.indexOf('=') + 1);
const tokenOf = (linkPath) => String(linkPath).slice('/job/'.length);

// The session of a cleaner's cookie is set back past its 12 hours. The cookie's Max-Age is the browser's; the server ends a session by the time in the
// row, so the row is what is set back.
async function endSession(cookie) {
    const [ended] = /** @type {any[]} */ (await (await db()).execute('UPDATE job_link_codes SET session_expires_at = NOW() - INTERVAL 1 SECOND WHERE session_hash = ?', [sha256Hex(cookieValue(cookie))]));
    expect(ended.affectedRows, 'the one session row of the cookie is set back to a second ago').toBe(1);
}

// A probe job of provider 1 with its crew and a link made by the provider's route.
async function makeJob(ctx, members, day = yesterday()) {
    const bookingId = await insertBooking(day);
    await setCrew(ctx, bookingId, members.map((member) => member.id));
    const created = await dataOf(await ctx.request.post(`/api/provider/jobs/${bookingId}/job-link`, { headers: ctx.as.provider, data: { action: 'create' } }), 200, 'provider 1 makes the job link');
    const linkPath = created.job_link?.path;
    expect(typeof linkPath === 'string' && /^\/job\/[A-Za-z0-9_-]{43}$/.test(linkPath), 'the link has a path of 43 base64url characters').toBe(true);
    const [link] = await rows('SELECT id FROM job_links WHERE booking_id = ?', [bookingId]);
    return { bookingId, token: tokenOf(linkPath), linkId: link.id };
}

// A before or an after photo planted in SQL: a row only, with an address that names no file (the photo route is another file's case).
async function plantPhoto(bookingId, type) {
    const url = `/uploads/job-photos/${tag().padEnd(32, '0')}.jpg`;
    await (await db()).execute('INSERT INTO job_photos (booking_id, photo_url, photo_type, uploaded_by) VALUES (?, ?, ?, ?)', [bookingId, url, type, PROVIDER1.id]);
}

// ---- the two routes, and the timer's start, each as one request ----

const checkInRequest = (ctx, token, headers, memberId) => ctx.request.post(`/api/job/${token}/check-in`, { headers, data: { crew_ids: [memberId], location: HERE }, timeout: REQUEST_TIMEOUT });
const reportRequest = (ctx, token, headers) =>
    ctx.request.post(`/api/job/${token}/reports`, {
        headers,
        multipart: {
            type: 'unhygienic',
            note: 'ENG-019 probe note',
            latitude: String(ADDRESS.latitude),
            longitude: String(ADDRESS.longitude),
            accuracy: '12.4',
            photo: { name: 'probe.jpg', mimeType: 'image/jpeg', buffer: TINY_JPEG },
        },
        timeout: REQUEST_TIMEOUT,
    });
const startRequest = (ctx, token, headers, location = HERE) => ctx.request.post(`/api/job/${token}/timer`, { headers, data: location === null ? { action: 'start' } : { action: 'start', location }, timeout: REQUEST_TIMEOUT });
const timerRead = (ctx, token, headers) => ctx.request.get(`/api/job/${token}/timer`, { headers, timeout: REQUEST_TIMEOUT });

const CHECK_IN = { name: 'POST /api/job/[token]/check-in', send: (ctx, token, headers, memberId) => checkInRequest(ctx, token, headers, memberId) };
const REPORTS = { name: 'POST /api/job/[token]/reports', send: (ctx, token, headers) => reportRequest(ctx, token, headers) };
const START = { name: 'POST /api/job/[token]/timer start', send: (ctx, token, headers) => startRequest(ctx, token, headers) };

// One request of a route: { status, body (parsed or null), cache }. The token is in the path and a cookie in the headers: a request that could not be
// sent is reported by `guarded` (its verb, its path with the token hidden and the first line of the error).
async function ask(ctx, route, token, headers, memberId) {
    const response = await route.send(ctx, token, headers, memberId);
    const text = await response.text();
    let body = null;
    try {
        body = JSON.parse(text);
    } catch {
        body = null;
    }
    return { status: response.status(), body, cache: response.headers()['cache-control'] ?? '' };
}

// What an answer was, for a failure message: the status, the sentence the route gave (a fixed one) and the cache header. Never a body.
const gotAs = (answer) => `${answer.status} ${typeof answer.body?.message === 'string' ? JSON.stringify(answer.body.message) : '(no message)'} ${answer.cache || '(no cache-control)'}`;

// The answers that are not the given status with exactly the given body and no-store, each named by its label and what it was.
function wrongAnswers(answers, status, body) {
    const wanted = JSON.stringify(body);
    return answers
        .filter((answer) => answer.status !== status || JSON.stringify(answer.body) !== wanted || answer.cache !== NO_STORE)
        .map((answer) => `${answer.label}: got ${gotAs(answer)}`);
}

// ---- the callers who must be turned away: three families ----

// Each family builds, for one case, the jobs on which its callers are asked and the callers themselves: [{ name, job, memberId, control, callers }].
// `control` is a caller who gets in at that job's link (the link is live and the token right), `callers` the ones to be refused, `memberId` a cleaner on
// that job's crew (the one a check-in would name). `ready` is what a case
// does to each job after its crew is set: nothing for the two routes, and for a start it ticks a cleaner in and puts a before photo on file, so that
// the caller is the one thing wrong.
const FAMILIES = [
    {
        name: 'no credential or a customer',
        build: async (ctx, ready) => {
            const [ann] = await addMembers(ctx, ['Ann']);
            const job = await makeJob(ctx, [ann]);
            await ready(ctx, job, ann);
            return [
                {
                    name: 'the live link',
                    job,
                    memberId: ann.id,
                    control: ['provider 1', ctx.as.provider],
                    callers: [['no credential', ctx.as.none], ['a customer (cookie)', ctx.as.customer], ['a customer (Bearer)', ctx.as.customerBearer]],
                },
            ];
        },
    },
    {
        name: 'provider 2 or the previous provider',
        build: async (ctx, ready) => {
            const two = await provider2Cookie(ctx.playwright, ctx.baseURL);
            const [ann] = await addMembers(ctx, ['Ann']);
            const job = await makeJob(ctx, [ann]);
            await ready(ctx, job, ann);
            // A second job, which the admin gives to provider 2: that clears its crew, so provider 2 sets its own and the job is made ready again.
            const [bea] = await addMembers(ctx, ['Bea']);
            const moved = await makeJob(ctx, [bea]);
            const reassigned = await ctx.request.post(`/api/bookings/${moved.bookingId}/reassign`, { headers: ctx.as.admin, data: { new_provider_id: PROVIDER2.id, old_provider_id: PROVIDER1.id }, timeout: REQUEST_TIMEOUT });
            expect([reassigned.status(), (await reassigned.json().catch(() => null))?.success], 'the admin reassigns the job to provider 2').toEqual([200, true]);
            const [cy] = await addMembers(ctx, ['Cy'], two, 'provider 2');
            await setCrew(ctx, moved.bookingId, [cy.id], two, 'provider 2');
            await ready(ctx, moved, cy, two);
            return [
                { name: 'the link of a job of provider 1', job, memberId: ann.id, control: ['provider 1', ctx.as.provider], callers: [['provider 2', two]] },
                { name: 'the link of a reassigned job', job: moved, memberId: cy.id, control: ['provider 2', two], callers: [['the previous provider (cookie)', ctx.as.provider], ['the previous provider (Bearer)', ctx.as.providerBearer]] },
            ];
        },
    },
    {
        name: 'a cleaner who is not on the crew now',
        build: async (ctx, ready) => {
            const [ann, bea, cat] = await addMembers(ctx, ['Ann', 'Bea', 'Cat']);
            const job = await makeJob(ctx, [ann, bea, cat]);
            const other = await makeJob(ctx, [cat]);
            const catOther = await signInWith(ctx, other, cat);
            const annCookie = await signInWith(ctx, job, ann);
            const beaCookie = await signInWith(ctx, job, bea);
            // Cat is on the crew for good: the provider ticks Cat in, so that a check-in of Cat, were a caller let in, would write.
            await ready(ctx, job, cat);
            // Ann is taken off the crew through ENG-014's route, and Bea's session is set back past its 12 hours.
            await setCrew(ctx, job.bookingId, [bea.id, cat.id], ctx.as.provider, 'provider 1 takes Ann off the job');
            await endSession(beaCookie);
            return [
                {
                    name: 'the live link',
                    job,
                    memberId: cat.id,
                    control: ['provider 1', ctx.as.provider],
                    callers: [
                        ["a cleaner's cookie for another job's link", { cookie: catOther }],
                        ["that session's value under this link's cookie name", { cookie: `jls_${job.linkId}=${cookieValue(catOther)}` }],
                        ['a cleaner taken off the crew since signing in', { cookie: annCookie }],
                        ['a session set back past its 12 hours', { cookie: beaCookie }],
                    ],
                },
            ];
        },
    },
];

// A job with all five met for a start: someone is checked in (by the provider whose headers are given) and a before photo is on file. The job is
// confirmed, dated yesterday and has its position, from insertBooking.
async function readyToStart(ctx, job, member, headers = ctx.as.provider) {
    await dataOf(await checkInRequest(ctx, job.token, headers, member.id), 200, `a provider ticks ${member.name} in`);
    await plantPhoto(job.bookingId, 'before');
}

const nothingToDo = async () => {};

// Every caller of a family asked at one route: the link is live (a caller who gets in reads the timer, which writes nothing), then each caller to be
// refused is asked and the rows and files are held against a change. Returns how many were asked, how many there should have been and the answers that
// are not the one 401 with no-store.
async function askFamily(ctx, family, route, ready) {
    const groups = await family.build(ctx, ready);
    let asked = 0;
    const problems = [];
    for (const group of groups) {
        const [controlWho, controlHeaders] = group.control;
        const control = await ask(ctx, { send: (c, token, headers) => timerRead(c, token, headers) }, group.job.token, controlHeaders, group.memberId);
        expect([control.status, control.body?.success], `control: ${controlWho} reads the timer of ${group.name}`).toEqual([200, true]);
        const got = await writesNothing(group.name, group.job.bookingId, async () => {
            const answers = [];
            for (const [who, headers] of group.callers) answers.push({ label: `${group.name} / ${who}`, ...(await ask(ctx, route, group.job.token, headers, group.memberId)) });
            return answers;
        });
        asked += got.length;
        problems.push(...wrongAnswers(got, 401, SIGN_IN));
    }
    return { asked, expected: groups.reduce((sum, group) => sum + group.callers.length, 0), problems };
}

// W5, one conjunct at a time: a job on which exactly one of five things is wrong. `make` says which; `fix` puts that one thing right, so that the same
// job, started again, is let start (the other four were met all along).
const CONJUNCTS = [
    {
        name: 'no before photo (an after photo is there)',
        make: { photo: 'after' },
        refusal: [409, MESSAGES.photo, 'no_before_photos'],
        fix: async (ctx, job) => plantPhoto(job.bookingId, 'before'),
    },
    {
        name: 'no one checked in',
        make: { tick: false },
        refusal: [409, MESSAGES.nobodyHere, 'nobody_here'],
        fix: async (ctx, job, member) => readyToStartTick(ctx, job, member),
    },
    {
        name: 'the job not confirmed',
        make: { status: 'pending' },
        refusal: [409, MESSAGES.notConfirmed, 'not_confirmed'],
        fix: async (ctx, job) => {
            await (await db()).execute("UPDATE bookings SET status = 'confirmed' WHERE id = ?", [job.bookingId]);
        },
    },
    {
        // The timer never reads the window (src/lib/job-timer.js has no reference to it): W5's "within the check-in window" holds through the tick-in,
        // which is itself the 409 with opens_at, and the start after it is refused for want of anyone here. The fix opens the window and does nothing
        // else: this job is dated yesterday's Morning, the way insertBooking dates it, and the cleaner is ticked in, which the shut window had refused.
        name: 'the window shut (a job dated tomorrow: the tick-in is refused, so no one is here)',
        make: { day: 'tomorrow', tick: 'refused' },
        refusal: [409, MESSAGES.nobodyHere, 'nobody_here'],
        fix: async (ctx, job, member) => {
            const day = yesterday();
            await (await db()).execute('UPDATE bookings SET job_date = ?, job_time_slot = ? WHERE id = ?', [day, slotLabel(day, 'Morning'), job.bookingId]);
            await readyToStartTick(ctx, job, member);
        },
    },
];

const readyToStartTick = async (ctx, job, member) => dataOf(await checkInRequest(ctx, job.token, ctx.as.provider, member.id), 200, `provider 1 ticks ${member.name} in`);

// A job of provider 1 on which what `make` says is wrong and the rest is right: a cleaner on the crew, who is ticked in by the provider (unless
// make.tick is false; 'refused' is a tick that is asked for and refused), a before photo (or the type make.photo gives), the job confirmed (or the
// status make.status gives) and dated yesterday (or tomorrow).
async function conjunctJob(ctx, make) {
    const [dee] = await addMembers(ctx, ['Dee']);
    const job = await makeJob(ctx, [dee], make.day === 'tomorrow' ? tomorrow() : yesterday());
    let ticked = null;
    if (make.tick !== false) ticked = await ask(ctx, CHECK_IN, job.token, ctx.as.provider, dee.id);
    await plantPhoto(job.bookingId, make.photo ?? 'before');
    if (make.status) await (await db()).execute('UPDATE bookings SET status = ? WHERE id = ?', [make.status, job.bookingId]);
    return { job, member: dee, ticked };
}

test.describe('Job link acceptance: who is turned away, and what a start needs', () => {
    sweepAround();

    // W12, W5: the link's check-in and its reports, asked of each family of callers who must be refused. Cases 1 and 2 of the design.
    for (const route of [CHECK_IN, REPORTS]) {
        for (const family of FAMILIES) {
            test(`Links: ${route.name} refuses ${family.name} with the link's one 401 and writes nothing`, async ({ playwright, request, baseURL }) => {
                test.setTimeout(240_000);
                const ctx = await setup(playwright, request, baseURL);
                const { asked, expected, problems } = await askFamily(ctx, family, route, nothingToDo);
                expect(asked, 'every caller was asked').toBe(expected);
                expect(problems, 'the answers that are not the one 401 "Enter your code to continue." with no-store').toEqual([]);
            });
        }
    }

    // The controls of case 3: the three callers who get in are let in at both routes, in this file and this run.
    test('Links: the cleaner with the code, the job\'s provider and an admin are let in at check-in and at reports', async ({ playwright, request, baseURL }) => {
        test.setTimeout(240_000);
        const ctx = await setup(playwright, request, baseURL);
        const [ann, bea, cat] = await addMembers(ctx, ['Ann', 'Bea', 'Cat']);
        const job = await makeJob(ctx, [ann, bea, cat]);
        const annCookie = await signInWith(ctx, job, ann);
        const callers = [
            ['the cleaner with the code', { cookie: annCookie }, ann],
            ['the job\'s provider', ctx.as.provider, bea],
            ['an admin', ctx.as.admin, cat],
        ];
        for (const [who, headers, member] of callers) {
            const before = await watched(job.bookingId);
            const tick = await ask(ctx, CHECK_IN, job.token, headers, member.id);
            expect([tick.status, tick.body?.success, tick.cache], `${who} ticks ${member.name} in: status, success, cache`).toEqual([200, true, NO_STORE]);
            const report = await ask(ctx, REPORTS, job.token, headers, member.id);
            expect([report.status, report.body?.success, report.cache], `${who} sends a report: status, success, cache`).toEqual([200, true, NO_STORE]);
            const after = await watched(job.bookingId);
            expect(after.counts.job_checkins - before.counts.job_checkins, `${who}: one check-in row`).toBe(1);
            expect(after.counts.job_reports - before.counts.job_reports, `${who}: one report row`).toBe(1);
        }
    });

    // W5 (hard gate), one conjunct at a time. Case 4 of the design.
    for (const row of CONJUNCTS) {
        test(`Links: W5 a start is refused, and nothing is written, when only this is wrong: ${row.name}`, async ({ playwright, request, baseURL }) => {
            test.setTimeout(180_000);
            const ctx = await setup(playwright, request, baseURL);
            const { job, member, ticked } = await conjunctJob(ctx, row.make);
            if (row.make.tick === 'refused') {
                expect([ticked?.status, typeof ticked?.body?.opens_at], 'the tick-in is refused with the time the window opens').toEqual([409, 'string']);
            } else if (ticked) {
                expect([ticked.status, ticked.body?.success], 'the provider ticks the cleaner in').toEqual([200, true]);
            }
            const before = await writesOf(job.bookingId);
            const refused = await ask(ctx, START, job.token, ctx.as.provider);
            expect([refused.status, refused.body?.message, refused.body?.reason], 'the start is refused with the route\'s own answer').toEqual(row.refusal);
            expect(refused.cache, 'no-store').toContain(NO_STORE);
            expect(await writesOf(job.bookingId), 'the status and the rows of job_sessions, booking_time_logs and booking_status_history are the same').toEqual(before);
            if (row.fix) {
                // The one thing is put right, and the same job starts: the other four were met all along.
                await row.fix(ctx, job, member);
                const started = await ask(ctx, START, job.token, ctx.as.provider);
                expect([started.status, started.body?.success, started.body?.data?.timer?.state], 'with that one thing put right the same job starts').toEqual([200, true, 'running']);
            }
        });
    }

    test('Links: W5 a start with no position is refused whatever the position is not (none, 0 and 0, words, a latitude of 91), and nothing is written', async ({ playwright, request, baseURL }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const { job } = await conjunctJob(ctx, {});
        const before = await writesOf(job.bookingId);
        const positions = [
            ['none', null],
            ['0 and 0', { latitude: 0, longitude: 0, accuracy: 5 }],
            ['words', { latitude: 'here', longitude: 'there', accuracy: 5 }],
            ['a latitude of 91', { latitude: 91, longitude: -114, accuracy: 5 }],
        ];
        for (const [what, location] of positions) {
            const refused = await answerOf(await startRequest(ctx, job.token, ctx.as.provider, location));
            expect([refused.status, refused.body?.message], `a start with a position of ${what}`).toEqual([400, MESSAGES.location]);
            expect(refused.cache, `${what}: no-store`).toContain(NO_STORE);
        }
        expect(await writesOf(job.bookingId), 'four refused starts wrote no session, no log and no history row and left the job confirmed').toEqual(before);
        const started = await ask(ctx, START, job.token, ctx.as.provider);
        expect([started.status, started.body?.data?.timer?.state], 'with a position the same job starts: the other four were met all along').toEqual([200, 'running']);
    });

    // W5, the caller as the one thing wrong: a job with all five met, started by each family of callers who must be refused. Case 4 of the design.
    for (const family of FAMILIES) {
        test(`Links: W5 a start by ${family.name} is refused with the link's one 401 and nothing is written`, async ({ playwright, request, baseURL }) => {
            test.setTimeout(240_000);
            const ctx = await setup(playwright, request, baseURL);
            const { asked, expected, problems } = await askFamily(ctx, family, START, readyToStart);
            expect(asked, 'every caller was asked').toBe(expected);
            expect(problems, 'the answers that are not the one 401 "Enter your code to continue." with no-store').toEqual([]);
        });
    }

    // W5, the way in: the three callers who may start each start a job with all five met, and the start records who and where.
    test('Links: W5 the cleaner with the code, the provider and an admin each start a job with all five met, and the start records who and where', async ({ playwright, request, baseURL }) => {
        test.setTimeout(240_000);
        const ctx = await setup(playwright, request, baseURL);
        const members = await addMembers(ctx, ['Ann', 'Bea', 'Cat']);
        const callers = [['the cleaner with the code', 'cleaner'], ['the provider', 'provider'], ['an admin', 'admin']];
        for (const [index, [who, kind]] of callers.entries()) {
            const member = members[index];
            const job = await makeJob(ctx, [member]);
            const headers = kind === 'cleaner' ? { cookie: await signInWith(ctx, job, member) } : kind === 'provider' ? ctx.as.provider : ctx.as.admin;
            await dataOf(await checkInRequest(ctx, job.token, headers, member.id), 200, `${who} ticks ${member.name} in`);
            await plantPhoto(job.bookingId, 'before');
            const before = await writesOf(job.bookingId);
            const started = await ask(ctx, START, job.token, headers);
            expect([started.status, started.body?.success, started.body?.data?.timer?.state], `${who} starts the job`).toEqual([200, true, 'running']);
            const after = await writesOf(job.bookingId);
            expect([after.sessions - before.sessions, after.logs - before.logs, after.history - before.history, after.status, after.timer], `${who}: one session, one log, one history row, in_progress and running`).toEqual([1, 1, 1, 'in_progress', 'running']);
            const events = await rows("SELECT actor_kind, latitude, longitude FROM job_link_events WHERE booking_id = ? AND kind = 'timer_start'", [job.bookingId]);
            expect(events.map((event) => event.actor_kind), `${who}: the start names who started it`).toEqual([kind]);
            expect([Number(events[0].latitude), Number(events[0].longitude)], `${who}: the start records the position it was sent from`).toEqual([ADDRESS.latitude, ADDRESS.longitude]);
        }
    });

    // W5.one-door (case 5 of the design, a finding): this passes while the door is open. See the header.
    test('Links: W5.one-door the provider\'s own start at time-tracking starts a confirmed job that has a before photo, with no check-in and no position', async ({ playwright, request, baseURL }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const { job } = await conjunctJob(ctx, { tick: false });
        const before = await writesOf(job.bookingId);
        expect(before.status, 'the probe job is confirmed and has a before photo').toBe('confirmed');
        // At the link the same start is refused: no one is checked in.
        const atLink = await ask(ctx, START, job.token, ctx.as.provider);
        expect([atLink.status, atLink.body?.reason], 'at the link the start is refused: no one is checked in').toEqual([409, 'nobody_here']);
        const atPortal = await answerOf(await ctx.request.post('/api/provider/jobs/time-tracking', { headers: ctx.as.provider, data: { booking_id: job.bookingId, action: 'start' }, timeout: REQUEST_TIMEOUT }));
        expect(atPortal.status, `the provider's own page starts the job (${atPortal.body?.message ?? 'no message'})`).toBe(200);
        const after = await writesOf(job.bookingId);
        expect([after.status, after.timer], 'the job is in progress and its timer running').toEqual(['in_progress', 'running']);
        expect(await countOf('SELECT COUNT(*) AS n FROM job_checkins WHERE booking_id = ?', [job.bookingId]), 'no one was checked in').toBe(0);
        expect(await countOf('SELECT COUNT(*) AS n FROM job_link_events WHERE booking_id = ? AND latitude IS NOT NULL', [job.bookingId]), 'no position was recorded').toBe(0);
    });
});
