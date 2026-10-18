// @ts-check
// ENG-019: the journey no single spec makes. One serial describe follows one job from a customer's checkout to a finished job, every step through the
// real route, one case to a step, the state of the job in a closure. A step that fails skips the rest, which is the right report: the next step
// stands on what the last one left. The cases are named by the acceptance map (e2e/acceptance/contract.js) by their title prefix ("Journey: W5 code:",
// "Journey: W5 photo:", "Journey: W6 no-show:", "Journey: W6 late:", "Journey: W7 re-divides:", "Journey: W8 alerts:", "Journey: W8 queue:"); the file's
// name, the describe and the title together are the baseline key.
//   book         a customer's checkout (with a device price of one cent in it) is in the admin job queue as waiting, an admin assigns it to provider 1
//                and provider 1 accepts it; the price stored is the pricing rule's;
//   texts        provider 1 adds two cleaners (Ann, Bea), puts both on the job and makes the job link: each cleaner is texted the link once. A cleaner
//                added after the start (Cat) is texted too, and the two before her are not texted again. The texts are attempts on a stack with no
//                Twilio credential, so these two cases are ATTEMPTED and say what is missing (`credentialGap`), never a PASS;
//   W5 code      Ann asks for a code through the route, gives back the code the text carried and is let in to the link; a caller with no session is not;
//   W6 no-show   Ann ticks in; Bea never does: the provider's view of the crew is one of two ticked in, and the timer counts one cleaner here;
//   W5 photo     the start is refused with no before photo; the photo goes in through the real photo route (as job-timer.spec.js AC7 does it); then the
//                cleaner starts the job from the link and the job is in progress;
//   W6 late      Cat, put on the job after the start, enters her own code and ticks in: the crew is three, two of them ticked in;
//   W7 re-divides with Cat here the timer shares what is LEFT of the quote among two (the quote less the time used, over the cleaners here), and the
//                shares worked add up to the time used. The case waits until a few seconds are used so that this differs from the quote shared among two;
//   W8 alerts    Ann sends an add-more-items report from the link: the provider and each admin are told by text and by e-mail, and nobody else;
//   W8 queue     the report is in the admin queue with its photo, note, sender and job. Approving it charges the customer, and the dev stack has no Stripe
//                key, so the approval is asked only when the app's variable names are listed without one (as e2e/job-reports.spec.js asks it) and is a 503
//                that records nothing; the admin then declines it. The charge after an approval is the seams file's (W8 charge), in process;
//   W2 finish    provider 1 finishes the job with hours and a crew size of their own choosing: the bill and the payout are the rule's.
// What SQL does here, and nothing else: reads evidence; plants the checked number of each cleaner (what the provider's number-check routes leave
// behind, which dev cannot produce because a text cannot be read); reads the code the cleaner was texted from its hash (the text's body is never read in
// dev, as e2e/job-checkin.spec.js does it); and moves the job's date to yesterday once the job is accepted, because the check-in window opens an hour
// before the first slot of the day and a checkout cannot book the past. Everything else is a request.
// The config runs one worker. Every row this file makes has an e-mail address that starts with EMAIL_PREFIX (bookings) or a number in +1 403 555 0760 to
// 0779 (the customer, and the cleaners), so the sweep before the first step and after the last removes exactly its own rows, the notice rows those steps
// caused and the sms_budget counters they spent. A failure message names the step, the status and the route, never a cookie, a code or a token.
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { getCredentialHeaders } from './auth/credentials.js';
import { RESET_RETRIES } from './support/auth.js';
import { credentialGap } from './support/credentials.js';
import { users, providers } from '../database/fixtures/accounts.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';
import { sha256Hex } from '../src/lib/link-token.js';
import { NOTICE_KINDS } from '../src/lib/notice-templates.js';
import { DESK_MESSAGES } from '../src/lib/report-desk.js';
import { budgetScope } from '../src/lib/sms-budget.js';
import { normalisePhone } from '../src/lib/phone.js';

// Every request carries a fixture account's session header and a trace records request headers: tracing is off, as in e2e/auth-matrix.spec.js.
test.use({ trace: 'off' });
// `next dev` compiles a route on its first request; a step sends a handful of them.
test.describe.configure({ timeout: 180_000 });

const [PROVIDER1] = providers;
const EMAIL_PREFIX = 'e2e-ajn-';
// The number block of this file: the digits after '+1 403 555 0'.
const NUMBER_FIRST = 760;
const NUMBER_LAST = 779;
const stored = (n) => `+14035550${n}`;
const typed = (n) => `+1 403 555 0${n}`;
let numbersUsed = 0;
const nextNumber = () => {
    if (NUMBER_FIRST + numbersUsed > NUMBER_LAST) throw new Error('the journey needs more numbers than the block has');
    numbersUsed += 1;
    return NUMBER_FIRST + numbersUsed - 1;
};

const REQUEST_TIMEOUT = 60_000;
// A token, wherever it turns up in a failure message, is hidden.
const TOKEN_SHAPE = /[A-Za-z0-9_-]{43}/g;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A job on a Wednesday: the weekend surcharge is on the booking's first date, so a literal price needs a weekday (e2e/on-behalf-booking.spec.js).
const WEDNESDAY = '2026-10-21';
const TWO_AND_ONE = { units: { bedrooms: 2, bathrooms: 1 } };
const SERVICE_NAME = 'Fixture Standard Clean';
// Worked by hand from the fixture rule of service 1: 80.00 + 2 x 20.00 + 15.00 = 135.00; the default commission is 20 %, so the payout is 108.00.
const RULE_PRICE = 135;
const RULE_PAYOUT = 108;

