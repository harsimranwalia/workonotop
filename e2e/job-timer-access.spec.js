// @ts-check
// ENG-016: who gets in at the four new public routes of the job link: POST /api/job/{token}/photos, GET and POST /api/job/{token}/timer and POST
// /api/job/{token}/check-out. The "Access (the negatives)" case of the design's table
// (agents/architect/designs/ENG-016-photos-and-countdown-timer-on-the-job-link.md, "Cases and baseline") is in this file, as three cases. Each title
// starts with "Access:", and the file's name, the describe and the title together are its baseline key:
//   a dead link   a token that is malformed, unknown, switched off, replaced (the OLD token), for a closed job (completed, cancelled) or for a job with
//                 no provider is the one 404 { success: false, message: 'This link is not valid.' } with no-store on every route, whether the caller has
//                 nothing, is the job's own provider or is an admin, and the bodies are byte-identical across the causes, the routes and the callers;
//   no way in     a live link answers 401 CODE_MESSAGES.signIn with no-store, on every route, to a caller with no credential, a cleaner's cookie for
//                 ANOTHER job's link (and that session's value under this link's own cookie name), a cleaner taken off the crew since signing in
//                 (ENG-014's PUT), a session set back past its 12 hours (SQL), a customer (cookie and Bearer), provider 2 and the previous provider after
//                 a reassign (cookie and Bearer, on provider 1's job);
//   gets in       the job's own provider (cookie, Bearer) and an admin (Bearer, cookie) pass the check with no cleaner cookie, shown with calls that
//                 change nothing: the timer read is a 200 with data.timer, a pause of a job that is not running is a 409 with reason not_running, a
//                 check-out of a cleaner who is not checked in is a 409 and a photo with a type and no file is a 400.
// In every case the calls write nothing: the rows of job_photos, job_sessions, job_checkins, booking_time_logs and job_link_events of the job (and the
// job's status and timer columns), and the files under public/uploads/job-photos (listed from the working directory of the run; a directory that is not
// there is a list of nothing), are the same after the calls as before them. The routes are asked in a table (ROUTES) by one function (ask), once for
// every cause and every caller, so a fifth cause or caller is one line. The photo that is sent is a real file for the photo route (its first bytes
// are a PNG's), so a refused call that was let in would be stored and would show.
// The rows of a job are made the way e2e/job-checkin.spec.js makes them (the crew through ENG-014's routes, the link through the provider's route, the
// booking in SQL: yesterday, the Morning slot, so that the check-in window is open), and a cleaner signs in the way that file does it: SMS is not
// configured in dev, so a case asks for a code through the route, reads code_hash in SQL and finds the six digits by hashing all 10^6 candidates. The
// config runs one worker, so the cases run one at a time and in order. The describe sweeps, before its first case, after every case and after its
// last, the crew members whose number is in this file's block (+1 403 555 0240 to 0249), the bookings whose e-mail address starts with the prefix
// below (their links, codes, check-ins, events and crew rows go with them) and the sms_budget counters of those numbers, links and members. A failure
// message names the case, the route, the caller and the status, never a cookie, a token or a code.
import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import mysql from 'mysql2/promise';
import { getCredentialHeaders } from './auth/credentials.js';
import { RESET_RETRIES } from './support/auth.js';
import { providers, FIXTURE_LOGINS } from '../database/fixtures/accounts.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';
import { CHECKIN_MESSAGES } from '../src/lib/job-checkin.js';
import { CODE_MESSAGES } from '../src/lib/job-link-code.js';
import { newLinkToken, sha256Hex } from '../src/lib/link-token.js';
import { budgetScope } from '../src/lib/sms-budget.js';

// Every request carries a fixture account's session header or a cleaner's cookie and a trace records request headers: tracing is off, as in
// e2e/job-checkin.spec.js.
test.use({ trace: 'off' });

