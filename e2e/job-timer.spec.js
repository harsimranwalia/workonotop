// @ts-check
// ENG-016: the job's countdown timer and the check-out, through the job link (GET and POST /api/job/{token}/timer, POST /api/job/{token}/check-out)
// and through the provider's own start (POST /api/provider/jobs/time-tracking). The route-level cases of the design's table
// (agents/architect/designs/ENG-016-photos-and-countdown-timer-on-the-job-link.md, "Cases and baseline") for the timer are in this file. Each
// title starts with the design's id, and the file's name, the describe and the title together are its baseline key:
//   AC2  (hard gate) with no before photo the checked-in cleaner, the provider and the admin at the link, and the provider at time-tracking,
//        are each refused a start, nothing is written and the job stays confirmed (an after photo planted in SQL does not count); with a before
//        photo each starts a probe of its own; nobody checked in, a pending job and no position each refuse and write nothing;
//   AC3  three cleaners checked in on a 360-minute job, started: the page, the poll and both panels say crew_here 3, quote_minutes 360 and a clock
//        within seconds of 7200 for the cleaner, the provider and the admin; a quote of NULL (and of 0) reads 60 minutes;
//   AC4  an hour on (rows set back in SQL, never a sleep): a fourth cleaner checking in makes the next poll read 2700, a check-out reads per V4
//        (5400); a cleaner taken off the crew through ENG-014's route is stamped checked out by the next look, once, even when ten looks run at
//        once, and the clock is divided again; the last one out of a running job pauses it (detail last_out);
//   AC5  after a pause, a resume, a late arrival, an early leaver and a cleaner taken off the crew, each cleaner's worked_seconds is what the
//        rows hold (worked out by hand here), they sum to used_seconds, and the removed cleaner's hours are in it;
//   AC6  the first look that finds the labour used sets over_quote_at and writes one over_quote event (ten at once write one, a later look
//        changes nothing); the clock reads 0 and over_seconds above 0; the admin's panel shows over_quote_at; no money column and no payment
//        or invoice row changes;
//   AC7  a whole flow (check-in, photo, start, pause with no position, resume, check-out): the admin's panel lists each event with the actor
//        kind and name, a time and the phone's position where it sent one; none holds a photo address or a fixture number.
// The clock vectors (V1 to V13) are e2e/job-clock.spec.js; the photos, the retention and who gets in are other files' cases. The rows of a job
// are made the way e2e/job-checkin.spec.js makes them (the crew through ENG-014's routes, the link through the provider's route, the booking in
// SQL), and a before photo is planted in SQL where the case is not about the photo route. A case that needs an hour to have passed sets the
// rows back in SQL (job_sessions, job_checkins) and reads the clock the server works out from them: no case sleeps. The config runs one worker,
// so the cases run one at a time and in order. The describe sweeps, before its first case, after every case and after its last, the crew members
// whose number is in this file's block (+1 403 555 0250 to 0269), the bookings whose e-mail address starts with the prefix below (their links,
// codes, check-ins, sessions, photos, logs and events go with them), the photo files those rows named, and the sms_budget counters of those
// numbers, links and members. A failure message names the case, the status and the figures, never a cookie, a token or a code.
import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import mysql from 'mysql2/promise';
import { getCredentialHeaders } from './auth/credentials.js';
import { providers } from '../database/fixtures/accounts.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';
import { sha256Hex } from '../src/lib/link-token.js';
import { budgetScope } from '../src/lib/sms-budget.js';

// Every request carries a fixture account's session header and a trace records request headers: tracing is off, as in e2e/provider-crew.spec.js.
test.use({ trace: 'off' });

const [PROVIDER1] = providers;
const EMAIL_PREFIX = 'e2e-jt-';
// The number block of this file: the digits after '+1 403 555 0'.
const NUMBER_FIRST = 250;
const NUMBER_LAST = 269;
const stored = (n) => `+14035550${n}`;
const typed = (n) => `+1 403 555 0${n}`;

// The address of every probe booking (Calgary) and the phone at the address.
const ADDRESS = { latitude: 51.04473, longitude: -114.07192 };
const HERE = { latitude: ADDRESS.latitude, longitude: ADDRESS.longitude, accuracy: 12.4 };

const MESSAGES = {
    photo: 'Take a before photo first.',
    photoAtProvider: 'Take a before photo first',
    nobodyHere: 'Check in who is here first.',
    notConfirmed: 'This job is not ready to start.',
    location: "We need your phone's location to start the job. Allow location for this page and try again.",
    notCheckedIn: 'That cleaner is not checked in.',
    checkedOut: 'That cleaner has checked out of this job.',
};

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
const photoUrlPattern = /^\/uploads\/job-photos\/[0-9a-f]{32}\.(jpg|png|webp)$/;