const UPDATED = { success: true, message: 'Booking updated successfully' };

// The fixture admin: the one account of the three in `users` that holds the admin role.
const ADMIN = users[2];

// The photos: the app stores each under public/uploads/job-photos with a random name and the row names the file.
const PHOTO_DIRECTORY = path.join(process.cwd(), 'public', 'uploads', 'job-photos');
const STORED_NAME = /^[0-9a-f]{32}\.(jpg|png|webp)$/;
const PHOTO_URL = /^\/uploads\/job-photos\/[0-9a-f]{32}\.(jpg|png|webp)$/;
// A minimal JPEG the photo store accepts: start of image, a JFIF header, a start of scan with two bytes of data and the end of image.
const TINY_JPEG = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0x34, 0xff, 0xd9,
]);

// A cleaner's page sends this note with an add-more-items report.
const ITEMS_NOTE = 'The customer also wants the oven and both fridges done';
// A cleaner standing at the job.
const HERE = { latitude: 51.04473, longitude: -114.07192, accuracy: 12.4 };

// ---- the dev database, the way e2e/acceptance-roles.spec.js reaches it ----

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
const marks = (list) => list.map(() => '?').join(', ');

// What the record of this file's rows holds, as one string: it is the same twice running once the notices a step caused have all been written.
async function recordKey() {
    const mine = `${EMAIL_PREFIX}%`;
    const [booked] = await rows("SELECT COUNT(*) AS n, COALESCE(MAX(n.id), 0) AS top, COALESCE(SUM(n.outcome = 'pending'), 0) AS waiting FROM notice_attempts n JOIN bookings b ON b.id = n.booking_id WHERE b.customer_email LIKE ?", [mine]);
    const [logged] = await rows("SELECT COUNT(*) AS n FROM activity_logs a JOIN bookings b ON a.entity_type = 'booking' AND a.entity_id = b.id WHERE b.customer_email LIKE ?", [mine]);
    return { key: JSON.stringify([booked, logged]), waiting: Number(booked.waiting) };
}

// A notice runs after the answer that caused it, so a row can be written after the last step has ended. The record is read until it is the same twice
// running with no attempt still pending, for at most three seconds.
async function settle() {
    let last = null;
    for (let round = 0; round < 12; round += 1) {
        const seen = await recordKey();
        if (seen.waiting === 0 && seen.key === last) return;
        last = seen.key;
        await sleep(250);
    }
}

// The stored photo files of the directory, by name; [] when the directory is not there yet.
async function photoFiles() {
    try {
        return (await fs.readdir(PHOTO_DIRECTORY)).filter((name) => STORED_NAME.test(name)).sort();
    } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes(/** @type {any} */ (error).code)) return [];
        throw error;
    }
}

// The files that were in the directory when the journey began: whatever else is there when it ends is its own.
let filesBefore = new Set();

async function removeNewFiles() {
    for (const name of await photoFiles()) {
        if (!filesBefore.has(name)) await fs.rm(path.join(PHOTO_DIRECTORY, name), { force: true });
    }
}

// Deletes what this file left: the files of the photos its bookings hold, the sms_budget counters of its numbers, the notice rows and logs of its
// bookings, the bookings of its e-mail prefix (their invoices, sessions, links, codes, check-ins, photos, reports and crew rows go with them) and the
// crew members of its block.
async function sweepOnce() {
    const open = await db();
    const mine = `${EMAIL_PREFIX}%`;
    // The photo store makes its directory when it first needs one, and the dev container runs as root: a directory made here first is the test user's,
    // and the sweep can remove the files the app writes into it.
    await fs.mkdir(PHOTO_DIRECTORY, { recursive: true });
    const ids = (await rows('SELECT id FROM bookings WHERE customer_email LIKE ?', [mine])).map((row) => row.id);
    if (ids.length > 0) {
        // Two reads, not a UNION: the two tables' columns do not share a collation.
        for (const table of ['job_photos', 'job_reports']) {
            for (const held of await rows(`SELECT photo_url FROM ${table} WHERE booking_id IN (${marks(ids)}) AND photo_url IS NOT NULL`, ids)) {
                if (PHOTO_URL.test(held.photo_url)) await fs.rm(path.join(process.cwd(), 'public', held.photo_url), { force: true });
            }
        }
    }
    const links = ids.length === 0 ? [] : await rows(`SELECT id FROM job_links WHERE booking_id IN (${marks(ids)})`, ids);
    const members = await rows('SELECT id FROM provider_crew_members WHERE phone BETWEEN ? AND ?', [stored(NUMBER_FIRST), stored(NUMBER_LAST)]);
    if (ids.length > 0) {
        await open.execute(`DELETE FROM notice_attempts WHERE booking_id IN (${marks(ids)})`, ids);
        await open.execute(`DELETE FROM activity_logs WHERE entity_type = 'booking' AND entity_id IN (${marks(ids)})`, ids);
        await open.execute(`DELETE FROM booking_audit_logs WHERE booking_id IN (${marks(ids)})`, ids);
    }
    await open.execute('DELETE FROM bookings WHERE customer_email LIKE ?', [mine]);
    await open.execute('DELETE FROM provider_crew_members WHERE phone BETWEEN ? AND ?', [stored(NUMBER_FIRST), stored(NUMBER_LAST)]);

    // The numbers the journey texts: this file's block and the fixtures' own (the admin, the providers and the customers are told by routes too).
    const numbers = [];
    for (let n = NUMBER_FIRST; n <= NUMBER_LAST; n += 1) numbers.push(stored(n));
    for (const person of [...users, ...providers]) {
        const phone = normalisePhone(person.phone);
        if (phone.ok) numbers.push(phone.phone);
    }
    const scopes = [budgetScope('platform', 'day'), ...providers.map((provider) => budgetScope('provider', provider.id))];
    for (const shift of [0, -86_400_000, 86_400_000]) scopes.push(budgetScope('platform-warned', new Date(Date.now() + shift).toISOString().slice(0, 10)));
    for (const number of numbers) {
        scopes.push(budgetScope('number', number));
        for (const kind of NOTICE_KINDS) scopes.push(budgetScope('kind', kind, number));
    }
    for (const link of links) {
        scopes.push(budgetScope('ask', link.id), budgetScope('verify', link.id));
        for (const member of members) scopes.push(budgetScope('cooldown', link.id, member.id));
    }
    for (const member of members) scopes.push(budgetScope('check_ask', member.id));
    for (let from = 0; from < scopes.length; from += 200) {
        const chunk = scopes.slice(from, from + 200);
        await open.execute(`DELETE FROM sms_budget WHERE scope IN (${marks(chunk)})`, chunk);
    }
}

