// @ts-check
// ENG-015: a crew ticks itself in at the job through the job link (POST /api/job/{token}/check-in). The route-level cases of the design's table
// (agents/architect/designs/ENG-015-secure-job-link-and-crew-check-in.md, "Cases and baseline") for the check-in are in this file. Each title
// starts with the design's id, and the file's name, the describe and the title together are its baseline key:
//   AC8   (one cleaner's session ticks three members) three rows, three events, checked_in of three, and the two others never opened the link:
//         no code and no session row for them;
//   AC9   after three, one more id is added: the first three are `already` on a repeat, a PUT that only adds a cleaner keeps the three ticks, and
//         the view shows four;
//   AC10  (hard gate, at the route) a job dated tomorrow, and one dated today whose window has not opened, are the 409 with opens_at and
//         opens_label for EVERY kind of caller (cleaner, provider, admin) and write no row; a job dated today after its window opened is a 200
//         for each of them;
//   AC11  (hard gate) a booking with coordinates: a check-in at the address has away 0, one 2 km off has away 1 and the admin's GET shows
//         away: true with distance_m; no location, {0,0}, strings, NaN, 91 degrees and the like are each a 400 and write no row; a booking
//         without coordinates records away NULL, which the admin's panel words as "no position to compare" (the API says null, never false);
//   AC15  the view lists every assigned member with checked_in; taking one off the job through ENG-014's routes drops them from it; putting
//         them back shows them unchecked (and a member removed from the crew list and added again is unchecked too).
// The window, the haversine, the retention and the pins are other files' cases. The rows of a job are made the way e2e/provider-crew.spec.js
// makes them where it can (the crew through ENG-014's routes, the link through the provider's route), with two exceptions that keep the cases
// quick and exact: the booking is inserted in SQL (its date, slot and coordinates are what the cases place), and a member's number is marked
// checked by inserting the proof row (the number check itself is another file's case). SMS is not configured in dev, so a route case cannot read
// a code: it asks through the route, reads code_hash in SQL and finds the six digits by hashing all 10^6 candidates with sha256Hex.
// Every probe booking is in Calgary, which the window code puts in America/Toronto (no cluster), so British Columbia's clock change does not
// enter. The config runs one worker, so the cases run one at a time and in order. The describe sweeps, before its first case, after every case
// and after its last, the crew members whose number is in this file's block (+1 403 555 0140 to 0159), the bookings whose e-mail address starts
// with the prefix below (their links, codes, check-ins, events and crew rows go with them) and the sms_budget counters of those numbers,
// links and members. Request headers carry a fixture account's session or the cleaner's cookie, and a failure message names the case, the
// status and the figures, never a cookie, a token or a code.
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
const EMAIL_PREFIX = 'e2e-jc-';
// The number block of this file: the digits after '+1 403 555 0'.
const NUMBER_FIRST = 140;
const NUMBER_LAST = 159;
const stored = (n) => `+14035550${n}`;
const typed = (n) => `+1 403 555 0${n}`;

// The address of every probe booking with a position (Calgary), the phone at the address, and a phone about 2 km north of it.
const ADDRESS = { latitude: 51.04473, longitude: -114.07192 };
const HERE = { latitude: ADDRESS.latitude, longitude: ADDRESS.longitude, accuracy: 12.4 };
const TWO_KM_OFF = { latitude: ADDRESS.latitude + 0.018, longitude: ADDRESS.longitude, accuracy: 30 };
const NEEDS_LOCATION = "We need your phone's location to check in. Allow location for this page and try again.";
const SIGN_IN = 'Enter your code to continue.';

// ---- the job's own clock: every probe booking falls in America/Toronto ----

const ZONE = 'America/Toronto';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// The hour a slot's window opens: an hour before 8:00, 12:00 and 16:00.
const OPENING_HOUR = { Morning: 7, Afternoon: 11, Evening: 15 };

// The wall clock of an instant in Toronto: { day: 'YYYY-MM-DD', hour, minute }.
function wallClock(instant) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(instant);
    const get = (type) => parts.find((part) => part.type === type)?.value ?? '';
    return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24, minute: Number(get('minute')) };
}