// Deletes what this file left: the files of the photos its bookings hold, the sms_budget counters of its numbers, links and members, the bookings
// of its e-mail prefix (links, codes, check-ins, sessions, photos, logs, events and crew rows go with them) and the crew members of its number block.
async function clearRows() {
    const open = await db();
    // The photo store makes its directory when it first needs one, and the dev container runs as root: a directory made here first is the test
    // user's, and the sweep below can remove the files the app writes into it.
    await fs.mkdir(path.join(process.cwd(), 'public', 'uploads', 'job-photos'), { recursive: true });
    const [photos] = /** @type {any[]} */ (await open.execute('SELECT p.photo_url FROM job_photos p JOIN bookings b ON b.id = p.booking_id WHERE b.customer_email LIKE ?', [`${EMAIL_PREFIX}%`]));
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

// A booking of provider 1 that is confirmed, in Calgary, dated yesterday, quoted for `quote` minutes (NULL for none).
async function insertBooking({ quote = 360 } = {}) {
    const id = tag();
    const day = yesterday();
    const [made] = /** @type {any[]} */ (await (await db()).execute(
        `INSERT INTO bookings (booking_number, service_id, service_name, service_price, customer_first_name, customer_last_name, customer_email, customer_phone,
           job_date, job_time_slot, job_description, address_line1, city, status, payment_status, provider_id, latitude, longitude, standard_duration_minutes)
         VALUES (?, 1, 'Probe service', 100.00, 'E2E', 'Probe', ?, ?, ?, ?, 'ENG-016 timer probe, deleted by the case', '1 Probe Street', 'Calgary', 'confirmed', 'pending', ?, ?, ?, ?)`,
        [`E2EJT${id}`, `${EMAIL_PREFIX}${id}@example.invalid`, stored(NUMBER_LAST), day, slotLabel(day, 'Morning'), PROVIDER1.id, ADDRESS.latitude, ADDRESS.longitude, quote]
    ));
    return Number(made.insertId);
}

// Provider 1 adds the cleaners through ENG-014's route, one number each from this file's block, counting from `offset`.
async function addMembers(ctx, names, offset = 0) {
    const made = [];
    for (const [index, name] of names.entries()) {
        const number = NUMBER_FIRST + offset + index;
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
    await (await db()).execute('INSERT INTO crew_number_checks (crew_member_id, phone, code_hash, expires_at, used_at) VALUES (?, ?, ?, NOW(), NOW())', [member.id, current.phone, sha256Hex(`jt-probe:${tag()}`)]);
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
// from a context of its own so that no jar carries it into the next request; it is returned as a `cookie` header value and never printed, with the
// code that was typed, which a case can look for in what the app lists.
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
        return { cookie: String(line).split(';')[0], code };
    } finally {
        await fresh.dispose();
    }
}

// A probe job of provider 1 with its crew, a link made by the provider's route and, with `signIn`, that member signed in (job.cookie and the code
// that was typed, job.code).
async function makeJob(ctx, { members, quote = 360, signIn = null }) {
    const bookingId = await insertBooking({ quote });
    await setCrew(ctx, bookingId, members.map((member) => member.id));
    const created = await dataOf(await ctx.request.post(`/api/provider/jobs/${bookingId}/job-link`, { headers: ctx.as.provider, data: { action: 'create' } }), 200, 'provider 1 makes the job link');
    const linkPath = created.job_link?.path;
    expect(typeof linkPath === 'string' && /^\/job\/[A-Za-z0-9_-]{43}$/.test(linkPath), 'the link has a path of 43 base64url characters').toBe(true);
    const [link] = await rows('SELECT id FROM job_links WHERE booking_id = ?', [bookingId]);
    /** @type {{ bookingId: number, token: string, linkId: number, cookie: string | null, code: string | null }} */
    const job = { bookingId, token: String(linkPath).slice('/job/'.length), linkId: link.id, cookie: null, code: null };
    if (signIn) {
        const session = await signInWith(ctx, job, signIn);
        job.cookie = session.cookie;
        job.code = session.code;
    }
    return job;
}

const asCleaner = (job) => ({ cookie: String(job.cookie) });

// A before or an after photo planted in SQL: a row only, with an address that names no file (the photo route is another file's case).
async function plantPhoto(bookingId, type) {
    const url = `/uploads/job-photos/${tag().padEnd(32, '0')}.jpg`;
    await (await db()).execute('INSERT INTO job_photos (booking_id, photo_url, photo_type, uploaded_by) VALUES (?, ?, ?, ?)', [bookingId, url, type, PROVIDER1.id]);
}

// A check-in, a check-out and the timer, with the body as it is given and with the phone's position as a case gives it.
const tick = async (request, job, headers, ids, location = HERE) => answerOf(await request.post(`/api/job/${job.token}/check-in`, { headers, data: { crew_ids: ids, location } }));
const out = async (request, job, headers, ids, location = HERE) => answerOf(await request.post(`/api/job/${job.token}/check-out`, { headers, data: { crew_ids: ids, location } }));
const readTimer = async (request, job, headers) => answerOf(await request.get(`/api/job/${job.token}/timer`, { headers }));
const act = async (request, job, headers, action, location = HERE) => answerOf(await request.post(`/api/job/${job.token}/timer`, { headers, data: location === null ? { action } : { action, location } }));

async function okOf(answer, who) {
    expect(answer.status, `${who}: status (${answer.body?.success === false ? answer.body.message : 'no message'})`).toBe(200);
    expect(answer.body?.success, `${who}: success`).toBe(true);
    return answer.body.data;
}

const tickOk = async (request, job, headers, ids, who) => okOf(await tick(request, job, headers, ids), `${who} ticks ${JSON.stringify(ids)}`);
const outOk = async (request, job, headers, ids, who) => okOf(await out(request, job, headers, ids), `${who} checks out ${JSON.stringify(ids)}`);
const timerOf = async (request, job, headers, who) => (await okOf(await readTimer(request, job, headers), `${who} reads the timer`)).timer;
const actOk = async (request, job, headers, action, who, location = HERE) => (await okOf(await act(request, job, headers, action, location), `${who} ${action}s the job`)).timer;
const publicView = async (request, job, headers, who) => dataOf(await request.get(`/api/job/${job.token}`, { headers }), 200, `${who} reads the job page`);
const adminView = async (ctx, bookingId) => dataOf(await ctx.request.get(`/api/admin/bookings/${bookingId}/job-link`, { headers: ctx.as.admin }), 200, 'the admin reads the job link panel');
const providerView = async (ctx, bookingId) => dataOf(await ctx.request.get(`/api/provider/jobs/${bookingId}/job-link`, { headers: ctx.as.provider }), 200, 'provider 1 reads the job link panel');

// A job whose cleaners named here are on the crew, the first `here` of them checked in, a before photo taken and the job started by the first.
async function runningJob(ctx, { names, quote = 360, here = names.length, offset = 0 }) {
    const members = await addMembers(ctx, names, offset);
    const job = await makeJob(ctx, { members, quote, signIn: members[0] });
    const cleaner = asCleaner(job);
    await tickOk(ctx.request, job, cleaner, members.slice(0, here).map((member) => member.id), 'the cleaner');
    await plantPhoto(job.bookingId, 'before');
    const timer = await actOk(ctx.request, job, cleaner, 'start', 'the cleaner', HERE);
    return { members, job, cleaner, timer };
}

// ---- the rows ----

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

const eventsOf = (bookingId, kind, detail = null) =>
    rows('SELECT actor_kind, actor_ref, crew_member_id, latitude, longitude, accuracy_m, detail FROM job_link_events WHERE booking_id = ? AND kind = ? AND (? IS NULL OR detail = ?) ORDER BY id', [bookingId, kind, detail, detail]);

// Sets back by `seconds` everything the clock is worked out from: the stretches the job ran and the times the cleaners came and went.
async function rewind(bookingId, seconds) {
    const open = await db();
    await open.execute('UPDATE job_sessions SET clock_in = clock_in - INTERVAL ? SECOND, clock_out = clock_out - INTERVAL ? SECOND WHERE booking_id = ?', [seconds, seconds, bookingId]);
    await open.execute('UPDATE job_checkins SET checked_in_at = checked_in_at - INTERVAL ? SECOND, checked_out_at = checked_out_at - INTERVAL ? SECOND WHERE booking_id = ?', [seconds, seconds, bookingId]);
}

function near(actual, expected, tolerance, what) {
    expect(typeof actual === 'number' && Math.abs(actual - expected) <= tolerance, `${what}: ${actual} is not within ${tolerance} of ${expected}`).toBe(true);
}

// A minimal JPEG the photo store accepts: start of image, a JFIF header, a start of scan with two bytes of data and the end of image.
const TINY_JPEG = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0x34, 0xff, 0xd9,
]);

