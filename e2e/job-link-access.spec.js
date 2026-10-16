// @ts-check
// ENG-015: who a job link lets in. The server cases of the design's "Cases and baseline" table
// (agents/architect/designs/ENG-015-secure-job-link-and-crew-check-in.md) for the sign-in code, the session cookie and the three kinds of access,
// all through the routes (API level, no browser). Each title starts with the design's id for the case it settles, and the file's name, the
// describe and the title together are its baseline key:
//   AC4  (hard gate) a checked cleaner asks for a code with the number typed four ways (10 digits, 1 and 10, +1 and 10, with punctuation): 200
//        each, the code is found from the hash and signs in; a wrong code is 400 and sets no cookie; no code, an empty one, letters, five digits
//        and a number type are 400; the right code is 200 with an HttpOnly, SameSite=Lax, Path=/, Max-Age=43200 cookie and the view says
//        cleaner; the same code again is 400; five wrong tries and then the right one is 400; an expired code (set back in SQL) is 400; member
//        A's code with member B's number is 400 and each right pair still signs in; an UNCHECKED member's number, a removed member's and a
//        number on no crew get the same 200, make no code row and spend nothing from the number's budget (no send);
//   AC5  (hard gate) the token without the cookie is access 'none' with no job field in the body; the cookie of one link on another link, a
//        random 43 character cookie and a malformed one are none; a session set back in SQL past its 12 hours is none on the page and the 401 on
//        a check-in, and a new code makes a new session; after a reissue the old cookie on the NEW token is none (and the old code does not
//        sign in); after a member's number is corrected, after the member is removed and after the job is reassigned the old cookie is none;
//        after an admin restart the job has no provider and its link is the one 404 on all four public routes, for a visitor, the old cookie and
//        an admin, and once the job is crewed again the old cookie is none; a removed and re-added member needs a new code (ENG-014's routes
//        make every crew change);
//   AC6  (hard gate) the job's provider (cookie and Bearer) is 'provider' and an admin (Bearer, cookie, both) is 'admin', with no code asked; a
//        customer, provider 2, an anonymous caller and the previous provider after a reassign are none; a wrong provider's cookie PLUS an
//        admin's Bearer is admin (the two-call order);
//   Condition 3  the number check through the routes: a check with the right code makes GET /api/provider/crew/numbers say checked, a wrong code
//        is 400, an expired or used-up one is 409, correcting the number through ENG-014's PATCH makes it unchecked again, and another
//        provider's member is the 404 of its kind;
//   Condition 4  (route level) the per-link ask cap answers 429 at the 21st ask and counts numbers that match nobody and unreadable ones too;
//        30 parallel asks for one checked member on one link leave exactly one code row and spend exactly one from the number's budget.
// A route case cannot read a text (no texting service is configured in dev): it asks for a code through the route, reads code_hash in SQL and
// finds the six digits by hashing the 10^6 candidates with sha256Hex of src/lib/link-token.js. "No send" is seen in the budget: the number's
// counter is spent only on the step just before the text, so an unchecked number leaves no counter row.
// The database is the dev database the way e2e/provider-crew.spec.js reaches it (mysql2/promise, assertDevTarget before it connects,
// assertNoRealPeople once connected). Every case uses numbers of this file's block, +1 403 555 0120 to 0139 (0139 is the probe customer's), and
// the e-mail prefix below; the sweep before the first case, after every case and after the last removes only the crew members of that block, the
// bookings of that prefix (their links, codes, sessions, events and crew rows go with them) and the sms_budget counters of those links, members and
// numbers. Jobs are made by the public checkout, given to provider 1 by the admin's PUT /api/bookings, and crewed through ENG-014's routes.
// Every request is made on a context of its own, so no cookie jar carries a session from one call to the next; a failure message names the case,
// the status and the figures, never a token, a code or a cookie.
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { getCredentialHeaders } from './auth/credentials.js';
import { RESET_RETRIES } from './support/auth.js';
import { providers, FIXTURE_LOGINS } from '../database/fixtures/accounts.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';
import { LINK_TOKEN_PATTERN, newLinkToken, sha256Hex } from '../src/lib/link-token.js';
import { budgetScope } from '../src/lib/sms-budget.js';

// Every request carries a fixture account's session header and a trace records request headers: tracing is off, as in e2e/provider-crew.spec.js.
test.use({ trace: 'off' });
// The cases share nothing but the two fixture providers and run one after another in this file's one worker (playwright.config.js). They are not a
// serial chain: a case that fails leaves the others to run, because each one makes its own job and crew and the sweep after it removes them.

const [PROVIDER1, PROVIDER2] = providers;
const EMAIL_PREFIX = 'e2e-ja-';
const FIRST = 120;
const LAST = 139;
const stored = (last3) => `+14035550${last3}`;
const typed = (last3) => `+1 403 555 0${last3}`;
const BLOCK_LOW = stored(String(FIRST));
const BLOCK_HIGH = stored(String(LAST));

const FAILED = { success: false, message: "That code didn't work. Check it and try again, or ask for a new one." };
const REQUESTED = { success: true, data: { requested: true } };
const LIMITED = { success: false, message: 'Too many requests on this link. Try again in a while.' };
const BLANK = 'Enter your mobile number.';
const NONE = { success: true, data: { access: 'none' } };
const NOT_VALID = { success: false, message: 'This link is not valid.' };
const SIGN_IN = { success: false, message: 'Enter your code to continue.' };
const HERE = { latitude: 51.0447, longitude: -114.0719, accuracy: 10 };
const NO_MEMBER = { success: false, message: 'Crew member not found' };
const NOT_RIGHT = { success: false, message: 'That code is not right.' };
const USED_UP = { success: false, message: 'That code has expired or been used up. Ask for a new one.' };
const WAIT = { success: false, message: 'Wait a minute before asking again.' };
const TOKEN_SHAPE = /[A-Za-z0-9_-]{43}/g;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- the dev database, as e2e/provider-crew.spec.js reaches it ----

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

// What the cases made, so the sweep can drop the counters of a link or a member whose rows are already gone.
const seen = { links: new Set(), members: new Set() };

async function forget(...scopes) {
    const open = await db();
    for (const scope of scopes) await open.execute('DELETE FROM sms_budget WHERE scope = ?', [scope]);
}