const plusDays = (day, count) => new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + count)).toISOString().slice(0, 10);
// A label as the checkout writes one day's slot: 'Oct 17: Morning'.
const slotLabel = (day, slot) => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}: ${slot}`;
const clockText = (hour) => `${hour % 12 === 0 ? 12 : hour % 12}:00 ${hour < 12 ? 'AM' : 'PM'}`;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekdayOf = (day) => WEEKDAYS[new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)))).getUTCDay()];

// Where "today" can put a window right now: the latest slot whose window opened at least 3 minutes ago (null before 07:03 in Toronto) and the
// earliest slot whose window opens at least 2 hours from now (null after 13:00).
function placeToday() {
    const now = wallClock(new Date());
    const minutes = now.hour * 60 + now.minute;
    const slots = Object.entries(OPENING_HOUR);
    const opened = slots.filter(([, hour]) => hour * 60 + 3 <= minutes).sort((a, b) => b[1] - a[1])[0];
    const notYet = slots.filter(([, hour]) => hour * 60 >= minutes + 120).sort((a, b) => a[1] - b[1])[0];
    return { today: now.day, yesterday: plusDays(now.day, -1), tomorrow: plusDays(now.day, 1), opened: opened?.[0] ?? null, notYet: notYet?.[0] ?? null };
}

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
const checkinCount = (bookingId) => countOf('SELECT COUNT(*) AS n FROM job_checkins WHERE booking_id = ?', [bookingId]);
const tickEventCount = (bookingId) => countOf("SELECT COUNT(*) AS n FROM job_link_events WHERE booking_id = ? AND kind = 'check_in'", [bookingId]);

// Deletes what this file left: the sms_budget counters of its numbers, links and members, the bookings of its e-mail prefix (links, codes,
// check-ins, events and crew rows go with them) and the crew members of its number block (their number checks go with them).
async function clearRows() {
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

const numeric = (a, b) => a - b;
const idsOf = (members) => members.map((member) => member.id).sort(numeric);

let sequence = 0;
const tag = () => `${Date.now().toString(36)}${(sequence += 1)}`;

// A booking of provider 1 that is confirmed, in Calgary, with a date and the slot's label placed by the case, and with or without a position.
async function insertBooking({ day, slot, coords }) {
    const id = tag();
    const [made] = /** @type {any[]} */ (await (await db()).execute(
        `INSERT INTO bookings (booking_number, service_id, service_name, service_price, customer_first_name, customer_last_name, customer_email, customer_phone,
           job_date, job_time_slot, job_description, address_line1, city, status, payment_status, provider_id, latitude, longitude)
         VALUES (?, 1, 'Probe service', 100.00, 'E2E', 'Probe', ?, ?, ?, ?, 'ENG-015 check-in probe, deleted by the case', '1 Probe Street', 'Calgary', 'confirmed', 'pending', ?, ?, ?)`,
        [`E2EJC${id}`, `${EMAIL_PREFIX}${id}@example.invalid`, stored(NUMBER_LAST), day, slotLabel(day, slot), PROVIDER1.id, coords ? ADDRESS.latitude : null, coords ? ADDRESS.longitude : null]
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
    await (await db()).execute('INSERT INTO crew_number_checks (crew_member_id, phone, code_hash, expires_at, used_at) VALUES (?, ?, ?, NOW(), NOW())', [member.id, current.phone, sha256Hex(`jc-probe:${tag()}`)]);
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
async function makeJob(ctx, { day, slot, coords = true, members, signIn = null }) {
    const bookingId = await insertBooking({ day, slot, coords });
    await setCrew(ctx, bookingId, members.map((member) => member.id));
    const created = await dataOf(await ctx.request.post(`/api/provider/jobs/${bookingId}/job-link`, { headers: ctx.as.provider, data: { action: 'create' } }), 200, 'provider 1 makes the job link');
    const path = created.job_link?.path;
    expect(typeof path === 'string' && /^\/job\/[A-Za-z0-9_-]{43}$/.test(path), 'the link has a path of 43 base64url characters').toBe(true);
    const [link] = await rows('SELECT id FROM job_links WHERE booking_id = ?', [bookingId]);
    /** @type {{ bookingId: number, token: string, linkId: number, cookie: string | null }} */
    const job = { bookingId, token: String(path).slice('/job/'.length), linkId: link.id, cookie: null };
    if (signIn) job.cookie = await signInWith(ctx, job, signIn);
    return job;
}

const asCleaner = (job) => ({ cookie: String(job.cookie) });

// A check-in with the body as it is given, and with the position as a case gives it.
async function postTick(request, job, headers, body) {
    return answerOf(await request.post(`/api/job/${job.token}/check-in`, { headers, data: body }));
}
const tick = (request, job, headers, crewIds, location = HERE) => postTick(request, job, headers, { crew_ids: crewIds, location });

// A tick that must be a 200: the data of its answer.
async function tickOk(request, job, headers, crewIds, who, location = HERE) {
    const answer = await tick(request, job, headers, crewIds, location);
    expect(answer.status, `${who} ticks ${JSON.stringify(crewIds)}: status (${answer.body?.success === false ? answer.body.message : 'no message'})`).toBe(200);
    expect(answer.body?.success, `${who} ticks: success`).toBe(true);
    return answer.body.data;
}

const publicView = async (request, job, headers, who) => dataOf(await request.get(`/api/job/${job.token}`, { headers }), 200, `${who} reads the job page`);
const adminView = async (ctx, bookingId) => dataOf(await ctx.request.get(`/api/admin/bookings/${bookingId}/job-link`, { headers: ctx.as.admin }), 200, 'the admin reads the job link panel');
const providerView = async (ctx, bookingId) => dataOf(await ctx.request.get(`/api/provider/jobs/${bookingId}/job-link`, { headers: ctx.as.provider }), 200, 'provider 1 reads the job link panel');

// The rows of job_checkins for a job, one per member, with the epoch of the member's assignment beside each.
const checkinRows = (bookingId) =>
    rows(
        `SELECT c.crew_member_id, c.assignment_epoch, c.by_kind, c.by_ref, c.latitude, c.longitude, c.accuracy_m, c.distance_m, c.away, UNIX_TIMESTAMP(bc.assigned_at) AS assigned_epoch
         FROM job_checkins c LEFT JOIN booking_crew bc ON bc.booking_id = c.booking_id AND bc.crew_member_id = c.crew_member_id
         WHERE c.booking_id = ? ORDER BY c.id`,
        [bookingId]
    );

const CREW_KEYS = ['checked_in', 'checked_in_at', 'id', 'name'];

test.describe('Job link check-in: a crew ticks in at the job', () => {
    sweepAround();

    test('AC8: a cleaner session ticks three members: three rows, three events, checked_in of three, and the two others never opened the link (no code and no session row for them)', async ({ playwright, request, baseURL }) => {
        test.setTimeout(120_000);
        const ctx = await setup(playwright, request, baseURL);
        const [ann, bea, cat] = await addMembers(ctx, ['Ann', 'Bea', 'Cat']);
        const job = await makeJob(ctx, { day: placeToday().yesterday, slot: 'Morning', members: [ann, bea, cat], signIn: ann });
        const cleaner = asCleaner(job);

        const before = await publicView(request, job, cleaner, 'the signed-in cleaner');
        expect(before.access, 'the cookie of the link is a cleaner session').toBe('cleaner');
        expect(before.crew.length, 'the view lists the three on the job').toBe(3);
        expect(before.crew.every((member) => member.checked_in === false && member.checked_in_at === null), 'nobody is ticked yet').toBe(true);
        expect(before.window.open, 'the window of a job dated yesterday is open').toBe(true);

        const data = await tickOk(request, job, cleaner, [ann.id, bea.id, cat.id], 'the cleaner');
        expect(data.checked_in, 'the three ids ticked, in the order asked').toEqual([ann.id, bea.id, cat.id]);
        expect(data.already, 'none of them was ticked before').toEqual([]);
        expect(data.away, 'a phone at the address is not away').toBe(false);
        expect(data.crew.length, 'the answer lists the three').toBe(3);
        expect(data.crew.every((member) => member.checked_in === true && typeof member.checked_in_at === 'string'), 'checked_in of three: all three are ticked, with a time').toBe(true);
        expect(data.crew.every((member) => JSON.stringify(Object.keys(member).sort()) === JSON.stringify(CREW_KEYS)), 'the crew in the answer is names and ticks only, no number').toBe(true);

        const checkins = await checkinRows(job.bookingId);
        expect(checkins.map((row) => row.crew_member_id).sort(numeric), 'three job_checkins rows, one per member').toEqual(idsOf([ann, bea, cat]));
        expect(checkins.every((row) => row.by_kind === 'cleaner' && row.by_ref === ann.id), 'each row says the signed-in cleaner ticked it').toBe(true);
        expect(checkins.every((row) => Number(row.assignment_epoch) === Number(row.assigned_epoch) && Number(row.assignment_epoch) > 1_700_000_000), "each row carries the second the member was put on the job (booking_crew's assigned_at)").toBe(true);
        expect(checkins.every((row) => Number(row.latitude) === ADDRESS.latitude && Number(row.longitude) === ADDRESS.longitude && row.accuracy_m === 12), "each row keeps the phone's position and its accuracy rounded to metres").toBe(true);

        const events = await rows("SELECT crew_member_id, actor_kind, actor_ref, latitude, longitude FROM job_link_events WHERE booking_id = ? AND kind = 'check_in' ORDER BY crew_member_id", [job.bookingId]);
        expect(events.map((row) => row.crew_member_id), 'three check_in events, one about each member').toEqual(idsOf([ann, bea, cat]));
        expect(events.every((row) => row.actor_kind === 'cleaner' && row.actor_ref === ann.id), 'each event names the cleaner who ticked').toBe(true);
        expect(events.every((row) => Number(row.latitude) === ADDRESS.latitude && Number(row.longitude) === ADDRESS.longitude), 'each event carries the same position as its row').toBe(true);

        const codes = await rows('SELECT crew_member_id, session_hash IS NOT NULL AS has_session FROM job_link_codes WHERE link_id = ?', [job.linkId]);
        expect(codes.filter((row) => row.crew_member_id === bea.id || row.crew_member_id === cat.id), 'no code row and no session row for the two who never opened the link').toEqual([]);
        expect(codes.filter((row) => Number(row.has_session) === 1).map((row) => row.crew_member_id), 'the one session on the link is the cleaner who signed in').toEqual([ann.id]);

        const after = await publicView(request, job, cleaner, 'the signed-in cleaner');
        expect(after.crew.filter((member) => member.checked_in).length, 'the page now shows three ticked').toBe(3);
        const panel = await adminView(ctx, job.bookingId);
        expect(panel.checkins.length, "the admin's panel lists the three check-ins").toBe(3);
        expect(panel.events.filter((event) => event.kind === 'check_in').length, "the admin's panel lists the three check_in events").toBe(3);
    });

    test('AC9: after three, one more id is added: the first three are already on a repeat, the PUT that adds the cleaner keeps their ticks, and the view shows four', async ({ playwright, request, baseURL }) => {
        test.setTimeout(120_000);
        const ctx = await setup(playwright, request, baseURL);
        const [ann, bea, cat, dee] = await addMembers(ctx, ['Ann', 'Bea', 'Cat', 'Dee']);
        const job = await makeJob(ctx, { day: placeToday().yesterday, slot: 'Morning', members: [ann, bea, cat], signIn: ann });
        const cleaner = asCleaner(job);

        const first = await tickOk(request, job, cleaner, [ann.id, bea.id, cat.id], 'the cleaner');
        expect(first.checked_in, 'the first three are ticked').toEqual([ann.id, bea.id, cat.id]);

        const repeat = await tickOk(request, job, cleaner, [ann.id, bea.id, cat.id], 'the cleaner (again)');
        expect(repeat.checked_in, 'a repeat ticks nobody new').toEqual([]);
        expect(repeat.already, 'a repeat reports the three as already ticked').toEqual([ann.id, bea.id, cat.id]);
        expect(await checkinCount(job.bookingId), 'a repeat writes no row').toBe(3);
        expect(await tickEventCount(job.bookingId), 'a repeat writes no event').toBe(3);

        // One more cleaner is put on the job (ENG-014's PUT keeps the rows of the three who stay), and one more id is added to the tick.
        await setCrew(ctx, job.bookingId, [ann.id, bea.id, cat.id, dee.id]);
        const added = await publicView(request, job, cleaner, 'the cleaner');
        expect(added.crew.map((member) => member.id).sort(numeric), 'the view lists four after the PUT').toEqual(idsOf([ann, bea, cat, dee]));
        expect(added.crew.filter((member) => member.checked_in).map((member) => member.id).sort(numeric), 'the three ticks survive a PUT that only adds a cleaner, and the new one is unticked').toEqual(idsOf([ann, bea, cat]));

        const fourth = await tickOk(request, job, cleaner, [ann.id, bea.id, cat.id, dee.id], 'the cleaner (with the fourth)');
        expect(fourth.checked_in, 'only the added id is newly ticked').toEqual([dee.id]);
        expect(fourth.already, 'the first three are already').toEqual([ann.id, bea.id, cat.id]);
        expect(fourth.crew.length === 4 && fourth.crew.every((member) => member.checked_in === true), 'the answer shows four ticked').toBe(true);
        expect(await checkinCount(job.bookingId), 'four rows in all').toBe(4);
        expect(await tickEventCount(job.bookingId), 'four events in all').toBe(4);

        const view = await publicView(request, job, cleaner, 'the cleaner');
        expect(view.crew.length === 4 && view.crew.every((member) => member.checked_in === true), 'the view shows four ticked').toBe(true);
        const panel = await adminView(ctx, job.bookingId);
        expect(panel.crew.length === 4 && panel.crew.every((member) => member.checked_in === true), "the admin's panel shows four ticked").toBe(true);
        expect(panel.checkins.length, "the admin's panel lists four check-ins").toBe(4);
    });

    // A closed window is the same 409 for everyone and writes nothing: the checks of one answer.
    function expectClosed(answer, who, day, slot) {
        const { opens_at: opensAt, opens_label: label, message } = answer.body ?? {};
        expect(answer.status, `${who}: a closed window is a 409`).toBe(409);
        expect(answer.body?.success, `${who}: success is false`).toBe(false);
        expect(answer.cache, `${who}: the answer says no-store`).toContain('no-store');
        expect(typeof opensAt === 'string' && typeof label === 'string' && label.length > 0, `${who}: the answer carries opens_at and opens_label`).toBe(true);
        expect(message, `${who}: the message names the opening`).toBe(`Check-in opens at ${label}.`);
        const hour = OPENING_HOUR[slot];
        const shown = wallClock(new Date(opensAt));
        expect(`${shown.day} ${shown.hour}:${shown.minute}`, `${who}: opens_at is ${hour}:00 on ${day} in Toronto (an hour before the slot)`).toBe(`${day} ${hour}:0`);
        const wanted = new RegExp(`^${clockText(hour)} E[DS]T on ${weekdayOf(day)}, ${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}$`);
        expect(wanted.test(label), `${who}: opens_label "${label}" reads ${clockText(hour)} Eastern on ${day}`).toBe(true);
        return opensAt;
    }

    test('AC10: a job dated tomorrow is the 409 with opens_at and opens_label for a cleaner, the provider and an admin, and writes no row (a job dated today before its window opens is the same)', async ({ playwright, request, baseURL }) => {
        test.setTimeout(120_000);
        const ctx = await setup(playwright, request, baseURL);
        const place = placeToday();
        const [ann, bea, cat] = await addMembers(ctx, ['Ann', 'Bea', 'Cat']);
        const job = await makeJob(ctx, { day: place.tomorrow, slot: 'Morning', members: [ann, bea, cat], signIn: ann });
        const cleaner = asCleaner(job);

        const callers = [
            ['the cleaner', cleaner, [ann.id]],
            ['the provider', ctx.as.provider, [bea.id]],
            ['an admin', ctx.as.admin, [ann.id, bea.id, cat.id]],
        ];
        const opened = new Set();
        for (const [who, headers, ids] of callers) {
            opened.add(expectClosed(await tick(request, job, headers, ids), who, place.tomorrow, 'Morning'));
        }
        expect(opened.size, 'every kind of caller is told the same opening').toBe(1);
        expect(await checkinCount(job.bookingId), 'no job_checkins row after three refused callers').toBe(0);
        expect(await tickEventCount(job.bookingId), 'no check_in event after three refused callers').toBe(0);

        // The window is judged before the position, and after who the caller is.
        expectClosed(await postTick(request, job, ctx.as.admin, { crew_ids: [ann.id] }), 'an admin with no position', place.tomorrow, 'Morning');
        const stranger = await tick(request, job, ctx.as.none, [ann.id]);
        expect(stranger.status, 'a caller with no way in is told to sign in, before the window is looked at').toBe(401);
        expect(stranger.body?.message, 'the sign-in sentence').toBe(SIGN_IN);
        expect(await checkinCount(job.bookingId), 'still no row').toBe(0);

        // The panels say the same thing as the refusal.
        const panel = await providerView(ctx, job.bookingId);
        expect(panel.window.open, "the provider's panel says the window is not open").toBe(false);
        expect(panel.window.opens_at, "the provider's panel names the same opening").toBe([...opened][0]);

        // A job dated today whose window opens later today (while there is such a slot left today) is held the same way.
        if (place.notYet) {
            const later = await makeJob(ctx, { day: place.today, slot: place.notYet, members: [ann, bea, cat] });
            expectClosed(await tick(request, later, ctx.as.admin, [ann.id]), `an admin on a ${place.notYet} job dated today`, place.today, place.notYet);
            expectClosed(await tick(request, later, ctx.as.provider, [bea.id]), `the provider on a ${place.notYet} job dated today`, place.today, place.notYet);
            expect(await checkinCount(later.bookingId), 'no row for a job whose window opens later today').toBe(0);
            expect(await tickEventCount(later.bookingId), 'no event for a job whose window opens later today').toBe(0);
        }
    });

    test('AC10: a job dated today after its window opened takes a check-in from a cleaner, the provider and an admin (200 each)', async ({ playwright, request, baseURL }) => {
        test.setTimeout(120_000);
        const ctx = await setup(playwright, request, baseURL);
        const place = placeToday();
        // Before 07:03 in Toronto no slot of today has opened yet, so the open job is yesterday's, which is open as well.
        const day = place.opened ? place.today : place.yesterday;
        const [ann, bea, cat] = await addMembers(ctx, ['Ann', 'Bea', 'Cat']);
        const job = await makeJob(ctx, { day, slot: place.opened ?? 'Morning', members: [ann, bea, cat], signIn: ann });
        const cleaner = asCleaner(job);

        const view = await publicView(request, job, cleaner, 'the cleaner');
        expect(view.window.open, `the window of the ${place.opened ?? 'Morning'} job dated ${place.opened ? 'today' : 'yesterday'} has opened`).toBe(true);

        const byCleaner = await tickOk(request, job, cleaner, [ann.id], 'the cleaner');
        expect(byCleaner.checked_in, 'the cleaner ticks themselves').toEqual([ann.id]);
        const byProvider = await tickOk(request, job, ctx.as.provider, [bea.id], 'the provider');
        expect(byProvider.checked_in, 'the provider ticks a cleaner').toEqual([bea.id]);
        const byAdmin = await tickOk(request, job, ctx.as.admin, [cat.id], 'an admin');
        expect(byAdmin.checked_in, 'an admin ticks a cleaner').toEqual([cat.id]);

        const checkins = await checkinRows(job.bookingId);
        const by = Object.fromEntries(checkins.map((row) => [row.crew_member_id, row.by_kind]));
        expect(by, 'each row says who ticked it').toEqual({ [ann.id]: 'cleaner', [bea.id]: 'provider', [cat.id]: 'admin' });
        expect(await tickEventCount(job.bookingId), 'three events').toBe(3);
        expect(byAdmin.crew.every((member) => member.checked_in === true), 'all three are ticked in the last answer').toBe(true);
    });

    test('AC11: a booking with coordinates: a check-in at the address has away 0, one 2 km off has away 1, and the admin GET shows away: true with distance_m', async ({ playwright, request, baseURL }) => {
        test.setTimeout(120_000);
        const ctx = await setup(playwright, request, baseURL);
        const [ann, bea, cat] = await addMembers(ctx, ['Ann', 'Bea', 'Cat']);
        const job = await makeJob(ctx, { day: placeToday().yesterday, slot: 'Morning', members: [ann, bea, cat], signIn: ann });
        const cleaner = asCleaner(job);

        const near = await tickOk(request, job, cleaner, [ann.id], 'the cleaner at the address');
        expect(near.away, 'at the address: away is false').toBe(false);
        expect(Number.isInteger(near.distance_m) && near.distance_m >= 0 && near.distance_m <= 5, `at the address: distance_m is a few metres (${near.distance_m})`).toBe(true);

        const far = await tickOk(request, job, cleaner, [bea.id], 'the cleaner 2 km off', TWO_KM_OFF);
        expect(far.away, '2 km off: away is true').toBe(true);
        expect(Number.isInteger(far.distance_m) && far.distance_m > 1900 && far.distance_m < 2100, `2 km off: distance_m is about 2000 (${far.distance_m})`).toBe(true);
        expect(far.checked_in, 'away is a flag and not a block: the member is ticked').toEqual([bea.id]);

        const checkins = await checkinRows(job.bookingId);
        const nearRow = checkins.find((row) => row.crew_member_id === ann.id);
        const farRow = checkins.find((row) => row.crew_member_id === bea.id);
        expect(nearRow?.away, 'the row at the address has away = 0').toBe(0);
        expect(nearRow?.distance_m, 'the row at the address stores the distance of the answer').toBe(near.distance_m);
        expect(farRow?.away, 'the row 2 km off has away = 1').toBe(1);
        expect(farRow?.distance_m, 'the row 2 km off stores the distance of the answer').toBe(far.distance_m);
        expect(Number(farRow?.latitude) === Number(TWO_KM_OFF.latitude.toFixed(8)) && farRow?.accuracy_m === 30, "the row keeps the phone's reading, not the address").toBe(true);

        const panel = await adminView(ctx, job.bookingId);
        const seen = Object.fromEntries(panel.checkins.map((entry) => [entry.crew_member_id, entry]));
        expect(seen[ann.id]?.away, "the admin's GET shows away: false for the check-in at the address").toBe(false);
        expect(seen[bea.id]?.away, "the admin's GET shows away: true for the one 2 km off").toBe(true);
        expect(seen[bea.id]?.distance_m, "the admin's GET shows the distance").toBe(far.distance_m);
        expect(seen[bea.id]?.accuracy_m, "the admin's GET shows the accuracy").toBe(30);
        expect(seen[bea.id]?.by?.kind, "the admin's GET says a cleaner ticked it").toBe('cleaner');
    });

    test('AC11: no location, {0,0}, strings, NaN, 91 degrees and the like are each a 400 and write no row (a cleaner, the provider and an admin alike)', async ({ playwright, request, baseURL }) => {
        test.setTimeout(120_000);
        const ctx = await setup(playwright, request, baseURL);
        const [ann, bea] = await addMembers(ctx, ['Ann', 'Bea']);
        const job = await makeJob(ctx, { day: placeToday().yesterday, slot: 'Morning', members: [ann, bea], signIn: ann });
        const cleaner = asCleaner(job);

        const ids = [bea.id];
        /** @type {Array<[string, any]>} */
        const refused = [
            ['no location at all', { crew_ids: ids }],
            ['location null', { crew_ids: ids, location: null }],
            ['location an empty object', { crew_ids: ids, location: {} }],
            ['location a string', { crew_ids: ids, location: 'here' }],
            ['location a list', { crew_ids: ids, location: [ADDRESS.latitude, ADDRESS.longitude] }],
            ['latitude and longitude both 0', { crew_ids: ids, location: { latitude: 0, longitude: 0 } }],
            ['strings for numbers', { crew_ids: ids, location: { latitude: '51.04473', longitude: '-114.07192' } }],
            ['booleans for numbers', { crew_ids: ids, location: { latitude: true, longitude: true } }],
            ['NaN (a JSON body can only say null)', { crew_ids: ids, location: { latitude: NaN, longitude: ADDRESS.longitude } }],
            ['only a latitude', { crew_ids: ids, location: { latitude: ADDRESS.latitude } }],
            ['latitude 91 degrees', { crew_ids: ids, location: { latitude: 91, longitude: ADDRESS.longitude } }],
            ['latitude -91 degrees', { crew_ids: ids, location: { latitude: -91, longitude: ADDRESS.longitude } }],
            ['longitude 181 degrees', { crew_ids: ids, location: { latitude: ADDRESS.latitude, longitude: 181 } }],
            ['accuracy a string', { crew_ids: ids, location: { ...HERE, accuracy: '5' } }],
            ['accuracy negative', { crew_ids: ids, location: { ...HERE, accuracy: -1 } }],
            ['accuracy over 100000 m', { crew_ids: ids, location: { ...HERE, accuracy: 100001 } }],
        ];
        const callers = [['the cleaner', cleaner], ['the provider', ctx.as.provider], ['an admin', ctx.as.admin]];
        for (const [what, body] of refused) {
            for (const [who, headers] of callers) {
                const answer = await postTick(request, job, headers, body);
                expect(answer.status, `${who}, ${what}: status (${answer.body?.message ?? 'no message'})`).toBe(400);
                expect(answer.body?.message, `${who}, ${what}: the message asks for the phone's location`).toBe(NEEDS_LOCATION);
            }
        }
        // NaN written out in the body is not JSON at all.
        for (const [who, headers] of callers) {
            // A Buffer goes out as it is. (A string with a JSON content type that does not parse is wrapped by Playwright into a JSON string, which is valid JSON.)
            const body = Buffer.from(`{"crew_ids":[${bea.id}],"location":{"latitude":NaN,"longitude":${ADDRESS.longitude}}}`, 'utf8');
            const raw = await request.post(`/api/job/${job.token}/check-in`, { headers: { ...headers, 'content-type': 'application/json' }, data: body });
            const answer = await answerOf(raw);
            expect(answer.status, `${who}, a body with a literal NaN: status`).toBe(400);
            expect(answer.body?.message, `${who}, a body with a literal NaN: not JSON`).toBe('Invalid request.');
        }
        expect(await checkinCount(job.bookingId), 'no job_checkins row after every refusal').toBe(0);
        expect(await tickEventCount(job.bookingId), 'no check_in event after every refusal').toBe(0);

        // The same member can still be ticked once the phone gives a position: nothing was half-done.
        const ok = await tickOk(request, job, cleaner, ids, 'the cleaner with a position');
        expect(ok.checked_in, 'a good position ticks the member after the refusals').toEqual(ids);
        expect(await checkinCount(job.bookingId), 'one row now').toBe(1);
    });

    test('AC11: a booking without coordinates records away NULL, which the admin sees as no position to compare (null, never false)', async ({ playwright, request, baseURL }) => {
        test.setTimeout(120_000);
        const ctx = await setup(playwright, request, baseURL);
        const [ann, bea] = await addMembers(ctx, ['Ann', 'Bea']);
        const job = await makeJob(ctx, { day: placeToday().yesterday, slot: 'Morning', coords: false, members: [ann, bea], signIn: ann });
        const cleaner = asCleaner(job);

        const [position] = await rows('SELECT latitude, longitude FROM bookings WHERE id = ?', [job.bookingId]);
        expect(position.latitude === null && position.longitude === null, 'the probe booking has no coordinates').toBe(true);

        const data = await tickOk(request, job, cleaner, [ann.id, bea.id], 'the cleaner');
        expect(data.away, 'the answer says away null: there is nothing to compare, which is not "at the address"').toBeNull();
        expect(data.distance_m, 'the answer says distance_m null').toBeNull();
        expect(data.checked_in, 'the check-in is recorded all the same').toEqual([ann.id, bea.id]);

        const checkins = await checkinRows(job.bookingId);
        expect(checkins.length, 'two rows').toBe(2);
        expect(checkins.every((row) => row.away === null && row.distance_m === null), 'away and distance_m are NULL in both rows').toBe(true);
        expect(checkins.every((row) => row.latitude !== null && row.longitude !== null), "the phone's own position is kept").toBe(true);

        const panel = await adminView(ctx, job.bookingId);
        expect(panel.checkins.length, "the admin's panel lists both").toBe(2);
        expect(panel.checkins.every((entry) => entry.away === null && entry.distance_m === null), "the admin's GET has away null and distance_m null for each (the panel words that as no position to compare)").toBe(true);
        expect(panel.checkins.some((entry) => entry.away === false), 'no entry says false').toBe(false);
    });

    test('AC15: the view lists every assigned member with checked_in; taking one off the job through ENG-014 drops them from it, and putting them back shows them unchecked', async ({ playwright, request, baseURL }) => {
        test.setTimeout(120_000);
        const ctx = await setup(playwright, request, baseURL);
        const [ann, bea, cat, dee] = await addMembers(ctx, ['Ann', 'Bea', 'Cat', 'Dee']);
        const job = await makeJob(ctx, { day: placeToday().yesterday, slot: 'Morning', members: [ann, bea, cat, dee], signIn: ann });
        const cleaner = asCleaner(job);
        const listed = (view) => view.crew.map((member) => member.id).sort(numeric);
        const ticked = (view) => view.crew.filter((member) => member.checked_in).map((member) => member.id).sort(numeric);

        const start = await publicView(request, job, cleaner, 'the cleaner');
        expect(listed(start), 'the view lists all four assigned members').toEqual(idsOf([ann, bea, cat, dee]));
        expect(start.crew.every((member) => JSON.stringify(Object.keys(member).sort()) === JSON.stringify(CREW_KEYS)), 'each is {id, name, checked_in, checked_in_at}: no number').toBe(true);
        expect(start.crew.every((member) => member.checked_in === false && member.checked_in_at === null), 'nobody is ticked at the start').toBe(true);

        await tickOk(request, job, cleaner, [ann.id, bea.id, cat.id, dee.id], 'the cleaner');
        expect(ticked(await publicView(request, job, cleaner, 'the cleaner')), 'all four are ticked').toEqual(idsOf([ann, bea, cat, dee]));

        // Bea is taken off the job: ENG-014's PUT without her.
        await setCrew(ctx, job.bookingId, [ann.id, cat.id, dee.id]);
        const taken = await publicView(request, job, cleaner, 'the cleaner');
        expect(listed(taken), 'the view no longer lists the member taken off the job').toEqual(idsOf([ann, cat, dee]));
        expect(ticked(taken), 'the others keep their ticks').toEqual(idsOf([ann, cat, dee]));
        const panelOff = await adminView(ctx, job.bookingId);
        expect(panelOff.crew.map((member) => member.id).sort(numeric), "the admin's panel drops her too").toEqual(idsOf([ann, cat, dee]));
        expect(panelOff.checkins.map((entry) => entry.crew_member_id).sort(numeric), "her old check-in no longer counts in the admin's list").toEqual(idsOf([ann, cat, dee]));
        expect(await countOf('SELECT COUNT(*) AS n FROM job_checkins WHERE booking_id = ? AND crew_member_id = ?', [job.bookingId, bea.id]), 'her old row is kept as history').toBe(1);

        // Bea is put back (a later second than the first time): a new assignment, not ticked.
        await new Promise((resolve) => setTimeout(resolve, 1100));
        await setCrew(ctx, job.bookingId, [ann.id, bea.id, cat.id, dee.id]);
        const back = await publicView(request, job, cleaner, 'the cleaner');
        expect(listed(back), 'the view lists her again').toEqual(idsOf([ann, bea, cat, dee]));
        const herEntry = back.crew.find((member) => member.id === bea.id);
        expect(herEntry?.checked_in === false && herEntry?.checked_in_at === null, 're-added, she shows unchecked').toBe(true);
        expect(ticked(back), 'the other three are still ticked').toEqual(idsOf([ann, cat, dee]));
        const panelBack = await adminView(ctx, job.bookingId);
        expect(panelBack.crew.find((member) => member.id === bea.id)?.checked_in, "the admin's panel shows her unchecked").toBe(false);
        expect(panelBack.checkins.some((entry) => entry.crew_member_id === bea.id), "the admin's check-in list does not count her old tick").toBe(false);
        expect((await providerView(ctx, job.bookingId)).crew.find((member) => member.id === bea.id)?.checked_in, "the provider's panel shows her unchecked").toBe(false);

        const again = await tickOk(request, job, cleaner, [bea.id], 'the cleaner (for the re-added member)');
        expect(again.checked_in, 'she can be ticked again for the new assignment').toEqual([bea.id]);
        expect(await countOf('SELECT COUNT(*) AS n FROM job_checkins WHERE booking_id = ? AND crew_member_id = ?', [job.bookingId, bea.id]), 'a second row for her: one per assignment').toBe(2);
        expect(ticked(await publicView(request, job, cleaner, 'the cleaner')), 'all four count again').toEqual(idsOf([ann, bea, cat, dee]));

        // The other road: Dee is removed from the crew list (ENG-014's DELETE takes her off the open job) and added again.
        await dataOf(await request.delete(`/api/provider/crew/${dee.id}`, { headers: ctx.as.provider }), 200, 'provider 1 removes Dee from the crew list');
        expect(listed(await publicView(request, job, cleaner, 'the cleaner')), 'the view no longer lists a member removed from the crew list').toEqual(idsOf([ann, bea, cat]));
        await new Promise((resolve) => setTimeout(resolve, 1100));
        const readded = await dataOf(await request.post('/api/provider/crew', { headers: ctx.as.provider, data: { name: 'Dee', phone: typed(dee.number) } }), 201, 'provider 1 adds Dee again');
        await setCrew(ctx, job.bookingId, [ann.id, bea.id, cat.id, readded.member.id]);
        const deeBack = await publicView(request, job, cleaner, 'the cleaner');
        const deeEntry = deeBack.crew.find((member) => member.id === readded.member.id);
        expect(deeEntry?.checked_in === false && deeEntry?.checked_in_at === null, 'removed from the list and added again, she shows unchecked').toBe(true);
        expect(ticked(deeBack), 'the three who stayed are still ticked').toEqual(idsOf([ann, bea, cat]));
    });
});