// The sweep is sent again when MySQL picks it as the victim of a deadlock or a lock wait against another request's writes (1213, 1205).
async function clearRows() {
    await settle();
    for (let attempt = 1; ; attempt += 1) {
        try {
            return await sweepOnce();
        } catch (error) {
            if (attempt >= 3 || ![1213, 1205].includes(/** @type {any} */ (error)?.errno)) throw error;
            await sleep(300 * attempt);
        }
    }
}

// ---- requests ----

// Playwright's own errors name the URL of the call that failed and, below their first line, its headers (a cookie): every request this file sends goes
// through a context whose errors are cut to their first line, with anything shaped like a token hidden.
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

// The sessions a step sends, as request headers (the cookie styles of getCredentialHeaders).
async function setup(playwright, request, baseURL) {
    const styles = await getCredentialHeaders(String(baseURL));
    return {
        playwright,
        baseURL: String(baseURL),
        request: guarded(request),
        admin: styles['admin-cookie'],
        provider1: styles['provider-cookie'],
    };
}

function call(ctx, method, url, headers, data) {
    return ctx.request.fetch(url, { method, headers, data, maxRetries: RESET_RETRIES, timeout: REQUEST_TIMEOUT });
}

// The whole body of an answer that succeeded. The message of a refusal is named, never the whole body (a success holds a link's path).
async function bodyOf(response, status, who) {
    const body = await response.json().catch(() => null);
    expect(response.status(), `${who}: status (${body?.success === false ? body.message : 'no message'})`).toBe(status);
    expect(body?.success, `${who}: success`).toBe(true);
    return body;
}

// ---- the bodies and the reads ----

let sequence = 0;
const tag = () => `${Date.now().toString(36)}${(sequence += 1)}`;
const mail = (what) => `${EMAIL_PREFIX}${what}-${tag()}@workontap.test`;

// The body of a checkout as the page posts it after its four steps, with a device price of ONE CENT in it: the route must record the rule's price.
function checkoutBody(what) {
    return {
        service_id: 1, service_name: SERVICE_NAME, service_price: 0.01, additional_price: 0.01,
        first_name: 'E2E', last_name: 'Journey', email: mail(what), phone: typed(nextNumber()),
        job_date: WEDNESDAY, job_time_slot: '09:00', job_description: 'ENG-019 journey probe, deleted by the run.',
        address_line1: '1 Probe Street', city: 'Calgary', payment_intent_id: `pi_e2e_ajn_${tag()}`, answers: TWO_AND_ONE,
    };
}

// The booking as the admin reads it (GET /api/bookings/[id]: the row and its status_history, newest first).
async function adminRow(ctx, id) {
    const response = await call(ctx, 'GET', `/api/bookings/${id}`, ctx.admin);
    expect(response.status(), `admin reads booking ${id}`).toBe(200);
    return (await response.json()).data;
}

async function assign(ctx, id, data) {
    const response = await call(ctx, 'PUT', `/api/bookings?id=${id}`, ctx.admin, data);
    expect(response.status(), `admin updates booking ${id}`).toBe(200);
    expect(await response.json(), `admin updates booking ${id}: body`).toEqual(UPDATED);
}

// The booking's row in the admin job queue, read a page at a time (the queue is oldest first, so a booking just made is on the last page), or undefined
// when the queue does not hold it.
async function queueRow(ctx, id) {
    for (let offset = 0; ;) {
        const response = await call(ctx, 'GET', `/api/bookings?queue=1&limit=500&offset=${offset}`, ctx.admin);
        const body = await response.json().catch(() => null);
        expect([response.status(), body?.success], `admin reads the job queue from ${offset}`).toEqual([200, true]);
        const found = body.data.find((row) => row.id === id);
        if (found) return found;
        offset += body.data.length;
        if (body.data.length === 0 || offset >= body.total) return undefined;
    }
}