// Deletes what this file left: the counters of its links, members and numbers (and the two fixture providers' daily counters, which it may delete
// and never raises), then the bookings of its prefix, then the crew members of its block.
async function sweepOnce() {
    const open = await db();
    const links = await rows('SELECT l.id FROM job_links l JOIN bookings b ON b.id = l.booking_id WHERE b.customer_email LIKE ?', [`${EMAIL_PREFIX}%`]);
    const members = await rows('SELECT id FROM provider_crew_members WHERE provider_id IN (?, ?) AND phone BETWEEN ? AND ?', [PROVIDER1.id, PROVIDER2.id, BLOCK_LOW, BLOCK_HIGH]);
    const linkIds = new Set([...links.map((row) => row.id), ...seen.links]);
    const memberIds = new Set([...members.map((row) => row.id), ...seen.members]);
    const scopes = [budgetScope('provider', PROVIDER1.id), budgetScope('provider', PROVIDER2.id)];
    for (let last = FIRST; last <= LAST; last += 1) scopes.push(budgetScope('number', stored(String(last))));
    for (const member of memberIds) scopes.push(budgetScope('check_ask', member));
    for (const link of linkIds) {
        scopes.push(budgetScope('ask', link), budgetScope('verify', link));
        for (const member of memberIds) scopes.push(budgetScope('cooldown', link, member));
    }
    for (let at = 0; at < scopes.length; at += 200) {
        const chunk = scopes.slice(at, at + 200);
        await open.execute(`DELETE FROM sms_budget WHERE scope IN (${chunk.map(() => '?').join(', ')})`, chunk);
    }
    await open.execute('DELETE FROM bookings WHERE customer_email LIKE ?', [`${EMAIL_PREFIX}%`]);
    await open.execute('DELETE FROM provider_crew_members WHERE provider_id IN (?, ?) AND phone BETWEEN ? AND ?', [PROVIDER1.id, PROVIDER2.id, BLOCK_LOW, BLOCK_HIGH]);
    seen.links.clear();
    seen.members.clear();
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

// ---- requests: one context per call, so no cookie jar carries a session ----

function parseCookie(line) {
    const [pair, ...attributes] = line.split(';').map((part) => part.trim());
    const at = pair.indexOf('=');
    /** @type {Record<string, string | true>} */
    const flags = {};
    for (const attribute of attributes) {
        const equals = attribute.indexOf('=');
        flags[(equals === -1 ? attribute : attribute.slice(0, equals)).toLowerCase()] = equals === -1 ? true : attribute.slice(equals + 1);
    }
    return { name: pair.slice(0, at), value: pair.slice(at + 1), flags };
}

function makeApi(playwright, baseURL) {
    async function call(method, url, headers = {}, data = undefined) {
        const context = await playwright.request.newContext({ baseURL: String(baseURL) });
        try {
            const response = await context.fetch(url, { method, headers, data, timeout: 60_000 });
            const text = await response.text();
            let body = null;
            try {
                body = JSON.parse(text);
            } catch {
                body = null;
            }
            const heard = response.headers();
            return {
                status: response.status(),
                body,
                text,
                header: (name) => heard[name.toLowerCase()] ?? null,
                cookies: response.headersArray().filter((entry) => entry.name.toLowerCase() === 'set-cookie').map((entry) => parseCookie(entry.value)),
            };
        } catch (error) {
            // A token in the path must not reach a failure message.
            throw new Error(`${method} ${url.replace(TOKEN_SHAPE, '{token}')} failed: ${String(/** @type {any} */ (error)?.message ?? error).split('\n')[0].replace(TOKEN_SHAPE, '{43}')}`);
        } finally {
            await context.dispose();
        }
    }
    return {
        get: (url, headers) => call('GET', url, headers),
        post: (url, data, headers) => call('POST', url, headers, data),
        put: (url, data, headers) => call('PUT', url, headers, data),
        patch: (url, data, headers) => call('PATCH', url, headers, data),
        del: (url, headers) => call('DELETE', url, headers),
    };
}

// The data of an answer that succeeded: status, success true, and the `data` of the envelope. A failure names the message, never the body.
function dataOf(res, status, who) {
    expect(res.status, `${who}: status${typeof res.body?.message === 'string' ? ` (${res.body.message.slice(0, 120)})` : ''}`).toBe(status);
    expect(res.body?.success, `${who}: success`).toBe(true);
    return res.body.data;
}

// What an answer was, for a failure message: the status, the fixed message of the route and the access it named. Never the body, a token or a code.
function got(res) {
    const message = typeof res?.body?.message === 'string' ? ` "${res.body.message.slice(0, 90)}"` : '';
    const access = typeof res?.body?.data?.access === 'string' ? ` access=${res.body.data.access}` : '';
    return ` [got ${res?.status}${message}${access}]`;
}
// expect([res.status, res.body], message), the message carrying what the answer was.
const expectRes = (res, message) => expect([res.status, res.body], `${message}${got(res)}`);

const COOKIE_OF = { provider2: 'provider_token' };
// Signs provider 2 in through its own login route and returns its session cookie as a request header. The token is never printed.
async function provider2Cookie(playwright, baseURL) {
    const login = FIXTURE_LOGINS.provider2;
    const context = await playwright.request.newContext({ baseURL: String(baseURL) });
    try {
        const response = await context.post(login.loginRoute, { data: { email: login.email, password: login.password }, maxRetries: RESET_RETRIES, timeout: 60_000 });
        expect(response.status(), 'provider 2 signs in').toBe(200);
        const held = (await context.storageState()).cookies.find((entry) => entry.name === COOKIE_OF.provider2);
        expect(held !== undefined, "provider 2's session cookie").toBe(true);
        return { cookie: `${COOKIE_OF.provider2}=${held?.value}` };
    } finally {
        await context.dispose();
    }
}

// ---- the world of a case: credentials, the jobs it made, and their removal ----

async function inWorld(playwright, baseURL, run) {
    const styles = await getCredentialHeaders(String(baseURL));
    const api = makeApi(playwright, baseURL);
    const w = {
        api,
        playwright,
        baseURL,
        made: /** @type {number[]} */ ([]),
        as: {
            providerCookie: styles['provider-cookie'], providerBearer: styles['provider-bearer'],
            adminCookie: styles['admin-cookie'], adminBearer: styles['admin-bearer'],
            customerCookie: styles['customer-cookie'], customerBearer: styles['customer-bearer'],
        },
    };
    try {
        await run(w);
    } finally {
        for (const id of w.made) await api.del(`/api/bookings?id=${id}`, w.as.adminCookie).catch(() => null);
    }
}

const tag = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function addMember(w, name, last3) {
    const added = dataOf(await writing(() => w.api.post('/api/provider/crew', { name, phone: typed(last3) }, w.as.providerCookie)), 201, `the provider adds ${name}`);
    seen.members.add(added.member.id);
    return { id: added.member.id, name: added.member.name, phone: added.member.phone };
}

// The proof that a number is the cleaner's, as the number check leaves it (the check itself is Condition 3's case).
async function markChecked(member) {
    await (await db()).execute('INSERT INTO crew_number_checks (crew_member_id, phone, code_hash, expires_at, used_at) VALUES (?, ?, ?, NOW(), NOW())', [member.id, member.phone, sha256Hex(`e2e-ja:${member.id}:${member.phone}`)]);
}
async function ensureChecked(member) {
    if ((await countOf('SELECT COUNT(*) AS n FROM crew_number_checks WHERE crew_member_id = ? AND phone = ? AND used_at IS NOT NULL', [member.id, member.phone])) === 0) await markChecked(member);
}

// A probe booking made by the public checkout and given to provider 1 (matching), with a crew and a link. `crew` entries are [name, last3, checked = true]
// for a new member or an existing member object. Returns { id, token, linkId, generation, members }.
async function newJob(w, { crew, link = true }) {
    const id = tag();
    const body = {
        service_id: 1, service_name: 'Fixture Standard Clean', service_price: 80, additional_price: 40,
        first_name: 'E2E', last_name: 'Access', email: `${EMAIL_PREFIX}${id}@workontap.test`, phone: stored('139'),
        job_date: '2026-02-01', job_time_slot: '09:00', job_description: 'E2E job link access probe booking, deleted by the case.',
        address_line1: '1 Probe Street', city: 'Calgary', payment_intent_id: `pi_e2e_ja_${id}`,
    };
    const created = await w.api.post('/api/bookings', body);
    expect(created.status, 'checkout makes the probe booking').toBe(200);
    const bookingId = created.body?.booking_id;
    expect(Number.isInteger(bookingId), 'the probe booking has an id').toBe(true);
    w.made.push(bookingId);
    const given = await w.api.put(`/api/bookings?id=${bookingId}`, { provider_id: PROVIDER1.id, status: 'matching' }, w.as.adminCookie);
    expect(given.status, `admin gives booking ${bookingId} to provider 1`).toBe(200);

    const members = [];
    for (const entry of crew) {
        if (!Array.isArray(entry)) {
            members.push(entry);
            continue;
        }
        const [name, last3, checked = true] = entry;
        const member = await addMember(w, name, last3);
        if (checked) await markChecked(member);
        members.push(member);
    }
    await putCrew(w, bookingId, members);
    const job = { id: bookingId, token: '', linkId: 0, generation: 0, members };
    if (link) await openLink(w, job);
    return job;
}

// ENG-014's writes answer 409 "Something changed while that saved. Try again." when MySQL reports a deadlock or a lock wait against another
// request's transaction, and four other specs write to the same database and the same two providers while this one runs. The message says to try
// again, so a write that got it is sent again (three tries, a short pause); any other answer, or the same 409 three times running, is the answer.
const CHANGED = 'Something changed while that saved. Try again.';
async function writing(send) {
    let res = await send();
    for (let again = 0; again < 2 && res.status === 409 && res.body?.message === CHANGED; again += 1) {
        await sleep(400 * (again + 1));
        res = await send();
    }
    return res;
}

async function putCrew(w, bookingId, members) {
    return dataOf(await writing(() => w.api.put(`/api/provider/jobs/${bookingId}/crew`, { crew_ids: members.map((member) => member.id) }, w.as.providerCookie)), 200, `the provider crews job ${bookingId}`);
}

async function openLink(w, job) {
    const data = dataOf(await w.api.post(`/api/provider/jobs/${job.id}/job-link`, { action: 'create' }, w.as.providerCookie), 200, `the provider creates the link of job ${job.id}`);
    const path = String(data.job_link?.path ?? '');
    expect(/^\/job\/[A-Za-z0-9_-]{43}$/.test(path), 'the link has a /job/{token} path').toBe(true);
    job.token = path.slice('/job/'.length);
    job.generation = data.job_link.generation;
    const [row] = await rows('SELECT id FROM job_links WHERE booking_id = ?', [job.id]);
    job.linkId = row.id;
    seen.links.add(row.id);
}

// ---- the sign-in, as the cases drive it ----

const scopeOf = {
    ask: (job) => budgetScope('ask', job.linkId),
    verify: (job) => budgetScope('verify', job.linkId),
    cooldown: (job, member) => budgetScope('cooldown', job.linkId, member.id),
    number: (member) => budgetScope('number', member.phone),
};

// Clears the counters that would stop a second ask (the link's, the member's minute, the number's day) so that a case can ask again at once.
async function fresh(job, ...members) {
    await forget(scopeOf.ask(job));
    for (const member of members) await forget(scopeOf.cooldown(job, member), scopeOf.number(member));
}

async function askFor(w, job, member, form = member.phone) {
    await fresh(job, member);
    const asked = await w.api.post(`/api/job/${job.token}/code`, { phone: form });
    expectRes(asked, `asking for ${member.name}'s code`).toEqual([200, REQUESTED]);
    return asked;
}

// A code is live while it is unused, unexpired and has tries left (five wrong tries burn it, and the row stays unused until it expires).
const TRIES = 5;
const liveCodes = (job, member) => rows(
    'SELECT id, code_hash, phone, attempts FROM job_link_codes WHERE link_id = ? AND crew_member_id = ? AND used_at IS NULL AND expires_at > NOW() AND attempts < ? ORDER BY id DESC',
    [job.linkId, member.id, TRIES],
);
const codeCount = (job, member) => countOf('SELECT COUNT(*) AS n FROM job_link_codes WHERE link_id = ? AND crew_member_id = ?', [job.linkId, member.id]);

// The six digits whose SHA-256 is the stored hash of the given prefix and digits, or null.
function crack(prefix, hash) {
    for (let n = 0; n < 1_000_000; n += 1) {
        const digits = String(n).padStart(6, '0');
        if (sha256Hex(prefix + digits) === hash) return digits;
    }
    return null;
}

// The code the member has live on the job's link, found from its hash.
async function codeOf(job, member) {
    const live = await liveCodes(job, member);
    expect(live.length, `${member.name} has exactly one live code`).toBe(1);
    const code = crack(`${job.linkId}:${member.id}:`, live[0].code_hash);
    expect(code !== null, `the live code of ${member.name} is found from its hash`).toBe(true);
    return /** @type {string} */ (code);
}

// A different six digits from the given ones.
const otherThan = (code) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

function expectFailed(res, who) {
    expectRes(res, `${who}: the one failure answer`).toEqual([400, FAILED]);
    expect(res.cookies.length, `${who}: no cookie is set`).toBe(0);
}

const verify = (w, job, phone, code, token = job.token) => w.api.post(`/api/job/${token}/verify`, { phone, code });

// Asks, finds the code and signs in; the session as a request header and the cookie as the response set it.
async function signIn(w, job, member, form = member.phone) {
    await askFor(w, job, member, form);
    const code = await codeOf(job, member);
    const res = await verify(w, job, form, code);
    expectRes(res, `${member.name} signs in`).toEqual([200, { success: true, data: { signed_in: true } }]);
    const cookie = res.cookies.find((entry) => entry.name === `jls_${job.linkId}`);
    expect(cookie !== undefined, `${member.name}'s sign-in sets the link's cookie`).toBe(true);
    return { headers: { cookie: `${cookie?.name}=${cookie?.value}` }, cookie, response: res };
}

const viewOf = (w, job, headers = {}, token = job.token) => w.api.get(`/api/job/${token}`, headers);
const accessOf = (res) => (res.status === 200 ? res.body?.data?.access : `HTTP ${res.status}`);

async function expectAccess(w, job, headers, expected, who, token = job.token) {
    const res = await viewOf(w, job, headers, token);
    expect(accessOf(res), `${who}: the access${got(res)}`).toBe(expected);
    if (expected === 'none') expect(res.body, `${who}: nothing else in the answer`).toEqual(NONE);
    return res;
}

// A dead link is the one 404 on all four public routes, whoever asks and whatever made it dead (design, Approach: a probe learns nothing about
// which dead link it hit). Each route is asked the same of a token nobody holds; the answer must match that one in status, body and cache header,
// and set no cookie.
async function expectNotValid(w, job, headers, who) {
    const [member] = job.members;
    const asks = (token) => [
        ['GET', () => viewOf(w, job, headers, token)],
        ['POST /code', () => w.api.post(`/api/job/${token}/code`, { phone: member.phone }, headers)],
        ['POST /verify', () => w.api.post(`/api/job/${token}/verify`, { phone: member.phone, code: '123456' }, headers)],
        ['POST /check-in', () => w.api.post(`/api/job/${token}/check-in`, { crew_ids: [member.id], location: HERE }, headers)],
    ];
    const mine = asks(job.token);
    const nobody = asks(newLinkToken());
    for (let at = 0; at < mine.length; at += 1) {
        const [route, ask] = mine[at];
        const res = await ask();
        const control = await nobody[at][1]();
        expectRes(control, `a token nobody holds, ${route}`).toEqual([404, NOT_VALID]);
        expectRes(res, `${who}: ${route}`).toEqual([404, NOT_VALID]);
        expect(res.header('cache-control'), `${who}: ${route} says what a token nobody holds says about caching`).toBe(control.header('cache-control'));
        expect(res.cookies.length, `${who}: ${route} sets no cookie`).toBe(0);
    }
}

const eventsOf = (job) => rows('SELECT kind, detail, crew_member_id FROM job_link_events WHERE link_id = ? ORDER BY id', [job.linkId]);

// ---- the cases ----

test.describe('Job link access: the code and the cookie', () => {
    sweepAround();

    test('AC4: a checked cleaner asks for a code with the number typed as 10 digits, as 1 and 10 digits, as +1 and 10 digits and with punctuation: 200 each, one live code bound to the stored number, the code found from the hash signs in with the same typing, and the other cleaner gets no code', async ({ playwright, baseURL }) => {
        test.setTimeout(120_000);
        await inWorld(playwright, baseURL, async (w) => {
            const job = await newJob(w, { crew: [['Ana', '120'], ['Ben', '121']] });
            const [ana, ben] = job.members;
            const forms = ['4035550120', '14035550120', '+14035550120', '(403) 555-0120'];
            for (const form of forms) {
                await fresh(job, ana);
                const asked = await w.api.post(`/api/job/${job.token}/code`, { phone: form });
                expectRes(asked, `asking with the number typed ${form}`).toEqual([200, REQUESTED]);
                expect(asked.header('cache-control'), `typed ${form}: the answer says no-store`).toMatch(/no-store/);
                const live = await liveCodes(job, ana);
                expect(live.length, `typed ${form}: exactly one live code`).toBe(1);
                expect(live[0].phone, `typed ${form}: the code is bound to the stored number`).toBe(ana.phone);
                const code = await codeOf(job, ana);
                const signedIn = await verify(w, job, form, code);
                expectRes(signedIn, `typed ${form}: the code found from the hash signs in with the same typing`).toEqual([200, { success: true, data: { signed_in: true } }]);
                const cookie = signedIn.cookies.find((entry) => entry.name === `jls_${job.linkId}`);
                expect(cookie !== undefined, `typed ${form}: the sign-in sets the link's cookie`).toBe(true);
                await expectAccess(w, job, { cookie: `${cookie?.name}=${cookie?.value}` }, 'cleaner', `typed ${form}: the new session`);
            }
            expect(await codeCount(job, ana), 'one code row per ask').toBe(forms.length);
            expect(await countOf('SELECT COUNT(*) AS n FROM job_link_codes WHERE link_id = ? AND crew_member_id = ? AND used_at IS NOT NULL', [job.linkId, ana.id]), 'every code was used once').toBe(forms.length);
            expect(await codeCount(job, ben), 'the other cleaner got no code').toBe(0);
        });
    });

    test('AC4: a wrong code is 400 with no cookie, no code or a malformed one is 400, the right code is 200 with an HttpOnly, SameSite=Lax, Path=/, Max-Age=43200 cookie and the view says cleaner, and the same code again is 400', async ({ playwright, baseURL }) => {
        test.setTimeout(120_000);
        await inWorld(playwright, baseURL, async (w) => {
            const job = await newJob(w, { crew: [['Ana', '122']] });
            const [ana] = job.members;
            await askFor(w, job, ana);
            const code = await codeOf(job, ana);

            const wrong = await verify(w, job, ana.phone, otherThan(code));
            expectFailed(wrong, 'a wrong code');
            expect(wrong.header('cache-control'), 'the refusal says no-store').toMatch(/no-store/);
            expect((await liveCodes(job, ana))[0].attempts, 'the wrong try is counted').toBe(1);
            const malformed = [
                ['no code', { phone: ana.phone }], ['an empty code', { phone: ana.phone, code: '' }], ['letters', { phone: ana.phone, code: 'abcdef' }],
                ['five digits', { phone: ana.phone, code: '12345' }], ['seven digits', { phone: ana.phone, code: '1234567' }], ['a number, not a string', { phone: ana.phone, code: Number(code) }],
                ['no number', { code }], ['a number that is not a number', { phone: 'call me', code }],
            ];
            for (const [what, data] of malformed) expectFailed(await w.api.post(`/api/job/${job.token}/verify`, data), `a try with ${what}`);
            expect((await liveCodes(job, ana))[0].attempts, 'a malformed try is refused before it is counted').toBe(1);

            const right = await verify(w, job, ana.phone, code);
            expectRes(right, 'the right code signs in').toEqual([200, { success: true, data: { signed_in: true } }]);
            expect(right.header('cache-control'), 'the sign-in says no-store').toMatch(/no-store/);
            const cookies = right.cookies.filter((entry) => entry.name.startsWith('jls_'));
            expect(cookies.length, 'one link cookie is set').toBe(1);
            const [cookie] = cookies;
            expect(cookie.name, "the cookie's name carries the link's row id").toBe(`jls_${job.linkId}`);
            expect(LINK_TOKEN_PATTERN.test(cookie.value), 'the cookie value is a fresh 43 character token').toBe(true);
            expect(cookie.flags.httponly === true, 'the cookie is HttpOnly').toBe(true);
            expect(String(cookie.flags.samesite).toLowerCase(), 'the cookie is SameSite=Lax').toBe('lax');
            expect(cookie.flags.path, 'the cookie is Path=/').toBe('/');
            expect(cookie.flags['max-age'], 'the cookie is Max-Age=43200 (12 hours)').toBe('43200');

            const [stored1] = await rows('SELECT session_hash, used_at, TIMESTAMPDIFF(SECOND, NOW(), session_expires_at) AS left_s FROM job_link_codes WHERE id = ?', [(await rows('SELECT id FROM job_link_codes WHERE link_id = ? AND crew_member_id = ? AND used_at IS NOT NULL', [job.linkId, ana.id]))[0].id]);
            expect(stored1.session_hash === sha256Hex(cookie.value), 'the database keeps the hash of the cookie value').toBe(true);
            expect(stored1.used_at !== null, 'the code is marked used').toBe(true);
            expect(stored1.left_s >= 43_000 && stored1.left_s <= 43_200, `the session lives 12 hours (${stored1.left_s} s left)`).toBe(true);

            const session = { cookie: `${cookie.name}=${cookie.value}` };
            const view = await expectAccess(w, job, session, 'cleaner', 'the signed-in cleaner');
            expect(view.body.data.you, 'the view names who is signed in').toEqual({ kind: 'cleaner', name: 'Ana' });
            expect(view.header('cache-control'), 'the view says no-store').toMatch(/no-store/);
            expect(typeof view.body.data.job?.service_name === 'string' && Array.isArray(view.body.data.crew), 'the view holds the job and the crew').toBe(true);

            expectFailed(await verify(w, job, ana.phone, code), 'the same code again');
            await expectAccess(w, job, session, 'cleaner', 'the session after the replayed code');
        });
    });

    test('AC4: five wrong tries and then the right code is 400, an expired code (set back in SQL) is 400, and member A\'s code with member B\'s number is 400 while each right pair still signs in', async ({ playwright, baseURL }) => {
        test.setTimeout(120_000);
        await inWorld(playwright, baseURL, async (w) => {
            const job = await newJob(w, { crew: [['Ana', '123'], ['Ben', '124']] });
            const [ana, ben] = job.members;

            await askFor(w, job, ana);
            const first = await codeOf(job, ana);
            for (let attempt = 1; attempt <= 5; attempt += 1) expectFailed(await verify(w, job, ana.phone, otherThan(first)), `wrong try ${attempt}`);
            expectFailed(await verify(w, job, ana.phone, first), 'the right code after five wrong tries');
            expect(await countOf('SELECT MAX(attempts) AS n FROM job_link_codes WHERE link_id = ? AND crew_member_id = ?', [job.linkId, ana.id]), 'five tries were counted and no more').toBe(5);

            await askFor(w, job, ana);
            const second = await codeOf(job, ana);
            await (await db()).execute('UPDATE job_link_codes SET expires_at = NOW() - INTERVAL 1 SECOND WHERE link_id = ? AND crew_member_id = ? AND used_at IS NULL', [job.linkId, ana.id]);
            expectFailed(await verify(w, job, ana.phone, second), 'an expired code');

            let codeA = '';
            let codeB = '';
            for (let round = 0; round < 5; round += 1) {
                await askFor(w, job, ana);
                await askFor(w, job, ben);
                codeA = await codeOf(job, ana);
                codeB = await codeOf(job, ben);
                if (codeA !== codeB) break;
            }
            expect(codeA !== codeB, 'the two cleaners hold different codes').toBe(true);
            expectFailed(await verify(w, job, ben.phone, codeA), "A's code with B's number");
            expectFailed(await verify(w, job, ana.phone, codeB), "B's code with A's number");
            const rightA = await verify(w, job, ana.phone, codeA);
            const rightB = await verify(w, job, ben.phone, codeB);
            expect([rightA.status, rightB.status], 'each right pair still signs in').toEqual([200, 200]);
            const cookieA = rightA.cookies.find((entry) => entry.name === `jls_${job.linkId}`);
            const cookieB = rightB.cookies.find((entry) => entry.name === `jls_${job.linkId}`);
            const seenA = await expectAccess(w, job, { cookie: `${cookieA?.name}=${cookieA?.value}` }, 'cleaner', "A's session");
            const seenB = await expectAccess(w, job, { cookie: `${cookieB?.name}=${cookieB?.value}` }, 'cleaner', "B's session");
            expect([seenA.body.data.you.name, seenB.body.data.you.name], 'each session is its own cleaner').toEqual(['Ana', 'Ben']);
        });
    });

    test('AC4: an unchecked member\'s number, a removed member\'s and a number on no crew get the same 200 as a checked one, make no code row and spend nothing from the number\'s budget (no send); an unreadable or missing number is a 400 and a body that is not JSON is a 400', async ({ playwright, baseURL }) => {
        test.setTimeout(120_000);
        await inWorld(playwright, baseURL, async (w) => {
            const job = await newJob(w, { crew: [['Ana', '125'], ['Ula', '126', false], ['Rob', '127'], ['Ben', '128']] });
            const [ana, ula, rob] = job.members;
            const removed = dataOf(await w.api.del(`/api/provider/crew/${rob.id}`, w.as.providerCookie), 200, 'the provider removes Rob');
            expect(removed.removed, 'Rob is removed').toBe(true);
            const stranger = stored('130');

            const answers = {};
            for (const [who, phone] of [['a checked cleaner', ana.phone], ['an unchecked cleaner', ula.phone], ['a removed cleaner', rob.phone], ['a number on no crew', stranger]]) {
                await fresh(job, ana, ula, rob);
                const res = await w.api.post(`/api/job/${job.token}/code`, { phone });
                expectRes(res, `${who}: the answer`).toEqual([200, REQUESTED]);
                answers[who] = JSON.stringify(res.body);
                if (who === 'a checked cleaner') {
                    expect(await codeCount(job, ana), 'the checked cleaner got a code').toBe(1);
                    expect(await countOf('SELECT COALESCE(SUM(used), 0) AS n FROM sms_budget WHERE scope = ?', [scopeOf.number(ana)]), "the checked cleaner's number was spent from once").toBe(1);
                } else {
                    expect(await countOf('SELECT COUNT(*) AS n FROM job_link_codes WHERE link_id = ? AND crew_member_id = ?', [job.linkId, { 'an unchecked cleaner': ula.id, 'a removed cleaner': rob.id }[who] ?? 0]), `${who}: no code row`).toBe(0);
                    expect(await countOf('SELECT COUNT(*) AS n FROM sms_budget WHERE scope IN (?, ?, ?)', [scopeOf.number({ phone }), scopeOf.cooldown(job, ula), scopeOf.cooldown(job, rob)]), `${who}: nothing was spent from the number's budget or the member's minute, so nothing was sent`).toBe(0);
                }
            }
            expect(new Set(Object.values(answers)).size, 'the four answers are one and the same').toBe(1);
            expect(await countOf('SELECT COUNT(*) AS n FROM job_link_codes WHERE link_id = ?', [job.linkId]), 'the link holds the one code of the checked cleaner and no other').toBe(1);
            const events = await eventsOf(job);
            expect(events.some((event) => event.kind === 'code_suppressed' && event.detail === 'not_checked' && event.crew_member_id === ula.id), 'the unchecked ask is recorded as not_checked').toBe(true);
            expect(events.filter((event) => event.kind === 'code_asked' && event.detail === 'no_match').length, 'the removed cleaner and the stranger are recorded as no_match').toBe(2);
            expect(events.filter((event) => event.kind === 'code_asked' && event.crew_member_id === ana.id).length, 'the checked ask is recorded once').toBe(1);

            // The unchecked cleaner has no code at all, so no entry signs in; a code made for somebody else does not either.
            expectFailed(await verify(w, job, ula.phone, otherThan('000000')), "the unchecked cleaner's number with a guess");
            const unreadable = await w.api.post(`/api/job/${job.token}/code`, { phone: 'call me' });
            expect([unreadable.status, unreadable.body?.success, typeof unreadable.body?.message], 'an unreadable number is a 400 with a message').toEqual([400, false, 'string']);
            for (const [what, data] of [['an empty number', { phone: '' }], ['a missing number', {}], ['a number that is a number type', { phone: 4035550125 }]]) {
                const res = await w.api.post(`/api/job/${job.token}/code`, data);
                expectRes(res, `${what}: the blank answer`).toEqual([400, { success: false, message: BLANK }]);
            }
            // A Buffer, because Playwright turns a string sent as application/json into a JSON string and the route would parse it.
            const notJson = await w.api.post(`/api/job/${job.token}/code`, Buffer.from('{not json'), { 'content-type': 'application/json' });
            expectRes(notJson, 'a body that is not JSON').toEqual([400, { success: false, message: 'Invalid request.' }]);
            expect(await countOf('SELECT COUNT(*) AS n FROM job_link_codes WHERE link_id = ?', [job.linkId]), 'none of those made a code').toBe(1);
        });
    });

    test('AC5: the token without the cookie is access none with no job field anywhere in the body; the cookie of one link on another link, a random 43 character cookie and a malformed one are none', async ({ playwright, baseURL }) => {
        test.setTimeout(120_000);
        await inWorld(playwright, baseURL, async (w) => {
            const jobX = await newJob(w, { crew: [['Ana', '120']] });
            const [ana] = jobX.members;
            const jobY = await newJob(w, { crew: [ana] });
            expect(jobX.token !== jobY.token && jobX.linkId !== jobY.linkId, 'two jobs have two links').toBe(true);
            const sessionX = await signIn(w, jobX, ana);
            await expectAccess(w, jobX, sessionX.headers, 'cleaner', 'the cookie on its own link');

            const bare = await expectAccess(w, jobX, {}, 'none', 'no cookie');
            expect(Object.keys(bare.body.data), 'no cookie: the data holds access and nothing else').toEqual(['access']);
            for (const word of ['service_name', 'address', 'crew', 'window', 'you', 'details', 'instructions', 'worker_count', 'Probe Street', 'Calgary', 'probe booking', 'Ana', 'Fixture']) {
                expect(bare.text.includes(word), `no cookie: the body holds no "${word}"`).toBe(false);
            }
            expect(bare.header('cache-control'), 'the none answer says no-store').toMatch(/no-store/);

            await expectAccess(w, jobY, sessionX.headers, 'none', "link X's cookie on link Y");
            await expectAccess(w, jobY, { cookie: `jls_${jobY.linkId}=${sessionX.cookie?.value}` }, 'none', "link X's session value under link Y's cookie name");
            await expectAccess(w, jobX, { cookie: `jls_${jobX.linkId}=${crypto.randomBytes(32).toString('base64url')}` }, 'none', 'a random 43 character cookie');
            for (const [what, value] of [['a short value', 'abc'], ['an empty value', ''], ['a 44 character value', 'a'.repeat(44)], ['a value with a character outside base64url', `${'a'.repeat(42)}!`]]) {
                await expectAccess(w, jobX, { cookie: `jls_${jobX.linkId}=${value}` }, 'none', `a malformed cookie (${what})`);
            }

            const sessionY = await signIn(w, jobY, ana);
            await expectAccess(w, jobX, sessionY.headers, 'none', "link Y's cookie on link X");
            await expectAccess(w, jobY, sessionY.headers, 'cleaner', "link Y's cookie on link Y");
            const both = { cookie: `${sessionX.headers.cookie}; ${sessionY.headers.cookie}` };
            await expectAccess(w, jobX, both, 'cleaner', 'both cookies on link X');
            await expectAccess(w, jobY, both, 'cleaner', 'both cookies on link Y');
        });
    });

    test('AC5: a session past its 12 hours (set back in SQL) is access none on the page and the 401 on a check-in, and a new code makes a new session while the old cookie stays none', async ({ playwright, baseURL }) => {
        test.setTimeout(120_000);
        await inWorld(playwright, baseURL, async (w) => {
            const job = await newJob(w, { crew: [['Ana', '132']] });
            const [ana] = job.members;
            const session = await signIn(w, job, ana);
            await expectAccess(w, job, session.headers, 'cleaner', 'the cookie while its session has time left');

            // The cookie's Max-Age is the browser's; the server ends a session by the time in the row, so the row is what is set back.
            const hash = sha256Hex(String(session.cookie?.value));
            const [ended] = /** @type {any[]} */ (await (await db()).execute('UPDATE job_link_codes SET session_expires_at = NOW() - INTERVAL 1 SECOND WHERE session_hash = ?', [hash]));
            expect(ended.affectedRows, 'the one session row of the cookie is set back to a second ago').toBe(1);
            await expectAccess(w, job, session.headers, 'none', 'the same cookie one second after its session ended');
            const tick = await w.api.post(`/api/job/${job.token}/check-in`, { crew_ids: [ana.id], location: HERE }, session.headers);
            expectRes(tick, 'a check-in with the cookie of the ended session').toEqual([401, SIGN_IN]);
            expect(await countOf('SELECT COUNT(*) AS n FROM job_checkins WHERE booking_id = ?', [job.id]), 'nothing was ticked').toBe(0);

            const renewed = await signIn(w, job, ana);
            await expectAccess(w, job, renewed.headers, 'cleaner', 'a new code makes a new session');
            await expectAccess(w, job, session.headers, 'none', 'the old cookie after the new sign-in');
        });
    });

    test('AC5: after a reissue the old cookie on the NEW token is none and a code asked before it does not sign in; a new code on the new token does', async ({ playwright, baseURL }) => {
        test.setTimeout(120_000);
        await inWorld(playwright, baseURL, async (w) => {
            const job = await newJob(w, { crew: [['Ana', '121']] });
            const [ana] = job.members;
            const session = await signIn(w, job, ana);
            await expectAccess(w, job, session.headers, 'cleaner', 'the cookie before the reissue');
            await askFor(w, job, ana);
            const earlier = await codeOf(job, ana);

            const reissued = dataOf(await w.api.post(`/api/provider/jobs/${job.id}/job-link`, { action: 'reissue', generation: job.generation }, w.as.providerCookie), 200, 'the provider reissues the link');
            const newToken = String(reissued.job_link.path).slice('/job/'.length);
            expect(LINK_TOKEN_PATTERN.test(newToken) && newToken !== job.token, 'the reissued link has a new token').toBe(true);
            expect(reissued.job_link.generation, 'the generation went up by one').toBe(job.generation + 1);

            await expectAccess(w, job, session.headers, 'none', 'the old cookie on the NEW token', newToken);
            expect([(await viewOf(w, job, session.headers)).status], 'the old token is the 404').toEqual([404]);
            expectFailed(await verify(w, job, ana.phone, earlier, newToken), 'a code asked before the reissue, on the new token');

            const renewed = { ...job, token: newToken, generation: job.generation + 1 };
            const fresher = await signIn(w, renewed, ana);
            await expectAccess(w, renewed, fresher.headers, 'cleaner', 'a new code on the new token');
            await expectAccess(w, renewed, session.headers, 'none', 'the old cookie after the new sign-in');
        });
    });

    test('AC5: after a member\'s number is corrected the old cookie is none and the code asked for the old number signs in on neither number; the corrected number is unchecked, so it gets no code until it is checked', async ({ playwright, baseURL }) => {
        test.setTimeout(120_000);
        await inWorld(playwright, baseURL, async (w) => {
            const job = await newJob(w, { crew: [['Ana', '122'], ['Ben', '123']] });
            const [ana] = job.members;
            const oldNumber = ana.phone;
            const session = await signIn(w, job, ana);
            await expectAccess(w, job, session.headers, 'cleaner', 'the cookie before the correction');
            await askFor(w, job, ana);
            const pending = await codeOf(job, ana);

            const patched = dataOf(await w.api.patch(`/api/provider/crew/${ana.id}`, { phone: typed('124') }, w.as.providerCookie), 200, "the provider corrects Ana's number");
            expect(patched.member.phone, 'the number is corrected').toBe(stored('124'));
            ana.phone = stored('124');

            await expectAccess(w, job, session.headers, 'none', 'the old cookie after the number was corrected');
            expectFailed(await verify(w, job, ana.phone, pending), 'the code asked for the old number, with the new number');
            expectFailed(await verify(w, job, oldNumber, pending), 'the code asked for the old number, with the old number');

            const before = await codeCount(job, ana);
            const asked = await askFor(w, job, ana);
            expect(asked.status, 'asking with the corrected, unchecked number').toBe(200);
            await fresh(job, ana);
            const old = await w.api.post(`/api/job/${job.token}/code`, { phone: oldNumber });
            expectRes(old, 'asking with the old number').toEqual([200, REQUESTED]);
            expect(await codeCount(job, ana), 'neither the unchecked new number nor the old number made a code').toBe(before);
            const events = await eventsOf(job);
            expect(events.some((event) => event.kind === 'code_suppressed' && event.detail === 'not_checked' && event.crew_member_id === ana.id), 'the new number is recorded as not_checked').toBe(true);

            await markChecked(ana);
            const renewed = await signIn(w, job, ana, typed('124'));
            await expectAccess(w, job, renewed.headers, 'cleaner', 'a new code for the checked new number');
            await expectAccess(w, job, session.headers, 'none', 'the old cookie after the new sign-in');
        });
    });

    test('AC5: after the member is removed the old cookie is none, and a removed and re-added member needs a new code (the code asked before is dead, the old cookie stays none)', async ({ playwright, baseURL }) => {
        test.setTimeout(120_000);
        await inWorld(playwright, baseURL, async (w) => {
            const job = await newJob(w, { crew: [['Ana', '125'], ['Ben', '126']] });
            const [ana, ben] = job.members;
            const session = await signIn(w, job, ana);
            await expectAccess(w, job, session.headers, 'cleaner', 'the cookie before the removal');
            await askFor(w, job, ana);
            const pending = await codeOf(job, ana);

            dataOf(await w.api.del(`/api/provider/crew/${ana.id}`, w.as.providerCookie), 200, 'the provider removes Ana');
            await expectAccess(w, job, session.headers, 'none', 'the old cookie after the removal');
            const rowsBefore = await codeCount(job, ana);
            await fresh(job, ana);
            const asked = await w.api.post(`/api/job/${job.token}/code`, { phone: ana.phone });
            expectRes(asked, 'a removed cleaner asks').toEqual([200, REQUESTED]);
            expect(await codeCount(job, ana), 'a removed cleaner gets no code').toBe(rowsBefore);
            expectFailed(await verify(w, job, ana.phone, pending), 'the code asked before the removal, after it');

            await sleep(1200);
            const back = dataOf(await w.api.post('/api/provider/crew', { name: 'Ana', phone: typed('125') }, w.as.providerCookie), 201, 'the provider adds Ana again');
            expect([back.revived, back.member.id], 'the same row comes back').toEqual([true, ana.id]);
            await expectAccess(w, job, session.headers, 'none', 'the old cookie once Ana is back on the list but not on the job');
            await putCrew(w, job.id, [ben, ana]);
            await ensureChecked(ana);
            await expectAccess(w, job, session.headers, 'none', 'the old cookie once Ana is back on the job');
            expectFailed(await verify(w, job, ana.phone, pending), 'the code asked before the removal, after the re-adding');

            const renewed = await signIn(w, job, ana);
            await expectAccess(w, job, renewed.headers, 'cleaner', 'a new code after the re-adding');
            await expectAccess(w, job, session.headers, 'none', 'the old cookie after the new sign-in');
        });
    });

    test('AC5: after the job is reassigned to provider 2 and back, and after an admin restart, the old cookie is none each time and a new code is needed', async ({ playwright, baseURL }) => {
        test.setTimeout(120_000);
        await inWorld(playwright, baseURL, async (w) => {
            const job = await newJob(w, { crew: [['Ana', '127'], ['Ben', '128']] });
            const [ana] = job.members;
            const reassign = async (to, from, who) => {
                const res = await w.api.post(`/api/bookings/${job.id}/reassign`, { new_provider_id: to, old_provider_id: from }, w.as.adminCookie);
                expectRes(res, who).toEqual([200, { success: true, message: 'Provider reassigned successfully' }]);
            };
            const session = await signIn(w, job, ana);
            await expectAccess(w, job, session.headers, 'cleaner', 'the cookie before the reassign');

            await reassign(PROVIDER2.id, PROVIDER1.id, 'the admin reassigns the job to provider 2');
            await expectAccess(w, job, session.headers, 'none', 'the old cookie after the reassign');
            await reassign(PROVIDER1.id, PROVIDER2.id, 'the admin reassigns the job back to provider 1');
            await expectAccess(w, job, session.headers, 'none', 'the old cookie after the reassign back');
            await sleep(1200);
            await putCrew(w, job.id, [ana]);
            await expectAccess(w, job, session.headers, 'none', 'the old cookie once the same cleaner is put on the job again');
            const second = await signIn(w, job, ana);
            await expectAccess(w, job, second.headers, 'cleaner', 'a new code after the reassign');

            const restart = await w.api.post(`/api/bookings/${job.id}/restart`, {}, w.as.adminCookie);
            expectRes(restart, 'the admin restarts the job').toEqual([200, { success: true, message: 'Booking restarted successfully' }]);
            // The restart leaves the job with no provider, and a job with no provider is a dead link: the 404 for a visitor, the old cookie and an admin.
            expect(await countOf('SELECT COUNT(*) AS n FROM bookings WHERE id = ? AND provider_id IS NULL', [job.id]), 'the restart leaves the job with no provider').toBe(1);
            await expectNotValid(w, job, {}, 'a visitor after the restart');
            await expectNotValid(w, job, second.headers, 'the cookie after the restart');
            await expectNotValid(w, job, w.as.adminCookie, 'an admin after the restart');
            const given = await w.api.put(`/api/bookings?id=${job.id}`, { provider_id: PROVIDER1.id, status: 'matching' }, w.as.adminCookie);
            expect(given.status, 'the admin gives the restarted job to provider 1 again').toBe(200);
            await sleep(1200);
            await putCrew(w, job.id, [ana]);
            await expectAccess(w, job, second.headers, 'none', 'the cookie once the restarted job is crewed again');
            const third = await signIn(w, job, ana);
            await expectAccess(w, job, third.headers, 'cleaner', 'a new code after the restart');
        });
    });

    test('AC6: the job\'s provider (cookie and Bearer) is provider and an admin (Bearer, cookie, both) is admin, with no code asked; a customer, provider 2, an anonymous caller and the previous provider after a reassign are none; a wrong provider\'s cookie plus an admin\'s Bearer is admin', async ({ playwright, baseURL }) => {
        test.setTimeout(120_000);
        await inWorld(playwright, baseURL, async (w) => {
            const job = await newJob(w, { crew: [['Ana', '129'], ['Ben', '130']] });
            const two = await provider2Cookie(playwright, baseURL);
            const as = w.as;

            const provider = await expectAccess(w, job, as.providerCookie, 'provider', "the job's provider by cookie");
            expect(provider.body.data.you.kind, 'the provider view names the kind').toBe('provider');
            await expectAccess(w, job, as.providerBearer, 'provider', "the job's provider by Bearer");
            const admin = await expectAccess(w, job, as.adminBearer, 'admin', 'an admin by Bearer');
            expect(admin.body.data.you.kind, 'the admin view names the kind').toBe('admin');
            expect(Array.isArray(admin.body.data.crew) && admin.body.data.crew.length === 2, 'the admin sees the whole crew').toBe(true);
            await expectAccess(w, job, as.adminCookie, 'admin', 'an admin by cookie');
            await expectAccess(w, job, { ...as.adminCookie, ...as.adminBearer }, 'admin', 'an admin by cookie and Bearer together');

            await expectAccess(w, job, {}, 'none', 'an anonymous caller');
            await expectAccess(w, job, as.customerCookie, 'none', 'a customer by cookie');
            await expectAccess(w, job, as.customerBearer, 'none', 'a customer by Bearer');
            await expectAccess(w, job, two, 'none', 'provider 2 by cookie');
            await expectAccess(w, job, { ...two, ...as.adminBearer }, 'admin', "a wrong provider's cookie PLUS an admin's Bearer");
            await expectAccess(w, job, { ...as.customerCookie, ...as.adminBearer }, 'admin', "a customer's cookie PLUS an admin's Bearer");
            await expectAccess(w, job, { ...as.providerCookie, ...as.adminBearer }, 'admin', "the job's provider's cookie PLUS an admin's Bearer (the admin is tried first)");
            expect(await countOf('SELECT COUNT(*) AS n FROM job_link_codes WHERE link_id = ?', [job.linkId]), 'no code was asked or made for any of that').toBe(0);
            expect(await countOf('SELECT COUNT(*) AS n FROM sms_budget WHERE scope IN (?, ?)', [scopeOf.ask(job), scopeOf.verify(job)]), 'nothing was counted against the link').toBe(0);

            const reassign = await w.api.post(`/api/bookings/${job.id}/reassign`, { new_provider_id: PROVIDER2.id, old_provider_id: PROVIDER1.id }, as.adminCookie);
            expect([reassign.status, reassign.body?.success], 'the admin reassigns the job to provider 2').toEqual([200, true]);
            await expectAccess(w, job, as.providerCookie, 'none', 'the previous provider by cookie after the reassign');
            await expectAccess(w, job, as.providerBearer, 'none', 'the previous provider by Bearer after the reassign');
            await expectAccess(w, job, two, 'provider', 'the new provider after the reassign');
            await expectAccess(w, job, as.adminBearer, 'admin', 'an admin after the reassign');
            await expectAccess(w, job, { ...as.providerCookie, ...as.adminBearer }, 'admin', "the previous provider's cookie PLUS an admin's Bearer after the reassign");
        });
    });
});

test.describe('Job link access: the number check and the burst', () => {
    sweepAround();

    test('Condition 3: a number check with the right code makes /numbers say checked, a wrong or malformed code is 400, an expired or used-up one is 409, and correcting the number through the PATCH makes it unchecked again', async ({ playwright, baseURL }) => {
        test.setTimeout(120_000);
        await inWorld(playwright, baseURL, async (w) => {
            const mia = await addMember(w, 'Mia', '131');
            const numberState = async (id) => {
                const data = dataOf(await w.api.get('/api/provider/crew/numbers', w.as.providerCookie), 200, 'the provider reads the number states');
                return data.numbers.find((entry) => entry.id === id)?.number_state;
            };
            const checkPath = `/api/provider/crew/${mia.id}/number-check`;
            const ask = async () => {
                await forget(budgetScope('check_ask', mia.id), budgetScope('number', mia.phone));
                const asked = dataOf(await w.api.post(checkPath, { action: 'ask' }, w.as.providerCookie), 200, 'the provider asks for a number check');
                expect([asked.asked, typeof asked.sent], 'the ask says a code was made and whether it went out').toEqual([true, 'boolean']);
                // Live for the number now on the list: unused, unexpired, with tries left. A code asked for an earlier number and one that five wrong
                // tries burnt stay unused in their rows until they expire, and are not live.
                const live = await rows('SELECT id, code_hash, phone FROM crew_number_checks WHERE crew_member_id = ? AND phone = ? AND used_at IS NULL AND expires_at > NOW() AND attempts < ? ORDER BY id DESC', [mia.id, mia.phone, TRIES]);
                expect(live.length, 'exactly one live check code').toBe(1);
                expect(live[0].phone, 'the check code is bound to the number now on the list').toBe(mia.phone);
                const code = crack(`check:${mia.id}:${mia.phone}:`, live[0].code_hash);
                expect(code !== null, 'the check code is found from its hash').toBe(true);
                return /** @type {string} */ (code);
            };
            const confirm = (code) => w.api.post(checkPath, { action: 'confirm', code }, w.as.providerCookie);

            expect(await numberState(mia.id), 'a number nobody has checked').toBe('unchecked');
            const code = await ask();
            const again = await w.api.post(checkPath, { action: 'ask' }, w.as.providerCookie);
            expectRes(again, 'a second ask inside a minute').toEqual([409, WAIT]);
            expect(await countOf('SELECT COUNT(*) AS n FROM crew_number_checks WHERE crew_member_id = ?', [mia.id]), 'the refused ask made no second code').toBe(1);
            expect(await numberState(mia.id), 'asking does not check the number').toBe('unchecked');

            const wrong = await confirm(otherThan(code));
            expectRes(wrong, 'a wrong code').toEqual([400, NOT_RIGHT]);
            for (const [what, data] of [['letters', 'abcdef'], ['five digits', '12345'], ['no code', undefined], ['a number type', Number(code)]]) {
                const res = await w.api.post(checkPath, { action: 'confirm', code: data }, w.as.providerCookie);
                expectRes(res, `a confirm with ${what}`).toEqual([400, NOT_RIGHT]);
            }
            expect(await numberState(mia.id), 'a wrong code does not check the number').toBe('unchecked');
            const right = await confirm(code);
            expectRes(right, 'the right code').toEqual([200, { success: true, data: { checked: true } }]);
            expect(await numberState(mia.id), 'a number checked with the right code').toBe('checked');
            const replay = await confirm(code);
            expectRes(replay, 'the same code again').toEqual([409, USED_UP]);

            const patched = dataOf(await w.api.patch(`/api/provider/crew/${mia.id}`, { phone: typed('132') }, w.as.providerCookie), 200, "the provider corrects Mia's number");
            mia.phone = patched.member.phone;
            expect(mia.phone, 'the number is corrected').toBe(stored('132'));
            expect(await numberState(mia.id), 'a corrected number is unchecked again, with no hook in the PATCH').toBe('unchecked');

            const stale = await ask();
            await (await db()).execute('UPDATE crew_number_checks SET expires_at = NOW() - INTERVAL 1 SECOND WHERE crew_member_id = ? AND used_at IS NULL', [mia.id]);
            const expired = await confirm(stale);
            expectRes(expired, 'an expired code').toEqual([409, USED_UP]);
            expect(await numberState(mia.id), 'an expired code does not check the number').toBe('unchecked');

            const guessed = await ask();
            for (let attempt = 1; attempt <= 5; attempt += 1) expect((await confirm(otherThan(guessed))).status, `wrong try ${attempt}`).toBe(400);
            const late = await confirm(guessed);
            expectRes(late, 'the right code after five wrong tries').toEqual([409, USED_UP]);
            expect(await numberState(mia.id), 'five wrong tries burn the code').toBe('unchecked');

            const old = await ask();
            const moved = dataOf(await w.api.patch(`/api/provider/crew/${mia.id}`, { phone: typed('133') }, w.as.providerCookie), 200, "the provider corrects Mia's number again");
            mia.phone = moved.member.phone;
            const forOld = await confirm(old);
            expectRes(forOld, 'a code asked for the number before it was corrected').toEqual([409, USED_UP]);
            expect(await numberState(mia.id), 'the old number\'s code does not check the new number').toBe('unchecked');
            const fresh2 = await ask();
            expect((await confirm(fresh2)).status, 'a code asked for the corrected number').toBe(200);
            expect(await numberState(mia.id), 'the corrected number, once checked').toBe('checked');
        });
    });

    test('Condition 3: another provider\'s member, a removed member, a missing id and an id that is not a number are the 404 of its kind on both actions, and provider 2\'s number list does not hold provider 1\'s members', async ({ playwright, baseURL }) => {
        test.setTimeout(120_000);
        await inWorld(playwright, baseURL, async (w) => {
            const two = await provider2Cookie(playwright, baseURL);
            const mia = await addMember(w, 'Mia', '134');
            const gone = await addMember(w, 'Gus', '135');
            dataOf(await w.api.del(`/api/provider/crew/${gone.id}`, w.as.providerCookie), 200, 'the provider removes Gus');
            const cases = [
                ["provider 1's member, by provider 2", mia.id, two], ['a removed member, by its provider', gone.id, w.as.providerCookie],
                ['an id nobody holds', 999999999, w.as.providerCookie], ['an id that is not a number', 'abc', w.as.providerCookie], ['an id of zero', 0, w.as.providerCookie],
            ];
            for (const [who, id, headers] of cases) {
                const asked = await w.api.post(`/api/provider/crew/${id}/number-check`, { action: 'ask' }, headers);
                expectRes(asked, `${who}: ask`).toEqual([404, NO_MEMBER]);
                const confirmed = await w.api.post(`/api/provider/crew/${id}/number-check`, { action: 'confirm', code: '123456' }, headers);
                expectRes(confirmed, `${who}: confirm`).toEqual([404, NO_MEMBER]);
            }
            expect(await countOf('SELECT COUNT(*) AS n FROM crew_number_checks WHERE crew_member_id IN (?, ?)', [mia.id, gone.id]), 'no refusal made a check code').toBe(0);
            expect(await countOf('SELECT COUNT(*) AS n FROM sms_budget WHERE scope IN (?, ?, ?)', [budgetScope('check_ask', mia.id), budgetScope('number', mia.phone), budgetScope('number', gone.phone)]), 'no refusal spent from a budget').toBe(0);

            const list = dataOf(await w.api.get('/api/provider/crew/numbers', two), 200, 'provider 2 reads the number states');
            expect(list.numbers.some((entry) => entry.id === mia.id || entry.id === gone.id), "provider 2's list holds none of provider 1's members").toBe(false);
            const own = dataOf(await w.api.get('/api/provider/crew/numbers', w.as.providerCookie), 200, 'provider 1 reads the number states');
            expect(own.numbers.find((entry) => entry.id === mia.id), "provider 1's list holds Mia, unchecked, with an id and a state and nothing else").toEqual({ id: mia.id, number_state: 'unchecked' });
            expect(own.numbers.some((entry) => entry.id === gone.id), "provider 1's list does not hold the removed member").toBe(false);
        });
    });

    test('Condition 4: the per-link ask cap answers 429 at the 21st ask, counts numbers that match nobody and unreadable ones too, and is not the try cap of the verify route', async ({ playwright, baseURL }) => {
        test.setTimeout(120_000);
        await inWorld(playwright, baseURL, async (w) => {
            const job = await newJob(w, { crew: [['Ana', '136']] });
            const [ana] = job.members;
            await w.api.post(`/api/job/${crypto.randomBytes(32).toString('base64url')}/code`, { phone: ana.phone });
            await fresh(job, ana);

            const statuses = [];
            for (let ask = 1; ask <= 20; ask += 1) {
                const phone = ask <= 10 ? stored(String(137 + (ask % 2))) : ask <= 14 ? 'call me' : typed('137');
                statuses.push((await w.api.post(`/api/job/${job.token}/code`, { phone })).status);
            }
            expect(statuses, 'asks 1 to 20: ten numbers on no crew, four unreadable, six more on no crew').toEqual([...Array(10).fill(200), ...Array(4).fill(400), ...Array(6).fill(200)]);
            expect(await countOf('SELECT COALESCE(SUM(used), 0) AS n FROM sms_budget WHERE scope = ?', [scopeOf.ask(job)]), 'twenty asks were counted, the unmatched and the unreadable ones too').toBe(20);

            const twentyFirst = await w.api.post(`/api/job/${job.token}/code`, { phone: stored('138') });
            expectRes(twentyFirst, 'the 21st ask').toEqual([429, LIMITED]);
            const checked = await w.api.post(`/api/job/${job.token}/code`, { phone: ana.phone });
            expectRes(checked, "the 21st ask is refused for a checked cleaner's number as well").toEqual([429, LIMITED]);
            const unreadable = await w.api.post(`/api/job/${job.token}/code`, { phone: 'call me' });
            expect(unreadable.status, 'and for an unreadable value').toBe(429);
            expect(await codeCount(job, ana), 'the refused asks made no code').toBe(0);
            expect(await countOf('SELECT COALESCE(SUM(used), 0) AS n FROM sms_budget WHERE scope = ?', [scopeOf.ask(job)]), 'the refused asks were not counted').toBe(20);
            expect(await countOf('SELECT COUNT(*) AS n FROM sms_budget WHERE scope IN (?, ?)', [scopeOf.number(ana), scopeOf.cooldown(job, ana)]), 'and spent nothing for the cleaner').toBe(0);

            expectFailed(await verify(w, job, ana.phone, '000000'), 'a try on the verify route while the ask cap is full');
        });
    });

    test('Condition 4: 30 parallel asks for one checked member on one link leave exactly one code row and spend exactly one from the number\'s budget', async ({ playwright, baseURL }) => {
        test.setTimeout(120_000);
        await inWorld(playwright, baseURL, async (w) => {
            const job = await newJob(w, { crew: [['Ana', '138']] });
            const [ana] = job.members;
            await w.api.post(`/api/job/${crypto.randomBytes(32).toString('base64url')}/code`, { phone: ana.phone });
            await fresh(job, ana);

            const forms = [ana.phone, '4035550138', '+1 (403) 555-0138'];
            const answers = await Promise.all(Array.from({ length: 30 }, (_, index) => w.api.post(`/api/job/${job.token}/code`, { phone: forms[index % forms.length] })));
            const tally = {};
            for (const answer of answers) tally[answer.status] = (tally[answer.status] ?? 0) + 1;
            expect(tally, 'thirty parallel asks: twenty pass the link cap and ten are the 429, nothing else').toEqual({ 200: 20, 429: 10 });
            expect(answers.filter((answer) => answer.status === 200).every((answer) => JSON.stringify(answer.body) === JSON.stringify(REQUESTED)), 'every answered ask is the one answer').toBe(true);

            expect(await codeCount(job, ana), 'exactly one code row').toBe(1);
            expect((await liveCodes(job, ana)).length, 'and it is live').toBe(1);
            expect(await countOf('SELECT used AS n FROM sms_budget WHERE scope = ?', [scopeOf.number(ana)]), "exactly one was spent from the number's budget").toBe(1);
            expect(await countOf('SELECT used AS n FROM sms_budget WHERE scope = ?', [scopeOf.cooldown(job, ana)]), "and exactly one from the member's minute").toBe(1);
            expect(await countOf('SELECT used AS n FROM sms_budget WHERE scope = ?', [scopeOf.ask(job)]), 'the link counted twenty asks').toBe(20);
            const events = await eventsOf(job);
            expect(events.filter((event) => event.kind === 'code_asked' && event.crew_member_id === ana.id).length, 'one ask went through to a text').toBe(1);
            expect(events.filter((event) => event.kind === 'code_suppressed' && event.detail === 'cooldown').length, 'the other nineteen were held by the minute').toBe(19);
        });
    });
});
