// @ts-check
// ENG-014: a provider keeps a crew list and picks which cleaners go on a job. The server cases and the pins of the design's table
// (agents/architect/designs/ENG-014-provider-crew-list-and-assigning-cleaners.md, "Cases and baseline") are in this file, and the screen cases of
// the frontend seat are its last describe. Each title starts with the design's id for the case it settles, and the file's
// name, the describe and the title together are its baseline key:
//   AC1  a provider adds, corrects, removes and re-adds a cleaner; src/lib/phone.js stores the number as E.164 and refuses what it could only
//        read by guessing; at 30 members the next add is a 409; the phone and name rules, in plain Node and through the routes;
//   AC2  a job an admin gave and a job claimed from the marketplace take a crew by one PUT that replaces the set and reports who was added and who
//        was removed; the same PUT again changes nothing, an empty list clears, and a finished job is read-only;
//   AC3  (hard gate) a job that is not the caller's (given to another provider, claimed by one, in the open pool, held by nobody, missing, or an id
//        that is not a number) is one 404 whatever the method, the body or the status, and a provider_id in the body or the query names no one;
//   AC4  (hard gate) a provider never sees, corrects, removes or puts on a job another provider's member, and every wrong id is the same answer;
//        with no credential every route is a 401 and a customer or an admin is a 403;
//   Resets  the three admin writers that reset a job also clear its crew, so a job that goes A to B to A, is restarted or is unassigned starts with
//        none; removing a member takes it off the jobs that can still change and not off a finished one;
//   Pins  source checks: only the lib names booking_crew, the routes and the lib prepare every statement, and phone.js has no import;
//   Screens  the My Crew entry, the crew page (add, correct, remove, the cap, its empty and failed states) and the "Crew on this job" panel, in a
//        browser signed in as provider 1.
// The database is the dev database the way e2e/on-behalf-booking.spec.js reaches it (mysql2/promise, assertDevTarget before it connects,
// assertNoRealPeople once connected). The describes that use it sweep, before their first case, after every case and after their last, the crew
// rows of the two fixture providers whose number starts +14035550 (a number of the fictional block 555-0100 to 0199; the rows that put a member on
// a job go with the member) and the bookings whose e-mail address starts with the prefix below, so a run that died halfway leaves nothing behind;
// each case also deletes the bookings it made, as admin, in a finally. Every case uses numbers of its own (the last three digits are the name:
// 123 is '+1 403 555 0123'), and the cap case fills a provider's whole crew, which is why the file runs one case at a time: no other case may run
// beside it. Jobs are made by the public checkout, given to a provider by the admin's PUT /api/bookings, and claimed or pushed as
// e2e/marketplace.spec.js does it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { getCredentialHeaders } from './auth/credentials.js';
import { RESET_RETRIES, signInAs } from './support/auth.js';
import { providers, FIXTURE_LOGINS } from '../database/fixtures/accounts.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';

// Every request carries a fixture account's session header and a trace records request headers: tracing is off, as in e2e/marketplace.spec.js.
// A failure message names the case, the status and the figures, never a header, a token or a cookie.
test.use({ trace: 'off' });
// One case at a time, in order, whatever the run's worker settings: the cap case fills provider 1's whole crew.
test.describe.configure({ mode: 'serial' });

const [PROVIDER1, PROVIDER2] = providers;
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const EMAIL_PREFIX = 'e2e-crew-';
const STORED_PREFIX = '+14035550';
const CREW_MAX = 30;
const MISSING = 999999999;
// Ids that are not positive whole numbers: each is the 404 of its kind, before the body is read.
const NOT_NUMBERS = ['abc', '0', '-1', '1.5'];
const OPEN_STATUSES = ['pending', 'matching', 'confirmed', 'in_progress'];
const CLOSED_STATUSES = ['awaiting_approval', 'completed', 'cancelled', 'disputed'];

const UNAUTHORIZED = { success: false, message: 'Unauthorized' };
const FORBIDDEN = { success: false, message: 'Forbidden' };
const NO_MEMBER = { success: false, message: 'Crew member not found' };
const NO_JOB = { success: false, message: 'Job not found' };
const NAME_MISSING = "Enter the cleaner's name.";
const DUPLICATE = { success: false, message: 'That number is already in your crew.' };
const CLASH = { success: false, message: 'Another entry already uses that number.' };
const FULL = { success: false, message: 'Your crew is full (30). Remove someone to add another.' };
const NOT_A_LIST = { success: false, message: "Send crew_ids as a list of your crew members' ids." };
const NOT_OWN = { success: false, message: 'Pick cleaners from your own crew list.' };
const FINISHED = { success: false, message: 'This job is finished, so its crew can no longer change.' };

// A fictional number as a person types it and as the table keeps it; `last3` are the digits after '+1 403 555 0'.
const typed = (last3) => `+1 403 555 0${last3}`;
const stored = (last3) => `${STORED_PREFIX}${last3}`;

// ---- plain-Node cases: the phone and name rules, and the source pins. They need no app and no database. ----

test.describe('Provider crew: the phone and name rules in plain Node', () => {
    test('AC1: normalisePhone gives E.164 for every North American form and for another country with a +, formatPhone shows it back, and PHONE_HINT asks for a country code', async () => {
        const { normalisePhone, formatPhone, PHONE_HINT } = await import('../src/lib/phone.js');
        const northAmerican = [
            '(403) 555-0123', '403-555-0123', '403.555.0123', '403 555 0123', '4035550123', '14035550123', '1-403-555-0123',
            '+1 403 555 0123', '+14035550123', '+1 (403) 555-0123', '  (403)555-0123  ',
        ];
        for (const input of northAmerican) {
            expect(normalisePhone(input), `normalisePhone(${JSON.stringify(input)})`).toEqual({ ok: true, phone: '+14035550123' });
        }
        // The edges of the area code and the exchange (2 to 9), and the other countries: an explicit +, 8 to 15 digits in all.
        // A 40 character entry, spaces and all, is the longest that is read: "over 40 characters" is the refusal.
        const edges = [['(200) 200-0000', '+12002000000'], ['999-999-9999', '+19999999999'], [`(403) 555${' '.repeat(26)}-0123`, '+14035550123']];
        const abroad = [
            ['+44 20 7946 0958', '+442079460958'], ['+91 98765 43210', '+919876543210'], ['+61 2 9876 5432', '+61298765432'],
            ['+47 123 456', '+47123456'], ['+44 1234 567 890 123', '+441234567890123'],
        ];
        for (const [input, phone] of [...edges, ...abroad]) {
            expect(normalisePhone(input), `normalisePhone(${JSON.stringify(input)})`).toEqual({ ok: true, phone });
            expect(normalisePhone(phone), `a stored number is read again as itself (${phone})`).toEqual({ ok: true, phone });
        }
        expect(formatPhone('+14035550123'), 'a North American number is shown as people read it').toBe('(403) 555-0123');
        expect(formatPhone('+442079460958'), "another country's number is shown as stored").toBe('+442079460958');
        expect(typeof PHONE_HINT === 'string' && /country code/i.test(PHONE_HINT), 'PHONE_HINT asks for the country code').toBe(true);
    });

    test('AC1: normalisePhone refuses letters, extensions, a + in the middle, a bare number of another length, an exchange starting 1, +0, 16 digits and over 40 characters, each with a message, and a bare 9 or 12 digit number asks for the country code', async () => {
        const { normalisePhone } = await import('../src/lib/phone.js');
        const refused = [
            ['letters in the number', '403-555-CALL'], ['letters only', 'abc'], ['an extension with x', '403-555-0123 x123'], ['an extension with ext', '(403) 555-0123 ext 5'],
            ['a + in the middle', '403+555-0123'], ['a + at the end', '(403) 555-0123+'], ['two + at the front', '++14035550123'], ['a lone +', '+'],
            ['an exchange starting 1', '403-155-0123'], ['an exchange starting 0', '403-055-0123'], ['an area code starting 1', '103-555-0123'], ['an area code starting 0', '043-555-0123'],
            ['+1 with an exchange starting 1', '+1 403 155 0123'], ['+1 and nine digits', '+1 403 555 012'], ['+1 and eleven digits', '+1 403 555 01234'],
            ['eleven digits that do not start with 1', '24035550123'], ['a bare 8 digit number', '55501234'],
            ['a country code that starts with 0', '+0123456789'], ['a 0 after the + of another country', '+044 20 7946 0958'],
            ['16 digits after the +', '+4412345678901234'], ['7 digits after the +', '+4712345'],
            ['41 characters, spaces inside, that clean to a good number', `(403) 555${' '.repeat(27)}-0123`], ['41 digits', '1'.repeat(41)],
            ['an empty string', ''], ['spaces only', '   '],
        ];
        for (const [what, input] of refused) {
            const answer = normalisePhone(input);
            expect(answer.ok, `normalisePhone refuses ${what}`).toBe(false);
            expect(typeof answer.message === 'string' && answer.message.length > 0, `the refusal of ${what} carries a message`).toBe(true);
            expect(answer, `the refusal of ${what} holds no number`).not.toHaveProperty('phone');
        }
        for (const [what, input] of [['a bare 9 digit number', '403555012'], ['a bare 12 digit number', '440207946095']]) {
            const answer = normalisePhone(input);
            expect(answer.ok, `normalisePhone refuses ${what}`).toBe(false);
            expect(answer.message, `the refusal of ${what} asks for the country code`).toMatch(/country code/i);
        }
        for (const input of [undefined, null, 5551234567, {}, [], true]) {
            expect(normalisePhone(/** @type {any} */ (input)).ok, `normalisePhone refuses the non-string ${JSON.stringify(input)}`).toBe(false);
        }
    });

    test('AC1: normaliseName trims, refuses an empty name with the cleaner message, more than 120 characters and any control character, and the constants are 30, 120 and the four open statuses', async () => {
        const { normaliseName, CREW_MAX: max, NAME_MAX, CREW_CHANGE_STATUSES } = await import('../src/lib/booking-crew.js');
        expect([max, NAME_MAX, CREW_CHANGE_STATUSES], 'the limits and the statuses of the design').toEqual([30, 120, OPEN_STATUSES]);
        expect(normaliseName('  Sam  '), 'a name is trimmed').toEqual({ ok: true, name: 'Sam' });
        expect(normaliseName("Zoë O'Brien-Smith"), 'accents and an apostrophe are names').toEqual({ ok: true, name: "Zoë O'Brien-Smith" });
        expect(normaliseName('a'.repeat(120)).ok, 'exactly 120 characters').toBe(true);
        expect(normaliseName('a'.repeat(121)).ok, '121 characters').toBe(false);
        for (const input of ['', '   ', undefined, null]) {
            expect(normaliseName(/** @type {any} */ (input)), `normaliseName(${JSON.stringify(input)}) asks for the name`).toEqual({ ok: false, message: NAME_MISSING });
        }
        expect(normaliseName(/** @type {any} */ (5)).ok, 'a number is not a name').toBe(false);
        for (const [what, input] of [['a line feed', 'Sam\nJones'], ['a carriage return and a line feed', 'Sam\r\nJones'], ['a tab', 'Sam\tJones'], ['a bell', 'Sam\u0007'], ['a delete', 'Sam\u007f']]) {
            const answer = normaliseName(input);
            expect(answer.ok, `normaliseName refuses a name with ${what}`).toBe(false);
            expect(typeof answer.message === 'string' && answer.message.length > 0, `the refusal for ${what} carries a message`).toBe(true);
        }
    });
});

