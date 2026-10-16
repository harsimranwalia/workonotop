// @ts-check
// ENG-015: the refusals of POST /api/job/{token}/check-in that e2e/job-checkin.spec.js (AC8-AC11, AC15) leaves out, in the order the route gives them
// (src/app/api/job/[token]/check-in/route.js, src/lib/job-checkin.js): no access (401), then crew_ids (400), then the window (409), then the position
// (400), then the crew (400).
//   Refusal 1  crew_ids missing, [], not a list, 31 ids, or a list holding 0, a negative number, a float, a numeric string, a nested list, null, true
//              or 2^53 (beside a good id, so a lenient reader that skipped the bad entry would tick someone) is the 400 "Pick who is here." for a
//              cleaner, the provider and an admin; no job_checkins row and no event is written; a good body afterwards still ticks;
//   Refusal 2  an id that is not on this job's crew (a member of the provider's other job, another provider's member, a member taken off this job
//              whose row still exists, an id that does not exist) is the 400 "Pick cleaners from this job's crew." for the WHOLE body: the code is
//              ALL-OR-NOTHING (the crew is checked before the first insert), so the good id in a mixed body is not ticked and no row or event is
//              written for it;
//   Refusal 3  the order of the refusals: the sign-in before the ids, the ids before the window, the window before the position, the position
//              before the crew.
// The rows of a job are made the way e2e/job-checkin.spec.js makes them (the helpers are copied, there is no shared module): the crew through
// ENG-014's routes, the link through the provider's route, the booking and a member's proof of a checked number in SQL, the code found by hashing
// the 10^6 candidates against code_hash (SMS is not configured in dev). This file shares the number block +1 403 555 0140 to 0159 and the e-mail
// prefix e2e-jc- with e2e/job-checkin.spec.js, so the two files run one after the other (one worker does), never in two runs at once. The describe
// sweeps its own block and prefix before its first case, after every case and after its last. A failure message names the case and the status, never
// a cookie, a token or a code.
import { test, expect } from '@playwright/test';
import mysql from 'mysql2/promise';
import { getCredentialHeaders } from './auth/credentials.js';
import { providers } from '../database/fixtures/accounts.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';
import { sha256Hex } from '../src/lib/link-token.js';
import { budgetScope } from '../src/lib/sms-budget.js';

// Every request carries a fixture account's session header and a trace records request headers: tracing is off, as in e2e/provider-crew.spec.js.
test.use({ trace: 'off' });

const [PROVIDER1, PROVIDER2] = providers;
const EMAIL_PREFIX = 'e2e-jc-';
const NUMBER_FIRST = 140;
const NUMBER_LAST = 159;
const stored = (n) => `+14035550${n}`;
const typed = (n) => `+1 403 555 0${n}`;

const ADDRESS = { latitude: 51.04473, longitude: -114.07192 };
const HERE = { latitude: ADDRESS.latitude, longitude: ADDRESS.longitude, accuracy: 12.4 };
const IDS_MESSAGE = 'Pick who is here.';
const CREW_MESSAGE = "Pick cleaners from this job's crew.";
const NEEDS_LOCATION = "We need your phone's location to check in. Allow location for this page and try again.";
const SIGN_IN = 'Enter your code to continue.';
// An id no row has: far above the auto-increment of any table here, and still a safe integer, so only the crew check can turn it away.
const MISSING_ID = 2_000_000_000;

// ---- the job's own clock: every probe booking falls in America/Toronto (Calgary has no cluster) ----

const ZONE = 'America/Toronto';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function wallClockDay(instant) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
    const get = (type) => parts.find((part) => part.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
}

