// @ts-check
// ENG-019: W12 (no customer, provider, cleaner or stranger can reach another account's data or actions they are not authorized for), the cleaner's half
// on the portals. W12 is one of the contract's five hard gates (e2e/acceptance/contract.js); the gate names these cases by their title prefix, "Roles:",
// and the file's name, the describe and the title together are the baseline key.
// The cleaner is the one role of the five that no credential style of e2e/auth/credentials.js carries: a cleaner has no account, only a session at one
// job's link (the `jls_{link id}` cookie that the code sign-in sets). e2e/auth-matrix.spec.js sends every row of the route table with no credential and
// with a customer, a provider and an admin (cookie and Bearer); this file sends every row that is guarded by role with a cleaner's session, so each of
// W12's five roles has a refusal case on the portals.
//   the sweep    for each HTTP method, the `jls_` cookie of a cleaner who entered the code is sent to every `roles` row of the route table
//                (e2e/auth/route-matrix.js, imported and never edited, so the rows another ticket adds are asked from the day they merge): the
//                answer must be 401 or 403, never a 2xx or a 5xx, and a failure names the route. One case per method and not one per row, so the
//                baseline's keys do not change when the table grows. A row whose probe is held sends nothing, as in the matrix;
//   the control  before the sweep and after it the same cookie, sent the same way, reads the timer of its own job's link and is let in, so a refusal
//                is read beside an acceptance and cannot be the artefact of a cookie that never arrived or of a session that had ended;
//   the table    the sweep asks five methods; a sixth case fails when the table holds a role-guarded route of a method none of them sends.
// The route files outside src/app/api are not rows of the table (case 13 of the design): the map says who may read each, and none serves anything but
// a file anyone may fetch by design or a public index.
// The job is made the way e2e/acceptance-links.spec.js makes it (the crew through ENG-014's routes, the link through the provider's route, the booking
// in SQL: yesterday, the Morning slot), and a cleaner signs in the way that file does it (SMS is not configured in dev, so a case asks for a code
// through the route, reads code_hash in SQL and finds the six digits by hashing all 10^6 candidates). The config runs one worker, so the cases run one
// at a time and in order. The describe sweeps, before its first case, after every case and after its last, the crew members whose number is in this
// file's block (+1 403 555 0720 to 0729), the bookings whose e-mail address starts with the prefix below (their links, codes, check-ins and crew rows
// go with them), the notice rows of those bookings and the sms_budget counters of those numbers, links and members. A failure message names the
// method and the route and the status, never a cookie, a token or a code. No case sleeps and none reads a clock.
import { test, expect } from '@playwright/test';
import mysql from 'mysql2/promise';
import { getCredentialHeaders } from './auth/credentials.js';
import { matrix } from './auth/route-matrix.js';
import { RESET_RETRIES } from './support/auth.js';
import { providers } from '../database/fixtures/accounts.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';
import { sha256Hex } from '../src/lib/link-token.js';
import { budgetScope } from '../src/lib/sms-budget.js';

// Every request carries a fixture account's session header or a cleaner's cookie and a trace records request headers: tracing is off, as in
// e2e/auth-matrix.spec.js.
test.use({ trace: 'off' });

const [PROVIDER1] = providers;
const EMAIL_PREFIX = 'e2e-arl-';
// The number block of this file: the digits after '+1 403 555 0'. The probe customer's number is the last of it.
const NUMBER_FIRST = 720;
const NUMBER_LAST = 729;
const stored = (n) => `+14035550${n}`;
const typed = (n) => `+1 403 555 0${n}`;

// The address of every probe booking (Calgary).
const ADDRESS = { latitude: 51.04473, longitude: -114.07192 };

// A token, wherever it turns up in a failure message, is hidden.
const TOKEN_SHAPE = /[A-Za-z0-9_-]{43}/g;
// `next dev` compiles a route on its first request, which can take a while; the matrix allows a probe the same.
const REQUEST_TIMEOUT = 60_000;
const ROUTE_TIMEOUT = 45_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

// ---- the dev database, the way e2e/acceptance-links.spec.js reaches it ----

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