// A source file's text with its comments taken out (block comments, whole-line comments, and a // comment that follows whitespace), so that a word a
// comment mentions is not read as a use of it. A // that follows a colon, as in a URL, is not a comment and stays (as e2e/pricing-rules.spec.js).
function withoutComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[ \t])\/\/.*$/gm, '$1');
}

// Every file under a directory, as a path from the repo root with forward slashes.
function filesUnder(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const found = path.join(directory, entry.name);
        if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : filesUnder(found);
        return [path.relative(ROOT, found).split(path.sep).join('/')];
    });
}

const textOf = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const LIB = 'src/lib/booking-crew.js';
const PREPARED_ONLY = ['src/app/api/provider/crew/route.js', 'src/app/api/provider/crew/[id]/route.js', 'src/app/api/provider/jobs/[id]/crew/route.js', LIB];

test.describe('Provider crew: pins', () => {
    // Mutant that turns this case red: a route or another lib reads or writes booking_crew itself, so a job's crew is read without the join on the
    // booking's current provider, and an old provider's picks come back as assigned.
    test('Pins: booking_crew is named in no file under src/ except src/lib/booking-crew.js', () => {
        const files = filesUnder(path.join(ROOT, 'src'));
        const naming = files.filter((file) => textOf(file).includes('booking_crew')).sort();
        expect(naming.includes(LIB), `the walk reaches the lib among ${files.length} files under src/`).toBe(true);
        expect(naming.filter((file) => file !== LIB), 'files other than the lib that name booking_crew').toEqual([]);
    });

    // Mutant that turns this case red: a statement that carries a name or a number is sent as text (query) and not prepared (execute), which is how an
    // injection reaches the personal data of people who are not users.
    test('Pins: the three crew routes and the booking-crew lib make no query( call, only prepared execute', () => {
        for (const file of PREPARED_ONLY) {
            expect(fs.existsSync(path.join(ROOT, file)), `${file} exists`).toBe(true);
            const lines = withoutComments(textOf(file)).split('\n');
            const calling = lines.flatMap((line, index) => (/\bquery\s*\(/.test(line) ? [index + 1] : []));
            expect(calling, `${file}: the lines that call query( (a bare call or connection.query)`).toEqual([]);
        }
    });

    // Mutant that turns this case red: phone.js imports something, so ENG-015's helper and a spec can no longer load the rule in plain Node.
    test('Pins: src/lib/phone.js has no import statement or expression', () => {
        const code = withoutComments(textOf('src/lib/phone.js'));
        expect(code.includes('export function normalisePhone'), 'the file is the phone rule').toBe(true);
        expect(/(?:^|[^\w$.])import\s*(?:\(|[\w$*{'"])/.test(code), 'an import statement or a dynamic import').toBe(false);
        expect(/\bexport\s+(?:\*|\{[^}]*\})\s*from\b/.test(code), 'a re-export from another file').toBe(false);
        expect(/\brequire\s*\(/.test(code), 'a require call').toBe(false);
    });
});

// ---- cases that ask the running app and the dev database ----

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
const activeMembers = (providerId) => countOf('SELECT COUNT(*) AS n FROM provider_crew_members WHERE provider_id = ? AND removed_at IS NULL', [providerId]);

// The member ids on a job, straight from the table, in id order.
async function crewRowsOn(bookingId) {
    return (await rows('SELECT crew_member_id FROM booking_crew WHERE booking_id = ? ORDER BY crew_member_id', [bookingId])).map((row) => row.crew_member_id);
}

async function setStatus(bookingId, status) {
    await (await db()).execute('UPDATE bookings SET status = ? WHERE id = ?', [status, bookingId]);
}

// The pages under /provider/jobs are shut to a provider whose Stripe account is not connected (the provider layout sends them to the dashboard) and
// neither fixture provider has one connected, so a case that opens a job page connects provider 1 first. clearRows puts the flag back.
async function connectStripe(providerId) {
    await (await db()).execute('UPDATE service_providers SET stripe_onboarding_complete = 1 WHERE id = ?', [providerId]);
}

// Deletes what this file left: the crew rows of the two fixture providers with a fictional number (the job rows go with them) and the bookings of
// this file's e-mail prefix (their crew rows go with them), and sets their Stripe flag back to 0, as the fixtures have it.
async function clearRows() {
    const open = await db();
    await open.execute('UPDATE service_providers SET stripe_onboarding_complete = 0 WHERE id IN (?, ?)', [PROVIDER1.id, PROVIDER2.id]);
    await open.execute('DELETE FROM provider_crew_members WHERE provider_id IN (?, ?) AND phone LIKE ?', [PROVIDER1.id, PROVIDER2.id, `${STORED_PREFIX}%`]);
    await open.execute('DELETE FROM bookings WHERE customer_email LIKE ?', [`${EMAIL_PREFIX}%`]);
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

// The credentials a case sends, as request headers (the cookie styles of getCredentialHeaders).
async function credentials(baseURL) {
    const styles = await getCredentialHeaders(String(baseURL));
    return { none: {}, customer: styles['customer-cookie'], provider: styles['provider-cookie'], admin: styles['admin-cookie'] };
}

const COOKIE_OF = { provider2: 'provider_token' };
// Signs a fixture account in through its own login route and returns its session cookie as a request header. The token is cut out of the storage
// state and put in a header; it is never printed.
async function signedInAs(playwright, baseURL, who) {
    const login = FIXTURE_LOGINS[who];
    const context = await playwright.request.newContext({ baseURL });
    try {
        const response = await context.post(login.loginRoute, { data: { email: login.email, password: login.password }, maxRetries: RESET_RETRIES, timeout: 60_000 });
        expect(response.status(), `${who} signs in`).toBe(200);
        const held = (await context.storageState()).cookies.find((entry) => entry.name === COOKIE_OF[who]);
        expect(held, `${who}'s ${COOKIE_OF[who]} cookie`).toBeTruthy();
        return { cookie: `${COOKIE_OF[who]}=${held?.value}` };
    } finally {
        await context.dispose();
    }
}

const tag = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// A guest booking made through the public checkout: pending, no provider, not pushed. Its address carries this file's prefix.
async function makeBooking(request) {
    const id = tag();
    const body = {
        service_id: 1, service_name: 'Fixture Standard Clean', service_price: 80, additional_price: 40,
        first_name: 'E2E', last_name: 'Crew', email: `${EMAIL_PREFIX}${id}@workontap.test`, phone: '+14035550199',
        job_date: '2026-02-01', job_time_slot: '09:00', job_description: 'E2E crew probe booking, deleted by the case.',
        address_line1: '1 Probe Street', city: 'Calgary', payment_intent_id: `pi_e2e_crew_${id}`,
    };
    const created = await request.post('/api/bookings', { data: body });
    expect(created.status(), 'checkout makes the probe booking').toBe(200);
    const bookingId = (await created.json()).booking_id;
    expect(Number.isInteger(bookingId), 'the probe booking has an id').toBe(true);
    return bookingId;
}

// `count` probe bookings, passed to `run` as ids; each is deleted again as admin, even when `run` fails.
async function withBookings(request, as, count, run) {
    const ids = [];
    try {
        for (let made = 0; made < count; made += 1) ids.push(await makeBooking(request));
        await run(...ids);
    } finally {
        for (const id of ids) await request.delete(`/api/bookings?id=${id}`, { headers: as.admin });
    }
}

// The admin gives a waiting booking to a provider: the provider's, matching.
async function give(request, as, id, providerId) {
    const response = await request.put(`/api/bookings?id=${id}`, { headers: as.admin, data: { provider_id: providerId, status: 'matching' } });
    expect(response.status(), `admin gives booking ${id} to provider ${providerId}`).toBe(200);
}

async function push(request, as, id) {
    const response = await request.post(`/api/admin/bookings/${id}/push`, { headers: as.admin });
    expect(response.status(), `admin pushes booking ${id}`).toBe(200);
}

// The admin pushes the booking and the provider claims it: the provider's, confirmed.
async function claim(request, as, headers, id) {
    await push(request, as, id);
    const response = await request.post('/api/provider/available-jobs', { headers, data: { booking_id: id } });
    expect(response.status(), `a provider claims booking ${id}: status`).toBe(200);
    expect((await response.json()).success, `a provider claims booking ${id}: success`).toBe(true);
}

async function answerOf(response) {
    return { status: response.status(), body: await response.json().catch(() => null) };
}

// The exact answer of a refusal: status and the whole body.
async function expectBody(response, status, body, who) {
    const answer = await answerOf(response);
    expect(answer.status, `${who}: status`).toBe(status);
    expect(answer.body, `${who}: body`).toEqual(body);
}

// The data of an answer that succeeded: its status, success true, and the `data` of the envelope.
async function dataOf(response, status, who) {
    const answer = await answerOf(response);
    expect(answer.status, `${who}: status (${JSON.stringify(answer.body)?.slice(0, 200)})`).toBe(status);
    expect(answer.body?.success, `${who}: success`).toBe(true);
    return answer.body.data;
}

// A refusal that is a 400 with a message: the message is returned, and its text is asserted by the caller where the design fixes it.
async function expectRefusal(response, who) {
    const answer = await answerOf(response);
    expect(answer.status, `${who}: status`).toBe(400);
    expect(answer.body?.success, `${who}: success`).toBe(false);
    expect(typeof answer.body?.message === 'string' && answer.body.message.length > 0, `${who}: a message`).toBe(true);
    return answer.body.message;
}

const postCrew = (request, headers, name, phone) => request.post('/api/provider/crew', { headers, data: { name, phone } });

async function addCrew(request, headers, name, phone, who = 'the provider') {
    return (await dataOf(await postCrew(request, headers, name, phone), 201, `${who} adds ${name}`)).member;
}

async function removeCrew(request, headers, id, who) {
    return dataOf(await request.delete(`/api/provider/crew/${id}`, { headers }), 200, `${who} removes member ${id}`);
}

async function crewOf(request, headers, who) {
    const data = await dataOf(await request.get('/api/provider/crew', { headers }), 200, `${who} reads the crew list`);
    expect(data.limit, `${who}: the limit the list states`).toBe(CREW_MAX);
    return data.crew;
}

// The members of a list that this file made: a fixture provider may hold others (a hand-made one), and the cases do not depend on them.
const mine = (crew) => crew.filter((entry) => entry.phone.startsWith(STORED_PREFIX));
const byId = (a, b) => a.id - b.id;
const idsOf = (members) => members.map((entry) => entry.id).sort((a, b) => a - b);
const asOnJob = (members, removed = false) => members.map((entry) => ({ ...entry, removed }));

const jobCrewPath = (id) => `/api/provider/jobs/${id}/crew`;
const jobCrew = async (request, headers, id, who) => dataOf(await request.get(jobCrewPath(id), { headers }), 200, `${who} reads the crew of job ${id}`);
const saveCrew = async (request, headers, id, crewIds, who) => dataOf(await request.put(jobCrewPath(id), { headers, data: { crew_ids: crewIds } }), 200, `${who} saves ${JSON.stringify(crewIds)} on job ${id}`);

test.describe('Provider crew: the crew list', () => {
    sweepAround();

    test('AC1: a provider adds Sam with (403) 555-0123 and it is listed as +14035550123, the same number typed as 1-403-555-0123 is a 409, and the list is ordered by name then id', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const added = await answerOf(await postCrew(request, as.provider, 'Sam', '(403) 555-0123'));
        expect(added.status, 'adding Sam: status').toBe(201);
        expect(added.body?.success, 'adding Sam: success').toBe(true);
        expect(added.body?.data, 'adding Sam: the member as stored, and not a revival').toEqual({ member: { id: expect.any(Number), name: 'Sam', phone: stored('123') }, revived: false });
        const sam = added.body.data.member;
        await expectBody(await postCrew(request, as.provider, 'Sam again', '1-403-555-0123'), 409, DUPLICATE, 'the same number typed as 1-403-555-0123');
        const dee = await addCrew(request, as.provider, 'Dee', typed('124'));
        const bea1 = await addCrew(request, as.provider, 'Bea', typed('125'));
        const bea2 = await addCrew(request, as.provider, 'Bea', typed('126'));
        const cal = await addCrew(request, as.provider, 'Cal', typed('127'));
        expect(bea1.id < bea2.id, 'the second Bea has the higher id').toBe(true);
        expect(mine(await crewOf(request, as.provider, 'provider 1')), 'the list: by name, equal names by id, each as {id, name, phone}, Sam still Sam').toEqual([bea1, bea2, cal, dee, sam]);
    });

    test('AC1: a provider corrects a name, then a number that is read again by the same rule, and a number another entry holds, removed or not, is a 409', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const sam = await addCrew(request, as.provider, 'Sam', typed('110'));
        const kim = await addCrew(request, as.provider, 'Kim', typed('112'));
        const patch = (id, data) => request.patch(`/api/provider/crew/${id}`, { headers: as.provider, data });

        expect(await dataOf(await patch(sam.id, { name: 'Samuel' }), 200, 'the name is corrected'), 'the corrected name, the same number and id').toEqual({ member: { id: sam.id, name: 'Samuel', phone: stored('110') } });
        const moved = { id: sam.id, name: 'Samuel', phone: stored('111') };
        expect(await dataOf(await patch(sam.id, { phone: '(403) 555-0111' }), 200, 'the number is corrected'), 'the number is read into E.164, the name stays').toEqual({ member: moved });
        expect(mine(await crewOf(request, as.provider, 'provider 1')), 'the list holds both corrections').toEqual([kim, moved]);

        const refusals = [['no field', {}], ['a blank name', { name: '   ' }], ['a number that cannot be read', { phone: 'not a number' }], ['a name with a line break', { name: 'Sam\nuel' }]];
        for (const [what, data] of refusals) await expectRefusal(await patch(sam.id, data), `a correction with ${what}`);
        expect(mine(await crewOf(request, as.provider, 'provider 1')), 'the refused corrections changed nothing').toEqual([kim, moved]);

        await expectBody(await patch(kim.id, { phone: '403-555-0111' }), 409, CLASH, "Kim's number changed to Samuel's");
        expect(await dataOf(await patch(kim.id, { phone: typed('112') }), 200, "Kim's own number typed again"), 'an entry is not another entry').toEqual({ member: kim });
        await removeCrew(request, as.provider, sam.id, 'provider 1');
        await expectBody(await patch(kim.id, { phone: '(403) 555-0111' }), 409, CLASH, "Kim's number changed to a removed entry's number");
        expect(mine(await crewOf(request, as.provider, 'provider 1')), 'Kim is as she was').toEqual([kim]);
    });

    test('AC1: removing a member drops it from the list but keeps its row, a second removal is a 404, and adding the same number again revives the same row under the new name', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const sam = await addCrew(request, as.provider, 'Sam', typed('120'));
        expect(await removeCrew(request, as.provider, sam.id, 'provider 1'), 'the removal answers, Sam being on no job').toEqual({ removed: true, taken_off_jobs: 0 });
        expect(mine(await crewOf(request, as.provider, 'provider 1')), 'the list no longer holds Sam').toEqual([]);
        const [kept] = await rows('SELECT name, phone, removed_at FROM provider_crew_members WHERE id = ?', [sam.id]);
        expect([kept?.name, kept?.phone, Boolean(kept?.removed_at)], 'the row stays, marked removed, with its name and number').toEqual(['Sam', stored('120'), true]);

        await expectBody(await request.delete(`/api/provider/crew/${sam.id}`, { headers: as.provider }), 404, NO_MEMBER, 'a second removal');
        await expectBody(await request.patch(`/api/provider/crew/${sam.id}`, { headers: as.provider, data: { name: 'Samuel' } }), 404, NO_MEMBER, 'a correction of a removed member');

        const revived = await dataOf(await postCrew(request, as.provider, 'Samantha', '1 (403) 555-0120'), 201, 'the same number added again');
        expect(revived, 'the same row comes back under the name just typed').toEqual({ member: { id: sam.id, name: 'Samantha', phone: stored('120') }, revived: true });
        expect(mine(await crewOf(request, as.provider, 'provider 1')), 'the list holds the revived member once').toEqual([revived.member]);
        const [back] = await rows('SELECT removed_at FROM provider_crew_members WHERE id = ?', [sam.id]);
        expect(back?.removed_at, 'the revived row is not marked removed').toBeNull();
    });

    test('AC1: a missing or blank name, a name over 120 characters or with a line break, and a number that cannot be read are 400s that add nobody, and a name with spaces round it is saved trimmed', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const before = (await crewOf(request, as.provider, 'provider 1')).length;
        const valid = typed('131');
        const nameRefusals = [
            ['no name and no number', {}], ['an empty name', { name: '', phone: valid }], ['a name of spaces', { name: '   ', phone: valid }], ['no name', { phone: valid }],
        ];
        for (const [what, data] of nameRefusals) {
            expect(await expectRefusal(await request.post('/api/provider/crew', { headers: as.provider, data }), `adding with ${what}`), `adding with ${what}: the message`).toBe(NAME_MISSING);
        }
        const otherRefusals = [
            ['a name of 121 characters', { name: 'a'.repeat(121), phone: valid }, null],
            ['a name with a line feed', { name: 'Sam\nJones', phone: valid }, null],
            ['a name with a carriage return and a line feed', { name: 'Sam\r\nJones', phone: valid }, null],
            ['no number', { name: 'Pat' }, null],
            ['a number with letters', { name: 'Pat', phone: '403-555-CALL' }, null],
            ['a number with an extension', { name: 'Pat', phone: '403-555-0131 x12' }, null],
            ['a country code that starts with 0', { name: 'Pat', phone: '+0123456789' }, null],
            ['a bare nine digit number', { name: 'Pat', phone: '403555013' }, /country code/i],
        ];
        for (const [what, data, expected] of otherRefusals) {
            const message = await expectRefusal(await request.post('/api/provider/crew', { headers: as.provider, data }), `adding with ${what}`);
            if (expected) expect(message, `adding with ${what}: the message asks for the country code`).toMatch(expected);
        }
        expect((await crewOf(request, as.provider, 'provider 1')).length, 'no refusal added a member').toBe(before);

        const pat = await addCrew(request, as.provider, '  Pat  ', ' (403) 555-0130 ');
        expect(pat, 'a name with spaces round it is saved trimmed, the number as E.164').toEqual({ id: expect.any(Number), name: 'Pat', phone: stored('130') });
    });

    test('AC1: at 30 members a 31st is a 409 with the cap message, a removed number cannot be brought back past the cap either, nothing is added, and a removal makes room', async ({ request, baseURL }) => {
        test.setTimeout(90_000);
        const as = await credentials(baseURL);
        const open = await db();
        const gone = await addCrew(request, as.provider, 'Gone', typed('140'));
        await removeCrew(request, as.provider, gone.id, 'provider 1');

        // Fills provider 1's crew to the cap with SQL: the active members it has, plus rows with the fictional numbers +14035550100 and up, none of
        // which is a number this case uses itself (140 and 141).
        const fill = CREW_MAX - (await activeMembers(PROVIDER1.id));
        expect(fill, 'provider 1 starts below the cap').toBeGreaterThan(0);
        const fillers = Array.from({ length: fill }, (_, index) => [PROVIDER1.id, `Filler ${index + 1}`, `${STORED_PREFIX}${100 + index}`]);
        await open.execute(`INSERT INTO provider_crew_members (provider_id, name, phone) VALUES ${fillers.map(() => '(?, ?, ?)').join(', ')}`, fillers.flat());
        expect((await crewOf(request, as.provider, 'provider 1')).length, 'the crew is at the cap').toBe(CREW_MAX);

        await expectBody(await postCrew(request, as.provider, 'Thirty-first', typed('141')), 409, FULL, 'the 31st member');
        await expectBody(await postCrew(request, as.provider, 'Gone', typed('140')), 409, FULL, 'a removed number added again at the cap');
        expect(await activeMembers(PROVIDER1.id), 'nothing was added at the cap').toBe(CREW_MAX);
        const [still] = await rows('SELECT removed_at FROM provider_crew_members WHERE id = ?', [gone.id]);
        expect(Boolean(still?.removed_at), 'the removed number stays removed').toBe(true);

        const [first] = await crewOf(request, as.provider, 'provider 1');
        await removeCrew(request, as.provider, first.id, 'provider 1');
        expect(await addCrew(request, as.provider, 'Thirty-first', typed('141')), 'a removal makes room for one').toEqual({ id: expect.any(Number), name: 'Thirty-first', phone: stored('141') });
        expect(await activeMembers(PROVIDER1.id), 'the crew is at the cap again').toBe(CREW_MAX);
    });
});

test.describe('Provider crew: the crew on a job', () => {
    sweepAround();

    test('AC2: a job the admin gave to the provider takes two members, GET shows them, the same PUT again adds and removes nobody, and a repeated id counts once', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const ann = await addCrew(request, as.provider, 'Ann', typed('150'));
        const ben = await addCrew(request, as.provider, 'Ben', typed('151'));
        await addCrew(request, as.provider, 'Cy', typed('152'));
        await withBookings(request, as, 1, async (id) => {
            await give(request, as, id, PROVIDER1.id);
            expect(await jobCrew(request, as.provider, id, 'provider 1'), 'a given job has no crew yet and can change').toEqual({ crew: [], editable: true });

            const first = await saveCrew(request, as.provider, id, [ben.id, ann.id, ann.id], 'provider 1');
            expect(first.crew, 'the crew, by name, a repeated id counted once').toEqual(asOnJob([ann, ben]));
            expect([...first.added].sort(byId), 'both members are new').toEqual([ann, ben]);
            expect(first.removed, 'nobody is removed by a first save').toEqual([]);
            expect(await jobCrew(request, as.provider, id, 'provider 1'), 'GET shows what the PUT answered').toEqual({ crew: first.crew, editable: true });

            const again = await saveCrew(request, as.provider, id, [ann.id, ben.id], 'provider 1');
            expect([again.added, again.removed], 'the same save again adds and removes nobody').toEqual([[], []]);
            expect(again.crew, 'the same save again leaves the crew as it was').toEqual(first.crew);
            expect(await crewRowsOn(id), 'the table holds the two members once each').toEqual(idsOf([ann, ben]));
        });
    });

    test('AC2: a job claimed from the marketplace takes a crew, a PUT of one kept and one new member reports exactly the difference, and an empty list clears it', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const a = await addCrew(request, as.provider, 'Ann', typed('153'));
        const b = await addCrew(request, as.provider, 'Ben', typed('154'));
        const c = await addCrew(request, as.provider, 'Cy', typed('155'));
        await withBookings(request, as, 1, async (id) => {
            await claim(request, as, as.provider, id);
            expect((await saveCrew(request, as.provider, id, [a.id, b.id], 'provider 1')).crew, 'a claimed job takes a crew').toEqual(asOnJob([a, b]));

            const swapped = await saveCrew(request, as.provider, id, [b.id, c.id], 'provider 1');
            expect(swapped.added, 'added is the member that is new').toEqual([c]);
            expect(swapped.removed, 'removed is the member that left').toEqual([a]);
            expect(swapped.crew, 'the crew is the kept and the new member').toEqual(asOnJob([b, c]));
            expect(await jobCrew(request, as.provider, id, 'provider 1'), 'GET shows the swap').toEqual({ crew: asOnJob([b, c]), editable: true });

            const cleared = await saveCrew(request, as.provider, id, [], 'provider 1');
            expect([cleared.crew, cleared.added], 'an empty list adds nobody and leaves nobody').toEqual([[], []]);
            expect([...cleared.removed].sort(byId), 'an empty list removes both').toEqual([b, c]);
            expect(await jobCrew(request, as.provider, id, 'provider 1'), 'GET shows nobody').toEqual({ crew: [], editable: true });
            expect(await crewRowsOn(id), 'the table holds nobody').toEqual([]);
            expect(idsOf(mine(await crewOf(request, as.provider, 'provider 1'))), 'clearing a job leaves the members on the crew list').toEqual(idsOf([a, b, c]));
        });
    });

    test('AC2: a finished job is a 409 on PUT and a 200 on GET with editable false, and its crew does not change', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const ann = await addCrew(request, as.provider, 'Ann', typed('156'));
        const ben = await addCrew(request, as.provider, 'Ben', typed('157'));
        await withBookings(request, as, 1, async (id) => {
            await give(request, as, id, PROVIDER1.id);
            await saveCrew(request, as.provider, id, [ann.id, ben.id], 'provider 1');
            await setStatus(id, 'completed');
            expect(await jobCrew(request, as.provider, id, 'provider 1'), 'a finished job is read, its crew shown, and cannot change').toEqual({ crew: asOnJob([ann, ben]), editable: false });
            await expectBody(await request.put(jobCrewPath(id), { headers: as.provider, data: { crew_ids: [ann.id] } }), 409, FINISHED, 'a PUT that would drop Ben');
            await expectBody(await request.put(jobCrewPath(id), { headers: as.provider, data: { crew_ids: [] } }), 409, FINISHED, 'a PUT that would clear the crew');
            expect(await crewRowsOn(id), 'the crew of the finished job is as it was').toEqual(idsOf([ann, ben]));
        });
    });

    test('AC2: the crew can change while a job is pending, matching, confirmed or in progress and not once it is awaiting approval, completed, cancelled or disputed, and GET says which', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const ann = await addCrew(request, as.provider, 'Ann', typed('158'));
        await withBookings(request, as, 1, async (id) => {
            await give(request, as, id, PROVIDER1.id);
            for (const status of [...OPEN_STATUSES, ...CLOSED_STATUSES]) {
                await setStatus(id, status);
                const open = OPEN_STATUSES.includes(status);
                const read = await jobCrew(request, as.provider, id, `provider 1 on a ${status} job`);
                expect(read.editable, `GET on a ${status} job: editable`).toBe(open);
                if (open) {
                    expect((await saveCrew(request, as.provider, id, [ann.id], `provider 1 on a ${status} job`)).crew, `PUT on a ${status} job: the crew`).toEqual(asOnJob([ann]));
                } else {
                    expect(read.crew, `GET on a ${status} job: the crew it has`).toEqual(asOnJob([ann]));
                    await expectBody(await request.put(jobCrewPath(id), { headers: as.provider, data: { crew_ids: [] } }), 409, FINISHED, `PUT on a ${status} job`);
                    expect(await crewRowsOn(id), `the crew of a ${status} job is as it was`).toEqual([ann.id]);
                }
            }
        });
    });

    test('AC2: a PUT body that is not a list of at most 30 positive whole-number ids is a 400 that names crew_ids, and nothing is written', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const ann = await addCrew(request, as.provider, 'Ann', typed('159'));
        await withBookings(request, as, 1, async (id) => {
            await give(request, as, id, PROVIDER1.id);
            await saveCrew(request, as.provider, id, [ann.id], 'provider 1');
            const thirtyOne = Array.from({ length: CREW_MAX + 1 }, (_, index) => MISSING - index);
            const bodies = [
                ['an empty object', {}], ['crew_ids null', { crew_ids: null }], ['crew_ids a string', { crew_ids: 'abc' }], ['crew_ids a number', { crew_ids: ann.id }],
                ['crew_ids an object', { crew_ids: { 0: ann.id } }], ['an id of 0', { crew_ids: [0] }], ['a negative id', { crew_ids: [-1] }], ['a fractional id', { crew_ids: [1.5] }],
                ['an id written as text', { crew_ids: [String(ann.id)] }], ['a null id', { crew_ids: [null] }], ['a good id and a bad one', { crew_ids: [ann.id, 'x'] }],
                ['31 ids', { crew_ids: thirtyOne }], ['a list as the whole body', [ann.id]],
            ];
            for (const [what, data] of bodies) {
                await expectBody(await request.put(jobCrewPath(id), { headers: as.provider, data }), 400, NOT_A_LIST, `a PUT with ${what}`);
            }
            const thirty = thirtyOne.slice(0, CREW_MAX);
            await expectBody(await request.put(jobCrewPath(id), { headers: as.provider, data: { crew_ids: thirty } }), 400, NOT_OWN, 'a PUT of 30 ids that are nobody\'s: a good shape, the other 400');
            expect(await jobCrew(request, as.provider, id, 'provider 1'), 'no refusal touched the crew').toEqual({ crew: asOnJob([ann]), editable: true });
            expect(await crewRowsOn(id), 'the table holds the one member').toEqual([ann.id]);
        });
    });
});

