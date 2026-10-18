// @ts-check
// ENG-015: the job link for cleaners (/job/{token}). This file settles the link seat's rows of the design's "Cases and baseline" table
// (agents/architect/designs/ENG-015-secure-job-link-and-crew-check-in.md), at API level, through the running app and the dev database. Each title starts
// with the design's id for the case it settles, and the file's name, the describe and the title together are its baseline key:
//   AC1   the token: /job/ and 43 base64url characters; one link per booking and the same path on a second create; a second job_links row for the
//         booking (or a second row with the same token) is a duplicate-key error; two bookings, two tokens; newLinkToken() x1000 are distinct; no token
//         holds the booking number, the e-mail or the phone;
//   AC2   every dead link is ONE 404: a booking id, a booking number, a customer e-mail, a customer phone, a token nobody holds, a token reissued, a
//         token switched off, a token of a finished job, a malformed token: same status, headers and body on all four public routes, and the token
//         is judged before the body is read (a live link says 400 to a body that is not JSON, a dead one the 404);
//   AC3   what a signed-in provider sees has exactly the allow-listed keys, and no response (the visitor's, the cleaner's, the provider's, the admin's,
//         the managed views and the check-in answer) holds a value planted in customer_*, service_price, booking_number, user_id or the Stripe id;
//   AC12  switch off, reissue (compare-and-set on the generation) and create-after-off, as the provider and as the admin; the job of another provider
//         is the 404 "Job not found"; a live session dies with the switch-off and with the reissue;
//   AC13  awaiting_approval, completed, cancelled and disputed: the four public routes are the 404 and create/reissue are 409; pending, matching,
//         confirmed and in_progress: everything works;
//   AC14  after a full flow the admin GET lists link_created, code_asked, code_failed, signed_in, check_in, link_off and link_reissued with the actor's
//         kind and resolved name, the time and the check-in's coordinates, and holds no fixture number and no code.
// The code gates (AC4 to AC6), check-in (AC8 to AC11, AC15), retention and the pins are other files' cases. Here a code is only the way a cleaner gets in:
// nothing is configured to text in dev, so the case asks for a code through the route, reads code_hash in SQL and finds the six digits by hashing
// the million candidates (the hash is sha256Hex("{link_id}:{crew_member_id}:{code}")). No production code has a hook for it.
// The database is reached as e2e/provider-crew.spec.js does (mysql2/promise, assertDevTarget before it connects, assertNoRealPeople once connected). The
// cases sweep, before the first case, after every case and after the last, only the crew rows of the two fixture providers whose number is in this
// file's block (+14035550100 to +14035550119, which also covers their job rows, codes, checks and check-ins), the bookings whose e-mail starts with
// the prefix below (which covers job_links, job_link_codes, job_checkins and job_link_events), and the sms_budget rows of those numbers and links. The
// providers' own daily count is never touched. Jobs are made by the public checkout, given to provider 1 by the admin's PUT /api/bookings and crewed
// through ENG-014's routes. A secret (a token, a code, a cookie) is never put in a failure message: those comparisons are reduced to a boolean first.
import { createHash } from 'node:crypto';
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { getCredentialHeaders } from './auth/credentials.js';
import { RESET_RETRIES } from './support/auth.js';
import { providers, FIXTURE_LOGINS } from '../database/fixtures/accounts.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';
import { LINK_TOKEN_PATTERN, newLinkToken, sha256Hex } from '../src/lib/link-token.js';

// Every request carries a fixture account's session header, and a trace records request headers: tracing is off, as in e2e/provider-crew.spec.js.
test.use({ trace: 'off' });
// One case at a time, in order: the cases share two fixture providers' crews and their daily text counts.
test.describe.configure({ mode: 'serial' });

const [PROVIDER1, PROVIDER2] = providers;

const EMAIL_PREFIX = 'e2e-jl-';
const BLOCK_LO = '+14035550100';
const BLOCK_HI = '+14035550119';
const OPEN_STATUSES = ['pending', 'matching', 'confirmed', 'in_progress'];
const CLOSED_STATUSES = ['awaiting_approval', 'completed', 'cancelled', 'disputed'];
const ADDRESS = { latitude: 51.04473, longitude: -114.07192 };
const PATH_PATTERN = /^\/job\/[A-Za-z0-9_-]{43}$/;

const NOT_VALID = { success: false, message: 'This link is not valid.' };
const NO_JOB = { success: false, message: 'Job not found' };
const NO_BOOKING = { success: false, message: 'Booking not found' };
const FINISHED = { success: false, message: 'This job is finished, so its link can no longer change.' };
const CHANGED = { success: false, message: 'Someone just changed this link. Reload and try again.' };
const SIGN_IN = { success: false, message: 'Enter your code to continue.' };
const CODE_FAILED = { success: false, message: "That code didn't work. Check it and try again, or ask for a new one." };

// A fictional number of this file's block as a person types it and as the table keeps it: nn is '00' to '19' (+1 403 555 0100 to 0119).
const typed = (nn) => `+1 403 555 01${nn}`;
const stored = (nn) => `+140355501${nn}`;
// The scope of an sms_budget count (src/lib/sms-budget.js budgetScope): the SHA-256 of kind:parts, so no number is stored.
const scopeOf = (kind, ...parts) => sha256Hex([kind, ...parts].join(':'));

// ---- the database ----

// One object feeds both the guard and the connection, so the guard certifies the values that get used (as database/fixtures/load.js).
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

async function sql(statement, params = []) {
    await (await db()).execute(statement, params);
}

const setStatus = (bookingId, status) => sql('UPDATE bookings SET status = ? WHERE id = ?', [status, bookingId]);