const claimByBody = (ctx, headers, id) => call(ctx, 'POST', '/api/provider/available-jobs', headers, { booking_id: id });

// ---- the days: the job's own clock, a job in Calgary falls in America/Toronto's rules (src/lib/job-window.js) ----

const ZONE = 'America/Toronto';

// The calendar day in Toronto of an instant: 'YYYY-MM-DD'.
function torontoDay(instant) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
    const get = (type) => parts.find((part) => part.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
}

const plusDays = (day, count) => new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + count)).toISOString().slice(0, 10);
// Yesterday: a job dated then has its check-in window open now, whatever the hour.
const yesterday = () => plusDays(torontoDay(new Date()), -1);

// ---- the cleaners: the provider's crew, the number check and the code ----

// A provider adds a cleaner through the crew route, with the next number of this file's block.
async function addCleaner(ctx, name) {
    const number = nextNumber();
    const body = await bodyOf(await call(ctx, 'POST', '/api/provider/crew', ctx.provider1, { name, phone: typed(number) }), 201, `provider 1 adds ${name}`);
    return { id: body.data.member.id, name, number };
}

// The proof the number-check routes leave behind: a used row for the member and the number they have now.
async function markChecked(member) {
    const [current] = await rows('SELECT phone FROM provider_crew_members WHERE id = ?', [member.id]);
    await (await db()).execute('INSERT INTO crew_number_checks (crew_member_id, phone, code_hash, expires_at, used_at) VALUES (?, ?, ?, NOW(), NOW())', [member.id, current.phone, sha256Hex(`asm-probe:${tag()}`)]);
}

// The six digits of the member's live code on a link, found by hashing every candidate against code_hash (a text cannot be read in dev).
async function findCode(linkId, memberId) {
    const [row] = await rows('SELECT code_hash FROM job_link_codes WHERE link_id = ? AND crew_member_id = ? AND used_at IS NULL AND expires_at > NOW() ORDER BY id DESC LIMIT 1', [linkId, memberId]);
    expect(row !== undefined, 'a live code row exists for the member').toBe(true);
    for (let n = 0; n < 1_000_000; n += 1) {
        const candidate = String(n).padStart(6, '0');
        if (sha256Hex(`${linkId}:${memberId}:${candidate}`) === row.code_hash) return candidate;
    }
    throw new Error('no six-digit code fits the stored hash');
}

// The state of the one job, as each step leaves it for the next.
const journey = {
    /** @type {number} */ bookingId: 0,
    number: '',
    token: '',
    /** @type {number} */ linkId: 0,
    /** @type {any} */ ann: null,
    /** @type {any} */ bea: null,
    /** @type {any} */ cat: null,
    /** @type {any} */ annSession: null,
    /** @type {any} */ catSession: null,
    /** @type {any} */ started: null,
    /** @type {number} */ reportId: 0,
};

const linkPath = (route) => `/api/job/${journey.token}/${route}`;
const linkCall = (ctx, method, route, session, data) => call(ctx, method, linkPath(route), session, data);

// A cleaner gives the link her number: a code is asked for through the route, found from its hash and given back. The cookie comes from a context of its
// own so that no jar carries it into the next request; it is returned as a `jls_{link id}={value}` header, and never printed.
async function signIn(ctx, member) {
    const asked = await ctx.request.post(linkPath('code'), { data: { phone: typed(member.number) }, timeout: REQUEST_TIMEOUT });
    expect(asked.status(), `${member.name} asks for a code`).toBe(200);
    const code = await findCode(journey.linkId, member.id);
    const fresh = await ctx.playwright.request.newContext({ baseURL: ctx.baseURL });
    try {
        const verified = await guarded(fresh).post(linkPath('verify'), { data: { phone: typed(member.number), code }, timeout: REQUEST_TIMEOUT });
        expect(verified.status(), `${member.name} gives the code back`).toBe(200);
        const line = verified.headersArray().filter((header) => header.name.toLowerCase() === 'set-cookie').map((header) => header.value).find((value) => value.startsWith(`jls_${journey.linkId}=`));
        expect(line !== undefined, `the answer sets the session cookie of link ${journey.linkId}`).toBe(true);
        return { cookie: String(line).split(';')[0] };
    } finally {
        await fresh.dispose();
    }
}

// The job's timer as a session reads it.
async function timerOf(ctx, session) {
    return (await bodyOf(await linkCall(ctx, 'GET', 'timer', session), 200, 'the timer is read')).data.timer;
}

// The crew of the job as provider 1 sees it (GET /api/provider/jobs/[id]/job-link).
async function crewView(ctx) {
    const view = await bodyOf(await call(ctx, 'GET', `/api/provider/jobs/${journey.bookingId}/job-link`, ctx.provider1), 200, 'provider 1 reads the job link');
    return view.data.crew;
}

// The time left shared among the cleaners here, as src/lib/job-clock.js says it: the quote less the time used, over the cleaners here, rounded up.
const shareOf = (timer) => Math.ceil(Math.max(timer.quote_minutes * 60 - timer.used_seconds, 0) / timer.crew_here);