test.describe('Provider crew: a job is the provider\'s own (hard gate)', () => {
    sweepAround();

    test('AC3 (hard gate): PUT and GET on a job given to provider 2, one provider 2 claimed, an open-pool job, a job nobody holds, a missing id and ids that are not numbers are all 404 Job not found, and nothing is written', async ({ request, baseURL, playwright }) => {
        test.setTimeout(90_000);
        const as = await credentials(baseURL);
        const two = await signedInAs(playwright, baseURL, 'provider2');
        const ann = await addCrew(request, as.provider, 'Ann', typed('160'), 'provider 1');
        const cy = await addCrew(request, two, 'Cy', typed('161'), 'provider 2');
        await withBookings(request, as, 4, async (given, claimed, pool, nobody) => {
            await give(request, as, given, PROVIDER2.id);
            await claim(request, as, two, claimed);
            await push(request, as, pool);
            for (const id of [given, claimed]) await saveCrew(request, two, id, [cy.id], 'provider 2');
            const heldBefore = [await jobCrew(request, two, given, 'provider 2'), await jobCrew(request, two, claimed, 'provider 2')];
            const targets = [
                ['a job given to provider 2', given], ['a job provider 2 claimed', claimed], ['an open-pool job', pool], ['a job nobody holds', nobody], ['a missing id', MISSING],
                ...NOT_NUMBERS.map((id) => [`the id ${id}`, id]),
            ];
            const refused = async (when) => {
                for (const [what, id] of targets) {
                    await expectBody(await request.put(jobCrewPath(id), { headers: as.provider, data: { crew_ids: [ann.id] } }), 404, NO_JOB, `provider 1 saves a crew on ${what} ${when}`);
                    await expectBody(await request.get(jobCrewPath(id), { headers: as.provider }), 404, NO_JOB, `provider 1 reads the crew of ${what} ${when}`);
                }
            };
            await refused('while it is open');
            // The id is read before the body: a body that is not a list is still the 404 of a bad id.
            await expectBody(await request.put(jobCrewPath('abc'), { headers: as.provider, data: {} }), 404, NO_JOB, 'provider 1 saves a body that is no list on the id abc');

            expect([await crewRowsOn(given), await crewRowsOn(claimed), await crewRowsOn(pool), await crewRowsOn(nobody)], 'nothing was written on any of the four jobs').toEqual([[cy.id], [cy.id], [], []]);
            expect([await jobCrew(request, two, given, 'provider 2'), await jobCrew(request, two, claimed, 'provider 2')], "the rightful holder's reads are unchanged").toEqual(heldBefore);

            // A finished job of another provider is still a 404: its status is not told to someone who does not hold it.
            await setStatus(given, 'completed');
            await setStatus(claimed, 'completed');
            await refused('once the jobs are finished');
            expect([await crewRowsOn(given), await crewRowsOn(claimed)], 'nothing was written on the finished jobs').toEqual([[cy.id], [cy.id]]);
        });
    });

    test('AC3 (hard gate): a provider_id in the body or the query string names no one, so it opens no other provider\'s job and moves no job', async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const two = await signedInAs(playwright, baseURL, 'provider2');
        const ann = await addCrew(request, as.provider, 'Ann', typed('162'), 'provider 1');
        await withBookings(request, as, 2, async (own, other) => {
            await give(request, as, own, PROVIDER1.id);
            await give(request, as, other, PROVIDER2.id);

            // Provider 1 names itself on provider 2's job.
            await expectBody(
                await request.put(`${jobCrewPath(other)}?provider_id=${PROVIDER1.id}`, { headers: as.provider, data: { crew_ids: [ann.id], provider_id: PROVIDER1.id } }),
                404, NO_JOB, "provider 1 names itself on provider 2's job in a PUT",
            );
            await expectBody(await request.get(`${jobCrewPath(other)}?provider_id=${PROVIDER1.id}`, { headers: as.provider }), 404, NO_JOB, "provider 1 names itself on provider 2's job in a GET");
            const [held] = await rows('SELECT provider_id FROM bookings WHERE id = ?', [other]);
            expect(held?.provider_id, "provider 2's job is still provider 2's").toBe(PROVIDER2.id);
            expect(await crewRowsOn(other), "nothing was written on provider 2's job").toEqual([]);

            // Provider 1 names provider 2 on its own job: the job is still provider 1's and the crew is provider 1's.
            const saved = await dataOf(
                await request.put(`${jobCrewPath(own)}?provider_id=${PROVIDER2.id}`, { headers: as.provider, data: { crew_ids: [ann.id], provider_id: PROVIDER2.id } }),
                200, "provider 1 names provider 2 on its own job in a PUT",
            );
            expect(saved.crew, 'the save is provider 1\'s').toEqual(asOnJob([ann]));
            const [mineStill] = await rows('SELECT provider_id FROM bookings WHERE id = ?', [own]);
            expect(mineStill?.provider_id, "provider 1's job is still provider 1's").toBe(PROVIDER1.id);
            expect(await crewRowsOn(own), 'the table holds provider 1\'s member').toEqual([ann.id]);
            await expectBody(await request.get(`${jobCrewPath(own)}?provider_id=${PROVIDER2.id}`, { headers: two }), 404, NO_JOB, "provider 2 names itself on provider 1's job in a GET");
        });
    });
});