// Deletes what this file left: the sms_budget counters of its numbers, links and members, the notice rows of its bookings, the bookings of its e-mail
// prefix (links, codes, check-ins and crew rows go with them) and the crew members of its number block (their number checks go with them).
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
    return { get: through('get'), post: through('post'), put: through('put'), fetch: through('fetch') };
}

// The provider's credentials, the one this file signs in with besides the cleaner's code.
async function setup(playwright, request, baseURL) {
    const styles = await getCredentialHeaders(String(baseURL));
    return { playwright, request: guarded(request), baseURL: String(baseURL), provider: styles['provider-cookie'] };
}

// The data of an answer that succeeded. The message of a refusal is named, never the whole body (a success holds a link's path).
async function dataOf(response, status, who) {
    const body = await response.json().catch(() => null);
    expect(response.status(), `${who}: status (${body?.success === false ? body.message : 'no message'})`).toBe(status);
    expect(body?.success, `${who}: success`).toBe(true);
    return body.data;
}

// ---- the rows of a job ----

let sequence = 0;
const tag = () => `${Date.now().toString(36)}${(sequence += 1)}`;

// A booking of provider 1 that is confirmed, in Calgary, in the Morning slot of yesterday, with a position.
async function insertBooking() {
    const id = tag();
    const day = yesterday();
    const [made] = /** @type {any[]} */ (await (await db()).execute(
        `INSERT INTO bookings (booking_number, service_id, service_name, service_price, customer_first_name, customer_last_name, customer_email, customer_phone,
           job_date, job_time_slot, job_description, address_line1, city, status, payment_status, provider_id, latitude, longitude)
         VALUES (?, 1, 'Probe service', 100.00, 'E2E', 'Probe', ?, ?, ?, ?, 'ENG-019 role probe, deleted by the case', '1 Probe Street', 'Calgary', 'confirmed', 'pending', ?, ?, ?)`,
        [`E2EARL${id}`, `${EMAIL_PREFIX}${id}@example.invalid`, stored(NUMBER_LAST), day, slotLabel(day, 'Morning'), PROVIDER1.id, ADDRESS.latitude, ADDRESS.longitude]
    ));
    return Number(made.insertId);
}

// A provider adds a cleaner through ENG-014's route, with the first number of this file's block.
async function addCleaner(ctx, name) {
    const number = NUMBER_FIRST;
    const data = await dataOf(await ctx.request.post('/api/provider/crew', { headers: ctx.provider, data: { name, phone: typed(number) } }), 201, `provider 1 adds ${name}`);
    return { id: data.member.id, name, number };
}