// ---- the notices a step caused, read from the rows ----

// Reads until the answer is the one wanted, for at most `ms`; the last read is returned either way, so the assertion that follows names what was there.
async function eventually(read, done, ms = 10_000) {
    const until = Date.now() + ms;
    for (;;) {
        const seen = await read();
        if (done(seen) || Date.now() >= until) return seen;
        await sleep(250);
    }
}

const noticeRows = (kind) => rows('SELECT channel, recipient_kind, recipient_ref, outcome FROM notice_attempts WHERE booking_id = ? AND kind = ? ORDER BY channel, recipient_kind, recipient_ref', [journey.bookingId, kind]);
// Who was told, as sorted 'channel kind ref' lines. An address given by the environment (ADMIN_EMAIL) is an admin with no id; it is left out.
const toldOf = (list) => list.filter((row) => row.recipient_ref !== null).map((row) => `${row.channel} ${row.recipient_kind} ${row.recipient_ref}`).sort();
const adminIds = async () => (await rows("SELECT id FROM users WHERE role = 'admin' ORDER BY id")).map((row) => row.id);

// A notice reached the point of an attempt: the gateway took it (sent), had nothing to send with (not_configured) or answered with something that is not a
// delivery (rejected, unsure). A refusal before an attempt (a budget, a bad number) is none of these.
const REACHED = ['sent', 'not_configured', 'rejected', 'unsure'];

// The outcome of every row of a channel, read from the row. On a stack with no credential for the channel the attempt stops at not_configured and the case
// has been marked "verified by attempt" (credentialGap); with the credential the outcome is any of REACHED.
function expectAttempted(list, channel, missing, who) {
    const mine = list.filter((row) => row.channel === channel);
    expect(mine.length > 0, `${who}: the ${channel} rows are there to read`).toBe(true);
    for (const row of mine) {
        const label = `${who}: ${channel} to ${row.recipient_kind} ${row.recipient_ref}`;
        if (missing.length > 0) expect(row.outcome, `${label}: the stack has no ${channel} credential, so the attempt stops there`).toBe('not_configured');
        else expect(REACHED, `${label}: the outcome ${row.outcome}`).toContain(row.outcome);
    }
}

// ---- the journey ----