test.describe('Provider crew: a member is the provider\'s own (hard gate)', () => {
    sweepAround();

    test('AC4 (hard gate): provider 2\'s crew list holds none of provider 1\'s members, and the same number can sit on both lists as two members', async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const two = await signedInAs(playwright, baseURL, 'provider2');
        const ann = await addCrew(request, as.provider, 'Ann', typed('170'), 'provider 1');
        const bea = await addCrew(request, as.provider, 'Bea', typed('171'), 'provider 1');
        const cy = await addCrew(request, two, 'Cy', typed('172'), 'provider 2');
        // The unique key is per provider: provider 2 may list a number that provider 1 lists, as its own member, and is not told that provider 1 does.
        const twin = await addCrew(request, two, 'Ann Two', typed('170'), 'provider 2');
        expect(twin.id, "provider 2's entry for the same number is its own row").not.toBe(ann.id);

        const list1 = await crewOf(request, as.provider, 'provider 1');
        const list2 = await crewOf(request, two, 'provider 2');
        expect(idsOf(list2).filter((id) => [ann.id, bea.id].includes(id)), "provider 1's members in provider 2's list").toEqual([]);
        expect(idsOf(list1).filter((id) => [cy.id, twin.id].includes(id)), "provider 2's members in provider 1's list").toEqual([]);
        expect(mine(list1), "provider 1's list is its own two").toEqual([ann, bea]);
        expect(mine(list2), "provider 2's list is its own two").toEqual([twin, cy]);
    });

    test('AC4 (hard gate): PATCH and DELETE on provider 1\'s member are 404 Crew member not found for provider 2, the same answer as a missing, a removed or a malformed id, and the member is unchanged and still on its job', async ({ request, baseURL, playwright }) => {
        test.setTimeout(90_000);
        const as = await credentials(baseURL);
        const two = await signedInAs(playwright, baseURL, 'provider2');
        const ann = await addCrew(request, as.provider, 'Ann', typed('173'), 'provider 1');
        const gone = await addCrew(request, two, 'Gone', typed('174'), 'provider 2');
        await removeCrew(request, two, gone.id, 'provider 2');
        await withBookings(request, as, 1, async (job) => {
            await give(request, as, job, PROVIDER1.id);
            await saveCrew(request, as.provider, job, [ann.id], 'provider 1');
            const targets = [
                ["provider 1's member", ann.id], ['a missing id', MISSING], ["provider 2's own removed member", gone.id],
                ...NOT_NUMBERS.map((id) => [`the id ${id}`, id]),
            ];
            for (const [what, id] of targets) {
                await expectBody(await request.patch(`/api/provider/crew/${id}`, { headers: two, data: { name: 'Nobody', phone: typed('199') } }), 404, NO_MEMBER, `provider 2 corrects ${what}`);
                await expectBody(await request.delete(`/api/provider/crew/${id}`, { headers: two }), 404, NO_MEMBER, `provider 2 removes ${what}`);
            }
            const [row] = await rows('SELECT provider_id, name, phone, removed_at FROM provider_crew_members WHERE id = ?', [ann.id]);
            expect(row, "provider 1's member after the refused corrections and removals").toEqual({ provider_id: PROVIDER1.id, name: 'Ann', phone: stored('173'), removed_at: null });
            expect(mine(await crewOf(request, as.provider, 'provider 1')), "provider 1's list is unchanged").toEqual([ann]);
            expect(await crewRowsOn(job), 'the refused removal did not take the member off the job').toEqual([ann.id]);
            expect(await countOf('SELECT COUNT(*) AS n FROM provider_crew_members WHERE phone = ?', [stored('199')]), 'the number of the refused correction was never stored').toBe(0);
        });
    });

    test('AC4 (hard gate): a PUT on a job naming another provider\'s member is the same 400 as a removed member and a missing id, in either direction, and writes nothing', async ({ request, baseURL, playwright }) => {
        test.setTimeout(90_000);
        const as = await credentials(baseURL);
        const two = await signedInAs(playwright, baseURL, 'provider2');
        const ann = await addCrew(request, as.provider, 'Ann', typed('175'), 'provider 1');
        const cy = await addCrew(request, two, 'Cy', typed('176'), 'provider 2');
        const gone = await addCrew(request, two, 'Gone', typed('177'), 'provider 2');
        await removeCrew(request, two, gone.id, 'provider 2');
        await withBookings(request, as, 2, async (jobTwo, jobOne) => {
            await give(request, as, jobTwo, PROVIDER2.id);
            await give(request, as, jobOne, PROVIDER1.id);
            expect((await saveCrew(request, two, jobTwo, [cy.id], 'provider 2')).crew, "a member of provider 2's own is accepted on provider 2's job").toEqual(asOnJob([cy]));

            const refusals = [
                ["provider 1's member", [ann.id]], ["a good member and provider 1's member", [cy.id, ann.id]], ['a removed member', [gone.id]],
                ['a missing id', [MISSING]], ['a good member and a missing id', [cy.id, MISSING]],
            ];
            for (const [what, ids] of refusals) {
                await expectBody(await request.put(jobCrewPath(jobTwo), { headers: two, data: { crew_ids: ids } }), 400, NOT_OWN, `provider 2 saves ${what} on its own job`);
            }
            expect(await crewRowsOn(jobTwo), "the refusals left provider 2's crew as it was").toEqual([cy.id]);
            expect((await jobCrew(request, two, jobTwo, 'provider 2')).crew, "provider 2's read after the refusals").toEqual(asOnJob([cy]));

            await expectBody(await request.put(jobCrewPath(jobOne), { headers: as.provider, data: { crew_ids: [cy.id] } }), 400, NOT_OWN, "provider 1 saves provider 2's member on its own job");
            await expectBody(await request.put(jobCrewPath(jobOne), { headers: as.provider, data: { crew_ids: [ann.id, cy.id] } }), 400, NOT_OWN, "provider 1 saves its own member and provider 2's member on its own job");
            expect(await crewRowsOn(jobOne), "nothing was written on provider 1's job").toEqual([]);
        });
    });

    test('AC4 (hard gate): with no credential every crew route is a 401 and a customer or an admin session is a 403, with real ids, and nothing is written', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const ann = await addCrew(request, as.provider, 'Ann', typed('178'), 'provider 1');
        await withBookings(request, as, 1, async (job) => {
            await give(request, as, job, PROVIDER1.id);
            await saveCrew(request, as.provider, job, [ann.id], 'provider 1');
            const routes = [
                ['GET /api/provider/crew', 'GET', '/api/provider/crew', undefined],
                ['POST /api/provider/crew', 'POST', '/api/provider/crew', { name: 'Nobody', phone: typed('179') }],
                ['PATCH /api/provider/crew/[id]', 'PATCH', `/api/provider/crew/${ann.id}`, { name: 'Nobody' }],
                ['DELETE /api/provider/crew/[id]', 'DELETE', `/api/provider/crew/${ann.id}`, undefined],
                ['GET /api/provider/jobs/[id]/crew', 'GET', jobCrewPath(job), undefined],
                ['PUT /api/provider/jobs/[id]/crew', 'PUT', jobCrewPath(job), { crew_ids: [] }],
            ];
            for (const [who, headers, status, body] of [['no credential', as.none, 401, UNAUTHORIZED], ['a customer', as.customer, 403, FORBIDDEN], ['an admin', as.admin, 403, FORBIDDEN]]) {
                for (const [label, method, route, data] of routes) {
                    await expectBody(await request.fetch(route, { method, headers, data }), status, body, `${who} on ${label}`);
                }
            }
            expect(mine(await crewOf(request, as.provider, 'provider 1')), "provider 1's list is as it was").toEqual([ann]);
            expect(await crewRowsOn(job), "provider 1's job crew is as it was").toEqual([ann.id]);
            expect(await countOf('SELECT COUNT(*) AS n FROM provider_crew_members WHERE phone = ?', [stored('179')]), 'the refused add stored no number').toBe(0);
        });
    });
});