// The proof ENG-015's number-check routes leave behind: a used row for the member and the number they have now.
async function markChecked(member) {
    const [current] = await rows('SELECT phone FROM provider_crew_members WHERE id = ?', [member.id]);
    await (await db()).execute('INSERT INTO crew_number_checks (crew_member_id, phone, code_hash, expires_at, used_at) VALUES (?, ?, ?, NOW(), NOW())', [member.id, current.phone, sha256Hex(`arl-probe:${tag()}`)]);
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

// A probe job of provider 1 with a cleaner on its crew and a link made by the provider's route.
async function makeJob(ctx, member) {
    const bookingId = await insertBooking();
    await dataOf(await ctx.request.put(`/api/provider/jobs/${bookingId}/crew`, { headers: ctx.provider, data: { crew_ids: [member.id] } }), 200, `provider 1 puts ${member.name} on job ${bookingId}`);
    const created = await dataOf(await ctx.request.post(`/api/provider/jobs/${bookingId}/job-link`, { headers: ctx.provider, data: { action: 'create' } }), 200, 'provider 1 makes the job link');
    const linkPath = created.job_link?.path;
    expect(typeof linkPath === 'string' && /^\/job\/[A-Za-z0-9_-]{43}$/.test(linkPath), 'the link has a path of 43 base64url characters').toBe(true);
    const [link] = await rows('SELECT id FROM job_links WHERE booking_id = ?', [bookingId]);
    return { bookingId, token: String(linkPath).slice('/job/'.length), linkId: link.id };
}

// ---- the sweep ----

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const guardedRows = matrix.filter((row) => row.kind === 'roles');
const refused = (status) => status === 401 || status === 403;

// The control: the cleaner's cookie, sent as the sweep sends it (a header of a context), reads the timer of its own job's link and is let in.
async function sessionIsLive(ctx, job, cookie, when) {
    const jar = await ctx.playwright.request.newContext({ baseURL: ctx.baseURL, extraHTTPHeaders: { cookie } });
    try {
        const response = await guarded(jar).get(`/api/job/${job.token}/timer`, { timeout: REQUEST_TIMEOUT });
        const body = await response.json().catch(() => null);
        expect([response.status(), body?.success], `control ${when}: the cleaner's session reads the timer of its own link`).toEqual([200, true]);
    } finally {
        await jar.dispose();
    }
}

test.describe('Role guard acceptance: a cleaner signed in at a job link', () => {
    sweepAround();

    // W12 (hard gate): the cleaner's session is sent to every role-guarded route, one case per method. Case 12 of the design.
    for (const method of METHODS) {
        test(`Roles: ${method} is refused to a cleaner's link session at every role-guarded route`, async ({ playwright, request, baseURL }, testInfo) => {
            test.setTimeout(900_000);
            const wanted = guardedRows.filter((row) => row.method === method);
            expect(wanted.length, `the route table has role-guarded ${method} routes to ask`).toBeGreaterThan(0);
            const ctx = await setup(playwright, request, baseURL);
            const ann = await addCleaner(ctx, 'Ann');
            const job = await makeJob(ctx, ann);
            const cookie = await signInWith(ctx, job, ann);
            await sessionIsLive(ctx, job, cookie, 'before the routes are asked');

            const answers = [];
            const held = [];
            const jar = await playwright.request.newContext({ baseURL: String(baseURL), extraHTTPHeaders: { cookie } });
            try {
                for (const row of wanted) {
                    // A row whose probe is held sends nothing from any caller, as in the matrix (its own case fails with the reason).
                    if (row.probe.hold) {
                        held.push(row.route);
                        continue;
                    }
                    const response = await guarded(jar).fetch(row.probe.path + (row.probe.query || ''), { method, data: row.probe.body, maxRetries: RESET_RETRIES, maxRedirects: 0, timeout: ROUTE_TIMEOUT });
                    answers.push({ route: row.route, status: response.status() });
                    await response.dispose();
                }
            } finally {
                await jar.dispose();
            }
            const tally = {};
            for (const answer of answers) tally[answer.status] = (tally[answer.status] ?? 0) + 1;
            testInfo.annotations.push({ type: 'answers', description: `${answers.length} of ${wanted.length} routes asked${held.length > 0 ? `, ${held.length} held` : ''}: ${Object.entries(tally).map(([status, count]) => `${status}=${count}`).join(' ')}` });

            // The session must still be a live one at the end: a refusal is not the effect of the requests ending it.
            await sessionIsLive(ctx, job, cookie, 'after the routes are asked');
            expect(answers.length + held.length, 'every role-guarded route of the table was asked or held').toBe(wanted.length);
            const wrong = answers.filter((answer) => !refused(answer.status));
            if (wrong.length > 0) {
                // The first wrong answer is on the first line (the console reporter prints only that line); every wrong answer has its own line below it.
                const more = wrong.length > 1 ? ` (+${wrong.length - 1} more)` : '';
                throw new Error(`${method} ${wrong[0].route} answered ${wrong[0].status} to a cleaner's link session, want 401 or 403${more}\n  ${wrong.map((answer) => `${method} ${answer.route}: got ${answer.status}`).join('\n  ')}`);
            }
        });
    }

    // The table holds no role-guarded route of a method that no case above sends. In process: no request is made.
    test('Roles: the route table has no role-guarded route of a method that no case here sends', async () => {
        const unasked = [...new Set(guardedRows.map((row) => row.method))].filter((method) => !METHODS.includes(method));
        expect(unasked, 'methods of role-guarded routes that no case of this file sends').toEqual([]);
        expect(guardedRows.length, 'the table holds role-guarded routes').toBeGreaterThan(0);
    });
});