const [PROVIDER1, PROVIDER2] = providers;
const EMAIL_PREFIX = 'e2e-jta-';
// The number block of this file: the digits after '+1 403 555 0'. The probe customer's number is the last of it.
const NUMBER_FIRST = 240;
const NUMBER_LAST = 249;
const stored = (n) => `+14035550${n}`;
const typed = (n) => `+1 403 555 0${n}`;

// The address of every probe booking (Calgary) and the phone at the address.
const ADDRESS = { latitude: 51.04473, longitude: -114.07192 };
const HERE = { latitude: ADDRESS.latitude, longitude: ADDRESS.longitude, accuracy: 12.4 };

// The two answers this file is about, as the routes give them (src/lib/job-link.js LINK_MESSAGES.notValid; src/lib/job-link-code.js CODE_MESSAGES.signIn).
const NOT_VALID = { success: false, message: 'This link is not valid.' };
const SIGN_IN = { success: false, message: CODE_MESSAGES.signIn };
const NO_STORE = 'no-store';
// A token, wherever it turns up in a failure message, is hidden.
const TOKEN_SHAPE = /[A-Za-z0-9_-]{43}/g;
// `next dev` compiles a route on its first request, which can take a while.
const REQUEST_TIMEOUT = 60_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A file the photo route would take: it decides what a file is from its first bytes, never from its name or its type (these are a PNG's signature and a
// few bytes after it).
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('e2e-jta probe')]);

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
// Yesterday: a job dated then has its check-in window open now, whatever the hour.
const yesterday = () => plusDays(torontoDay(new Date()), -1);

// ---- the dev database, the way e2e/job-checkin.spec.js reaches it ----

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