test.describe('Provider crew: a job that changes hands', () => {
    sweepAround();

    test('Resets: an admin reassign to provider 2 and back clears the crew on each step, so provider 2 sees none and provider 1\'s old picks do not come back', async ({ request, baseURL, playwright }) => {
        test.setTimeout(90_000);
        const as = await credentials(baseURL);
        const two = await signedInAs(playwright, baseURL, 'provider2');
        const ann = await addCrew(request, as.provider, 'Ann', typed('180'), 'provider 1');
        const bea = await addCrew(request, as.provider, 'Bea', typed('181'), 'provider 1');
        const reassign = async (id, to, from, who) => expectBody(
            await request.post(`/api/bookings/${id}/reassign`, { headers: as.admin, data: { new_provider_id: to, old_provider_id: from } }),
            200, { success: true, message: 'Provider reassigned successfully' }, who,
        );
        await withBookings(request, as, 1, async (id) => {
            await give(request, as, id, PROVIDER1.id);
            await saveCrew(request, as.provider, id, [ann.id, bea.id], 'provider 1');
            expect(await crewRowsOn(id), 'two members are on the job before the reassign').toEqual(idsOf([ann, bea]));

            await reassign(id, PROVIDER2.id, PROVIDER1.id, 'the admin reassigns the job to provider 2');
            expect(await crewRowsOn(id), 'the reassign cleared the crew rows').toEqual([]);
            expect(await jobCrew(request, two, id, 'provider 2'), "the new provider's read: nobody, and it can change").toEqual({ crew: [], editable: true });
            await expectBody(await request.get(jobCrewPath(id), { headers: as.provider }), 404, NO_JOB, 'provider 1 reads the job it no longer holds');

            await reassign(id, PROVIDER1.id, PROVIDER2.id, 'the admin reassigns the job back to provider 1');
            expect(await crewRowsOn(id), 'the reassign back left no crew rows').toEqual([]);
            expect(await jobCrew(request, as.provider, id, 'provider 1'), "provider 1's old picks do not come back").toEqual({ crew: [], editable: true });
            await expectBody(await request.get(jobCrewPath(id), { headers: two }), 404, NO_JOB, 'provider 2 reads the job it no longer holds');

            const fresh = await saveCrew(request, as.provider, id, [bea.id], 'provider 1');
            expect([fresh.added, fresh.removed], 'a save after the round trip starts from nobody').toEqual([[bea], []]);
        });
    });

    test('Resets: an admin restart leaves the job with no crew, and giving it to the same provider again starts with nobody', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const ann = await addCrew(request, as.provider, 'Ann', typed('182'), 'provider 1');
        await withBookings(request, as, 1, async (id) => {
            await give(request, as, id, PROVIDER1.id);
            await saveCrew(request, as.provider, id, [ann.id], 'provider 1');
            await expectBody(await request.post(`/api/bookings/${id}/restart`, { headers: as.admin, data: {} }), 200, { success: true, message: 'Booking restarted successfully' }, 'the admin restarts the job');
            expect(await crewRowsOn(id), 'the restart cleared the crew rows').toEqual([]);
            await give(request, as, id, PROVIDER1.id);
            expect(await jobCrew(request, as.provider, id, 'provider 1'), 'given to provider 1 again, the job has no crew').toEqual({ crew: [], editable: true });
        });
    });

    test('Resets: unassigning a job through PUT /api/bookings leaves it with no crew, and giving it to the same provider again starts with nobody', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const ann = await addCrew(request, as.provider, 'Ann', typed('183'), 'provider 1');
        await withBookings(request, as, 1, async (id) => {
            await give(request, as, id, PROVIDER1.id);
            await saveCrew(request, as.provider, id, [ann.id], 'provider 1');
            const cleared = await request.put(`/api/bookings?id=${id}`, { headers: as.admin, data: { provider_id: null, status: 'pending' } });
            expect(cleared.status(), `admin unassigns booking ${id}`).toBe(200);
            expect(await crewRowsOn(id), 'the unassign cleared the crew rows').toEqual([]);
            await expectBody(await request.get(jobCrewPath(id), { headers: as.provider }), 404, NO_JOB, 'provider 1 reads the job nobody holds');
            await give(request, as, id, PROVIDER1.id);
            expect(await jobCrew(request, as.provider, id, 'provider 1'), 'given to provider 1 again, the job has no crew').toEqual({ crew: [], editable: true });
        });
    });

    test('Resets: removing a member takes it off the jobs that can still change and not off a finished one, whose crew still names it, marked as removed', async ({ request, baseURL }) => {
        test.setTimeout(90_000);
        const as = await credentials(baseURL);
        const ann = await addCrew(request, as.provider, 'Ann', typed('184'));
        const bea = await addCrew(request, as.provider, 'Bea', typed('185'));
        await withBookings(request, as, 3, async (given, claimed, finished) => {
            await give(request, as, given, PROVIDER1.id);
            await claim(request, as, as.provider, claimed);
            await give(request, as, finished, PROVIDER1.id);
            await saveCrew(request, as.provider, given, [ann.id, bea.id], 'provider 1');
            await saveCrew(request, as.provider, claimed, [ann.id], 'provider 1');
            await saveCrew(request, as.provider, finished, [ann.id, bea.id], 'provider 1');
            await setStatus(finished, 'completed');

            expect(await removeCrew(request, as.provider, ann.id, 'provider 1'), 'Ann was on two jobs that can still change').toEqual({ removed: true, taken_off_jobs: 2 });
            expect(await jobCrew(request, as.provider, given, 'provider 1'), 'the given job keeps Bea only').toEqual({ crew: asOnJob([bea]), editable: true });
            expect(await jobCrew(request, as.provider, claimed, 'provider 1'), 'the claimed job has nobody left').toEqual({ crew: [], editable: true });
            const read = await jobCrew(request, as.provider, finished, 'provider 1');
            expect(read, 'the finished job still names Ann, with her name and number, marked as removed, and Bea').toEqual({ crew: [{ ...ann, removed: true }, { ...bea, removed: false }], editable: false });
            expect([await crewRowsOn(given), await crewRowsOn(claimed), await crewRowsOn(finished)], 'the rows: one, none, and both on the finished job').toEqual([[bea.id], [], idsOf([ann, bea])]);
            expect(mine(await crewOf(request, as.provider, 'provider 1')), 'Ann is not on the crew list any more').toEqual([bea]);
        });
    });
});