// Deletes what this file left: the sms_budget counts of its numbers and links, the crew rows of the two fixture providers in this file's block (the rows
// that put a member on a job, its codes, number checks and check-ins go with the member) and the bookings of this file's e-mail prefix (their links, codes,
// check-ins and events go with them). The two fixture providers' own daily counts are other cases' too, and are left alone.
async function clearRows() {
    const open = await db();
    const links = await rows('SELECT l.id FROM job_links l JOIN bookings b ON b.id = l.booking_id WHERE b.customer_email LIKE ?', [`${EMAIL_PREFIX}%`]);
    const members = await rows('SELECT id FROM provider_crew_members WHERE provider_id IN (?, ?) AND phone BETWEEN ? AND ?', [PROVIDER1.id, PROVIDER2.id, BLOCK_LO, BLOCK_HI]);
    const scopes = [];
    for (let n = 0; n < 20; n += 1) scopes.push(scopeOf('number', stored(String(n).padStart(2, '0'))));
    for (const link of links) {
        scopes.push(scopeOf('ask', link.id), scopeOf('verify', link.id));
        for (const member of members) scopes.push(scopeOf('cooldown', link.id, member.id));
    }
    await open.execute(`DELETE FROM sms_budget WHERE scope IN (${scopes.map(() => '?').join(', ')})`, scopes);
    await open.execute('DELETE FROM provider_crew_members WHERE provider_id IN (?, ?) AND phone BETWEEN ? AND ?', [PROVIDER1.id, PROVIDER2.id, BLOCK_LO, BLOCK_HI]);
    await open.execute('DELETE FROM bookings WHERE customer_email LIKE ?', [`${EMAIL_PREFIX}%`]);
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

// ---- credentials and answers ----

async function credentials(baseURL) {
    const styles = await getCredentialHeaders(String(baseURL));
    return { none: {}, provider: styles['provider-cookie'], admin: styles['admin-cookie'], adminBearer: styles['admin-bearer'], customer: styles['customer-cookie'] };
}

// Signs a fixture provider in through its own login route and returns its session cookie as a request header. The token is cut out of the storage
// state and put in a header; it is never printed.
async function signedInAs(playwright, baseURL, who) {
    const login = FIXTURE_LOGINS[who];
    const context = await playwright.request.newContext({ baseURL });
    try {
        const response = await context.post(login.loginRoute, { data: { email: login.email, password: login.password }, maxRetries: RESET_RETRIES, timeout: 60_000 });
        expect(response.status(), `${who} signs in`).toBe(200);
        const held = (await context.storageState()).cookies.find((entry) => entry.name === 'provider_token');
        expect(held, `${who}'s provider_token cookie`).toBeTruthy();
        return { cookie: `provider_token=${held?.value}` };
    } finally {
        await context.dispose();
    }
}

async function answerOf(response) {
    return { status: response.status(), body: await response.json().catch(() => null), headers: response.headers() };
}

// A refusal's exact answer: its status and the whole body (a refusal holds no token).
function expectAnswer(answer, status, body, who) {
    expect(answer.status, `${who}: status`).toBe(status);
    expect(answer.body, `${who}: body`).toEqual(body);
}

// The data of an answer that succeeded. A body is only put in the message when the status is not the expected one, and then it is a refusal.
function dataOf(answer, status, who) {
    expect(answer.status, `${who}: status${answer.status === status ? '' : ` (${JSON.stringify(answer.body)?.slice(0, 200)})`}`).toBe(status);
    expect(answer.body?.success, `${who}: success`).toBe(true);
    return answer.body.data;
}

const tag = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const unique = () => Math.floor(Math.random() * 36 ** 5).toString(36).padStart(5, '0');

// ---- jobs, crews and links ----

// A guest booking made through the public checkout: pending, no provider, in the past (so a check-in window is open). Its e-mail carries this file's prefix.
async function makeBooking(request) {
    const id = tag();
    const body = {
        service_id: 1, service_name: 'Fixture Standard Clean', service_price: 80, additional_price: 40,
        first_name: 'E2E', last_name: 'Link', email: `${EMAIL_PREFIX}${id}@workontap.test`, phone: stored('19'),
        job_date: '2026-02-01', job_time_slot: '09:00', job_description: 'E2E job link probe booking, deleted by the case.',
        address_line1: '1 Probe Street', city: 'Calgary', payment_intent_id: `pi_e2e_jl_${id}`,
    };
    const created = await request.post('/api/bookings', { data: body });
    expect(created.status(), 'checkout makes the probe booking').toBe(200);
    const bookingId = (await created.json()).booking_id;
    expect(Number.isInteger(bookingId), 'the probe booking has an id').toBe(true);
    return bookingId;
}

// `count` probe bookings given to provider 1 and passed to `run` as ids; each is deleted again as admin, even when `run` fails.
async function withJobs(request, as, count, run) {
    const ids = [];
    try {
        for (let made = 0; made < count; made += 1) {
            const id = await makeBooking(request);
            ids.push(id);
            const given = await request.put(`/api/bookings?id=${id}`, { headers: as.admin, data: { provider_id: PROVIDER1.id, status: 'matching' } });
            expect(given.status(), `admin gives booking ${id} to provider 1`).toBe(200);
        }
        await run(...ids);
    } finally {
        for (const id of ids) await request.delete(`/api/bookings?id=${id}`, { headers: as.admin });
    }
}

async function addMember(request, as, name, nn) {
    const answer = await answerOf(await request.post('/api/provider/crew', { headers: as.provider, data: { name, phone: typed(nn) } }));
    const member = dataOf(answer, 201, `provider 1 adds ${name}`).member;
    expect(member.phone, `${name}'s number is kept as E.164`).toBe(stored(nn));
    return member;
}

async function putCrew(request, as, jobId, ids) {
    const answer = await answerOf(await request.put(`/api/provider/jobs/${jobId}/crew`, { headers: as.provider, data: { crew_ids: ids } }));
    dataOf(answer, 200, `provider 1 puts ${JSON.stringify(ids)} on job ${jobId}`);
}

// The provider's proof that a number is the cleaner's own (the row a number-check confirm leaves), made here so that the sign-in does not wait on a text.
const markChecked = (member) =>
    sql('INSERT INTO crew_number_checks (crew_member_id, phone, code_hash, expires_at, used_at) VALUES (?, ?, ?, NOW(), NOW())', [member.id, member.phone, '0'.repeat(64)]);

const providerLink = (jobId) => `/api/provider/jobs/${jobId}/job-link`;
const adminLink = (jobId) => `/api/admin/bookings/${jobId}/job-link`;
const tokenOf = (path) => String(path).slice('/job/'.length);

// POST { action, generation? } to a managed route.
async function act(request, headers, url, action, generation = undefined) {
    const data = generation === undefined ? { action } : { action, generation };
    return answerOf(await request.post(url, { headers, data }));
}

// The link view of a managed answer that succeeded, with the figures the case states.
function linkOf(answer, who, { on = true, generation }) {
    const link = dataOf(answer, 200, who).job_link;
    expect([link.on, link.generation], `${who}: on and generation`).toEqual([on, generation]);
    expect(on ? PATH_PATTERN.test(link.path) : link.path === null, `${who}: ${on ? 'a /job/ path of 43 base64url characters' : 'no path while the link is off'}`).toBe(true);
    return link;
}

const view = (request, token, headers = {}) => request.get(`/api/job/${token}`, { headers }).then(answerOf);

// The six digits of the newest live code of a member on a link, found by hashing every candidate against code_hash.
async function findCode(linkId, memberId) {
    const [row] = await rows('SELECT code_hash FROM job_link_codes WHERE link_id = ? AND crew_member_id = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1', [linkId, memberId]);
    expect(row, 'asking made a code row (a suppressed ask makes none: is the number checked, and the number and provider counts not used up?)').toBeTruthy();
    const wanted = Buffer.from(row.code_hash, 'hex');
    for (let n = 0; n < 1_000_000; n += 1) {
        const code = String(n).padStart(6, '0');
        if (createHash('sha256').update(`${linkId}:${memberId}:${code}`).digest().equals(wanted)) return code;
    }
    throw new Error('no six-digit code fits the stored hash');
}

// A cleaner asks for a code on a link through the route and the code is found. The minute between codes for a member on a link and the number's daily
// count are this case's own rows: they are cleared first, so a second sign-in inside a minute is not held.
async function askCode(request, bookingId, token, member) {
    const [link] = await rows('SELECT id FROM job_links WHERE booking_id = ?', [bookingId]);
    await sql('DELETE FROM sms_budget WHERE scope IN (?, ?)', [scopeOf('cooldown', link.id, member.id), scopeOf('number', member.phone)]);
    const asked = await request.post(`/api/job/${token}/code`, { data: { phone: member.phone } });
    expect(asked.status(), 'asking for a code: status').toBe(200);
    return { linkId: link.id, code: await findCode(link.id, member.id) };
}

// The verify call is made on a context of its own, so that the cookie it sets stays out of the case's own cookie jar (every other request of a case
// then carries exactly the credential the case gives it).
async function verifyOnce(playwright, baseURL, token, phone, code) {
    const context = await playwright.request.newContext({ baseURL });
    try {
        const response = await context.post(`/api/job/${token}/verify`, { data: { phone, code } });
        const cookies = response.headersArray().filter((entry) => entry.name.toLowerCase() === 'set-cookie').map((entry) => entry.value);
        return { status: response.status(), body: await response.json().catch(() => null), cookies };
    } finally {
        await context.dispose();
    }
}

// A cleaner signs in on a link: ask, find the code, give it back. Returns the request headers that carry the session, and the code.
async function signIn(request, playwright, baseURL, bookingId, token, member) {
    const { linkId, code } = await askCode(request, bookingId, token, member);
    const verified = await verifyOnce(playwright, baseURL, token, member.phone, code);
    expect(verified.status, 'signing in with the right code: status').toBe(200);
    expect(verified.body, 'signing in with the right code: body').toEqual({ success: true, data: { signed_in: true } });
    expect(verified.cookies.length, 'signing in sets one cookie').toBe(1);
    return { headers: { cookie: verified.cookies[0].split(';')[0] }, code, linkId };
}

// Every key of a JSON value, at any depth.
function keysOf(value, found = []) {
    if (Array.isArray(value)) value.forEach((entry) => keysOf(entry, found));
    else if (value && typeof value === 'object') {
        for (const [key, inner] of Object.entries(value)) {
            found.push(key);
            keysOf(inner, found);
        }
    }
    return found;
}

// ---- the cases ----

test.describe('Job link: the token, the dead link, the views, the managed routes and the record', () => {
    sweepAround();

    test('AC1: provider create on a job with two cleaners gives /job/ and 43 base64url characters, a second create gives the same path, a second job_links row (or token) is a duplicate-key error, two bookings get different tokens, 1000 newLinkToken() are distinct, and no token holds the booking number, e-mail or phone', async ({ request, baseURL }) => {
        test.setTimeout(180_000);
        const as = await credentials(baseURL);
        await withJobs(request, as, 2, async (jobA, jobB) => {
            const ann = await addMember(request, as, `Ann ${unique()}`, '00');
            const bea = await addMember(request, as, `Bea ${unique()}`, '01');
            await putCrew(request, as, jobA, [ann.id, bea.id]);
            await putCrew(request, as, jobB, [ann.id]);

            const link = linkOf(await act(request, as.provider, providerLink(jobA), 'create'), 'provider creates the link', { generation: 1 });
            expect(Object.keys(link).sort(), 'the link view has these five keys and no more').toEqual(['created_at', 'generation', 'off_at', 'on', 'path']);
            expect(link.off_at, 'a new link was never switched off').toBe(null);
            const again = linkOf(await act(request, as.provider, providerLink(jobA), 'create'), 'a second create', { generation: 1 });
            expect(again.path === link.path, 'a second create returns the same path').toBe(true);
            const byAdmin = linkOf(await act(request, as.admin, adminLink(jobA), 'create'), 'the admin creates on a link that is on', { generation: 1 });
            expect(byAdmin.path === link.path, 'the admin creating on a link that is on returns the same path').toBe(true);

            const held = await rows('SELECT token, generation, off_at, CHAR_LENGTH(token) AS length FROM job_links WHERE booking_id = ?', [jobA]);
            expect(held.length, 'one job_links row for the booking after three creates').toBe(1);
            expect(held[0].token === tokenOf(link.path), 'the row holds the token of the path').toBe(true);
            expect([held[0].length, held[0].generation, held[0].off_at], 'the row: 43 characters, generation 1, off_at NULL').toEqual([43, 1, null]);

            let duplicate = null;
            try {
                await sql('INSERT INTO job_links (booking_id, token) VALUES (?, ?)', [jobA, newLinkToken()]);
            } catch (error) {
                duplicate = error;
            }
            expect([duplicate?.code, duplicate?.errno], 'a second job_links row for the same booking is a duplicate-key error (the key is the rule, not a check)').toEqual(['ER_DUP_ENTRY', 1062]);

            const second = linkOf(await act(request, as.provider, providerLink(jobB), 'create'), 'provider creates the link on a second booking', { generation: 1 });
            expect(second.path !== link.path, 'two bookings get different tokens').toBe(true);
            let sameToken = null;
            try {
                await sql('UPDATE job_links SET token = ? WHERE booking_id = ?', [tokenOf(link.path), jobB]);
            } catch (error) {
                sameToken = error;
            }
            expect([sameToken?.code, sameToken?.errno], 'two links with one token are a duplicate-key error').toEqual(['ER_DUP_ENTRY', 1062]);
            expect((await rows('SELECT COUNT(*) AS n FROM job_links WHERE booking_id IN (?, ?)', [jobA, jobB]))[0].n, 'one row per booking after the refused writes').toBe(2);

            // 1000 tokens: 43 base64url characters, all distinct, and no token holds anything about a booking. The booking id is a small number and
            // appears in a random token by chance, so the id is covered by the shape of the minting instead: newLinkToken takes no argument.
            const minted = Array.from({ length: 1000 }, () => newLinkToken());
            expect(newLinkToken.length, 'newLinkToken takes no argument, so nothing about a booking can go into a token').toBe(0);
            expect(minted.every((token) => LINK_TOKEN_PATTERN.test(token)), '1000 newLinkToken() calls are all 43 base64url characters').toBe(true);
            expect(new Set(minted).size, '1000 newLinkToken() calls are all distinct').toBe(1000);
            const [booking] = await rows('SELECT booking_number, customer_email, customer_phone FROM bookings WHERE id = ?', [jobA]);
            const secrets = [booking.booking_number, booking.customer_email, booking.customer_email.split('@')[0], booking.customer_phone, booking.customer_phone.replace(/\D/g, ''), typed('00'), ann.phone, bea.phone];
            const forms = secrets.flatMap((secret) => [secret, Buffer.from(secret).toString('base64url'), Buffer.from(secret).toString('hex')]);
            const tokens = [tokenOf(link.path), tokenOf(second.path), ...minted];
            expect(tokens.some((token) => forms.some((form) => token.includes(form))), 'no token holds the booking number, the e-mail, the phone, a crew number, or the base64url or hex of any of them').toBe(false);
            expect(PATH_PATTERN.test(`/job/${tokenOf(link.path)}`) && String(jobA).length > 0 && !tokenOf(link.path).startsWith(String(jobA).padStart(6, '0')), 'the token does not start with the booking id written out').toBe(true);
        });
    });

    test('AC2: a booking id, a booking number, a customer e-mail, a customer phone, a token nobody holds, a reissued, a switched-off and a finished job\'s token and malformed ones are one 404 with one status, one header set and one body on all four public routes', async ({ request, baseURL }) => {
        test.setTimeout(180_000);
        const as = await credentials(baseURL);
        await withJobs(request, as, 1, async (jobId) => {
            const ann = await addMember(request, as, `Ann ${unique()}`, '02');
            await putCrew(request, as, jobId, [ann.id]);
            const [booking] = await rows('SELECT booking_number, customer_email, customer_phone FROM bookings WHERE id = ?', [jobId]);

            const location = { latitude: ADDRESS.latitude, longitude: ADDRESS.longitude, accuracy: 10 };
            const signatures = [];
            // One path, four calls: the answer of each route as status, every header but the date, and the body text.
            const probe = async (label, path, headers = {}) => {
                const calls = {
                    'GET': () => request.get(`/api/job/${path}`, { headers }),
                    'POST code': () => request.post(`/api/job/${path}/code`, { headers, data: { phone: typed('18') } }),
                    'POST verify': () => request.post(`/api/job/${path}/verify`, { headers, data: { phone: typed('18'), code: '123456' } }),
                    'POST check-in': () => request.post(`/api/job/${path}/check-in`, { headers, data: { crew_ids: [ann.id], location } }),
                };
                for (const [route, call] of Object.entries(calls)) {
                    const response = await call();
                    const responseHeaders = { ...response.headers() };
                    delete responseHeaders.date;
                    signatures.push({ what: `${label} (${route})`, status: response.status(), headers: responseHeaders, body: await response.text() });
                }
            };

            const first = linkOf(await act(request, as.provider, providerLink(jobId), 'create'), 'provider creates the link', { generation: 1 });
            const t1 = tokenOf(first.path);
            const control = await view(request, t1);
            expect(control.status, 'control: the live link answers 200').toBe(200);
            expect(control.body, 'control: a visitor is told access none and nothing else').toEqual({ success: true, data: { access: 'none' } });
            const flipped = [...t1].map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join('');
            expect(flipped !== t1, 'the case-flipped token differs from the live one').toBe(true);
            await probe('the live token with its case flipped', flipped);
            // Not JSON: a live link answers the body, a dead one is the 404 first (the token is judged before the body is read).
            // text/plain, because Playwright quotes a string it is given under a JSON content type, which would make it valid JSON.
            const notJson = { 'content-type': 'text/plain' };
            const liveBad = await request.post(`/api/job/${t1}/code`, { headers: notJson, data: 'this is not json' });
            expectAnswer(await answerOf(liveBad), 400, { success: false, message: 'Invalid request.' }, 'a live link given a body that is not JSON');
            const deadBad = await request.post(`/api/job/${newLinkToken()}/code`, { headers: notJson, data: 'this is not json' });
            expectAnswer(await answerOf(deadBad), 404, NOT_VALID, 'a dead link given a body that is not JSON');

            const reissued = linkOf(await act(request, as.provider, providerLink(jobId), 'reissue', 1), 'provider reissues', { generation: 2 });
            await probe('the token a reissue replaced', t1);
            const t2 = tokenOf(reissued.path);
            linkOf(await act(request, as.provider, providerLink(jobId), 'off'), 'provider switches off', { on: false, generation: 2 });
            await probe('a switched-off token', t2);
            const revived = linkOf(await act(request, as.provider, providerLink(jobId), 'create'), 'create after off', { generation: 3 });
            const t3 = tokenOf(revived.path);
            expect((await view(request, t3)).body?.data?.access, 'control: the new token of the revived link answers').toBe('none');
            await setStatus(jobId, 'completed');
            await probe("a finished job's token", t3);

            await probe('a booking id', String(jobId));
            await probe('a booking number', encodeURIComponent(booking.booking_number));
            await probe('a customer e-mail', encodeURIComponent(booking.customer_email));
            await probe('a customer phone', encodeURIComponent(booking.customer_phone));
            await probe('a well-formed token nobody holds', newLinkToken());
            await probe('a token one character short', t3.slice(1));
            await probe('a token one character long', `${t3}a`);
            await probe('a token with a plus in it', `${t3.slice(0, 42)}%2B`);
            await probe('a one-word path', 'abc');
            // The same dead token, asked by a caller with a real session: the answer does not change with who asks.
            const unknown = newLinkToken();
            const asAdmin = await request.get(`/api/job/${unknown}`, { headers: as.admin });
            const asProvider = await request.get(`/api/job/${unknown}`, { headers: as.provider });
            for (const [who, response] of [['an admin', asAdmin], ['the provider', asProvider]]) {
                const responseHeaders = { ...response.headers() };
                delete responseHeaders.date;
                signatures.push({ what: `a token nobody holds, asked by ${who}`, status: response.status(), headers: responseHeaders, body: await response.text() });
            }

            expect(signatures.length, 'every dead path was asked on all four routes').toBeGreaterThanOrEqual(13 * 4 + 2);
            const reference = signatures[0];
            expect(reference.status, 'the 404 is a 404').toBe(404);
            expect(JSON.parse(reference.body), 'the 404 body is the one sentence').toEqual(NOT_VALID);
            expect(reference.headers['cache-control'], 'the 404 says no-store').toBe('no-store');
            const differing = signatures.filter((entry) => JSON.stringify([entry.status, entry.headers, entry.body]) !== JSON.stringify([reference.status, reference.headers, reference.body])).map((entry) => entry.what);
            expect(differing, 'the dead links whose status, headers or body differ from the first 404').toEqual([]);
        });
    });

    test('AC3: a signed-in provider\'s view has exactly the allow-listed keys, and no response (visitor, cleaner, provider, admin, managed views, check-in) holds a value planted in customer_*, service_price, booking_number, user_id or the Stripe id', async ({ request, playwright, baseURL }) => {
        test.setTimeout(180_000);
        const as = await credentials(baseURL);
        await withJobs(request, as, 1, async (jobId) => {
            const ann = await addMember(request, as, `Ann ${unique()}`, '03');
            const bea = await addMember(request, as, `Bea ${unique()}`, '04');
            await putCrew(request, as, jobId, [ann.id, bea.id]);
            await markChecked(ann);
            const u = unique();
            const planted = {
                first: `Zelda${u}`, last: `Zoller${u}`, email: `${EMAIL_PREFIX}planted-${u}@workontap.test`, phone: stored('19'), price: '4321.09',
                number: `E2EJL-PLANTED-${u}`, stripe: `cus_e2ejl${u}`,
            };
            await sql(
                'UPDATE bookings SET customer_first_name = ?, customer_last_name = ?, customer_email = ?, customer_phone = ?, service_price = ?, booking_number = ?, user_id = ?, stripe_customer_id = ? WHERE id = ?',
                [planted.first, planted.last, planted.email, planted.phone, planted.price, planted.number, 2, planted.stripe, jobId]
            );
            // What a join to the booking's customer would bring in, besides the planted values: user 2 is the user_id planted.
            const [owner] = await rows('SELECT first_name, last_name, email, phone FROM users WHERE id = ?', [2]);
            const forbidden = [
                planted.first, planted.last, planted.email, `planted-${u}`, planted.phone, planted.phone.slice(2), planted.price, planted.number, planted.stripe,
                owner.email, owner.last_name, `${owner.first_name} ${owner.last_name}`, owner.phone, String(owner.phone).slice(2),
            ];

            /** @type {string[]} */
            const seen = [];
            /** @type {Record<string, any>} */
            const views = {};
            const take = async (response) => {
                const text = await response.text();
                seen.push(text);
                return { status: response.status(), text, body: text ? JSON.parse(text) : null };
            };

            const created = await take(await request.post(providerLink(jobId), { headers: as.provider, data: { action: 'create' } }));
            expect(created.status, 'provider creates the link').toBe(200);
            const token = tokenOf(created.body.data.job_link.path);

            const visitor = await take(await request.get(`/api/job/${token}`));
            expect(visitor.status, 'the visitor GET answers').toBe(200);
            expect(visitor.body, 'the visitor is told access none and nothing else').toEqual({ success: true, data: { access: 'none' } });

            const session = await signIn(request, playwright, baseURL, jobId, token, ann);
            views.cleaner = await take(await request.get(`/api/job/${token}`, { headers: session.headers }));
            views.provider = await take(await request.get(`/api/job/${token}`, { headers: as.provider }));
            views.adminCookie = await take(await request.get(`/api/job/${token}`, { headers: as.admin }));
            views.adminBearer = await take(await request.get(`/api/job/${token}`, { headers: as.adminBearer }));
            const expectedAccess = { cleaner: 'cleaner', provider: 'provider', adminCookie: 'admin', adminBearer: 'admin' };
            const allowed = {
                top: ['access', 'crew', 'job', 'photo_can', 'photos', 'report_can', 'reports', 'timer', 'window', 'you'],
                you: ['kind', 'name'],
                job: ['address', 'days', 'details', 'service_name'],
                address: ['city', 'line1', 'line2', 'postal_code'],
                details: ['description', 'elevator', 'instructions', 'parking', 'pets', 'timing_note', 'worker_count'],
                crew: ['checked_in', 'checked_in_at', 'checked_out_at', 'id', 'name'],
                window: ['open', 'opens_at', 'opens_label', 'time_zone'],
            };
            for (const [who, answer] of Object.entries(views)) {
                expect(answer.status, `${who}: the view answers 200`).toBe(200);
                const data = answer.body.data;
                expect(data.access, `${who}: access`).toBe(expectedAccess[who]);
                expect(Object.keys(data).sort(), `${who}: the view has exactly the allow-listed top-level keys`).toEqual(allowed.top);
                expect(Object.keys(data.you).sort(), `${who}: you`).toEqual(allowed.you);
                expect(Object.keys(data.job).sort(), `${who}: job`).toEqual(allowed.job);
                expect(Object.keys(data.job.address).sort(), `${who}: job.address`).toEqual(allowed.address);
                expect(Object.keys(data.job.details).sort(), `${who}: job.details`).toEqual(allowed.details);
                expect(data.crew.length, `${who}: both cleaners are on the crew`).toBe(2);
                for (const member of data.crew) expect(Object.keys(member).sort(), `${who}: a crew entry is id, name and the tick, no number`).toEqual(allowed.crew);
                expect(Object.keys(data.window).sort(), `${who}: window`).toEqual(allowed.window);
                expect(data.job.address.line1, `${who}: the street`).toBe('1 Probe Street');
                expect(data.job.address.city, `${who}: the city`).toBe('Calgary');
                expect(String(data.job.details.description).includes('E2E job link probe booking'), `${who}: the description`).toBe(true);
                expect(Array.isArray(data.job.days) && data.job.days.every((day) => typeof day === 'string'), `${who}: days are text`).toBe(true);
            }
            expect(views.provider.body.data.you, 'the provider is shown their own name').toEqual({ kind: 'provider', name: 'Fixture Provider One' });
            expect(views.cleaner.body.data.you.name === ann.name, 'the cleaner is shown their own name').toBe(true);

            // The managed views and the check-in answer are responses too.
            const managedProvider = await take(await request.get(providerLink(jobId), { headers: as.provider }));
            const managedAdmin = await take(await request.get(adminLink(jobId), { headers: as.admin }));
            expect([managedProvider.status, managedAdmin.status], 'the managed views answer').toEqual([200, 200]);
            const ticked = await take(await request.post(`/api/job/${token}/check-in`, { headers: session.headers, data: { crew_ids: [ann.id], location: { ...ADDRESS, accuracy: 8 } } }));
            expect(ticked.status, 'a check-in answers (the window is open for a job in the past)').toBe(200);
            const afterTick = await take(await request.get(`/api/job/${token}`, { headers: session.headers }));
            expect(afterTick.body.data.crew.find((member) => member.id === ann.id)?.checked_in, 'the page shows the tick').toBe(true);

            expect(seen.length, 'every response was kept to be scanned').toBeGreaterThanOrEqual(10);
            for (const text of seen) {
                const held = forbidden.filter((value) => text.includes(value));
                expect(held.length, 'a planted customer, price, booking-number, user or Stripe value appears in a response').toBe(0);
                const badKeys = keysOf(JSON.parse(text)).filter((key) => /customer|user_id|price|amount|commission|payment|stripe|booking_number|e_?mail/i.test(key));
                expect(badKeys, 'a key of a response names the customer, a price, a payment or the booking number').toEqual([]);
                expect(/403[\s().-]*555[\s.-]*01\d\d/.test(text), 'no crew number or customer number is in any response').toBe(false);
            }
            // The page is the only thing a cleaner sees; the cleaner's own session never carried a number back either.
            expect(session.code.length, 'control: the code was found').toBe(6);
            // The link's own token is cut out first: a random 43-character token holds any six digits by chance now and then.
            expect(seen.some((text) => text.split(token).join('').includes(session.code)), 'no response holds the code').toBe(false);
        });
    });

    test('AC12: switch-off ends a link and its sessions at once and twice is 200; reissue needs the current generation (409 otherwise) and kills the old path and sessions; create after off reissues; another provider\'s job is "Job not found"; an admin can do each', async ({ request, playwright, baseURL }) => {
        test.setTimeout(180_000);
        const as = await credentials(baseURL);
        const provider2 = await signedInAs(playwright, baseURL, 'provider2');
        await withJobs(request, as, 1, async (jobId) => {
            const ann = await addMember(request, as, `Ann ${unique()}`, '05');
            const bea = await addMember(request, as, `Bea ${unique()}`, '06');
            await putCrew(request, as, jobId, [ann.id, bea.id]);
            await markChecked(ann);
            await markChecked(bea);
            const url = providerLink(jobId);
            const rowNow = async () => (await rows('SELECT token, generation, off_at FROM job_links WHERE booking_id = ?', [jobId]))[0];

            const link1 = linkOf(await act(request, as.provider, url, 'create'), 'provider creates', { generation: 1 });
            const t1 = tokenOf(link1.path);
            const sessionAnn = await signIn(request, playwright, baseURL, jobId, t1, ann);
            expect((await view(request, t1, sessionAnn.headers)).body?.data?.access, 'control: the cleaner is in on the first token').toBe('cleaner');

            // Another provider's job is the 404 of its kind, for every method and action, and nothing changes.
            expectAnswer(await answerOf(await request.get(url, { headers: provider2 })), 404, NO_JOB, 'provider 2 reads the link of provider 1\'s job');
            for (const [action, generation] of [['create', undefined], ['off', undefined], ['reissue', 1]]) {
                expectAnswer(await act(request, provider2, url, action, generation), 404, NO_JOB, `provider 2 ${action}s the link of provider 1's job`);
            }
            expectAnswer(await answerOf(await request.get(providerLink(999999999), { headers: as.provider })), 404, NO_JOB, 'provider 1 reads the link of a job nobody has');
            const untouched = await rowNow();
            expect([untouched.token === t1, untouched.generation, untouched.off_at], "provider 2's attempts changed nothing").toEqual([true, 1, null]);

            // Reissue is a compare-and-set on the generation.
            for (const [what, generation] of [['a stale generation', 7], ['no generation', undefined], ['a string', '1'], ['null', null]]) {
                expectAnswer(await act(request, as.provider, url, 'reissue', generation), 409, CHANGED, `reissue with ${what}`);
            }
            const afterWrong = await rowNow();
            expect([afterWrong.token === t1, afterWrong.generation], 'the wrong generations changed nothing').toEqual([true, 1]);
            expect((await view(request, t1, sessionAnn.headers)).body?.data?.access, 'the session still holds after the refused reissues').toBe('cleaner');

            const link2 = linkOf(await act(request, as.provider, url, 'reissue', 1), 'reissue with the right generation', { generation: 2 });
            const t2 = tokenOf(link2.path);
            expect(t2 !== t1, 'a reissue makes a new token').toBe(true);
            expect((await view(request, t2)).body?.data, 'the new path works: a visitor is told access none').toEqual({ access: 'none' });
            expectAnswer(await view(request, t1), 404, NOT_VALID, 'the old path after a reissue');
            expectAnswer(await view(request, t1, sessionAnn.headers), 404, NOT_VALID, 'the old path after a reissue, with the old session');
            expect((await view(request, t2, sessionAnn.headers)).body?.data, 'the old session on the new token is access none').toEqual({ access: 'none' });

            // A second cleaner signs in on the new token; the switch-off ends the link and the session at once.
            const sessionBea = await signIn(request, playwright, baseURL, jobId, t2, bea);
            expect((await view(request, t2, sessionBea.headers)).body?.data?.access, 'control: the second cleaner is in on the new token').toBe('cleaner');
            const off1 = linkOf(await act(request, as.provider, url, 'off'), 'provider switches off', { on: false, generation: 2 });
            expect(off1.off_at !== null, 'a switched-off link says when').toBe(true);
            expectAnswer(await view(request, t2), 404, NOT_VALID, 'the public GET of a switched-off link');
            expectAnswer(await view(request, t2, sessionBea.headers), 404, NOT_VALID, 'a live session on a switched-off link');
            const askOff = await request.post(`/api/job/${t2}/code`, { data: { phone: bea.phone } });
            expectAnswer(await answerOf(askOff), 404, NOT_VALID, 'asking for a code on a switched-off link');
            const off2 = linkOf(await act(request, as.provider, url, 'off'), 'a second switch-off is 200', { on: false, generation: 2 });
            expect(off2.off_at, 'a second switch-off changes nothing').toBe(off1.off_at);
            const managedOff = dataOf(await answerOf(await request.get(url, { headers: as.provider })), 200, 'provider reads an off link');
            expect([managedOff.job_link.on, managedOff.job_link.path], 'the managed view of an off link: off and no path').toEqual([false, null]);

            // The admin can do each, on this provider's job.
            const adminRead = dataOf(await answerOf(await request.get(adminLink(jobId), { headers: as.admin })), 200, 'admin reads');
            expect(adminRead.job_link.on, 'admin reads an off link').toBe(false);
            const link3 = linkOf(await act(request, as.admin, adminLink(jobId), 'create'), 'admin create on an off link reissues it', { generation: 3 });
            const t3 = tokenOf(link3.path);
            expect([t3 !== t2, t3 !== t1], 'create on an off link is a new token').toEqual([true, true]);
            const link3again = linkOf(await act(request, as.admin, adminLink(jobId), 'create'), 'admin create again', { generation: 3 });
            expect(link3again.path === link3.path, 'create is idempotent for the admin too').toBe(true);
            expect((await view(request, t3, sessionBea.headers)).body?.data, 'a session of an earlier generation is access none on the new token').toEqual({ access: 'none' });
            expectAnswer(await act(request, as.admin, adminLink(jobId), 'reissue', 2), 409, CHANGED, 'admin reissue with a stale generation');
            const link4 = linkOf(await act(request, as.admin, adminLink(jobId), 'reissue', 3), 'admin reissue with the right generation', { generation: 4 });
            const t4 = tokenOf(link4.path);
            expectAnswer(await view(request, t3), 404, NOT_VALID, 'the token the admin replaced');
            expect((await view(request, t4)).body?.data, 'the admin-issued token works').toEqual({ access: 'none' });
            linkOf(await act(request, as.admin, adminLink(jobId), 'off'), 'admin switches off', { on: false, generation: 4 });
            linkOf(await act(request, as.admin, adminLink(jobId), 'off'), 'admin switches off twice', { on: false, generation: 4 });
            expectAnswer(await view(request, t4), 404, NOT_VALID, 'the token the admin switched off');
            const link5 = linkOf(await act(request, as.admin, adminLink(jobId), 'reissue', 4), 'admin reissue of an off link turns it on', { generation: 5 });
            expect((await view(request, tokenOf(link5.path))).body?.data?.access, 'the link the admin brought back works').toBe('none');
            expectAnswer(await answerOf(await request.get(adminLink(999999999), { headers: as.admin })), 404, NO_BOOKING, 'admin reads a booking nobody has');
            expectAnswer(await act(request, as.admin, adminLink(999999999), 'create'), 404, NO_BOOKING, 'admin creates for a booking nobody has');
        });
    });

    test('AC13: awaiting_approval, completed, cancelled and disputed make the four public routes the 404 and create/reissue a 409; pending, matching, confirmed and in_progress let everything work', async ({ request, baseURL }) => {
        test.setTimeout(180_000);
        const as = await credentials(baseURL);
        await withJobs(request, as, 1, async (jobId) => {
            const ann = await addMember(request, as, `Ann ${unique()}`, '07');
            await putCrew(request, as, jobId, [ann.id]);
            const url = providerLink(jobId);
            let link = linkOf(await act(request, as.provider, url, 'create'), 'provider creates', { generation: 1 });
            const location = { ...ADDRESS, accuracy: 10 };
            const rowNow = async () => (await rows('SELECT token, generation, off_at FROM job_links WHERE booking_id = ?', [jobId]))[0];

            for (const status of OPEN_STATUSES) {
                await setStatus(jobId, status);
                const token = tokenOf(link.path);
                expect((await view(request, token)).body, `${status}: the public GET works`).toEqual({ success: true, data: { access: 'none' } });
                expect((await view(request, token, as.provider)).body?.data?.access, `${status}: the provider sees the job`).toBe('provider');
                const asked = await answerOf(await request.post(`/api/job/${token}/code`, { data: { phone: typed('18') } }));
                expectAnswer(asked, 200, { success: true, data: { requested: true } }, `${status}: POST code`);
                const verify = await answerOf(await request.post(`/api/job/${token}/verify`, { data: { phone: typed('18'), code: '123456' } }));
                expectAnswer(verify, 400, CODE_FAILED, `${status}: POST verify`);
                const checkIn = await answerOf(await request.post(`/api/job/${token}/check-in`, { data: { crew_ids: [ann.id], location } }));
                expectAnswer(checkIn, 401, SIGN_IN, `${status}: POST check-in without a session`);
                const providerCreate = linkOf(await act(request, as.provider, url, 'create'), `${status}: provider create`, { generation: link.generation });
                expect(providerCreate.path === link.path, `${status}: create returns the link as it is`).toBe(true);
                const adminCreate = linkOf(await act(request, as.admin, adminLink(jobId), 'create'), `${status}: admin create`, { generation: link.generation });
                expect(adminCreate.path === link.path, `${status}: the admin's create returns the link as it is`).toBe(true);
                const next = linkOf(await act(request, as.provider, url, 'reissue', link.generation), `${status}: provider reissue`, { generation: link.generation + 1 });
                expect(next.path !== link.path, `${status}: reissue makes a new path`).toBe(true);
                expect((await view(request, tokenOf(next.path))).body?.data?.access, `${status}: the reissued link works`).toBe('none');
                link = next;
            }

            for (const status of CLOSED_STATUSES) {
                await setStatus(jobId, status);
                const token = tokenOf(link.path);
                const before = await rowNow();
                for (const [who, headers] of [['a visitor', {}], ['the provider', as.provider], ['an admin', as.admin]]) {
                    expectAnswer(await view(request, token, headers), 404, NOT_VALID, `${status}: GET, ${who}`);
                    expectAnswer(await answerOf(await request.post(`/api/job/${token}/code`, { headers, data: { phone: typed('18') } })), 404, NOT_VALID, `${status}: POST code, ${who}`);
                    expectAnswer(await answerOf(await request.post(`/api/job/${token}/verify`, { headers, data: { phone: typed('18'), code: '123456' } })), 404, NOT_VALID, `${status}: POST verify, ${who}`);
                    expectAnswer(await answerOf(await request.post(`/api/job/${token}/check-in`, { headers, data: { crew_ids: [ann.id], location } })), 404, NOT_VALID, `${status}: POST check-in, ${who}`);
                }
                expectAnswer(await act(request, as.provider, url, 'create'), 409, FINISHED, `${status}: provider create`);
                expectAnswer(await act(request, as.provider, url, 'reissue', link.generation), 409, FINISHED, `${status}: provider reissue`);
                expectAnswer(await act(request, as.admin, adminLink(jobId), 'create'), 409, FINISHED, `${status}: admin create`);
                expectAnswer(await act(request, as.admin, adminLink(jobId), 'reissue', link.generation), 409, FINISHED, `${status}: admin reissue`);
                const managed = dataOf(await answerOf(await request.get(url, { headers: as.provider })), 200, `${status}: the provider can still read the panel`);
                expect([managed.status_open, managed.job_link.on], `${status}: the panel says the job is closed and the link row is still on`).toEqual([false, true]);
                const after = await rowNow();
                expect([after.token === before.token, after.generation, after.off_at], `${status}: the refused writes changed nothing`).toEqual([true, before.generation, null]);
            }

            // Switching off is the one change a finished job still allows.
            const closedOff = linkOf(await act(request, as.provider, url, 'off'), 'provider switches off a finished job\'s link', { on: false, generation: link.generation });
            expect(closedOff.off_at !== null, 'the switch-off on a finished job is recorded').toBe(true);
        });
    });

    test('AC14: after a full flow the admin GET lists link_created, code_asked, code_failed, signed_in, check_in, link_off and link_reissued with the actor kind and resolved name, the time and the check-in coordinates, and holds no fixture number and no code', async ({ request, playwright, baseURL }) => {
        test.setTimeout(180_000);
        const as = await credentials(baseURL);
        await withJobs(request, as, 1, async (jobId) => {
            const ann = await addMember(request, as, `Ann ${unique()}`, '10');
            const bea = await addMember(request, as, `Bea ${unique()}`, '11');
            await putCrew(request, as, jobId, [ann.id, bea.id]);
            await markChecked(ann);
            await sql('UPDATE bookings SET latitude = ?, longitude = ? WHERE id = ?', [ADDRESS.latitude, ADDRESS.longitude, jobId]);

            const created = linkOf(await act(request, as.provider, providerLink(jobId), 'create'), 'provider creates', { generation: 1 });
            const token = tokenOf(created.path);
            const { linkId, code } = await askCode(request, jobId, token, ann);
            const wrong = code === '000001' ? '000002' : '000001';
            const refused = await verifyOnce(playwright, baseURL, token, ann.phone, wrong);
            expect([refused.status, refused.body, refused.cookies.length], 'a wrong code is 400 with the one sentence and no cookie').toEqual([400, CODE_FAILED, 0]);
            const signed = await verifyOnce(playwright, baseURL, token, ann.phone, code);
            expect([signed.status, signed.body, signed.cookies.length], 'the right code signs in with one cookie').toEqual([200, { success: true, data: { signed_in: true } }, 1]);
            const headers = { cookie: signed.cookies[0].split(';')[0] };
            expect(linkId > 0, 'control: the link row id is known').toBe(true);

            const location = { ...ADDRESS, accuracy: 12 };
            const ticked = dataOf(await answerOf(await request.post(`/api/job/${token}/check-in`, { headers, data: { crew_ids: [ann.id], location } })), 200, 'the cleaner checks in at the address');
            expect([ticked.checked_in, ticked.already, ticked.away], 'the tick: Ann in, nobody already, not away').toEqual([[ann.id], [], false]);

            linkOf(await act(request, as.provider, providerLink(jobId), 'off'), 'provider switches off', { on: false, generation: 1 });
            const reissued = linkOf(await act(request, as.admin, adminLink(jobId), 'reissue', 1), 'admin reissues', { generation: 2 });

            const providerPanel = dataOf(await answerOf(await request.get(providerLink(jobId), { headers: as.provider })), 200, 'provider reads the panel');
            expect(Object.keys(providerPanel).sort(), "the provider's panel carries no events and no check-in list").toEqual(['crew', 'job_link', 'photos', 'reports', 'status_open', 'timer', 'window']);

            const response = await request.get(adminLink(jobId), { headers: as.admin });
            const text = await response.text();
            expect(response.status(), 'the admin GET answers').toBe(200);
            const data = JSON.parse(text).data;
            expect(Object.keys(data).sort(), 'the admin view adds the check-ins and the events').toEqual(['checkins', 'crew', 'events', 'job_link', 'photos', 'reports', 'status_open', 'timer', 'window']);
            expect([data.job_link.on, data.job_link.generation, data.job_link.path === reissued.path, data.status_open, data.window.open], 'the link is the reissued one, on, generation 2, and the window is open').toEqual([true, 2, true, true, true]);

            const events = data.events;
            expect(events.map((event) => event.kind), 'the events, newest first, are exactly the flow').toEqual(['link_reissued', 'link_off', 'check_in', 'signed_in', 'code_failed', 'code_asked', 'link_created']);
            const ofKind = (kind) => events.find((event) => event.kind === kind);
            const expectedActors = {
                link_created: ['provider', 'Fixture Provider One', null],
                code_asked: ['visitor', null, ann.name],
                code_failed: ['visitor', null, ann.name],
                signed_in: ['cleaner', ann.name, ann.name],
                check_in: ['cleaner', ann.name, ann.name],
                link_off: ['provider', 'Fixture Provider One', null],
                link_reissued: ['admin', 'Fixture Admin', null],
            };
            for (const [kind, [actorKind, actorName, subject]] of Object.entries(expectedActors)) {
                const event = ofKind(kind);
                expect([event.actor.kind, event.actor.name, event.subject], `${kind}: actor kind, resolved name and the person it is about`).toEqual([actorKind, actorName, subject]);
                expect(Math.abs(Date.parse(event.created_at) - Date.now()) < 5 * 60_000, `${kind}: created_at is a time of the last few minutes`).toBe(true);
                expect(Object.keys(event).sort(), `${kind}: the keys of an event`).toEqual(['accuracy_m', 'actor', 'created_at', 'detail', 'id', 'kind', 'latitude', 'longitude', 'subject']);
            }
            expect(['sent', 'not_sent'].includes(ofKind('code_asked').detail), 'code_asked says whether the text went (nothing is configured to send in dev)').toBe(true);
            const tick = ofKind('check_in');
            expect([tick.latitude, tick.longitude, tick.accuracy_m], 'check_in carries the phone\'s coordinates and accuracy').toEqual([ADDRESS.latitude, ADDRESS.longitude, 12]);
            for (const kind of ['link_created', 'code_asked', 'code_failed', 'signed_in', 'link_off', 'link_reissued']) {
                expect([ofKind(kind).latitude, ofKind(kind).longitude, ofKind(kind).accuracy_m], `${kind}: no coordinates`).toEqual([null, null, null]);
            }

            expect(data.checkins.length, 'one check-in counts').toBe(1);
            const [checkin] = data.checkins;
            expect([checkin.crew_member_id, checkin.name, checkin.by, checkin.away, checkin.distance_m, checkin.accuracy_m], 'the check-in: who, by whom, not away, at the address, with the accuracy').toEqual([ann.id, ann.name, { kind: 'cleaner', name: ann.name }, false, 0, 12]);
            expect(Math.abs(Date.parse(checkin.checked_in_at) - Date.now()) < 5 * 60_000, 'the check-in has its time').toBe(true);
            const crew = Object.fromEntries(data.crew.map((member) => [member.id, [member.checked_in, member.number_state]]));
            expect(crew, 'the crew: Ann ticked and checked, Bea neither').toEqual({ [ann.id]: [true, 'checked'], [bea.id]: [false, 'unchecked'] });

            // No fixture number in any form, and no code, the wrong one included, anywhere in the answer.
            expect(/403[\s().-]*555[\s.-]*01\d\d/.test(text), 'no fixture phone number, in any form, is in the admin answer').toBe(false);
            expect([ann.phone, bea.phone, typed('10'), typed('11')].some((value) => text.includes(value)), 'no crew number as stored or typed is in the admin answer').toBe(false);
            // The reissued path is cut out first, as in AC3: a random token holds any six digits by chance now and then.
            const bare = text.split(tokenOf(reissued.path)).join('');
            expect([code, wrong].some((value) => bare.includes(value)), 'neither the code nor the wrong code is in the admin answer').toBe(false);
            expect(/code_hash|session_hash/.test(text), 'no hash column is in the admin answer').toBe(false);
        });
    });
});