const TOLERANCE = 6;

test.describe('Job timer: a crew starts, pauses and leaves a job through the link', () => {
    sweepAround();

    test('AC2: (hard gate) with no before photo the cleaner, the provider and the admin at the link and the provider at time-tracking are each refused a start and nothing is written; with one each starts a probe of its own; nobody checked in, a pending job and no position are refused as well', async ({ playwright, request, baseURL }) => {
        test.setTimeout(240_000);
        const ctx = await setup(playwright, request, baseURL);

        // The refusals: a cleaner is checked in, an AFTER photo is there (it does not count), no BEFORE photo.
        const [ann, bea] = await addMembers(ctx, ['Ann', 'Bea']);
        const job = await makeJob(ctx, { members: [ann, bea], signIn: ann });
        const cleaner = asCleaner(job);
        await tickOk(request, job, cleaner, [ann.id], 'the cleaner');
        await plantPhoto(job.bookingId, 'after');
        const before = await writesOf(job.bookingId);
        expect(before.status, 'the probe job is confirmed').toBe('confirmed');
        for (const [who, headers] of [['the checked-in cleaner', cleaner], ['the provider', ctx.as.provider], ['the admin', ctx.as.admin]]) {
            const refused = await act(request, job, headers, 'start');
            expect(refused.status, `${who} starts with no before photo: status`).toBe(409);
            expect(refused.cache, `${who}: no-store`).toContain('no-store');
            expect(refused.body, `${who} starts with no before photo: the refusal`).toEqual({ success: false, message: MESSAGES.photo, reason: 'no_before_photos' });
        }
        const atProvider = await answerOf(await request.post('/api/provider/jobs/time-tracking', { headers: ctx.as.provider, data: { booking_id: job.bookingId, action: 'start' } }));
        expect(atProvider.status, 'the provider starts at time-tracking with no before photo: status').toBe(400);
        expect(atProvider.body?.message, 'the provider at time-tracking: the refusal').toBe(MESSAGES.photoAtProvider);
        expect(await writesOf(job.bookingId), 'four refused starts wrote no session, no log, no history and left the job confirmed').toEqual(before);
        expect((await publicView(request, job, cleaner, 'the cleaner')).timer.blocked, 'the page says why the start is blocked').toBe('no_before_photos');

        // A before photo is there now: the cleaner starts this probe.
        await plantPhoto(job.bookingId, 'before');
        const started = await actOk(request, job, cleaner, 'start', 'the cleaner');
        expect(started.state, 'the cleaner starts the job once a before photo exists').toBe('running');
        const after = await writesOf(job.bookingId);
        expect([after.sessions - before.sessions, after.logs - before.logs, after.history - before.history, after.status, after.timer], 'one session, one log, one history row, in_progress and running').toEqual([1, 1, 1, 'in_progress', 'running']);
        expect((await eventsOf(job.bookingId, 'timer_start')).map((event) => event.actor_kind), 'the start is recorded as the cleaner\'s').toEqual(['cleaner']);

        // The provider and the admin each start a probe of their own at the link.
        let offset = 2;
        for (const [who, headers, kind] of [['the provider', ctx.as.provider, 'provider'], ['the admin', ctx.as.admin, 'admin']]) {
            const [member] = await addMembers(ctx, [`Cy ${kind}`], offset);
            offset += 1;
            const own = await makeJob(ctx, { members: [member] });
            await tickOk(request, own, headers, [member.id], who);
            await plantPhoto(own.bookingId, 'before');
            const timer = await actOk(request, own, headers, 'start', who);
            expect(timer.state, `${who} starts a probe at the link`).toBe('running');
            expect((await writesOf(own.bookingId)).status, `${who}: the job is in progress`).toBe('in_progress');
            expect((await eventsOf(own.bookingId, 'timer_start')).map((event) => event.actor_kind), `${who}: the start names who started it`).toEqual([kind]);
        }

        // The provider's own start, at time-tracking, on a probe of its own.
        const direct = await insertBooking({});
        await plantPhoto(direct, 'before');
        const viaProvider = await answerOf(await request.post('/api/provider/jobs/time-tracking', { headers: ctx.as.provider, data: { booking_id: direct, action: 'start' } }));
        expect(viaProvider.status, `the provider starts at time-tracking with a before photo (${viaProvider.body?.message ?? 'no message'})`).toBe(200);
        expect((await writesOf(direct)).status, 'time-tracking: the job is in progress').toBe('in_progress');

        // The other refusals, on one more probe: nobody checked in, no position, a job that is pending. None writes anything.
        const [dee] = await addMembers(ctx, ['Dee'], offset);
        const w5 = await makeJob(ctx, { members: [dee] });
        await plantPhoto(w5.bookingId, 'before');
        const w5Before = await writesOf(w5.bookingId);
        const nobody = await act(request, w5, ctx.as.provider, 'start');
        expect([nobody.status, nobody.body?.message, nobody.body?.reason], 'nobody is checked in').toEqual([409, MESSAGES.nobodyHere, 'nobody_here']);
        await tickOk(request, w5, ctx.as.provider, [dee.id], 'the provider');
        for (const [what, location] of [['no position', null], ['a position of 0,0', { latitude: 0, longitude: 0, accuracy: 5 }], ['a position in words', { latitude: 'here', longitude: 'there', accuracy: 5 }], ['a latitude of 91', { latitude: 91, longitude: -114, accuracy: 5 }]]) {
            const refused = await act(request, w5, ctx.as.provider, 'start', location);
            expect([refused.status, refused.body?.message], `a start with ${what}`).toEqual([400, MESSAGES.location]);
        }
        await (await db()).execute("UPDATE bookings SET status = 'pending' WHERE id = ?", [w5.bookingId]);
        const pending = await act(request, w5, ctx.as.provider, 'start');
        expect([pending.status, pending.body?.message, pending.body?.reason], 'a pending job is not ready to start').toEqual([409, MESSAGES.notConfirmed, 'not_confirmed']);
        const w5After = await writesOf(w5.bookingId);
        expect({ ...w5After, status: 'confirmed' }, 'the refusals wrote no session, no log and no history row').toEqual(w5Before);
        expect(w5After.status, 'and the job is pending').toBe('pending');
    });

    test('AC3: three cleaners checked in on a 360-minute job and started: crew_here 3, quote_minutes 360 and a clock of 7200 seconds for the cleaner, the provider and the admin, on the page, the poll and both panels; a quote of NULL (and of 0) reads 60 minutes', async ({ playwright, request, baseURL }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const { job, cleaner, timer: started } = await runningJob(ctx, { names: ['Ann', 'Bea', 'Cat'], quote: 360 });
        expect([started.state, started.crew_here, started.quote_minutes], 'the start answers with the timer: running, three here, 360 minutes').toEqual(['running', 3, 360]);
        near(started.clock_seconds, 7200, TOLERANCE, 'the clock right after the start');
        expect(started.can.pause, 'a running job can be paused').toBe(true);

        for (const [who, headers] of [['the cleaner', cleaner], ['the provider', ctx.as.provider], ['the admin', ctx.as.admin]]) {
            const poll = await timerOf(request, job, headers, who);
            expect([poll.state, poll.crew_here, poll.quote_minutes], `${who}: the poll`).toEqual(['running', 3, 360]);
            near(poll.clock_seconds, 7200, TOLERANCE, `${who}: the poll's clock`);
            const page = (await publicView(request, job, headers, who)).timer;
            expect([page.state, page.crew_here, page.quote_minutes], `${who}: the page`).toEqual(['running', 3, 360]);
            near(page.clock_seconds, 7200, TOLERANCE, `${who}: the page's clock`);
        }
        for (const [who, view] of [['the provider\'s panel', await providerView(ctx, job.bookingId)], ['the admin\'s panel', await adminView(ctx, job.bookingId)]]) {
            expect([view.timer.state, view.timer.crew_here, view.timer.quote_minutes], who).toEqual(['running', 3, 360]);
            near(view.timer.clock_seconds, 7200, TOLERANCE, `${who}: the clock`);
        }

        // A quote that is not there reads 60 minutes: a job with one cleaner, not started, quoted NULL and then 0.
        const [dee] = await addMembers(ctx, ['Dee'], 3);
        const bare = await makeJob(ctx, { members: [dee], quote: null });
        expect((await timerOf(request, bare, ctx.as.provider, 'the provider')).quote_minutes, 'NULL reads 60 minutes').toBe(60);
        await (await db()).execute('UPDATE bookings SET standard_duration_minutes = 0 WHERE id = ?', [bare.bookingId]);
        const zero = await timerOf(request, bare, ctx.as.provider, 'the provider');
        expect([zero.quote_minutes, zero.state], '0 reads 60 minutes too, and a job not started says so').toEqual([60, 'not_started']);
    });

    test('AC5: a job restarted while it ran leaves a stretch open: the next look reads a job that has not started with nothing used, and the new start closes the stale stretch so that no labour is counted twice', async ({ playwright, request, baseURL }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const { job, cleaner } = await runningJob(ctx, { names: ['Ann', 'Bea'], quote: 120 });
        await rewind(job.bookingId, 1800);
        expect(await countOf('SELECT COUNT(*) AS n FROM job_sessions WHERE booking_id = ? AND clock_out IS NULL', [job.bookingId]), 'the run left one stretch open').toBe(1);

        // The admin's restart puts the booking back to confirmed and does not close the stretch the provider's timer left open.
        await (await db()).execute("UPDATE bookings SET status = 'confirmed', job_timer_status = 'not_started', start_time = NULL WHERE id = ?", [job.bookingId]);
        const idle = await timerOf(request, job, cleaner, 'the cleaner');
        expect([idle.state, idle.used_seconds, idle.crew_here, idle.clock_seconds], 'a job that has not started has done no labour: 7200 seconds shared between two').toEqual(['not_started', 0, 2, 3600]);

        const started = await actOk(request, job, cleaner, 'start', 'the cleaner');
        expect(started.state, 'the cleaner starts the job again').toBe('running');
        expect(started.used_seconds < 60, `the stale stretch is not counted beside the new one (${started.used_seconds} seconds used)`).toBe(true);
        expect(await countOf('SELECT COUNT(*) AS n FROM job_sessions WHERE booking_id = ? AND clock_out IS NULL', [job.bookingId]), 'one stretch is open: the new one').toBe(1);
    });

    test('AC4: an hour on, a fourth cleaner checking in makes the next poll read 2700 and a check-out reads per V4 (5400); the last one out of a running job pauses it', async ({ playwright, request, baseURL }) => {
        test.setTimeout(240_000);
        const ctx = await setup(playwright, request, baseURL);

        // Three here from the start, an hour on, a fourth arrives: 360 minutes of labour, 3 hours used, 3 hours left among four.
        const first = await runningJob(ctx, { names: ['Ann', 'Bea', 'Cat', 'Dee'], quote: 360, here: 3 });
        await rewind(first.job.bookingId, 3600);
        await tickOk(request, first.job, first.cleaner, [first.members[3].id], 'the cleaner');
        const four = await timerOf(request, first.job, first.cleaner, 'the cleaner');
        expect(four.crew_here, 'four are here').toBe(4);
        near(four.used_seconds, 10800, 15, 'three hours of labour are used');
        near(four.clock_seconds, 2700, TOLERANCE, 'the clock among four (V3)');

        // Three here, an hour on, one checks out: V4.
        const second = await runningJob(ctx, { names: ['Eve', 'Fay', 'Gus'], quote: 360, offset: 4 });
        await rewind(second.job.bookingId, 3600);
        const left = await outOk(request, second.job, second.cleaner, [second.members[2].id], 'the cleaner');
        expect(left.checked_out, 'the answer names the cleaner who left').toEqual([second.members[2].id]);
        const two = await timerOf(request, second.job, ctx.as.admin, 'the admin');
        expect([two.state, two.crew_here], 'two are here and the job runs').toEqual(['running', 2]);
        near(two.clock_seconds, 5400, 10, 'the clock among two (V4)');
        const gone = two.per_member.find((member) => member.id === second.members[2].id);
        expect(gone?.checked_out_at !== null && gone?.checked_out_at !== undefined, 'the one who left shows a time out').toBe(true);
        near(gone?.worked_seconds, 3600, TOLERANCE, 'the hour the one who left worked is kept');

        // A repeat is the cleaner's mistake and not a silent success; a cleaner who left cannot tick in again.
        const again = await out(request, second.job, second.cleaner, [second.members[2].id]);
        expect([again.status, again.body?.message], 'a second check-out of the same cleaner').toEqual([409, MESSAGES.notCheckedIn]);
        const back = await tick(request, second.job, second.cleaner, [second.members[2].id]);
        expect([back.status, back.body?.message], 'a cleaner who has checked out cannot check in again').toEqual([409, MESSAGES.checkedOut]);

        // The last two out: the first leaves the job running, the last one out pauses it.
        const one = await outOk(request, second.job, second.cleaner, [second.members[1].id], 'the cleaner');
        expect(one.timer.state, 'with one here the job runs').toBe('running');
        const last = await outOk(request, second.job, second.cleaner, [second.members[0].id], 'the cleaner');
        expect(last.timer.state, 'the last one out pauses the job').toBe('paused');
        expect((await eventsOf(second.job.bookingId, 'timer_pause', 'last_out')).length, 'one timer_pause with the detail last_out').toBe(1);
        expect((await eventsOf(second.job.bookingId, 'check_out')).length, 'three check_out events, one for each who left').toBe(3);
        expect(await countOf('SELECT COUNT(*) AS n FROM job_sessions WHERE booking_id = ? AND clock_out IS NULL', [second.job.bookingId]), 'no stretch is left open').toBe(0);
        expect((await writesOf(second.job.bookingId)).timer, 'the booking says paused').toBe('paused');
        const resumeNobody = await act(request, second.job, ctx.as.provider, 'resume');
        expect([resumeNobody.status, resumeNobody.body?.reason], 'nobody is here to resume the clock for').toEqual([409, 'nobody_here']);
    });

    test('AC4: a cleaner taken off the crew is stamped checked out by the next look, once, even when ten looks run at once, and the clock is divided again', async ({ playwright, request, baseURL }) => {
        test.setTimeout(240_000);
        const ctx = await setup(playwright, request, baseURL);
        const { members, job, cleaner } = await runningJob(ctx, { names: ['Ann', 'Bea', 'Cat'], quote: 360 });
        await rewind(job.bookingId, 3600);

        // ENG-014's route takes Cat off the crew: nothing in that route knows about the timer.
        await setCrew(ctx, job.bookingId, [members[0].id, members[1].id]);
        expect(await countOf('SELECT COUNT(*) AS n FROM job_checkins WHERE booking_id = ? AND crew_member_id = ? AND checked_out_at IS NULL', [job.bookingId, members[2].id]), 'before anybody looks Cat is ticked in').toBe(1);

        const looks = await Promise.all(Array.from({ length: 10 }, () => readTimer(request, job, cleaner)));
        for (const [index, look] of looks.entries()) {
            expect([look.status, look.body?.success], `look ${index + 1} answers`).toEqual([200, true]);
            expect(look.body.data.timer.crew_here, `look ${index + 1}: two are here`).toBe(2);
        }
        const removed = await eventsOf(job.bookingId, 'check_out', 'removed');
        expect(removed.map((event) => event.crew_member_id), 'one check_out event with the detail removed, about Cat, for ten looks').toEqual([members[2].id]);
        expect(removed[0].actor_kind, 'the event names whoever looked').toBe('cleaner');
        expect(await countOf('SELECT COUNT(*) AS n FROM job_checkins WHERE booking_id = ? AND crew_member_id = ? AND checked_out_at IS NOT NULL', [job.bookingId, members[2].id]), 'Cat is stamped checked out').toBe(1);

        const now = await timerOf(request, job, ctx.as.provider, 'the provider');
        expect([now.state, now.crew_here], 'the job runs with two').toEqual(['running', 2]);
        near(now.clock_seconds, 5400, 10, 'the clock is divided again (V4)');
        const cat = now.per_member.find((member) => member.id === members[2].id);
        near(cat?.worked_seconds, 3600, TOLERANCE, "Cat's hour is kept");
        expect((await eventsOf(job.bookingId, 'check_out', 'removed')).length, 'looking again writes no second event').toBe(1);
        expect((await eventsOf(job.bookingId, 'timer_pause')).length, 'two are here, so nothing paused').toBe(0);

        // The last cleaners taken off the crew pause a running job at the next look.
        await setCrew(ctx, job.bookingId, [members[0].id]);
        await readTimer(request, job, cleaner);
        const paused = await timerOf(request, job, ctx.as.admin, 'the admin');
        expect(paused.crew_here, 'one is here').toBe(1);
        await setCrew(ctx, job.bookingId, []);
        const bare = await timerOf(request, job, ctx.as.provider, 'the provider');
        expect([bare.state, bare.crew_here], 'with nobody left the next look pauses the job').toEqual(['paused', 0]);
        expect((await eventsOf(job.bookingId, 'timer_pause', 'last_out')).length, 'one timer_pause with the detail last_out').toBe(1);
    });

    test('AC5: after a pause, a resume, a late arrival, an early leaver and a cleaner taken off the crew each cleaner\'s worked seconds are what the rows hold, they sum to the seconds used, and the removed cleaner\'s hours are in the sum', async ({ playwright, request, baseURL }) => {
        test.setTimeout(240_000);
        const ctx = await setup(playwright, request, baseURL);
        const { members, job } = await runningJob(ctx, { names: ['Ann', 'Bea', 'Cat', 'Dee'], quote: 360 });
        const [ann, bea, cat, dee] = members;
        const open = await db();

        // The timeline, in seconds before now (T): the job ran from T-7000 to T-4000, was paused, and ran again from T-3000.
        // Ann, Bea and Cat came at T-7000, Dee at T-3500; Bea left at T-2000 and Cat is taken off the crew below.
        const [{ t }] = await rows('SELECT UNIX_TIMESTAMP() AS t');
        const T = Number(t);
        await open.execute('UPDATE job_sessions SET clock_in = FROM_UNIXTIME(?), clock_out = FROM_UNIXTIME(?) WHERE booking_id = ?', [T - 7000, T - 4000, job.bookingId]);
        await open.execute('INSERT INTO job_sessions (booking_id, provider_id, clock_in) VALUES (?, ?, FROM_UNIXTIME(?))', [job.bookingId, PROVIDER1.id, T - 3000]);
        for (const [member, from] of [[ann, 7000], [bea, 7000], [cat, 7000], [dee, 3500]]) {
            await open.execute('UPDATE job_checkins SET checked_in_at = FROM_UNIXTIME(?) WHERE booking_id = ? AND crew_member_id = ?', [T - from, job.bookingId, member.id]);
        }
        await open.execute('UPDATE job_checkins SET checked_out_at = FROM_UNIXTIME(?) WHERE booking_id = ? AND crew_member_id = ?', [T - 2000, job.bookingId, bea.id]);
        await setCrew(ctx, job.bookingId, [ann.id, bea.id, dee.id]);

        const view = await timerOf(request, job, ctx.as.provider, 'the provider');
        const elapsed = view.server_now - T;
        const worked = Object.fromEntries(view.per_member.map((member) => [member.name, member.worked_seconds]));
        // Ann: the whole of both stretches (3000 and 3000 plus the time since). Bea: 3000 and the 1000 of the second before she left. Cat: both
        // stretches until the look that stamped him. Dee: the second stretch from T-3000 (he came during the pause).
        near(worked.Ann, 6000 + elapsed, TOLERANCE, 'Ann');
        near(worked.Bea, 4000, TOLERANCE, 'Bea, who left early');
        near(worked.Cat, 6000 + elapsed, TOLERANCE, 'Cat, who was taken off the crew while checked in');
        near(worked.Dee, 3000 + elapsed, TOLERANCE, 'Dee, who came during the pause');
        expect(view.per_member.length, 'everyone who was ever here is listed, the removed cleaner too').toBe(4);
        const sum = view.per_member.reduce((total, member) => total + member.worked_seconds, 0);
        near(view.used_seconds, sum, 2, 'the cleaners\' seconds sum to the seconds used');
        expect([view.state, view.crew_here], 'two are here: Ann and Dee').toEqual(['running', 2]);
        near(view.used_seconds, 19000 + 3 * elapsed, 3 * TOLERANCE, 'the seconds used are the hand-worked sum');
    });

    test('AC6: the first look that finds the labour used sets over_quote_at and writes one over_quote event, ten at once write one and a later look changes nothing; the clock reads 0, the admin sees the flag, and no money column and no payment or invoice row changes', async ({ playwright, request, baseURL }) => {
        test.setTimeout(240_000);
        const ctx = await setup(playwright, request, baseURL);
        const { job, cleaner } = await runningJob(ctx, { names: ['Ann'], quote: 60 });
        // The whole row of the booking but the two columns the flag moves (over_quote_at, and updated_at, which follows any change to the row). A bill
        // for the overrun would be written to a price, a payment or an overtime column, and one of a column added later is read here without a change.
        const money = async () => {
            const [booking] = await rows('SELECT * FROM bookings WHERE id = ?', [job.bookingId]);
            delete booking.over_quote_at;
            delete booking.updated_at;
            return booking;
        };
        // Counted for this booking only, so that a row another run writes to the shared database between the two counts is not this case's red.
        const tables = async () => ({
            invoices: await countOf('SELECT COUNT(*) AS n FROM invoices WHERE booking_id = ?', [job.bookingId]),
            payouts: await countOf('SELECT COUNT(*) AS n FROM provider_payouts WHERE booking_id = ?', [job.bookingId]),
        });
        const moneyBefore = await money();
        const tablesBefore = await tables();
        expect(Object.keys(moneyBefore), 'the row read holds the columns that bill an overrun').toEqual(expect.arrayContaining(['overtime_minutes', 'overtime_earnings', 'additional_price', 'final_provider_amount']));

        const early = await timerOf(request, job, cleaner, 'the cleaner');
        expect([early.over_quote_at, early.over_seconds], 'inside the quote nothing is flagged').toEqual([null, null]);

        // Two hours on one cleaner's labour of one hour: the quote was used up an hour ago.
        await rewind(job.bookingId, 7200);
        const looks = await Promise.all(Array.from({ length: 10 }, () => readTimer(request, job, cleaner)));
        for (const [index, look] of looks.entries()) {
            expect([look.status, look.body?.success], `look ${index + 1} answers`).toEqual([200, true]);
            expect(look.body.data.timer.clock_seconds, `look ${index + 1}: nothing is left on the clock`).toBe(0);
            expect(look.body.data.timer.over_seconds > 0, `look ${index + 1}: the job is over the quote`).toBe(true);
        }
        const [flag] = await rows('SELECT UNIX_TIMESTAMP(over_quote_at) AS flagged FROM bookings WHERE id = ?', [job.bookingId]);
        expect(flag.flagged !== null, 'over_quote_at is set').toBe(true);
        expect((await eventsOf(job.bookingId, 'over_quote')).length, 'ten looks wrote one over_quote event').toBe(1);

        const later = await timerOf(request, job, ctx.as.provider, 'the provider');
        const [again] = await rows('SELECT UNIX_TIMESTAMP(over_quote_at) AS flagged FROM bookings WHERE id = ?', [job.bookingId]);
        expect(again.flagged, 'a later look leaves the flag where it was').toBe(flag.flagged);
        expect((await eventsOf(job.bookingId, 'over_quote')).length, 'and writes no second event').toBe(1);
        expect(later.over_quote_at !== null, 'the poll carries the flag').toBe(true);
        near(later.over_seconds, 3600, 15, 'an hour over the quote');

        const panel = await adminView(ctx, job.bookingId);
        expect(panel.timer.over_quote_at !== null, "the admin's panel shows over_quote_at").toBe(true);
        expect(panel.events.filter((event) => event.kind === 'over_quote').length, "and lists the over_quote event").toBe(1);
        expect(await money(), 'no money column of the booking changed').toEqual(moneyBefore);
        expect(await tables(), 'no invoice and no payout row was made').toEqual(tablesBefore);
    });

    test('AC7: a whole flow (check-in, photo, start, pause with no position, resume, check-out): the admin\'s panel lists each event with the actor and a time, and the phone\'s position where it sent one; none holds a photo address or a number', async ({ playwright, request, baseURL }) => {
        test.setTimeout(240_000);
        const ctx = await setup(playwright, request, baseURL);
        const [ann] = await addMembers(ctx, ['Ann']);
        const job = await makeJob(ctx, { members: [ann], quote: 60, signIn: ann });
        const cleaner = asCleaner(job);

        await tickOk(request, job, cleaner, [ann.id], 'the cleaner');
        const photo = await answerOf(await request.post(`/api/job/${job.token}/photos`, {
            headers: cleaner,
            multipart: { type: 'before', latitude: String(HERE.latitude), longitude: String(HERE.longitude), accuracy: String(HERE.accuracy), photo: { name: 'before.jpg', mimeType: 'image/jpeg', buffer: TINY_JPEG } },
        }));
        expect(photo.status, `the cleaner adds a before photo (${photo.body?.message ?? 'no message'})`).toBe(200);
        await actOk(request, job, cleaner, 'start', 'the cleaner');
        await actOk(request, job, cleaner, 'pause', 'the cleaner', null);
        await actOk(request, job, cleaner, 'resume', 'the cleaner');
        const left = await outOk(request, job, cleaner, [ann.id], 'the cleaner');
        expect(left.timer.state, 'the last one out of a running job pauses it').toBe('paused');

        const panel = await adminView(ctx, job.bookingId);
        const events = panel.events;
        const ofKind = (kind) => events.filter((event) => event.kind === kind);
        for (const kind of ['check_in', 'photo_added', 'timer_start', 'timer_pause', 'timer_resume', 'check_out']) {
            expect(ofKind(kind).length > 0, `the panel lists a ${kind} event`).toBe(true);
            for (const event of ofKind(kind)) {
                expect([event.actor.kind, event.actor.name], `${kind}: who did it`).toEqual(['cleaner', 'Ann']);
                expect(Number.isFinite(Date.parse(event.created_at)), `${kind}: a time`).toBe(true);
            }
        }
        expect(ofKind('photo_added')[0].detail, 'the photo event says before and nothing more').toBe('before');
        const pauses = ofKind('timer_pause');
        expect(pauses.length, 'a pause by hand and the pause of the last one out').toBe(2);
        const byHand = pauses.find((event) => event.detail === null);
        const lastOut = pauses.find((event) => event.detail === 'last_out');
        expect([byHand !== undefined, lastOut !== undefined], 'one pause is the cleaner\'s and one is last_out').toEqual([true, true]);
        expect([byHand?.latitude, byHand?.longitude, byHand?.accuracy_m], 'the pause sent no position, so it is recorded with none').toEqual([null, null, null]);
        for (const kind of ['photo_added', 'timer_start', 'timer_resume', 'check_out']) {
            expect([ofKind(kind)[0].latitude, ofKind(kind)[0].longitude], `${kind}: the phone's position`).toEqual([ADDRESS.latitude, ADDRESS.longitude]);
        }
        const text = JSON.stringify(events);
        expect(/\/uploads\/|job-photos|\.jpg/.test(text), 'no event holds a photo address').toBe(false);
        expect(/403[\s().-]*555[\s.-]*02\d\d/.test(text), 'no event holds a fixture number').toBe(false);
        // The code that was typed is looked for in the text of the events, numbers left out so that no id or coordinate can hold six digits by chance;
        // a code that is not six digits, or a search that finds no text at all, would find nothing for the wrong reason.
        expect(job.code, 'the code that was typed is six digits').toMatch(/^\d{6}$/);
        const words = JSON.stringify(events, (_key, value) => (typeof value === 'number' ? undefined : value));
        expect(words.includes('Ann'), 'the text searched holds the strings of the events, the cleaner\'s name among them').toBe(true);
        expect(words.includes(String(job.code)), 'no event holds the sign-in code').toBe(false);
        expect(
            await countOf("SELECT COUNT(*) AS n FROM job_link_events WHERE booking_id = ? AND kind IN ('photo_added','check_out','timer_start','timer_pause','timer_resume','over_quote') AND detail IS NOT NULL AND detail NOT IN ('before','after','last_out','removed')", [job.bookingId]),
            'the detail of a photo, a timer or a check-out event is one of the fixed codes'
        ).toBe(0);
    });
});