// ---- the screens (the frontend seat): the My Crew entry, /provider/crew and the "Crew on this job" panel, in a browser signed in as provider 1. The
// crew and the jobs a case needs are made through the routes (the cap by SQL, as its server case does), and the case then does on the screen what a
// person would do. The sweep of the describes above applies here too. ----

// `next dev` compiles a page or a route on its first request, and again on the first after it has been idle for a minute (11 to 16 s here), so
// the first assertion that waits on a request the page makes gets this budget and not the 10 s of the config.
const FIRST_VISIT_MS = 45_000;

const addForm = (page) => page.getByRole('form', { name: 'Add a cleaner' });
const cleanerRow = (page, name) => page.getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) });
const countShown = (page, count) => page.getByText(`${count} of ${CREW_MAX}`, { exact: true });
const crewListHeading = (page) => page.getByRole('heading', { name: 'Your cleaners', level: 2 });
const crewPanel = (page) => page.getByRole('region', { name: 'Crew on this job' });
const noticeSaying = (page, text) => page.getByRole('status').filter({ hasText: text });
const alertSaying = (page, text) => page.getByRole('alert').filter({ hasText: text });

async function openCrewPage(page) {
    await page.goto('/provider/crew', { timeout: FIRST_VISIT_MS });
    await expect(crewListHeading(page)).toBeVisible({ timeout: FIRST_VISIT_MS });
}