test.describe('Journey acceptance: a booking from the checkout to a finished job', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeAll(async () => {
        numbersUsed = 0;
        filesBefore = new Set(await photoFiles());
        await clearRows();
    });
    test.afterAll(async () => {
        if (!connection) return;
        try {
            await removeNewFiles();
            await clearRows();
        } finally {
            await connection.end();
            connection = null;
        }
    });

    test('Journey: book: a customer\'s checkout is in the admin job queue as waiting, an admin assigns it to provider 1 and provider 1 accepts it, at the rule\'s price', async ({ playwright, request, baseURL }) => {
        const ctx = await setup(playwright, request, baseURL);
        const made = await bodyOf(await call(ctx, 'POST', '/api/bookings', {}, checkoutBody('journey')), 200, 'the customer checks out');
        expect(Number.isInteger(made.booking_id), 'the booking has an id').toBe(true);
        journey.bookingId = made.booking_id;

        const waiting = await queueRow(ctx, journey.bookingId);
        expect(waiting !== undefined, `the queue holds booking ${journey.bookingId}`).toBe(true);
        expect([waiting.queue_state, waiting.provider_id, waiting.status, waiting.service_price], 'in the queue as waiting, with no provider, at the rule price and not the device\'s one cent')
            .toEqual(['waiting', null, 'pending', RULE_PRICE]);
        journey.number = String(waiting.booking_number);

        await assign(ctx, journey.bookingId, { provider_id: PROVIDER1.id, status: 'matching' });
        const assigned = await queueRow(ctx, journey.bookingId);
        expect([assigned.queue_state, assigned.provider_id, assigned.status], 'in the queue as assigned to provider 1').toEqual(['assigned', PROVIDER1.id, 'matching']);

        const accepted = await bodyOf(await claimByBody(ctx, ctx.provider1, journey.bookingId), 200, 'provider 1 accepts the job assigned to them');
        expect(accepted.success, 'the acceptance').toBe(true);
        const confirmed = await adminRow(ctx, journey.bookingId);
        expect([confirmed.provider_id, confirmed.status, Number(confirmed.service_price)], 'confirmed, provider 1\'s, at the rule price').toEqual([PROVIDER1.id, 'confirmed', RULE_PRICE]);

        // The day of the job comes: the window of the check-in opens an hour before the first slot of the day, and a checkout cannot book yesterday.
        await (await db()).execute('UPDATE bookings SET job_date = ? WHERE id = ?', [yesterday(), journey.bookingId]);
    });

    test('Journey: texts: provider 1 puts two cleaners on the job and makes its link, and each cleaner is texted the link once', async ({ playwright, request, baseURL }, testInfo) => {
        const missingSms = credentialGap(testInfo, 'sms');
        const ctx = await setup(playwright, request, baseURL);
        journey.ann = await addCleaner(ctx, 'Ann');
        journey.bea = await addCleaner(ctx, 'Bea');
        // The numbers have passed the provider's check (the proof the check routes leave), or the link would not be texted to them.
        await markChecked(journey.ann);
        await markChecked(journey.bea);

        const saved = await bodyOf(await call(ctx, 'PUT', `/api/provider/jobs/${journey.bookingId}/crew`, ctx.provider1, { crew_ids: [journey.ann.id, journey.bea.id] }), 200, 'provider 1 puts Ann and Bea on the job');
        expect(saved.data.added.map((member) => member.id).sort(), 'both are added').toEqual([journey.ann.id, journey.bea.id].sort());
        expect(await noticeRows('job_link'), 'a job with no link texts nobody').toEqual([]);

        const created = await bodyOf(await call(ctx, 'POST', `/api/provider/jobs/${journey.bookingId}/job-link`, ctx.provider1, { action: 'create' }), 200, 'provider 1 makes the job link');
        const path = created.data.job_link?.path;
        expect(typeof path === 'string' && /^\/job\/[A-Za-z0-9_-]{43}$/.test(path), 'the link has a path of 43 base64url characters').toBe(true);
        journey.token = String(path).slice('/job/'.length);
        const [link] = await rows('SELECT id FROM job_links WHERE booking_id = ?', [journey.bookingId]);
        journey.linkId = link.id;

        const crew = await crewView(ctx);
        expect(crew.map((member) => [member.id, member.number_state, Boolean(member.checked_in)]).sort(), 'both cleaners have a checked number and neither has ticked in')
            .toEqual([[journey.ann.id, 'checked', false], [journey.bea.id, 'checked', false]].sort());

        const expected = [journey.ann, journey.bea].map((member) => `sms cleaner ${member.id}`).sort();
        const told = await eventually(() => noticeRows('job_link'), (list) => toldOf(list).length >= expected.length && list.every((row) => row.outcome !== 'pending'));
        expect(toldOf(told), 'each cleaner on the crew is texted the link, once').toEqual(expected);
        expectAttempted(told, 'sms', missingSms, 'the job link');
    });

    test('Journey: W5 code: a cleaner who gives back the code she was texted is let in to the link, and a caller with no session is not', async ({ playwright, request, baseURL }) => {
        const ctx = await setup(playwright, request, baseURL);
        const refused = await ctx.request.get(linkPath('timer'), { timeout: REQUEST_TIMEOUT });
        expect(refused.status(), 'a caller with no session reads nothing of the job').toBe(401);

        journey.annSession = await signIn(ctx, journey.ann);
        const timer = await timerOf(ctx, journey.annSession);
        expect(timer.state, 'with her session Ann reads the timer of a job that has not started').toBe('not_started');
    });

    test('Journey: W6 no-show: one cleaner ticks in and the other never does, so the job shows one of two ticked in and the timer counts one cleaner here', async ({ playwright, request, baseURL }) => {
        const ctx = await setup(playwright, request, baseURL);
        const ticked = await bodyOf(await linkCall(ctx, 'POST', 'check-in', journey.annSession, { crew_ids: [journey.ann.id], location: HERE }), 200, 'Ann ticks in');
        expect(ticked.data.checked_in, 'her tick is the only one this request made').toEqual([journey.ann.id]);

        const crew = await crewView(ctx);
        expect(crew.map((member) => [member.id, Boolean(member.checked_in)]).sort(), 'the provider\'s view: Ann is ticked in, Bea is not').toEqual([[journey.ann.id, true], [journey.bea.id, false]].sort());
        expect(crew.filter((member) => member.checked_in).length, 'one of two').toBe(1);

        const timer = await timerOf(ctx, journey.annSession);
        expect([timer.state, timer.crew_here], 'the timer counts the one cleaner who is here').toEqual(['not_started', 1]);
        expect(timer.clock_seconds, 'nothing has run, so the one cleaner here has the whole quote').toBe(timer.quote_minutes * 60);
        const [bea] = timer.per_member.filter((member) => member.id === journey.bea.id);
        expect(bea === undefined || (bea.checked_in_at === null && bea.worked_seconds === 0), 'if the timer lists Bea she has not ticked in and has worked no time').toBe(true);
    });

    test('Journey: W5 photo: the start is refused until a before photo has gone in through the photo route, and then the cleaner starts the job from the link', async ({ playwright, request, baseURL }) => {
        const ctx = await setup(playwright, request, baseURL);
        const early = await linkCall(ctx, 'POST', 'timer', journey.annSession, { action: 'start', location: HERE });
        expect([early.status(), (await early.json().catch(() => null))?.reason], 'a start with no before photo is refused').toEqual([409, 'no_before_photos']);

        const multipart = {
            type: 'before', photo: { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: TINY_JPEG },
            latitude: String(HERE.latitude), longitude: String(HERE.longitude), accuracy: String(HERE.accuracy),
        };
        const taken = await bodyOf(await ctx.request.post(linkPath('photos'), { headers: journey.annSession, multipart, timeout: REQUEST_TIMEOUT }), 200, 'Ann sends the before photo');
        expect([taken.data.photo.type, taken.data.photo.taken_by], 'the photo is a before photo, taken by Ann').toEqual(['before', { kind: 'cleaner', name: 'Ann' }]);
        expect(taken.data.photo.url, 'the photo has an address in the store').toMatch(PHOTO_URL);
        expect(await photoFiles(), 'and is a file there').toContain(path.basename(taken.data.photo.url));

        const ready = await timerOf(ctx, journey.annSession);
        expect([ready.blocked, ready.can.start], 'with the photo in, nothing blocks the start').toEqual([null, true]);

        const started = await bodyOf(await linkCall(ctx, 'POST', 'timer', journey.annSession, { action: 'start', location: HERE }), 200, 'Ann starts the job from the link');
        expect([started.data.timer.state, started.data.timer.crew_here], 'the job is running, with Ann the one cleaner here').toEqual(['running', 1]);
        journey.started = started.data.timer;
        const row = await adminRow(ctx, journey.bookingId);
        expect(row.status, 'the booking is in progress').toBe('in_progress');
    });

    test('Journey: texts late: a cleaner put on the job after the start is texted the link, and the two before her are not texted again', async ({ playwright, request, baseURL }, testInfo) => {
        const missingSms = credentialGap(testInfo, 'sms');
        const ctx = await setup(playwright, request, baseURL);
        journey.cat = await addCleaner(ctx, 'Cat');
        await markChecked(journey.cat);
        const saved = await bodyOf(await call(ctx, 'PUT', `/api/provider/jobs/${journey.bookingId}/crew`, ctx.provider1, { crew_ids: [journey.ann.id, journey.bea.id, journey.cat.id] }), 200, 'provider 1 puts Cat on the job');
        expect(saved.data.added.map((member) => member.id), 'Cat is the one added').toEqual([journey.cat.id]);

        const expected = [journey.ann, journey.bea, journey.cat].map((member) => `sms cleaner ${member.id}`).sort();
        const told = await eventually(() => noticeRows('job_link'), (list) => toldOf(list).length >= expected.length && list.every((row) => row.outcome !== 'pending'));
        expect(toldOf(told), 'three texts in all: one to each cleaner, so Ann and Bea were not texted again').toEqual(expected);
        expectAttempted(told, 'sms', missingSms, 'the late arrival\'s link');
    });

    test('Journey: W6 late: a cleaner added after the start enters her own code and ticks in, and the crew is three with two of them ticked in', async ({ playwright, request, baseURL }) => {
        const ctx = await setup(playwright, request, baseURL);
        journey.catSession = await signIn(ctx, journey.cat);
        const ticked = await bodyOf(await linkCall(ctx, 'POST', 'check-in', journey.catSession, { crew_ids: [journey.cat.id], location: HERE }), 200, 'Cat ticks in');
        expect(ticked.data.checked_in, 'her tick is the only one this request made').toEqual([journey.cat.id]);

        const crew = await crewView(ctx);
        expect(crew.map((member) => [member.id, Boolean(member.checked_in)]).sort(), 'Ann and Cat are ticked in, Bea is not').toEqual([[journey.ann.id, true], [journey.bea.id, false], [journey.cat.id, true]].sort());
        const row = await adminRow(ctx, journey.bookingId);
        expect(row.status, 'the job is still in progress').toBe('in_progress');
    });

    test('Journey: W7 re-divides: with a third cleaner here the timer shares what is left of the quote among two, and the shares worked add up to the time used', async ({ playwright, request, baseURL }) => {
        const ctx = await setup(playwright, request, baseURL);
        // Read once a few seconds are used, so that a share worked out from what is left differs from one worked out from the whole quote.
        const timer = await eventually(() => timerOf(ctx, journey.catSession), (seen) => seen.used_seconds >= 3, 20_000);
        expect(timer.used_seconds >= 3, 'the clock has run for a few seconds').toBe(true);
        expect([timer.state, timer.crew_here], 'running, with Ann and Cat here and Bea, who never came, not').toEqual(['running', 2]);
        expect(timer.clock_seconds, 'each cleaner here has what is left of the quote shared between two').toBe(shareOf(timer));
        expect(timer.clock_seconds < journey.started.clock_seconds, 'a cleaner\'s share is less than when Ann was the one cleaner here').toBe(true);

        const worked = timer.per_member.reduce((sum, member) => sum + member.worked_seconds, 0);
        expect(worked, 'the shares worked add up to the time used').toBe(timer.used_seconds);
        const byId = new Map(timer.per_member.map((member) => [member.id, member]));
        expect(byId.get(journey.ann.id).worked_seconds > 0 && byId.get(journey.cat.id).worked_seconds >= 0, 'Ann has worked, and Cat has worked no more than she has been here').toBe(true);
        const bea = byId.get(journey.bea.id);
        expect(bea === undefined || bea.worked_seconds === 0, 'Bea, who never came, has worked no time').toBe(true);
    });

    test('Journey: W8 alerts: an add-more-items report sent from the link texts and e-mails the provider and each admin, and not the cleaner who sent it', async ({ playwright, request, baseURL }, testInfo) => {
        const missingSms = credentialGap(testInfo, 'sms');
        const missingMail = credentialGap(testInfo, 'email');
        const ctx = await setup(playwright, request, baseURL);
        const multipart = { type: 'add_items', note: ITEMS_NOTE, photo: { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: TINY_JPEG } };
        const sent = await bodyOf(await ctx.request.post(linkPath('reports'), { headers: journey.annSession, multipart, timeout: REQUEST_TIMEOUT }), 200, 'Ann sends an add-more-items report');
        expect(sent.data.again, 'the report is new').toBe(false);
        expect(Number.isInteger(sent.data.report.id), 'the report has an id').toBe(true);
        journey.reportId = sent.data.report.id;

        const admins = await adminIds();
        expect(admins, 'the fixture admin is one of the admins').toContain(ADMIN.id);
        const expected = ['email', 'sms'].flatMap((channel) => [`${channel} provider ${PROVIDER1.id}`, ...admins.map((id) => `${channel} admin ${id}`)]).sort();
        const told = await eventually(() => noticeRows('report_added'), (list) => toldOf(list).length >= expected.length && list.every((row) => row.outcome !== 'pending'));
        expect(toldOf(told), 'the provider of the job and each admin are told on both channels').toEqual(expected);
        expect(told.filter((row) => !['admin', 'provider'].includes(row.recipient_kind)), 'nobody else is told: not the cleaner who sent it, not the customer').toEqual([]);
        const known = told.filter((row) => row.recipient_ref !== null);
        expectAttempted(known, 'sms', missingSms, 'the report');
        expectAttempted(known, 'email', missingMail, 'the report');
    });

    test('Journey: W8 queue: the report is in the admin queue with its photo, note, sender and job, an approval with no payment key is a 503 that records nothing, and the admin declines it', async ({ playwright, request, baseURL }) => {
        const ctx = await setup(playwright, request, baseURL);
        const answer = await bodyOf(await call(ctx, 'GET', `/api/admin/reports?status=open&booking_id=${journey.bookingId}&limit=50`, ctx.admin), 200, 'the admin reads the open reports of the job');
        expect(answer.data.reports.map((report) => report.id), 'the queue holds the one report').toEqual([journey.reportId]);
        const [report] = answer.data.reports;
        expect([report.type, report.note, report.status, report.decision], 'the kind, the cleaner\'s own note, waiting, not decided').toEqual(['add_items', ITEMS_NOTE, 'open', null]);
        expect(report.by, 'sent by the cleaner').toEqual({ kind: 'cleaner', name: 'Ann' });
        expect(report.booking.id, 'from this job').toBe(journey.bookingId);
        expect(report.booking.number, 'with the booking\'s number').toBe(journey.number);
        expect(report.photo, 'the photo\'s address').toMatch(PHOTO_URL);
        expect(await photoFiles(), 'the photo is a file in the store').toContain(path.basename(report.photo));

        // An approval is a real charge on an app that holds a payment key: it is asked only when the runner has listed the NAMES of the app's variables
        // (E2E_APP_ENV_NAMES, never values) and STRIPE_SECRET_KEY is not one of them (e2e/job-reports.spec.js).
        const names = process.env.E2E_APP_ENV_NAMES;
        const keyless = names !== undefined && !names.split(',').map((name) => name.trim()).includes('STRIPE_SECRET_KEY');
        if (keyless) {
            const approved = await call(ctx, 'POST', `/api/admin/reports/${journey.reportId}`, ctx.admin, { action: 'approve', extras: [{ code: 'oven', quantity: 1 }], expected_cents: 3500 });
            expect([approved.status(), (await approved.json().catch(() => null))?.message], 'approving with no payment key is refused').toEqual([503, DESK_MESSAGES.notConfigured]);
            const [held] = await rows('SELECT status, charge_status, approved_cents, charge_intent_id, decided_by FROM job_reports WHERE id = ?', [journey.reportId]);
            expect([held.status, held.charge_status, held.approved_cents, held.decided_by, held.charge_intent_id], 'and records nothing').toEqual(['open', 'none', null, null, null]);
        }

        const declined = await call(ctx, 'POST', `/api/admin/reports/${journey.reportId}`, ctx.admin, { action: 'decline', note: 'The customer changed their mind' });
        expect(declined.status(), 'the admin declines the report').toBe(200);
        const [after] = await rows('SELECT status, charge_status, approved_cents, charge_intent_id FROM job_reports WHERE id = ?', [journey.reportId]);
        expect([after.status, after.charge_status, after.approved_cents, after.charge_intent_id], 'declined, and nothing charged').toEqual(['declined', 'none', null, null]);
        const [booking] = await rows('SELECT service_price FROM bookings WHERE id = ?', [journey.bookingId]);
        expect(Number(booking.service_price), 'and the booking\'s price has not moved').toBe(RULE_PRICE);
    });

    test('Journey: W2 finish: the provider finishes the job with hours and a crew size of their own choosing, and the bill and the payout are the rule\'s', async ({ playwright, request, baseURL }) => {
        const ctx = await setup(playwright, request, baseURL);
        const finished = await bodyOf(await call(ctx, 'POST', '/api/provider/jobs/time-tracking', ctx.provider1, {
            booking_id: journey.bookingId, action: 'stop', work_summary: 'Done', submitted_duration_minutes: 600, submitted_headcount: 10, adjustment_reason: 'ENG-019 journey probe',
        }), 200, 'the provider finishes the job');
        expect(finished.data.total_earnings, 'the payout the finish answers: the price less the commission').toBe(RULE_PAYOUT);

        const [row] = await rows('SELECT status, service_price, final_provider_amount, submitted_duration_minutes, submitted_headcount FROM bookings WHERE id = ?', [journey.bookingId]);
        expect([row.status, Number(row.service_price), Number(row.final_provider_amount), row.submitted_duration_minutes, row.submitted_headcount], 'the stored price and payout, beside the entries the provider made')
            .toEqual(['awaiting_approval', RULE_PRICE, RULE_PAYOUT, 600, 10]);
    });
});