const plusDays = (day, count) => new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + count)).toISOString().slice(0, 10);
const slotLabel = (day, slot) => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}: ${slot}`;

// Yesterday's job is open whatever the hour; tomorrow's is closed whatever the hour.
function days() {
    const today = wallClockDay(new Date());
    return { yesterday: plusDays(today, -1), tomorrow: plusDays(today, 1) };
}

// ---- the dev database, the way e2e/provider-crew.spec.js reaches it ----

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

async function dataOf(response, status, who) {
    const answer = await answerOf(response);
    expect(answer.status, `${who}: status (${answer.body?.success === false ? answer.body.message : 'no message'})`).toBe(status);
    expect(answer.body?.success, `${who}: success`).toBe(true);
    return answer.body.data;
}

const numeric = (a, b) => a - b;

let sequence = 0;
const tag = () => `${Date.now().toString(36)}${(sequence += 1)}`;

// A booking of provider 1 that is confirmed, in Calgary, with the date and the slot's label placed by the case, and a position.
async function insertBooking({ day, slot }) {
    const id = tag();
    const [made] = /** @type {any[]} */ (await (await db()).execute(
        `INSERT INTO bookings (booking_number, service_id, service_name, service_price, customer_first_name, customer_last_name, customer_email, customer_phone,
           job_date, job_time_slot, job_description, address_line1, city, status, payment_status, provider_id, latitude, longitude)
         VALUES (?, 1, 'Probe service', 100.00, 'E2E', 'Probe', ?, ?, ?, ?, 'ENG-015 check-in refusals probe, deleted by the case', '1 Probe Street', 'Calgary', 'confirmed', 'pending', ?, ?, ?)`,
        [`E2EJC${id}`, `${EMAIL_PREFIX}${id}@example.invalid`, stored(NUMBER_LAST), day, slotLabel(day, slot), PROVIDER1.id, ADDRESS.latitude, ADDRESS.longitude]
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

// A cleaner of provider 2, made in SQL with a number of this file's block (a second provider's crew is not worth a login here).
async function insertOtherProvidersMember(name, number) {
    const [made] = /** @type {any[]} */ (await (await db()).execute('INSERT INTO provider_crew_members (provider_id, name, phone) VALUES (?, ?, ?)', [PROVIDER2.id, name, stored(number)]));
    return { id: Number(made.insertId), name, number, checked: false };
}

async function setCrew(ctx, bookingId, ids) {
    await dataOf(await ctx.request.put(`/api/provider/jobs/${bookingId}/crew`, { headers: ctx.as.provider, data: { crew_ids: ids } }), 200, `provider 1 puts ${ids.length} cleaners on job ${bookingId}`);
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
    let why = 'nothing';
    if (row === undefined) {
        // Why the ask made no code is on its event (no_match, not_checked, cooldown, a budget cap...): a word, never a code.
        try {
            const [asked] = await rows("SELECT e.detail FROM job_link_events e JOIN job_links l ON l.booking_id = e.booking_id WHERE l.id = ? AND e.kind = 'code_asked' ORDER BY e.id DESC LIMIT 1", [linkId]);
            why = String(asked?.detail ?? 'no code_asked event');
        } catch {
            why = 'the event could not be read';
        }
    }
    expect(row !== undefined, `a live code row exists for the member (a text cannot be read in dev; the last code_asked event says: ${why})`).toBe(true);
    for (let n = 0; n < 1_000_000; n += 1) {
        const candidate = String(n).padStart(6, '0');
        if (sha256Hex(`${linkId}:${memberId}:${candidate}`) === row.code_hash) return candidate;
    }
    throw new Error('no six-digit code fits the stored hash');
}

// A cleaner opens the link: a code is asked for through the route, found from its hash and given back from a context of its own, so that no jar
// carries the cookie into the next request. The result is a `cookie` header value, never printed.
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
async function makeJob(ctx, { day, slot, members, signIn = null }) {
    const bookingId = await insertBooking({ day, slot });
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

// A check-in with the body exactly as a case gives it.
async function postTick(request, job, headers, body) {
    return answerOf(await request.post(`/api/job/${job.token}/check-in`, { headers, data: body }));
}

async function tickOk(request, job, headers, crewIds, who) {
    const answer = await postTick(request, job, headers, { crew_ids: crewIds, location: HERE });
    expect(answer.status, `${who} ticks ${JSON.stringify(crewIds)}: status (${answer.body?.success === false ? answer.body.message : 'no message'})`).toBe(200);
    expect(answer.body?.success, `${who} ticks: success`).toBe(true);
    return answer.body.data;
}

// One refusal: the status, the one sentence, success false and no-store.
function expectRefused(answer, status, message, what) {
    expect(answer.status, `${what}: status (${answer.body?.message ?? 'no message'})`).toBe(status);
    expect(answer.body?.success, `${what}: success is false`).toBe(false);
    expect(answer.body?.message, `${what}: the sentence`).toBe(message);
    expect(answer.cache, `${what}: the answer says no-store`).toContain('no-store');
}

test.describe('Job link check-in refusals: what the route turns away, and in which order', () => {
    sweepAround();

    test('Refusal 1: crew_ids missing, empty, not a list, 31 ids, or holding 0, a negative, a float, a numeric string, a nested list, null, true or 2^53 is the 400 "Pick who is here." for a cleaner, the provider and an admin; no row, no event; a good body still ticks', async ({ playwright, request, baseURL }) => {
        test.setTimeout(240_000);
        const ctx = await setup(playwright, request, baseURL);
        const [ann, bea] = await addMembers(ctx, ['Ann', 'Bea']);
        const job = await makeJob(ctx, { day: days().yesterday, slot: 'Morning', members: [ann, bea], signIn: ann });
        const cleaner = asCleaner(job);

        const thirtyOne = Array.from({ length: 31 }, (_, index) => index + 1);
        /** @type {Array<[string, any]>} */
        const refused = [
            ['crew_ids missing', { location: HERE }],
            ['crew_ids an empty list', { crew_ids: [], location: HERE }],
            ['crew_ids a number, not a list', { crew_ids: ann.id, location: HERE }],
            ['crew_ids a string, not a list', { crew_ids: String(ann.id), location: HERE }],
            ['crew_ids an object, not a list', { crew_ids: { 0: ann.id }, location: HERE }],
            ['crew_ids null', { crew_ids: null, location: HERE }],
            ['31 ids', { crew_ids: thirtyOne, location: HERE }],
            ['a list with 0 beside a good id', { crew_ids: [ann.id, 0], location: HERE }],
            ['a list with a negative number beside a good id', { crew_ids: [ann.id, -bea.id], location: HERE }],
            ['a list with a float beside a good id', { crew_ids: [ann.id, bea.id + 0.5], location: HERE }],
            ['a list with a numeric string beside a good id', { crew_ids: [ann.id, String(bea.id)], location: HERE }],
            ['a list with a nested list beside a good id', { crew_ids: [ann.id, [bea.id]], location: HERE }],
            ['a list with null beside a good id', { crew_ids: [ann.id, null], location: HERE }],
            ['a list with true beside a good id', { crew_ids: [ann.id, true], location: HERE }],
            ['a list with 2^53 (not a safe integer) beside a good id', { crew_ids: [ann.id, 2 ** 53], location: HERE }],
        ];
        const callers = [['the cleaner', cleaner], ['the provider', ctx.as.provider], ['an admin', ctx.as.admin]];
        for (const [what, body] of refused) {
            // The three callers at once: the dev server answers many requests slowly when other runs share it.
            const answers = await Promise.all(callers.map(([, headers]) => postTick(request, job, headers, body)));
            answers.forEach((answer, index) => expectRefused(answer, 400, IDS_MESSAGE, `${callers[index][0]}, ${what}`));
        }
        expect(await checkinCount(job.bookingId), 'no job_checkins row after every refusal (a reader that skipped the bad entry would have ticked the good id)').toBe(0);
        expect(await tickEventCount(job.bookingId), 'no check_in event after every refusal').toBe(0);

        // Thirty ids are not too many: the 31st is what is refused, and 30 ids that are not on the crew are the crew's refusal, not this one.
        const thirty = await postTick(request, job, ctx.as.admin, { crew_ids: thirtyOne.slice(0, 30), location: HERE });
        expectRefused(thirty, 400, CREW_MESSAGE, 'an admin, 30 ids that are not on the crew (the length is allowed, the crew is not)');

        // The same cleaners can still be ticked: nothing was half-done. Duplicates are dropped and the order is kept.
        const ok = await tickOk(request, job, cleaner, [bea.id, ann.id, bea.id], 'the cleaner with a good body');
        expect(ok.checked_in, 'a good body ticks both after the refusals, a duplicate dropped and the order kept').toEqual([bea.id, ann.id]);
        expect(ok.already, 'nobody was ticked before').toEqual([]);
        expect(await checkinCount(job.bookingId), 'two rows now').toBe(2);
        expect(await tickEventCount(job.bookingId), 'two events now').toBe(2);
    });

    test("Refusal 2: ALL-OR-NOTHING: an id not on this job's crew (the provider's other job's cleaner, another provider's cleaner, one taken off this job, one that does not exist) is the 400 \"Pick cleaners from this job's crew.\" for the whole body; the good id in a mixed body is not ticked and nothing is written for it", async ({ playwright, request, baseURL }) => {
        test.setTimeout(240_000);
        const ctx = await setup(playwright, request, baseURL);
        const [ann, bea, cat, dee] = await addMembers(ctx, ['Ann', 'Bea', 'Cat', 'Dee']);
        const eve = await insertOtherProvidersMember('Eve', 149);
        const job = await makeJob(ctx, { day: days().yesterday, slot: 'Morning', members: [ann, bea, dee], signIn: ann });
        const cleaner = asCleaner(job);
        // Cat is on the provider's other job. Dee is taken off this one: her row stays in the provider's crew, she is just not assigned here.
        const otherJob = await insertBooking({ day: days().yesterday, slot: 'Morning' });
        await setCrew(ctx, otherJob, [cat.id]);
        await setCrew(ctx, job.bookingId, [ann.id, bea.id]);
        expect(await countOf('SELECT COUNT(*) AS n FROM provider_crew_members WHERE id = ? AND removed_at IS NULL', [dee.id]), "Dee's row still exists and is not removed").toBe(1);
        expect(await countOf('SELECT COUNT(*) AS n FROM booking_crew WHERE booking_id = ? AND crew_member_id = ?', [job.bookingId, dee.id]), 'Dee is no longer assigned to this job').toBe(0);
        expect(await countOf('SELECT COUNT(*) AS n FROM provider_crew_members WHERE id = ? AND provider_id <> ?', [eve.id, PROVIDER1.id]), "Eve belongs to another provider's crew").toBe(1);

        /** @type {Array<[string, number[]]>} */
        const refused = [
            ["a cleaner of the provider's other job", [cat.id]],
            ["another provider's cleaner", [eve.id]],
            ['a cleaner taken off this job (the row still exists)', [dee.id]],
            ['an id that does not exist', [MISSING_ID]],
            ["a good id first, then the other job's cleaner", [ann.id, cat.id]],
            ["the other job's cleaner first, then a good id", [cat.id, ann.id]],
            ['both good ids and a cleaner taken off this job', [ann.id, bea.id, dee.id]],
            ['a good id and an id that does not exist', [bea.id, MISSING_ID]],
            ["a good id and another provider's cleaner", [ann.id, eve.id]],
        ];
        const callers = [['the cleaner', cleaner], ['the provider', ctx.as.provider], ['an admin', ctx.as.admin]];
        for (const [what, ids] of refused) {
            const answers = await Promise.all(callers.map(([, headers]) => postTick(request, job, headers, { crew_ids: ids, location: HERE })));
            answers.forEach((answer, index) => expectRefused(answer, 400, CREW_MESSAGE, `${callers[index][0]}, ${what}`));
        }
        expect(await checkinCount(job.bookingId), 'no job_checkins row on this job after every refusal: nobody is ticked, not even the good ids of the mixed bodies').toBe(0);
        expect(await tickEventCount(job.bookingId), 'no check_in event on this job after every refusal').toBe(0);
        expect(await checkinCount(otherJob), 'no row on the other job either').toBe(0);
        expect(await countOf('SELECT COUNT(*) AS n FROM job_checkins WHERE crew_member_id IN (?, ?, ?)', [cat.id, dee.id, eve.id]), 'no job_checkins row for any of the three who are not on the crew').toBe(0);

        // The good ids alone are ticked, so the refusals did not block the job.
        const ok = await tickOk(request, job, cleaner, [ann.id, bea.id], 'the cleaner with only good ids');
        expect(ok.checked_in, 'the good ids are ticked once the body holds only good ids').toEqual([ann.id, bea.id]);
        expect(await checkinCount(job.bookingId), 'two rows now').toBe(2);
        expect(ok.crew.map((member) => member.id).sort(numeric), 'the answer lists only the two on the crew').toEqual([ann.id, bea.id].sort(numeric));
    });

    test('Refusal 3: the order of the refusals is the sign-in (401), crew_ids (400), the window (409), the position (400), then the crew (400)', async ({ playwright, request, baseURL }) => {
        test.setTimeout(240_000);
        const ctx = await setup(playwright, request, baseURL);
        const place = days();
        const [ann, bea, cat] = await addMembers(ctx, ['Ann', 'Bea', 'Cat']);
        const open = await makeJob(ctx, { day: place.yesterday, slot: 'Morning', members: [ann, bea] });
        const later = await makeJob(ctx, { day: place.tomorrow, slot: 'Morning', members: [ann, bea] });
        const callers = [['the provider', ctx.as.provider], ['an admin', ctx.as.admin]];
        const BAD_POSITION = { latitude: 91, longitude: ADDRESS.longitude, accuracy: 5 };

        // 1. No way in is the 401 first, whatever the body and whatever the window.
        for (const [name, job] of [['the open job', open], ['the job dated tomorrow', later]]) {
            expectRefused(await postTick(request, job, ctx.as.none, { crew_ids: [], location: BAD_POSITION }), 401, SIGN_IN, `a caller with no way in, ${name}, bad ids and a bad position`);
            expectRefused(await postTick(request, job, ctx.as.none, { crew_ids: [cat.id] }), 401, SIGN_IN, `a caller with no way in, ${name}, an id off the crew and no position`);
        }

        // 2. The ids come before the window: a job whose window is closed still answers a bad list with the ids sentence, not the 409.
        for (const [who, headers] of callers) {
            expectRefused(await postTick(request, later, headers, { crew_ids: [] }), 400, IDS_MESSAGE, `${who}, the job dated tomorrow, an empty list and no position (ids before the window)`);
            expectRefused(await postTick(request, later, headers, { crew_ids: [ann.id, 0], location: HERE }), 400, IDS_MESSAGE, `${who}, the job dated tomorrow, a list holding 0 (ids before the window)`);
        }

        // 3. The window comes before the position and before the crew: the job dated tomorrow is the 409 whatever else is wrong with the body.
        const closed = [
            ['no position', { crew_ids: [ann.id] }],
            ['a bad position', { crew_ids: [ann.id], location: BAD_POSITION }],
            ['an id off the crew with a good position', { crew_ids: [cat.id], location: HERE }],
            ['an id off the crew and a bad position', { crew_ids: [cat.id], location: BAD_POSITION }],
        ];
        for (const [who, headers] of callers) {
            for (const [what, body] of closed) {
                const answer = await postTick(request, later, headers, body);
                expect(answer.status, `${who}, the job dated tomorrow, ${what}: the window is the 409`).toBe(409);
                expect(answer.body?.success, `${who}, the job dated tomorrow, ${what}: success is false`).toBe(false);
                expect(typeof answer.body?.opens_at === 'string' && typeof answer.body?.opens_label === 'string', `${who}, the job dated tomorrow, ${what}: the answer carries opens_at and opens_label`).toBe(true);
            }
        }

        // 4. On an open job the position comes before the crew: an id off the crew with no usable position is the position's sentence.
        for (const [who, headers] of callers) {
            expectRefused(await postTick(request, open, headers, { crew_ids: [cat.id] }), 400, NEEDS_LOCATION, `${who}, the open job, an id off the crew and no position (position before crew)`);
            expectRefused(await postTick(request, open, headers, { crew_ids: [cat.id], location: BAD_POSITION }), 400, NEEDS_LOCATION, `${who}, the open job, an id off the crew and a bad position (position before crew)`);
        }

        // 5. Last, with a good body and a good position, the crew.
        for (const [who, headers] of callers) {
            expectRefused(await postTick(request, open, headers, { crew_ids: [cat.id], location: HERE }), 400, CREW_MESSAGE, `${who}, the open job, an id off the crew and a good position (the crew last)`);
        }

        for (const [name, job] of [['the open job', open], ['the job dated tomorrow', later]]) {
            expect(await checkinCount(job.bookingId), `no job_checkins row on ${name} after every refusal`).toBe(0);
            expect(await tickEventCount(job.bookingId), `no check_in event on ${name} after every refusal`).toBe(0);
        }

        // The open job is truly open: the same admin with a good body ticks.
        const ok = await tickOk(request, open, ctx.as.admin, [ann.id], 'an admin with a good body on the open job');
        expect(ok.checked_in, 'a good body ticks on the open job').toEqual([ann.id]);
    });
});