test.describe('Provider crew: the screens', () => {
    test.use({ storageState: { cookies: [], origins: [] } });
    sweepAround();

    // Mutant that turns this case red: the entry is missing from navItems in src/app/provider/layout.js or points elsewhere, the empty list does not say
    // so or shows a count that is not 0 of 30, or the page carries a sentence about texts or links (nobody is texted until ENG-015 ships).
    test('Screens: My Crew is in the provider menu and opens the crew page, which with nobody on it says so, counts 0 of 30 and says nothing about texts or links', async ({ page }) => {
        test.setTimeout(120_000);
        await signInAs(page, 'provider1');
        // An empty list whatever the dev database holds: the cases below read the real one.
        await page.route('**/api/provider/crew', (route) =>
            route.request().method() === 'GET' ? route.fulfill({ json: { success: true, data: { crew: [], limit: CREW_MAX } } }) : route.continue());
        await page.goto('/provider/dashboard', { timeout: FIRST_VISIT_MS });
        const entry = page.getByRole('link', { name: 'My Crew' });
        await expect(entry, 'the menu has My Crew').toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(entry).toHaveAttribute('href', '/provider/crew');
        await entry.click();
        await expect(page, 'the entry opens the crew page').toHaveURL(/\/provider\/crew$/, { timeout: FIRST_VISIT_MS });
        await expect(page.getByRole('heading', { name: 'My crew', level: 1 })).toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(page.getByText('No cleaners yet. Add the people you send to jobs.'), 'an empty crew says so').toBeVisible();
        await expect(countShown(page, 0), 'and counts 0 of 30').toBeVisible();
        await expect(addForm(page), 'and offers the Add form').toBeVisible();
        await expect(page.locator('main'), 'the page says nothing about texts or links').not.toContainText(/\b(?:texts?|texted|texting|sms|links?)\b/i);
    });

    // Mutant that turns this case red: the list or the notice shows the number as typed ('403.555.0123') and not as saved, the number is sent already
    // changed (so the table holds something else), the count does not move, the form keeps its values or loses the focus, or Enter does not add.
    test('Screens: a provider adds a cleaner with the number typed in any form, Enter in the number field adds it, the saved number is shown back as (403) 555-0123 and the table keeps +14035550123', async ({ page }) => {
        test.setTimeout(120_000);
        const others = await activeMembers(PROVIDER1.id);
        await signInAs(page, 'provider1');
        await openCrewPage(page);
        const form = addForm(page);
        const name = form.getByLabel('Name', { exact: true });
        const phone = form.getByLabel('Mobile number');
        await expect(phone, 'the hint asks for the country code').toHaveAccessibleDescription(/country code/i);

        await name.fill('Sam');
        await phone.fill('403.555.0123');
        await phone.press('Enter');
        await expect(cleanerRow(page, 'Sam'), 'Sam is listed').toContainText('(403) 555-0123');
        await expect(countShown(page, others + 1), 'the count moved').toBeVisible();
        await expect(noticeSaying(page, 'Added Sam, (403) 555-0123.'), 'the notice shows the saved number').toBeVisible();
        await expect(name, 'the form is cleared').toHaveValue('');
        await expect(phone, 'the form is cleared').toHaveValue('');
        await expect(name, 'and ready for the next cleaner').toBeFocused();
        const held = await rows('SELECT phone FROM provider_crew_members WHERE provider_id = ? AND name = ? AND removed_at IS NULL', [PROVIDER1.id, 'Sam']);
        expect(held.map((row) => row.phone), 'the table keeps the number as E.164').toEqual([stored('123')]);

        await page.reload();
        await expect(crewListHeading(page)).toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(cleanerRow(page, 'Sam'), 'a reload shows Sam from the table').toContainText('(403) 555-0123');
    });

    // Mutant that turns this case red: a refusal is not shown beside the field it is about (or not at all), the field is not marked invalid or does not
    // take the focus, a number that cannot be read or an empty name is sent to the route, or the list gains someone from a refused add.
    test('Screens: a number the crew already has is refused beside the number field, a number that cannot be read and an empty name are refused before any request, and nobody is added', async ({ page, request, baseURL }) => {
        test.setTimeout(120_000);
        const as = await credentials(baseURL);
        const others = await activeMembers(PROVIDER1.id);
        await addCrew(request, as.provider, 'Sam', typed('123'));
        await signInAs(page, 'provider1');
        let posts = 0;
        page.on('request', (sent) => {
            if (sent.method() === 'POST' && new URL(sent.url()).pathname === '/api/provider/crew') posts += 1;
        });
        await openCrewPage(page);
        const form = addForm(page);
        const name = form.getByLabel('Name', { exact: true });
        const phone = form.getByLabel('Mobile number');
        const add = form.getByRole('button', { name: 'Add cleaner' });

        // Only the route knows the number is held, so this one is sent and its refusal is shown beside the number.
        await name.fill('Dee');
        await phone.fill('1-403-555-0123');
        await add.click();
        await expect(phone, 'the route refuses a number the crew holds, beside the number').toHaveAccessibleDescription(/That number is already in your crew\./);
        await expect(phone).toHaveAttribute('aria-invalid', 'true');
        await expect(phone).toBeFocused();
        expect(posts, 'the held number was sent').toBe(1);

        await phone.fill('403-555-CALL');
        await add.click();
        await expect(phone, 'a number with letters is refused beside the number').toHaveAccessibleDescription(/cannot have letters/);
        expect(posts, 'a number that cannot be read is not sent').toBe(1);

        await name.fill('');
        await phone.fill('403-555-0124');
        await add.click();
        await expect(name, 'a missing name is refused beside the name').toHaveAccessibleDescription(/Enter the cleaner's name\./);
        await expect(name).toBeFocused();
        expect(posts, 'a missing name is not sent').toBe(1);

        await expect(cleanerRow(page, 'Dee'), 'nobody was added to the list').toHaveCount(0);
        expect(await activeMembers(PROVIDER1.id), 'nor to the table').toBe(others + 1);
    });

    // Mutant that turns this case red: Edit does not fill the fields with the name and the number as shown, Save is live with nothing changed, a saved
    // number is not shown back in display form or the row keeps the number it had, focus is lost after Save, or Cancel keeps what was typed.
    test('Screens: a provider corrects a name and a number on the row, the row shows the saved number back, Save waits for a change, and Cancel leaves the row as it was', async ({ page, request, baseURL }) => {
        test.setTimeout(120_000);
        const as = await credentials(baseURL);
        const sam = await addCrew(request, as.provider, 'Sam', typed('110'));
        await addCrew(request, as.provider, 'Kim', typed('112'));
        await signInAs(page, 'provider1');
        await openCrewPage(page);

        await page.getByRole('button', { name: 'Edit Sam' }).click();
        const edit = page.getByRole('form', { name: 'Edit Sam' });
        const name = edit.getByLabel('Name', { exact: true });
        const phone = edit.getByLabel('Mobile number');
        await expect(name, 'Edit fills in the name').toHaveValue('Sam');
        await expect(name, 'and starts in it').toBeFocused();
        await expect(phone, 'and the number as it is shown').toHaveValue('(403) 555-0110');
        await expect(edit.getByRole('button', { name: 'Save' }), 'Save waits for a change').toHaveAttribute('aria-disabled', 'true');

        await name.fill('Samuel');
        await phone.fill('403 555 0111');
        await edit.getByRole('button', { name: 'Save' }).click();
        await expect(cleanerRow(page, 'Samuel'), 'the row shows the corrected name and the saved number').toContainText('(403) 555-0111', { timeout: FIRST_VISIT_MS });
        await expect(noticeSaying(page, 'Saved Samuel, (403) 555-0111.')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Edit Samuel' }), 'focus returns to the row').toBeFocused();
        const held = await rows('SELECT name, phone FROM provider_crew_members WHERE id = ?', [sam.id]);
        expect(held, 'the table holds both corrections').toEqual([{ name: 'Samuel', phone: stored('111') }]);

        await page.getByRole('button', { name: 'Edit Kim' }).click();
        const kim = page.getByRole('form', { name: 'Edit Kim' });
        await kim.getByLabel('Name', { exact: true }).fill('Kimberly');
        await kim.getByRole('button', { name: 'Cancel' }).click();
        await expect(page.getByRole('form', { name: 'Edit Kim' }), 'Cancel closes the editor').toHaveCount(0);
        await expect(cleanerRow(page, 'Kim'), 'and leaves the row as it was').toContainText('(403) 555-0112');
        await expect(page.getByText('Kimberly')).toHaveCount(0);
    });

    // Mutant that turns this case red: Remove removes at once without asking, the question does not name the person or the consequence, Keep removes
    // anyway, Yes does not remove, the job keeps listing the cleaner, or the notice does not say how many jobs they were taken off.
    test('Screens: Remove asks first, Keep leaves the cleaner, and confirming removes them, takes them off the job that is not finished and says so', async ({ page, request, baseURL }) => {
        test.setTimeout(120_000);
        const as = await credentials(baseURL);
        const others = await activeMembers(PROVIDER1.id);
        const ann = await addCrew(request, as.provider, 'Ann', typed('150'));
        const bea = await addCrew(request, as.provider, 'Bea', typed('151'));
        await withBookings(request, as, 1, async (id) => {
            await give(request, as, id, PROVIDER1.id);
            await saveCrew(request, as.provider, id, [ann.id, bea.id], 'provider 1');
            await signInAs(page, 'provider1');
            await openCrewPage(page);

            await page.getByRole('button', { name: 'Remove Ann' }).click();
            const question = page.getByRole('group', { name: /Remove Ann from your crew\?/ });
            await expect(question, 'Remove asks first').toContainText('They are taken off any job that is not finished.');
            expect(await activeMembers(PROVIDER1.id), 'nothing is removed by asking').toBe(others + 2);
            await expect(question.getByRole('button', { name: 'Keep' }), 'the safe answer has the focus').toBeFocused();
            await question.getByRole('button', { name: 'Keep' }).click();
            await expect(question).toHaveCount(0);
            await expect(cleanerRow(page, 'Ann'), 'Keep leaves Ann').toBeVisible();
            expect(await activeMembers(PROVIDER1.id), 'Keep removes nobody').toBe(others + 2);

            await page.getByRole('button', { name: 'Remove Ann' }).click();
            await page.getByRole('button', { name: 'Yes, remove' }).click();
            await expect(cleanerRow(page, 'Ann'), 'Yes removes Ann from the list').toHaveCount(0, { timeout: FIRST_VISIT_MS });
            await expect(noticeSaying(page, 'Ann is no longer on your crew. Taken off 1 job.'), 'and says how many jobs she was taken off').toBeVisible();
            await expect(countShown(page, others + 1)).toBeVisible();
            expect(await activeMembers(PROVIDER1.id), 'the table has one fewer').toBe(others + 1);
            expect(await crewRowsOn(id), 'the job keeps Bea only').toEqual([bea.id]);
        });
    });

    // Mutant that turns this case red: the Add form stays live at the cap, the cap sentence is missing or says another number, the count is not 30 of 30,
    // or removing one leaves the form off.
    test('Screens: at 30 cleaners the Add form is off and says the crew is full, and removing one turns it back on', async ({ page }) => {
        test.setTimeout(120_000);
        const open = await db();
        // As the server case fills it: the active members provider 1 has, plus rows with the fictional numbers +14035550100 and up.
        const fill = CREW_MAX - (await activeMembers(PROVIDER1.id));
        expect(fill, 'provider 1 starts below the cap').toBeGreaterThan(0);
        const fillers = Array.from({ length: fill }, (_, index) => [PROVIDER1.id, `Filler ${index + 1}`, `${STORED_PREFIX}${100 + index}`]);
        await open.execute(`INSERT INTO provider_crew_members (provider_id, name, phone) VALUES ${fillers.map(() => '(?, ?, ?)').join(', ')}`, fillers.flat());
        await signInAs(page, 'provider1');
        await openCrewPage(page);

        const form = addForm(page);
        const full = page.getByText('Your crew is full (30). Remove someone to add another.');
        await expect(countShown(page, CREW_MAX)).toBeVisible();
        await expect(full, 'the cap sentence').toBeVisible();
        await expect(form.getByRole('button', { name: 'Add cleaner' }), 'Add is off').toBeDisabled();
        await expect(form.getByLabel('Name', { exact: true })).toBeDisabled();
        await expect(form.getByLabel('Mobile number')).toBeDisabled();

        await page.getByRole('button', { name: 'Remove Filler 1', exact: true }).click();
        await page.getByRole('button', { name: 'Yes, remove' }).click();
        await expect(countShown(page, CREW_MAX - 1), 'one removed').toBeVisible({ timeout: FIRST_VISIT_MS });
        await expect(form.getByRole('button', { name: 'Add cleaner' }), 'the room turns Add back on').toBeEnabled();
        await expect(full).toHaveCount(0);
    });

    // Mutant that turns this case red: the panel is missing from the job page of a job the provider holds, lists someone else's members, shows a box
    // checked that is not on the job, Save is live with no change, a save adds to the crew without replacing it, or the saved crew is not what a
    // reload shows.
    test('Screens: the job page has Crew on this job, Save crew waits for a change, a save replaces the crew as a set, and a reload shows what was saved', async ({ page, request, baseURL }) => {
        test.setTimeout(120_000);
        const as = await credentials(baseURL);
        const ann = await addCrew(request, as.provider, 'Ann', typed('153'));
        const ben = await addCrew(request, as.provider, 'Ben', typed('154'));
        const cy = await addCrew(request, as.provider, 'Cy', typed('155'));
        await withBookings(request, as, 1, async (id) => {
            await give(request, as, id, PROVIDER1.id);
            await connectStripe(PROVIDER1.id);
            await signInAs(page, 'provider1');
            await page.goto(`/provider/jobs/${id}`, { timeout: FIRST_VISIT_MS });
            const panel = crewPanel(page);
            await expect(panel, 'the job page has the crew panel').toBeVisible({ timeout: FIRST_VISIT_MS });
            const box = (member) => panel.getByRole('checkbox', { name: new RegExp(`^${member}\\b`) });
            const save = panel.getByRole('button', { name: 'Save crew' });
            await expect(box('Ann'), 'nobody is on the job yet').not.toBeChecked();
            await expect(save, 'Save crew waits for a change').toHaveAttribute('aria-disabled', 'true');

            await box('Ann').check();
            await box('Cy').check();
            await expect(save, 'a change turns Save crew on').not.toHaveAttribute('aria-disabled', 'true');
            await save.click();
            await expect(panel.getByText('Crew saved.')).toBeVisible({ timeout: FIRST_VISIT_MS });
            await expect(save, 'saved, there is nothing to save').toHaveAttribute('aria-disabled', 'true');
            expect(await crewRowsOn(id), 'the job has Ann and Cy').toEqual(idsOf([ann, cy]));

            await box('Ann').uncheck();
            await expect(panel.getByText('Crew saved.'), 'a changed selection does not read as saved').toHaveCount(0);
            await box('Ben').check();
            await save.click();
            await expect(panel.getByText('Crew saved.')).toBeVisible();
            expect(await crewRowsOn(id), 'a save replaces the set: Ben and Cy, not Ann').toEqual(idsOf([ben, cy]));

            await page.reload();
            await expect(panel).toBeVisible({ timeout: FIRST_VISIT_MS });
            await expect(box('Ben'), 'a reload shows Ben on the job').toBeChecked();
            await expect(box('Cy'), 'and Cy').toBeChecked();
            await expect(box('Ann'), 'and not Ann').not.toBeChecked();
        });
    });

    // Mutant that turns this case red: a finished job keeps live checkboxes or a Save button, a removed cleaner is shown without the mark or dropped, or the
    // job page of a job in the open pool (no provider holds it) shows the crew panel.
    test('Screens: a finished job shows its crew read-only with a removed cleaner marked, and a job in the open pool has no crew panel', async ({ page, request, baseURL }) => {
        test.setTimeout(150_000);
        const as = await credentials(baseURL);
        const ann = await addCrew(request, as.provider, 'Ann', typed('184'));
        const bea = await addCrew(request, as.provider, 'Bea', typed('185'));
        await withBookings(request, as, 2, async (finished, pooled) => {
            await give(request, as, finished, PROVIDER1.id);
            await saveCrew(request, as.provider, finished, [ann.id, bea.id], 'provider 1');
            await setStatus(finished, 'completed');
            await removeCrew(request, as.provider, ann.id, 'provider 1');
            await push(request, as, pooled);

            await connectStripe(PROVIDER1.id);
            await signInAs(page, 'provider1');
            await page.goto(`/provider/jobs/${finished}`, { timeout: FIRST_VISIT_MS });
            const panel = crewPanel(page);
            await expect(panel, 'a finished job shows its crew').toBeVisible({ timeout: FIRST_VISIT_MS });
            await expect(panel).toContainText('This job is finished, so its crew can no longer change.');
            await expect(panel.getByRole('listitem').filter({ hasText: 'Ann' }), 'Ann is shown, marked').toContainText('(no longer on your crew)');
            await expect(panel.getByRole('listitem').filter({ hasText: 'Bea' }), 'Bea is shown, unmarked').not.toContainText('(no longer on your crew)');
            await expect(panel.getByRole('checkbox'), 'nothing can be ticked').toHaveCount(0);
            await expect(panel.getByRole('button'), 'and there is nothing to save').toHaveCount(0);

            await page.goto(`/provider/jobs/${pooled}`, { timeout: FIRST_VISIT_MS });
            await expect(page.getByRole('heading', { name: 'Fixture Standard Clean', level: 1 }), 'the open-pool job page loads').toBeVisible({ timeout: FIRST_VISIT_MS });
            await expect(page.getByText('Crew on this job'), 'and has no crew panel').toHaveCount(0);
        });
    });

    // Mutant that turns this case red: a failed load shows nothing or a blank page, says the wrong thing for a connection that is down, has no Retry, or
    // Retry does not read the list again.
    test('Screens: when the crew cannot be loaded the page says so with a Retry that reads it again, and with the connection down it says that instead', async ({ page }) => {
        test.setTimeout(120_000);
        await signInAs(page, 'provider1');
        // What the list read gets is set by the case and not counted: `next dev` runs the page's load effect twice, so the number of reads is not fixed.
        let answer = 'fault';
        await page.route('**/api/provider/crew', (route) => {
            if (route.request().method() !== 'GET') return route.continue();
            if (answer === 'fault') return route.fulfill({ status: 500, json: { success: false, message: 'Failed to load the crew' } });
            if (answer === 'offline') return route.abort('internetdisconnected');
            return route.continue();
        });
        await page.goto('/provider/crew', { timeout: FIRST_VISIT_MS });
        const failed = alertSaying(page, "Couldn't load your crew. Try again.");
        await expect(failed, 'a server fault is said in words').toBeVisible({ timeout: FIRST_VISIT_MS });
        answer = 'offline';
        await failed.getByRole('button', { name: 'Retry' }).click();
        const offline = alertSaying(page, "Couldn't reach the server. Check your connection and try again.");
        await expect(offline, 'a connection that is down is said as that').toBeVisible();
        answer = 'live';
        await offline.getByRole('button', { name: 'Retry' }).click();
        await expect(crewListHeading(page), 'Retry reads the list again').toBeVisible({ timeout: FIRST_VISIT_MS });
    });

    // Mutant that turns this case red: a Remove the server refuses drops the cleaner from the list anyway or says nothing, or an Add the server refuses
    // clears the typed name and number, says nothing, or shows a row that is not stored.
    test('Screens: a Remove the server refuses keeps the cleaner on the list and says so, and an Add it refuses keeps what was typed and says so', async ({ page, request, baseURL }) => {
        test.setTimeout(120_000);
        const as = await credentials(baseURL);
        const others = await activeMembers(PROVIDER1.id);
        await addCrew(request, as.provider, 'Sam', typed('160'));
        await signInAs(page, 'provider1');
        await openCrewPage(page);
        await page.route('**/api/provider/crew/*', (route) => (route.request().method() === 'DELETE'
            ? route.fulfill({ status: 500, json: { success: false, message: 'Failed to remove the crew member' } })
            : route.continue()));
        await page.route('**/api/provider/crew', (route) => (route.request().method() === 'POST'
            ? route.fulfill({ status: 500, json: { success: false, message: 'Failed to add the crew member' } })
            : route.continue()));

        await page.getByRole('button', { name: 'Remove Sam' }).click();
        await page.getByRole('button', { name: 'Yes, remove' }).click();
        await expect(alertSaying(page, "Couldn't save that. Try again."), 'a refused Remove is said in words').toBeVisible();
        await expect(cleanerRow(page, 'Sam'), 'and Sam stays on the list').toBeVisible();
        await expect(page.getByRole('group', { name: /Remove Sam from your crew\?/ }), 'with the question open to answer').toBeVisible();
        expect(await activeMembers(PROVIDER1.id), 'and in the table').toBe(others + 1);
        await page.getByRole('button', { name: 'Keep' }).click();

        const add = addForm(page);
        await add.getByLabel('Name', { exact: true }).fill('Dee');
        await add.getByLabel('Mobile number').fill('403 555 0161');
        await add.getByRole('button', { name: 'Add cleaner' }).click();
        await expect(add.getByRole('alert'), 'a refused Add is said in the form').toContainText("Couldn't save that. Try again.");
        await expect(add.getByLabel('Name', { exact: true }), 'the name stays').toHaveValue('Dee');
        await expect(add.getByLabel('Mobile number'), 'and the number').toHaveValue('403 555 0161');
        await expect(cleanerRow(page, 'Dee'), 'no row appears for it').toHaveCount(0);
        expect(await activeMembers(PROVIDER1.id), 'and nothing is stored').toBe(others + 1);
    });
});