// Deletes what this file left: the sms_budget counters of its numbers, links and members, the bookings of its e-mail prefix (links, codes, check-ins,
// events and crew rows go with them) and the crew members of its number block (their number checks go with them).
async function sweepOnce() {
    const open = await db();
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

// The tables whose rows of a job a refused call must not change, and the directory the photo route stores into.
const WATCHED = ['job_photos', 'job_sessions', 'job_checkins', 'booking_time_logs', 'job_link_events'];
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

// The row counts of a job in the watched tables, its status and timer columns, and the photo files. A token that belongs to no job (bookingId null) has
// the files only.
async function watched(bookingId) {
    /** @type {Record<string, number | null>} */
    const counts = {};
    for (const table of WATCHED) counts[table] = bookingId === null ? null : await countOf(`SELECT COUNT(*) AS n FROM ${table} WHERE booking_id = ?`, [bookingId]);
    const [booking] = bookingId === null ? [null] : await rows('SELECT status, provider_id, job_timer_status, UNIX_TIMESTAMP(start_time) AS started FROM bookings WHERE id = ?', [bookingId]);
    return { counts, booking: booking ?? null, files: await photoFiles() };
}

// Runs the calls and holds the world against a change: what `watched` finds after them is what it found before them. Returns what `run` returned.
async function writesNothing(label, bookingId, run) {
    const before = await watched(bookingId);
    const result = await run();
    expect(await watched(bookingId), `${label}: the rows and the files are the same after the calls as before them`).toEqual(before);
    return result;
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

// A booking of provider 1 that is confirmed, in Calgary, dated yesterday in the Morning slot, with a position.
async function insertBooking() {
    const id = tag();
    const day = yesterday();
    const [made] = /** @type {any[]} */ (await (await db()).execute(
        `INSERT INTO bookings (booking_number, service_id, service_name, service_price, customer_first_name, customer_last_name, customer_email, customer_phone,
           job_date, job_time_slot, job_description, address_line1, city, status, payment_status, provider_id, latitude, longitude)
         VALUES (?, 1, 'Probe service', 100.00, 'E2E', 'Probe', ?, ?, ?, ?, 'ENG-016 who-gets-in probe, deleted by the case', '1 Probe Street', 'Calgary', 'confirmed', 'pending', ?, ?, ?)`,
        [`E2EJTA${id}`, `${EMAIL_PREFIX}${id}@example.invalid`, stored(NUMBER_LAST), day, slotLabel(day, 'Morning'), PROVIDER1.id, ADDRESS.latitude, ADDRESS.longitude]
    ));
    return Number(made.insertId);
}

// Provider 1 adds the cleaners through ENG-014's route, one number each from this file's block.
async function addMembers(ctx, names) {
    const made = [];
    for (const [index, name] of names.entries()) {
        const number = NUMBER_FIRST + index;
        const data = await dataOf(await ctx.request.post('/api/provider/crew', { headers: ctx.as.provider, data: { name, phone: typed(number) } }), 201, `provider 1 adds ${name}`);
        made.push({ id: data.member.id, name, number, checked: false });
    }
    return made;
}

// Provider 1 sets the crew of a job (ENG-014's PUT, which replaces the set and keeps the rows of those who stay).
async function setCrew(ctx, bookingId, ids, who = 'provider 1') {
    await dataOf(await ctx.request.put(`/api/provider/jobs/${bookingId}/crew`, { headers: ctx.as.provider, data: { crew_ids: ids } }), 200, `${who} puts ${ids.length} cleaners on job ${bookingId}`);
}

// The proof ENG-015's number-check routes leave behind: a used row for the member and the number they have now.
async function markChecked(member) {
    if (member.checked) return;
    const [current] = await rows('SELECT phone FROM provider_crew_members WHERE id = ?', [member.id]);
    await (await db()).execute('INSERT INTO crew_number_checks (crew_member_id, phone, code_hash, expires_at, used_at) VALUES (?, ?, ?, NOW(), NOW())', [member.id, current.phone, sha256Hex(`jta-probe:${tag()}`)]);
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

const setStatus = async (bookingId, status) => {
    await (await db()).execute('UPDATE bookings SET status = ? WHERE id = ?', [status, bookingId]);
};

// A probe job of provider 1 with its crew and a link made by the provider's route.
async function makeJob(ctx, members) {
    const bookingId = await insertBooking();
    await setCrew(ctx, bookingId, members.map((member) => member.id));
    const created = await linkAction(ctx, { bookingId }, { action: 'create' }, 'provider 1 makes the job link');
    const linkPath = created.job_link?.path;
    expect(typeof linkPath === 'string' && /^\/job\/[A-Za-z0-9_-]{43}$/.test(linkPath), 'the link has a path of 43 base64url characters').toBe(true);
    const [link] = await rows('SELECT id FROM job_links WHERE booking_id = ?', [bookingId]);
    return { bookingId, token: tokenOf(linkPath), linkId: link.id, generation: created.job_link.generation };
}

// The provider's own route for the link: { action: 'create' | 'off' | 'reissue', generation? }. The data of the answer.
async function linkAction(ctx, job, body, who) {
    return dataOf(await ctx.request.post(`/api/provider/jobs/${job.bookingId}/job-link`, { headers: ctx.as.provider, data: body }), 200, who);
}

// Provider 1 ticks a member in at the link (so that a check-out of the member, were a refused caller let in, would write).
async function tickIn(ctx, job, member) {
    await dataOf(await ctx.request.post(`/api/job/${job.token}/check-in`, { headers: ctx.as.provider, data: { crew_ids: [member.id], location: HERE }, timeout: REQUEST_TIMEOUT }), 200, `provider 1 ticks ${member.name} in`);
}

// ---- the four routes, each as one request ----

const photoRequest = (ctx, token, headers, withFile = true) =>
    ctx.request.post(`/api/job/${token}/photos`, {
        headers,
        multipart: withFile ? { type: 'before', photo: { name: 'probe.png', mimeType: 'image/png', buffer: PNG } } : { type: 'before' },
        timeout: REQUEST_TIMEOUT,
    });
const timerRead = (ctx, token, headers) => ctx.request.get(`/api/job/${token}/timer`, { headers, timeout: REQUEST_TIMEOUT });
const timerAct = (ctx, token, headers, action) => ctx.request.post(`/api/job/${token}/timer`, { headers, data: { action, location: HERE }, timeout: REQUEST_TIMEOUT });
const checkOutRequest = (ctx, token, headers, memberId) => ctx.request.post(`/api/job/${token}/check-out`, { headers, data: { crew_ids: [memberId], location: HERE }, timeout: REQUEST_TIMEOUT });

const PHOTOS = { name: 'POST photos', send: (ctx, token, headers) => photoRequest(ctx, token, headers) };
const TIMER_READ = { name: 'GET timer', send: (ctx, token, headers) => timerRead(ctx, token, headers) };
const TIMER_ACT = { name: 'POST timer', send: (ctx, token, headers) => timerAct(ctx, token, headers, 'start') };
const CHECK_OUT = { name: 'POST check-out', send: (ctx, token, headers, memberId) => checkOutRequest(ctx, token, headers, memberId) };
// The four routes of the job link this ticket adds (both verbs of the timer), each with a body that is whole and would be taken from a caller who got in.
const ROUTES = [PHOTOS, TIMER_READ, TIMER_ACT, CHECK_OUT];

// One request of a table's route: { status, body (parsed or null), text, cache }. The token is in the path and a cookie in the headers: a request that
// could not be sent is reported by `guarded` (its verb, its path with the token hidden and the first line of the error).
async function ask(ctx, route, token, headers, memberId) {
    const response = await route.send(ctx, token, headers, memberId);
    const text = await response.text();
    let body = null;
    try {
        body = JSON.parse(text);
    } catch {
        body = null;
    }
    return { status: response.status(), body, text, cache: response.headers()['cache-control'] ?? '' };
}

// Every route asked as every caller ([name, headers]) at one token: the answers, each with a label that holds no token, code or cookie.
async function askAll(ctx, cause, token, callers, memberId) {
    const answers = [];
    for (const route of ROUTES) {
        for (const [who, headers] of callers) {
            answers.push({ label: `${cause} / ${route.name} / ${who}`, ...(await ask(ctx, route, token, headers, memberId)) });
        }
    }
    return answers;
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

test.describe('Job timer, photos and check-out: who gets in', () => {
    sweepAround();

    test('Access: every dead link is the one 404, and nothing is written', async ({ playwright, request, baseURL }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const [ann] = await addMembers(ctx, ['Ann']);

        // A live link, which the routes do answer (a control), and the jobs whose links die in the ways the design lists.
        const live = await makeJob(ctx, [ann]);
        const control = await ask(ctx, TIMER_READ, live.token, ctx.as.provider, ann.id);
        expect([control.status, control.body?.success], 'control: the provider reads the timer of a live link').toEqual([200, true]);

        const off = await makeJob(ctx, [ann]);
        await linkAction(ctx, off, { action: 'off' }, 'provider 1 switches the link off');

        const replaced = await makeJob(ctx, [ann]);
        const reissued = await linkAction(ctx, replaced, { action: 'reissue', generation: replaced.generation }, 'provider 1 reissues the link');
        const newToken = tokenOf(reissued.job_link.path);
        expect(newToken !== replaced.token, 'the reissued link has a new token').toBe(true);
        const renewed = await ask(ctx, TIMER_READ, newToken, ctx.as.provider, ann.id);
        expect([renewed.status, renewed.body?.success], 'control: the provider reads the timer at the new token').toEqual([200, true]);

        const closed = await makeJob(ctx, [ann]);

        const orphan = await makeJob(ctx, [ann]);
        await (await db()).execute('UPDATE bookings SET provider_id = NULL WHERE id = ?', [orphan.bookingId]);

        const flipped = [...live.token].map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join('');
        expect(flipped !== live.token, 'the case-flipped token differs from the live one').toBe(true);

        /** @type {{ name: string, token: string, bookingId: number | null, status?: string }[]} */
        const causes = [
            { name: 'malformed (a word)', token: 'abc', bookingId: null },
            { name: 'malformed (one character short)', token: newLinkToken().slice(1), bookingId: null },
            { name: 'malformed (one character long)', token: `${newLinkToken()}a`, bookingId: null },
            { name: 'malformed (a plus in it)', token: `${newLinkToken().slice(0, 42)}%2B`, bookingId: null },
            { name: 'malformed (a booking id)', token: String(live.bookingId), bookingId: null },
            { name: 'unknown (well formed, nobody holds it)', token: newLinkToken(), bookingId: null },
            { name: 'unknown (a live token with its case flipped)', token: flipped, bookingId: live.bookingId },
            { name: 'switched off', token: off.token, bookingId: off.bookingId },
            { name: 'replaced (the old token)', token: replaced.token, bookingId: replaced.bookingId },
            { name: 'closed (completed)', token: closed.token, bookingId: closed.bookingId, status: 'completed' },
            { name: 'closed (cancelled)', token: closed.token, bookingId: closed.bookingId, status: 'cancelled' },
            { name: 'no provider', token: orphan.token, bookingId: orphan.bookingId },
        ];
        // The answer does not change with who asks: nobody, the job's own provider, an admin.
        const callers = [['nobody', ctx.as.none], ['the provider of the job', ctx.as.provider], ['an admin (Bearer)', ctx.as.adminBearer]];

        const answers = [];
        const problems = [];
        for (const cause of causes) {
            if (cause.status && cause.bookingId !== null) await setStatus(cause.bookingId, cause.status);
            const got = await writesNothing(cause.name, cause.bookingId, () => askAll(ctx, cause.name, cause.token, callers, ann.id));
            answers.push(...got);
            problems.push(...wrongAnswers(got, 404, NOT_VALID));
        }

        expect(answers.length, 'every cause was asked on every route as every caller').toBe(causes.length * ROUTES.length * callers.length);
        expect(problems, 'the answers that are not the one 404 "This link is not valid." with no-store').toEqual([]);
        const differing = answers.filter((answer) => answer.text !== answers[0].text).map((answer) => answer.label);
        expect(differing, 'the answers whose body is not, byte for byte, the body of the first one').toEqual([]);
    });

    test('Access: no way in is the one 401, and nothing is written', async ({ playwright, request, baseURL }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const two = await provider2Cookie(playwright, baseURL);
        const [ann, bea, cat] = await addMembers(ctx, ['Ann', 'Bea', 'Cat']);

        // The job under test, with three on its crew; the job at whose link Cat signs in; and the job that is reassigned.
        const job = await makeJob(ctx, [ann, bea, cat]);
        const other = await makeJob(ctx, [cat]);
        const moved = await makeJob(ctx, [ann]);

        const catOther = await signInWith(ctx, other, cat);
        const annCookie = await signInWith(ctx, job, ann);
        const beaCookie = await signInWith(ctx, job, bea);
        // Cat is checked in, so that a check-out of Cat, were a caller let in, would write.
        await tickIn(ctx, job, cat);

        // Controls: the link is live, and the two cleaners' cookies work until the case ends their access.
        for (const [who, headers] of [['provider 1', ctx.as.provider], ['Ann', { cookie: annCookie }], ['Bea', { cookie: beaCookie }]]) {
            const read = await ask(ctx, TIMER_READ, job.token, headers, cat.id);
            expect([read.status, read.body?.success], `control: ${who} reads the timer of the live link`).toEqual([200, true]);
        }

        // Ann is taken off the crew through ENG-014's route, and Bea's session is set back past its 12 hours.
        await setCrew(ctx, job.bookingId, [bea.id, cat.id], 'provider 1 takes Ann off the job');
        await endSession(beaCookie);

        // The previous provider: the admin gives the job to provider 2, which clears its crew and starts it again.
        const reassigned = await ctx.request.post(`/api/bookings/${moved.bookingId}/reassign`, { headers: ctx.as.admin, data: { new_provider_id: PROVIDER2.id, old_provider_id: PROVIDER1.id }, timeout: REQUEST_TIMEOUT });
        expect([reassigned.status(), (await reassigned.json().catch(() => null))?.success], 'the admin reassigns the job to provider 2').toEqual([200, true]);
        const newProvider = await ask(ctx, TIMER_READ, moved.token, two, ann.id);
        expect([newProvider.status, newProvider.body?.success], 'control: provider 2 reads the timer of the reassigned job').toEqual([200, true]);

        const groups = [
            {
                name: 'the live link',
                job,
                callers: [
                    ['no credential', ctx.as.none],
                    ["a cleaner's cookie for another job's link", { cookie: catOther }],
                    ["that session's value under this link's cookie name", { cookie: `jls_${job.linkId}=${cookieValue(catOther)}` }],
                    ['a cleaner taken off the crew since signing in', { cookie: annCookie }],
                    ['a session set back past its 12 hours', { cookie: beaCookie }],
                    ['a customer (cookie)', ctx.as.customer],
                    ['a customer (Bearer)', ctx.as.customerBearer],
                    ['provider 2', two],
                ],
            },
            {
                name: 'the link of a reassigned job',
                job: moved,
                callers: [
                    ['the previous provider (cookie)', ctx.as.provider],
                    ['the previous provider (Bearer)', ctx.as.providerBearer],
                ],
            },
        ];

        let asked = 0;
        const problems = [];
        for (const group of groups) {
            const got = await writesNothing(group.name, group.job.bookingId, () => askAll(ctx, group.name, group.job.token, group.callers, cat.id));
            asked += got.length;
            problems.push(...wrongAnswers(got, 401, SIGN_IN));
        }

        expect(asked, 'every caller was asked on every route').toBe(groups.reduce((sum, group) => sum + group.callers.length * ROUTES.length, 0));
        expect(problems, 'the answers that are not the one 401 "Enter your code to continue." with no-store').toEqual([]);
    });

    test('Access: the provider and an admin get in, and nothing is written', async ({ playwright, request, baseURL }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const [ann, bea] = await addMembers(ctx, ['Ann', 'Bea']);
        const job = await makeJob(ctx, [ann, bea]);

        // Each call is one the job answers without changing a thing: nobody is checked in and the job has not started.
        const passes = [
            {
                name: 'GET timer',
                send: (c, token, headers) => timerRead(c, token, headers),
                status: 200,
                holds: (answer) => answer.body?.success === true && typeof answer.body?.data?.timer === 'object' && answer.body.data.timer !== null,
            },
            {
                name: 'POST timer (a pause)',
                send: (c, token, headers) => timerAct(c, token, headers, 'pause'),
                status: 409,
                holds: (answer) => answer.body?.success === false && answer.body?.reason === 'not_running',
            },
            {
                name: 'POST check-out (a cleaner who is not checked in)',
                send: (c, token, headers, memberId) => checkOutRequest(c, token, headers, memberId),
                status: 409,
                holds: (answer) => answer.body?.success === false && answer.body?.message === CHECKIN_MESSAGES.notCheckedIn,
            },
            {
                name: 'POST photos (a type and no file)',
                send: (c, token, headers) => photoRequest(c, token, headers, false),
                status: 400,
                holds: (answer) => answer.body?.success === false,
            },
        ];
        // Each with the one credential and no cleaner cookie.
        const callers = [
            ['the provider (cookie)', ctx.as.provider],
            ['the provider (Bearer)', ctx.as.providerBearer],
            ['an admin (Bearer)', ctx.as.adminBearer],
            ['an admin (cookie)', ctx.as.admin],
        ];

        const answers = await writesNothing('the provider and the admin', job.bookingId, async () => {
            const got = [];
            for (const pass of passes) {
                for (const [who, headers] of callers) {
                    got.push({ label: `${pass.name} / ${who}`, pass, ...(await ask(ctx, pass, job.token, headers, ann.id)) });
                }
            }
            return got;
        });

        expect(answers.length, 'every call was made as every caller').toBe(passes.length * callers.length);
        const problems = answers
            .filter((answer) => answer.status !== answer.pass.status || !answer.pass.holds(answer) || answer.cache !== NO_STORE)
            .map((answer) => `${answer.label}: got ${gotAs(answer)}`);
        expect(problems, 'the calls that did not get through the access check with the answer of the job, and no-store').toEqual([]);
    });
});
