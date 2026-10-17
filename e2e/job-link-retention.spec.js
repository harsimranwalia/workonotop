// @ts-check
// ENG-015, the retention half of the server cases: the first and the sixth of the security conditions carried from ENG-014, and the source pins of the
// design's "Pins" row (agents/architect/designs/ENG-015-secure-job-link-and-crew-check-in.md, "Cases and baseline"). Each title starts with the
// design's id for the row it settles, and the file's name, the describe and the title together are its baseline key:
//   Condition 1  src/lib/crew-retention.js against the dev database, on rows this file plants and only those: a member removed 400 days ago is
//        anonymised (Former cleaner, x{id}) with their number checks and sign-in codes gone and their old events keeping no member; a removal of 364 or
//        30 days and a current member are untouched; a second run erases nobody; a run that stops half way is finished by the next; a member put back
//        on a crew mid-run stays one; a deleted provider's crew is anonymised when information_schema shows the status and the column, and the answer
//        is provider_deletion 'not_in_schema' when it does not (the library is also run against a database that lacks each); a check-in and an
//        event older than a year lose their position and keep the distance and the flag; expired codes, sessions and unused number-check codes go a
//        week after they expire, a proof of the member's own number stays; old budget counters go; every statement is prepared; a failing statement
//        reaches the caller. GET /api/cron/crew-retention is 401 on the running app for no secret, a wrong one, Bearer undefined and an empty
//        ?secret= (the dev app has no CRON_SECRET, so it can only ever answer 401), and the handler itself is run in plain Node with a secret
//        set: 401 until the secret is given as a Bearer or as ?secret=, then it runs the retention and answers the summary.
//   Condition 6  a spy on console.log / info / warn / error is installed before the first case and restored after the last, so it sees the whole
//        file: the retention runs log nothing; sendSMS logs fixed lines only, the Twilio failure line carries the status and the Twilio code and
//        never the body (the stubbed fetch answers 400 with a body that holds a fixture number); a code asked, texted through sendSMS and entered
//        logs the one fixed line; the cron route logs the error code and nothing the driver said; every console call in the new files is of a fixed
//        shape; and the last case looks for every fixture number, name, token, code and cookie value in everything the file logged.
//   Pins  source checks: booking_crew is named only in src/lib/booking-crew.js; the five new tables are named only in their own library and
//        crew-retention.js; no new file contains query(; job-link.js has no customer, price or payment word in a SELECT; link-token.js imports only
//        node:crypto.
// The database is the dev database the way e2e/provider-crew.spec.js reaches it (mysql2/promise, assertDevTarget before it connects, assertNoRealPeople
// once connected). Retention deletes by age across the whole table, so these cases never count what it did anywhere but in their own rows: every
// member they plant belongs to a provider of their own (service_providers e-mail starting e2e-je-), every booking to the e-mail prefix e2e-je-, and every
// number is in +1 403 555 0180 to 0199. The sweep (before the first case of a describe, after every case, after the last) deletes only those, and,
// because an erased member's number is x{id} and so leaves the block, it finds members through their provider. No case asserts a count that other
// specs' rows could move: a count of the first run is only ever "at least" the rows the case planted, and "a second run erases nobody" is asserted by
// watching the second run (watching() reads each UPDATE back as the ids its WHERE matches) and looking for the case's own ids in what it matched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { format } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { RESET_RETRIES } from './support/auth.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';
import { runCrewRetention, REMOVED_MEMBER_DAYS, LOCATION_DAYS, DELETION_GRACE_HOURS, EXPIRED_KEEP_DAYS } from '../src/lib/crew-retention.js';
import { ERASED_NAME } from '../src/lib/job-link-base.js';
import { requestCode, verifyCode } from '../src/lib/job-link-code.js';
import { newLinkToken, sha256Hex } from '../src/lib/link-token.js';
import { budgetScope } from '../src/lib/sms-budget.js';
import { sendSMS } from '../src/lib/sms.js';

// A trace records request headers and the cases here send none that matter, but the convention of the crew specs is kept: tracing is off.
// Cases run in the order of the file, one worker; they are independent (each plants its own rows), so one failure does not hide the next.
test.use({ trace: 'off' });

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EMAIL_PREFIX = 'e2e-je-';
const BLOCK_LOW = '+14035550180';
const BLOCK_HIGH = '+14035550199';
const RUN = Date.now().toString(36);
const CRON_PATH = '/api/cron/crew-retention';

// ---- the console spy: installed before the first case of the file, restored after the last, so it sees every case ------------------------

/** @type {{ method: string, text: string }[]} */
const captured = [];
/** @type {Record<string, any>} */
const realConsole = {};
const SPIED = ['log', 'info', 'warn', 'error', 'debug'];
let spying = false;

test.beforeAll(() => {
    if (spying) return;
    spying = true;
    for (const method of SPIED) {
        realConsole[method] = /** @type {any} */ (console)[method];
        /** @type {any} */ (console)[method] = (/** @type {any[]} */ ...args) => {
            captured.push({ method, text: format(...args) });
        };
    }
});

test.afterAll(() => {
    if (!spying) return;
    spying = false;
    for (const method of SPIED) /** @type {any} */ (console)[method] = realConsole[method];
});

/** Runs `work` and returns what it logged, as [method, text] pairs. */
async function logsOf(work) {
    const before = captured.length;
    const result = await work();
    return { result, lines: captured.slice(before).map((entry) => [entry.method, entry.text]) };
}

// ---- what a log line must never hold: every fixture value this file makes, by kind ------------------------------------------------------

const secrets = { numbers: new Set(), names: new Set(), emails: new Set(), tokens: new Set(), codes: new Set(), cookies: new Set(), credentials: new Set() };
for (let last = 180; last <= 199; last += 1) {
    const four = String(last).padStart(4, '0');
    for (const form of [`+1403555${four}`, `403555${four}`, `(403) 555-${four}`, `403-555-${four}`, `403 555 ${four}`]) secrets.numbers.add(form);
}

// ---- the database ------------------------------------------------------------------------------------------------------------------

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

// The libraries take `execute` in the shape of src/lib/db.js: the rows for a SELECT, the result header for a write.
async function execute(sql, params = []) {
    const [result] = await (await db()).execute(sql, params);
    return /** @type {any} */ (result);
}
const rows = (sql, params = []) => /** @type {Promise<any[]>} */ (execute(sql, params));
const countOf = async (sql, params = []) => Number((await rows(sql, params))[0].n);

const budgetScopes = new Set();
const trackScope = (...parts) => {
    budgetScopes.add(/** @type {any} */ (budgetScope)(...parts));
};

// Deletes what this file made: the bookings of the e-mail prefix (their links, codes, check-ins, events and crew rows follow by the foreign keys),
// then the members of this file's providers and those with a number of its block, then its providers, then its budget counters.
async function clearRows() {
    const open = await db();
    await open.execute('DELETE FROM bookings WHERE customer_email LIKE ?', [`${EMAIL_PREFIX}%`]);
    await open.execute('DELETE FROM provider_crew_members WHERE provider_id IN (SELECT id FROM service_providers WHERE email LIKE ?) OR phone BETWEEN ? AND ?', [`${EMAIL_PREFIX}%`, BLOCK_LOW, BLOCK_HIGH]);
    await open.execute('DELETE FROM service_providers WHERE email LIKE ?', [`${EMAIL_PREFIX}%`]);
    for (let last = 180; last <= 199; last += 1) budgetScopes.add(budgetScope('number', `+1403555${String(last).padStart(4, '0')}`));
    for (const scope of budgetScopes) await open.execute('DELETE FROM sms_budget WHERE scope = ?', [scope]);
    budgetScopes.clear();
}

let numberSeq = 0;
let providerSeq = 0;
let bookingSeq = 0;
const nextNumber = () => {
    const last = 180 + numberSeq;
    numberSeq += 1;
    if (last > 198) throw new Error('the case needs more numbers than the block has');
    return `+1403555${String(last).padStart(4, '0')}`;
};

function sweepAround() {
    test.beforeAll(clearRows);
    test.beforeEach(() => {
        numberSeq = 0;
    });
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

// ---- rows the cases plant (SQL only; no route and no other spec's rows) -----------------------------------------------------------------

async function mkProvider(status = 'active') {
    const email = `${EMAIL_PREFIX}prov-${RUN}-${providerSeq++}@workontap.test`;
    secrets.emails.add(email);
    const made = await execute("INSERT INTO service_providers (name, email, password, status) VALUES (?, ?, 'x', ?)", [`Probe ${status} ${RUN}`, email, status]);
    return /** @type {number} */ (made.insertId);
}

// A provider whose deletion was asked `hoursAgo` hours ago. Only for a database whose status column lists pending_deletion and has the column.
async function mkPendingProvider(hoursAgo) {
    const email = `${EMAIL_PREFIX}prov-${RUN}-${providerSeq++}@workontap.test`;
    secrets.emails.add(email);
    const made = await execute("INSERT INTO service_providers (name, email, password, status, deletion_requested_at) VALUES (?, ?, 'x', 'pending_deletion', NOW() - INTERVAL ? HOUR)", [`Probe pending ${RUN}`, email, hoursAgo]);
    return /** @type {number} */ (made.insertId);
}

async function mkBooking(providerId) {
    secrets.numbers.add(BLOCK_HIGH);
    // The customer of a probe job is a person too: their name, street and e-mail are among the values no log line may carry.
    for (const value of ['Rhea', 'Rowe', '1 Probe Street']) secrets.names.add(value);
    const bookingEmail = `${EMAIL_PREFIX}${RUN}-${bookingSeq++}@workontap.test`;
    secrets.emails.add(bookingEmail);
    const made = await execute(
        `INSERT INTO bookings (booking_number, service_id, service_name, service_price, customer_first_name, customer_last_name, customer_email, customer_phone,
           job_date, job_time_slot, job_description, address_line1, city, postal_code, worker_count, status, payment_status, provider_id, latitude, longitude)
         VALUES (?, 1, 'Probe service', 10, 'Rhea', 'Rowe', ?, ?, DATE_FORMAT(CURDATE(), '%Y-%m-%d'), 'Oct 17: Morning', 'x', '1 Probe Street', 'Calgary', 'T2P 0A1', 3,
           'confirmed', 'pending', ?, 51.04473, -114.07192)`,
        [`EJR${RUN}${bookingSeq}`, bookingEmail, BLOCK_HIGH, providerId]
    );
    return /** @type {number} */ (made.insertId);
}

async function mkLink(bookingId) {
    const token = newLinkToken();
    secrets.tokens.add(token);
    const made = await execute('INSERT INTO job_links (booking_id, token) VALUES (?, ?)', [bookingId, token]);
    return { id: /** @type {number} */ (made.insertId), token };
}

// removedDaysAgo null = a current member.
async function mkMember(label, { provider, removedDaysAgo = null }) {
    const phone = nextNumber();
    const name = `${label} ${RUN}`;
    secrets.names.add(name);
    const made = await execute(
        `INSERT INTO provider_crew_members (provider_id, name, phone, removed_at) VALUES (?, ?, ?, ${removedDaysAgo === null ? 'NULL' : 'NOW() - INTERVAL ? DAY'})`,
        removedDaysAgo === null ? [provider, name, phone] : [provider, name, phone, removedDaysAgo]
    );
    return { id: /** @type {number} */ (made.insertId), phone, name, provider };
}

const putOnJob = (bookingId, memberId) => execute('INSERT INTO booking_crew (booking_id, crew_member_id) VALUES (?, ?)', [bookingId, memberId]);

// expiredDays: how long ago the code expired (negative = still to run); sessionExpiredDays: null = the code was never used.
const addCode = (linkId, memberId, phone, { expiredDays, sessionExpiredDays = null, unique }) =>
    execute(
        `INSERT INTO job_link_codes (link_id, generation, crew_member_id, assignment_epoch, phone, code_hash, expires_at, session_hash, session_expires_at)
         VALUES (?, 1, ?, 1, ?, ?, NOW() - INTERVAL ? DAY, ?, ${sessionExpiredDays === null ? 'NULL' : 'NOW() - INTERVAL ? DAY'})`,
        sessionExpiredDays === null
            ? [linkId, memberId, phone, sha256Hex(`c${unique}${RUN}`), expiredDays, null]
            : [linkId, memberId, phone, sha256Hex(`c${unique}${RUN}`), expiredDays, sha256Hex(`s${unique}${RUN}`), sessionExpiredDays]
    );

const addCheck = (memberId, phone, { used = false, expiredDays = 0, createdDaysAgo = 0, unique }) =>
    execute(
        `INSERT INTO crew_number_checks (crew_member_id, phone, code_hash, expires_at, used_at, created_at)
         VALUES (?, ?, ?, NOW() - INTERVAL ? DAY, ${used ? 'NOW()' : 'NULL'}, NOW() - INTERVAL ? DAY)`,
        [memberId, phone, sha256Hex(`n${unique}${RUN}`), expiredDays, createdDaysAgo]
    );

const addEvent = (linkId, bookingId, kind, memberId) =>
    execute("INSERT INTO job_link_events (link_id, booking_id, kind, actor_kind, actor_ref, crew_member_id) VALUES (?, ?, ?, 'cleaner', ?, ?)", [linkId, bookingId, kind, memberId, memberId]);

const memberRow = async (id) => (await rows('SELECT id, provider_id, name, phone, removed_at IS NOT NULL AS removed FROM provider_crew_members WHERE id = ?', [id]))[0];
const isErased = (member) => member.name === ERASED_NAME && member.phone === `x${member.id}` && Number(member.removed) === 1;
const isIntact = (member, original) => member.name === original.name && member.phone === original.phone;

// What the writes of one retention run match, by id, found without reading any global count: every UPDATE the library sends is first read back as a
// SELECT of the ids its WHERE matches (the statement's first WHERE, with the parameters left after those its SET takes), then sent on unchanged. A case
// looks for ITS OWN ids in what a run matched and says nothing about anybody else's rows, which other specs may be planting at the same moment.
function watching() {
    /** @type {{ table: string, ids: number[] }[]} */
    const matched = [];
    const run = async (sql, params = []) => {
        if (/^\s*UPDATE\s/i.test(sql)) {
            const at = sql.indexOf(' WHERE ');
            const head = at < 0 ? sql : sql.slice(0, at);
            const target = /^\s*UPDATE\s+(\w+)(?:\s+(\w+))?\s+SET\s/i.exec(head);
            if (at < 0 || !target) throw new Error(`this spec cannot read the UPDATE the retention sent: ${head.replace(/\s+/g, ' ').slice(0, 90)}`);
            const [, table, alias] = target;
            const taken = (head.match(/\?/g) ?? []).length;
            const found = await rows(`SELECT ${alias ?? table}.id AS id FROM ${table}${alias ? ` ${alias}` : ''} WHERE ${sql.slice(at + 7)}`, params.slice(taken));
            matched.push({ table, ids: found.map((row) => Number(row.id)) });
        }
        return execute(sql, params);
    };
    // The ids of `mine` that some UPDATE of `table` matched, once each, in order.
    const idsIn = (table, mine) => [...new Set(matched.filter((entry) => entry.table === table).flatMap((entry) => entry.ids).filter((id) => mine.includes(id)))].sort((a, b) => a - b);
    return { run, idsIn };
}
const ascending = (ids) => [...ids].sort((a, b) => a - b);

const SUMMARY_KEYS = ['removed_members', 'provider_deletion', 'check_in_positions', 'event_positions', 'codes', 'number_check_codes', 'stale_number_checks', 'budget_rows', 'notice_rows'];

// What the database can do about a provider's deletion, read plainly from information_schema (the library reads the same two facts).
async function schemaSupport() {
    const columns = await rows("SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_providers' AND COLUMN_NAME IN ('status', 'deletion_requested_at')");
    const status = columns.find((column) => column.name === 'status');
    const lists = (value) => typeof status?.type === 'string' && status.type.toLowerCase().startsWith('enum(') && status.type.includes(`'${value}'`);
    return { deleted: lists('deleted'), pending: lists('pending_deletion') && columns.some((column) => column.name === 'deletion_requested_at') };
}

// ---- source reading (as e2e/cron-secret.spec.js and e2e/provider-crew.spec.js do it) --------------------------------------------------

// One pass over the characters of a source file: its text with the comments taken out (line breaks kept) and the string / template literals in it.
// A comment marker inside a string is text. Regex literals and `${ }` are not tracked; none of the files read here needs it, and each case
// that depends on the reading checks that what it looked for is really there.
function scanSource(text) {
    let code = '';
    const literals = [];
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (text.startsWith('//', i)) {
            while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
        } else if (text.startsWith('/*', i)) {
            const close = text.indexOf('*/', i + 2);
            const end = close === -1 ? text.length : close + 2;
            code += ' ' + text.slice(i, end).replace(/[^\n]/g, '');
            i = end;
        } else if (ch === "'" || ch === '"' || ch === '`') {
            let j = i + 1;
            while (j < text.length && text[j] !== ch) j += text[j] === '\\' ? 2 : 1;
            literals.push(text.slice(i, j + 1));
            code += text.slice(i, j + 1);
            i = j + 1;
        } else {
            code += ch;
            i++;
        }
    }
    return { code, literals };
}

function filesUnder(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const found = path.join(directory, entry.name);
        if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : filesUnder(found);
        return [path.relative(ROOT, found).split(path.sep).join('/')];
    });
}

const textOf = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const codeOf = (file) => scanSource(textOf(file)).code;

// The arguments of every call of `name(` in `code`, as text, found by matching the parentheses (strings are skipped over).
function callsOf(code, name) {
    const found = [];
    const pattern = new RegExp(`\\b${name.replace(/\./g, '\\.')}\\s*\\(`, 'g');
    for (let match = pattern.exec(code); match; match = pattern.exec(code)) {
        let depth = 1;
        let i = match.index + match[0].length;
        const start = i;
        while (i < code.length && depth > 0) {
            const ch = code[i];
            if (ch === "'" || ch === '"' || ch === '`') {
                i += 1;
                while (i < code.length && code[i] !== ch) i += code[i] === '\\' ? 2 : 1;
            } else if (ch === '(') depth += 1;
            else if (ch === ')') depth -= 1;
            i += 1;
        }
        found.push(code.slice(start, i - 1).replace(/\s+/g, ' ').trim());
    }
    return found;
}

// The files ENG-015 added under src/ (git diff --name-status 85c255e..HEAD -- src, the "A" lines) as of the commit that added the routes. The list is
// written out because the cases run in a container whose checkout points at a git directory outside the mount, where git cannot answer; where git
// can answer (a host run), the files it adds to the list (a file a later commit of the ticket adds, an untracked one) are checked as well.
const ENG015_NEW_FILES = [
    'src/app/api/admin/bookings/[id]/job-link/route.js',
    'src/app/api/cron/crew-retention/route.js',
    'src/app/api/job/[token]/check-in/route.js',
    'src/app/api/job/[token]/code/route.js',
    'src/app/api/job/[token]/route.js',
    'src/app/api/job/[token]/verify/route.js',
    'src/app/api/provider/crew/[id]/number-check/route.js',
    'src/app/api/provider/crew/numbers/route.js',
    'src/app/api/provider/jobs/[id]/job-link/route.js',
    'src/lib/crew-number-check.js',
    'src/lib/crew-retention.js',
    'src/lib/job-checkin.js',
    'src/lib/job-link-base.js',
    'src/lib/job-link-code.js',
    'src/lib/job-link.js',
    'src/lib/job-window.js',
    'src/lib/link-token.js',
    'src/lib/sms-budget.js',
];

function eng015NewFiles() {
    const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 });
    let fromGit = null;
    try {
        const added = git(['diff', '--name-status', '85c255e..HEAD', '--', 'src']).split('\n').filter((line) => line.startsWith('A\t')).map((line) => line.slice(2));
        const untracked = git(['ls-files', '--others', '--exclude-standard', '--', 'src']).split('\n').filter(Boolean);
        fromGit = [...added, ...untracked];
    } catch {
        fromGit = null;
    }
    return { files: [...new Set([...ENG015_NEW_FILES, ...(fromGit ?? [])])].sort(), fromGit };
}

// ================================================================================================================================
// Pins: source checks, no app and no database
// ================================================================================================================================

test.describe('Job link retention: pins', () => {
    // Mutant that turns this case red: a route or another lib reads or writes booking_crew itself, so a job's crew is read without the join on the
    // booking's current provider and an old provider's picks come back as assigned.
    test('Pins: booking_crew is named in no code under src/ except src/lib/booking-crew.js (comments are not code)', () => {
        const LIB = 'src/lib/booking-crew.js';
        const files = filesUnder(path.join(ROOT, 'src'));
        const naming = files.filter((file) => codeOf(file).includes('booking_crew')).sort();
        const mentioning = files.filter((file) => textOf(file).includes('booking_crew')).sort();
        expect(naming.includes(LIB), `the walk reaches the lib among ${files.length} files under src/`).toBe(true);
        expect(naming.filter((file) => file !== LIB), 'files other than the lib that name booking_crew in code').toEqual([]);
        // Honest about the rest: a file that only mentions the table in a comment (crew-retention.js says "booking_crew is left alone") is not a use of it.
        const commentOnly = mentioning.filter((file) => !naming.includes(file));
        if (commentOnly.length > 0) test.info().annotations.push({ type: 'note', description: `booking_crew is named only in a comment in: ${commentOnly.join(', ')}` });
    });

    // Mutant that turns this case red: a route or another lib reads or writes one of the new tables itself, around the library that knows its rules
    // (the cap, the generation, the window), so a burst or a stale session gets past the one place that holds them.
    test('Pins: job_link_codes, job_checkins, job_link_events, crew_number_checks and sms_budget are named only in their own library and crew-retention.js', () => {
        const RETENTION = 'src/lib/crew-retention.js';
        const OWNER = {
            job_link_codes: 'src/lib/job-link-code.js',
            job_checkins: 'src/lib/job-checkin.js',
            job_link_events: 'src/lib/job-link-base.js',
            crew_number_checks: 'src/lib/crew-number-check.js',
            sms_budget: 'src/lib/sms-budget.js',
        };
        const files = filesUnder(path.join(ROOT, 'src'));
        for (const [table, owner] of Object.entries(OWNER)) {
            const naming = files.filter((file) => codeOf(file).includes(table)).sort();
            expect(naming.includes(owner), `${table}: the walk reaches its own library ${owner}`).toBe(true);
            expect(naming.filter((file) => file !== owner && file !== RETENTION), `${table}: files other than ${owner} and ${RETENTION} that name it in code`).toEqual([]);
            // Honest about the rest: a comment that only says the name is not a use of the table, but it is reported.
            const commentOnly = files.filter((file) => textOf(file).includes(table) && !naming.includes(file) && file !== owner && file !== RETENTION);
            if (commentOnly.length > 0) test.info().annotations.push({ type: 'note', description: `${table} is named only in a comment in: ${commentOnly.join(', ')}` });
        }
    });

    // Mutant that turns this case red: a new file sends a statement as text (query) and not prepared (execute), which is how an injection reaches the
    // personal data of people who are not users. ENG-014's pin does the same for its three routes and its lib.
    test('Pins: no new file of ENG-015 contains a query( call, only prepared execute', () => {
        const { files, fromGit } = eng015NewFiles();
        expect(files.length, 'the list of the ticket\'s new files is not empty').toBeGreaterThanOrEqual(ENG015_NEW_FILES.length);
        const calling = [];
        for (const file of files) {
            expect(fs.existsSync(path.join(ROOT, file)), `${file} exists`).toBe(true);
            if (!/\.(js|jsx|mjs)$/.test(file)) continue;
            const lines = codeOf(file).split('\n');
            for (const [index, line] of lines.entries()) if (/\bquery\s*\(/.test(line)) calling.push(`${file}:${index + 1}`);
        }
        expect(calling, `the lines that call query( (a bare call or connection.query) in ${files.length} new files`).toEqual([]);
        test.info().annotations.push({ type: 'note', description: `${files.length} files checked; git ${fromGit === null ? 'could not list the ticket\'s files here (list written out in the spec)' : 'listed them too'}` });
    });

    // Mutant that turns this case red: a SELECT in job-link.js reads a customer's contact, a price or a payment, so the job page can put it on a
    // crew's phone. The page is built from named columns; this reads every SELECT in the file for the words that would break that.
    test('Pins: src/lib/job-link.js has no customer_, user_id, price, amount, commission, payment, stripe or booking_number inside a SELECT', () => {
        const { literals } = scanSource(textOf('src/lib/job-link.js'));
        const selects = literals.filter((literal) => /\bselect\b/i.test(literal));
        expect(selects.length, 'the reading finds the SELECT statements of job-link.js (findJobLink, jobPage, linkRow, managedView, lockJob)').toBeGreaterThanOrEqual(5);
        expect(selects.some((select) => /FROM\s+bookings/i.test(select)), 'among them the statements on bookings').toBe(true);
        const FORBIDDEN = ['customer_', 'user_id', 'price', 'amount', 'commission', 'payment', 'stripe', 'booking_number'];
        for (const word of FORBIDDEN) {
            const holding = selects.filter((select) => select.toLowerCase().includes(word));
            expect(holding.length, `${word} inside a SELECT of job-link.js`).toBe(0);
        }
    });

    // Mutant that turns this case red: link-token.js imports something, so the card link, a spec and any library can no longer load the one place a token
    // is made and a hash taken in plain Node, and a dependency gets between a token and the code that makes it.
    test('Pins: src/lib/link-token.js imports only node:crypto', () => {
        const code = codeOf('src/lib/link-token.js');
        expect(code.includes('export function newLinkToken'), 'the file is the token maker').toBe(true);
        const specifiers = [...code.matchAll(/\bimport\s*(?:[\w$*{}\s,]*?\bfrom\s*)?(['"])([^'"]+)\1/g)].map((match) => match[2]);
        expect(specifiers, 'every module the file imports').toEqual(['node:crypto']);
        expect(/\bimport\s*\(/.test(code), 'a dynamic import').toBe(false);
        expect(/\brequire\s*\(/.test(code), 'a require call').toBe(false);
        expect(/\bexport\s+(?:\*|\{[^}]*\})\s*from\b/.test(code), 'a re-export from another file').toBe(false);
    });

    // Mutant that turns this case red: the route does work before the guard, or the schedule is dropped, so retention runs for anyone or never.
    test('Condition 1: the cron route calls requireCronSecret first and runs the retention with the pool\'s execute, and vercel.json schedules it daily', () => {
        const code = codeOf('src/app/api/cron/crew-retention/route.js');
        expect(code, 'the guard is imported from the shared module').toMatch(/import\s*\{\s*requireCronSecret\s*\}\s*from\s*['"]@\/lib\/api-auth['"]/);
        expect(code, 'the first statements of GET are the guard call and its refusal').toMatch(
            /export\s+async\s+function\s+GET\s*\(\s*request\s*\)\s*\{\s*const\s+secret\s*=\s*requireCronSecret\(\s*request\s*\)\s*;?\s*if\s*\(\s*!secret\.ok\s*\)\s*return\s+secret\.response\s*;?/
        );
        expect(code, 'the old checks are not back (development skip, the secret read by hand)').not.toMatch(/NODE_ENV|process\.env\.CRON_SECRET|searchParams\.get\(\s*['"]secret['"]\s*\)/);
        expect(callsOf(code, 'runCrewRetention'), 'the retention runs with the pool\'s execute').toEqual(['execute']);
        const vercel = JSON.parse(textOf('vercel.json'));
        const entry = (vercel.crons ?? []).find((cron) => cron.path === CRON_PATH);
        expect(entry, 'vercel.json has a cron entry for the route').toBeTruthy();
        expect(/^\d{1,2} \d{1,2} \* \* \*$/.test(entry?.schedule ?? ''), 'it runs once a day (a minute, an hour, then three stars)').toBe(true);
    });

    // Mutant that turns this case red: a new line logs a value (a number, a name, a body) or a whole error object. This is the static half of the
    // sixth condition; the runtime half is the spy at the end of the file.
    test('Condition 6: every console call in the new files and in sms.js is a fixed line, with at most an error code, a Twilio status or a Twilio code in it', () => {
        const { files } = eng015NewFiles();
        const FIXED = /^(['"])[^'"`$\\]*\1$/;
        const WITH_ERROR_CODE = /^(['"])[^'"`$\\]*\1, error\?\.code \|\| error\?\.name$/;
        const TEMPLATE = /^`[^`$\\]*(?:\$\{(?:response\.status|twilioCode|e\?\.code \|\| e\?\.name \|\| 'unknown')\}[^`$\\]*)*`$/;
        let seen = 0;
        const bad = [];
        for (const file of [...files, 'src/lib/sms.js']) {
            if (!/\.(js|jsx|mjs)$/.test(file)) continue;
            const code = codeOf(file);
            for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
                for (const args of callsOf(code, `console.${method}`)) {
                    seen += 1;
                    if (!(FIXED.test(args) || WITH_ERROR_CODE.test(args) || TEMPLATE.test(args))) bad.push(`${file}: console.${method}(${args})`);
                }
            }
            expect(/\bconsole\s*(?:\[|\.\s*(?!log\b|info\b|warn\b|error\b|debug\b|trace\b))/.test(code), `${file}: console is used only through its named methods`).toBe(false);
        }
        expect(seen, 'the reading finds the console calls of the new files (the routes, sms.js)').toBeGreaterThanOrEqual(10);
        expect(bad, 'console calls that are not a fixed line (shown whole: they are source, not data)').toEqual([]);
    });
});

// ================================================================================================================================
// Condition 1: runCrewRetention against the database
// ================================================================================================================================

test.describe('Job link retention: runCrewRetention', () => {
    sweepAround();

    test('Condition 1: a member removed 400 days ago is anonymised with their checks and codes gone and their events keeping no member; a younger removal and a current member are untouched; a second run erases nobody', async () => {
        test.setTimeout(120_000);
        expect([REMOVED_MEMBER_DAYS, LOCATION_DAYS, DELETION_GRACE_HOURS, EXPIRED_KEEP_DAYS], 'the design\'s named values (365, 365, 48, 7)').toEqual([365, 365, 48, 7]);

        const provider = await mkProvider();
        const job = await mkBooking(provider);
        const link = await mkLink(job);
        const old = await mkMember('Old', { provider, removedDaysAgo: 400 }); // removed long ago: erased
        const edge = await mkMember('Edge', { provider, removedDaysAgo: 364 }); // not yet
        const recent = await mkMember('Recent', { provider, removedDaysAgo: 30 }); // not yet
        const current = await mkMember('Current', { provider }); // a member
        const old2 = await mkMember('Old Two', { provider, removedDaysAgo: 500 }); // two erased under one provider: the key on (provider, phone) must hold
        const originals = { edge, recent, current };
        for (const member of [old, edge, recent, current, old2]) await putOnJob(job, member.id);

        // The things that hang off the old member and off the current one.
        await addCode(link.id, old.id, old.phone, { expiredDays: 1, sessionExpiredDays: -1, unique: 'old-live' }); // a live session of an erased cleaner
        await addCheck(old.id, old.phone, { used: true, unique: 'old-proof' });
        await addCheck(old.id, old.phone, { used: false, expiredDays: -1, unique: 'old-ask' });
        await addCode(link.id, current.id, current.phone, { expiredDays: -1, sessionExpiredDays: -1, unique: 'cur-live' });
        await addCheck(current.id, current.phone, { used: true, unique: 'cur-proof' });
        await addEvent(link.id, job, 'check_in', old.id);
        await addEvent(link.id, job, 'code_asked', old.id);
        await addEvent(link.id, job, 'check_in', current.id);
        await execute(
            `INSERT INTO job_checkins (booking_id, crew_member_id, assignment_epoch, by_kind, by_ref, latitude, longitude, accuracy_m, distance_m, away, checked_in_at)
             VALUES (?, ?, 1, 'cleaner', ?, 51.1, -114.1, 20, 123, 0, NOW() - INTERVAL 10 DAY)`,
            [job, old.id, old.id]
        );

        const firstRun = watching();
        const { result: first, lines } = await logsOf(() => runCrewRetention(firstRun.run));
        expect(Object.keys(first).sort(), 'the summary has the counts of every step').toEqual([...SUMMARY_KEYS].sort());
        expect(lines, 'the retention run logs nothing at all').toEqual([]);
        // The positive control of the watching below: the member update of the first run matched the two members removed over a year ago, and none of the three others.
        expect(firstRun.idsIn('provider_crew_members', [old.id, old2.id, edge.id, recent.id, current.id]), 'the first run\'s member update matched exactly the members removed 400 and 500 days ago').toEqual(ascending([old.id, old2.id]));

        const oldNow = await memberRow(old.id);
        const old2Now = await memberRow(old2.id);
        expect(isErased(oldNow) && isErased(old2Now), `removed 400 and 500 days ago: name Former cleaner, number x{id}, still removed (${JSON.stringify([oldNow, old2Now])})`).toBe(true);
        expect(oldNow.phone, 'two erased members of one provider coexist with distinct x{id} numbers').not.toBe(old2Now.phone);
        expect(isIntact(await memberRow(edge.id), edge) && isIntact(await memberRow(recent.id), recent), 'removed 364 and 30 days ago: untouched').toBe(true);
        const currentNow = await memberRow(current.id);
        expect(isIntact(currentNow, originals.current) && Number(currentNow.removed) === 0, 'the current member: untouched and still a member').toBe(true);
        expect(first.removed_members, 'the first run counted at least the two it erased').toBeGreaterThanOrEqual(2);

        expect(await countOf('SELECT COUNT(*) AS n FROM crew_number_checks WHERE crew_member_id = ?', [old.id]), 'the erased member\'s number checks are gone').toBe(0);
        expect(await countOf('SELECT COUNT(*) AS n FROM job_link_codes WHERE crew_member_id = ?', [old.id]), 'the erased member\'s sign-in codes and their session are gone').toBe(0);
        expect(await countOf('SELECT COUNT(*) AS n FROM crew_number_checks WHERE crew_member_id = ?', [current.id]), 'the current member\'s proof is kept').toBe(1);
        expect(await countOf('SELECT COUNT(*) AS n FROM job_link_codes WHERE crew_member_id = ?', [current.id]), 'the current member\'s live session is kept').toBe(1);
        expect(await countOf('SELECT COUNT(*) AS n FROM job_link_events WHERE link_id = ? AND crew_member_id IS NULL', [link.id]), 'the erased member\'s two events stay and belong to nobody').toBe(2);
        expect(await countOf('SELECT COUNT(*) AS n FROM job_link_events WHERE link_id = ? AND crew_member_id = ?', [link.id, current.id]), 'the current member\'s event keeps its member').toBe(1);
        expect(await countOf('SELECT COUNT(*) AS n FROM booking_crew WHERE booking_id = ?', [job]), 'booking_crew is left alone (an anonymous row says how many were on the job)').toBe(5);
        const [tick] = await rows('SELECT latitude, distance_m, away FROM job_checkins WHERE booking_id = ? AND crew_member_id = ?', [job, old.id]);
        expect(tick && Number(tick.latitude) === 51.1 && tick.distance_m === 123 && tick.away === 0, 'the erased member\'s check-in is kept, position and all, until it is a year old').toBe(true);

        // Run it again: nothing is left to do, and the rows are as they were. The run is watched, so the case asserts on its own two ids and not on a
        // count that other specs' rows could move: the member update of the second run must not match either of the members the first one erased.
        const second = watching();
        await runCrewRetention(second.run);
        expect(second.idsIn('provider_crew_members', [old.id, old2.id]), 'a second run erases nobody it erased before (idempotent): the guard on x{id} keeps an erased member out of the next run').toEqual([]);
        expect(isErased(await memberRow(old.id)) && isErased(await memberRow(old2.id)), 'the erased members are as they were after the second run').toBe(true);
        expect((await memberRow(old.id)).phone, 'and keep the same x{id} number').toBe(oldNow.phone);
    });

    test('Condition 1: a run that stops half way is finished by the next one, and a member put back on a crew mid-run stays a member', async () => {
        test.setTimeout(120_000);
        const provider = await mkProvider();
        const job = await mkBooking(provider);
        const link = await mkLink(job);

        // A crash at the member update: the member row is the last thing written, so the member is whole and the next run finds them.
        const half = await mkMember('Half', { provider, removedDaysAgo: 450 });
        await addCheck(half.id, half.phone, { used: true, unique: 'half-proof' });
        let updates = 0;
        const dies = async (sql, params) => {
            if (/^\s*UPDATE provider_crew_members/.test(sql) && ++updates === 1) throw new Error('simulated crash');
            return execute(sql, params);
        };
        await expect(runCrewRetention(dies), 'the crash reaches the caller').rejects.toThrow('simulated crash');
        expect(isIntact(await memberRow(half.id), half), 'crash before the member update: the member is still whole (the update is last)').toBe(true);
        const finished = await runCrewRetention(execute);
        expect(isErased(await memberRow(half.id)), 'the next run finishes the job').toBe(true);
        expect(finished.removed_members, 'and counts it').toBeGreaterThanOrEqual(1);

        // A crash on the events step, after the checks and codes went: still whole, and the next run cleans the events that were left.
        const half2 = await mkMember('HalfTwo', { provider, removedDaysAgo: 470 });
        await addCheck(half2.id, half2.phone, { used: true, unique: 'half2-proof' });
        await addEvent(link.id, job, 'check_in', half2.id);
        const dies2 = async (sql, params) => {
            if (/^\s*UPDATE job_link_events SET crew_member_id = NULL/.test(sql)) throw new Error('simulated crash');
            return execute(sql, params);
        };
        await expect(runCrewRetention(dies2), 'the crash on the events step reaches the caller').rejects.toThrow('simulated crash');
        expect(isIntact(await memberRow(half2.id), half2), 'crash on the events step: the member is still whole, so the next run can still find them').toBe(true);
        await runCrewRetention(execute);
        expect(isErased(await memberRow(half2.id)), 'the next run erases the member').toBe(true);
        expect(await countOf('SELECT COUNT(*) AS n FROM job_link_events WHERE crew_member_id = ?', [half2.id]), 'and takes them out of the events that were about them').toBe(0);
        expect(await countOf('SELECT COUNT(*) AS n FROM job_link_events WHERE link_id = ? AND crew_member_id IS NULL', [link.id]), 'the event itself stays').toBe(1);

        // A member put back on a crew between two statements (ENG-014's add revives a removed row) keeps their row: the update re-checks removed_at.
        const revived = await mkMember('Revived', { provider, removedDaysAgo: 600 });
        await addCheck(revived.id, revived.phone, { used: true, unique: 'rev-proof' });
        let seen = 0;
        const revives = async (sql, params) => {
            const out = await execute(sql, params);
            if (/^\s*UPDATE job_link_events SET crew_member_id = NULL/.test(sql) && ++seen === 1) await execute('UPDATE provider_crew_members SET removed_at = NULL WHERE id = ?', [revived.id]);
            return out;
        };
        await runCrewRetention(revives);
        const back = await memberRow(revived.id);
        expect(isIntact(back, revived) && Number(back.removed) === 0, 'put back on a crew mid-run: left a member, name and number as they were').toBe(true);
    });

    test('Condition 1: a deleted provider\'s crew is anonymised when information_schema has the status and the column, and the answer is provider_deletion not_in_schema when it does not', async () => {
        test.setTimeout(120_000);
        const support = await schemaSupport();
        test.info().annotations.push({ type: 'note', description: `this database: status deleted ${support.deleted}, pending_deletion with deletion_requested_at ${support.pending}` });
        const live = await mkProvider('active');
        const mFine = await mkMember('Fine', { provider: live });
        const planted = { live: mFine };
        let pendingOld = null;
        let pendingNew = null;
        let gone = null;
        if (support.pending) {
            const oldProvider = await mkPendingProvider(72);
            const newProvider = await mkPendingProvider(5);
            pendingOld = { provider: oldProvider, member: await mkMember('PendingOld', { provider: oldProvider }) };
            pendingNew = { provider: newProvider, member: await mkMember('PendingNew', { provider: newProvider }) };
            await addCheck(pendingOld.member.id, pendingOld.member.phone, { used: true, unique: 'po-proof' });
        }
        if (support.deleted) {
            const goneProvider = await mkProvider('deleted');
            gone = { provider: goneProvider, member: await mkMember('Gone', { provider: goneProvider }), removed: await mkMember('GoneRemoved', { provider: goneProvider, removedDaysAgo: 3 }) };
        }

        const thirdRun = watching();
        const third = await runCrewRetention(thirdRun.run);
        expect(isIntact(await memberRow(planted.live.id), planted.live), 'an active provider\'s member is untouched').toBe(true);
        // The positive control of the watching below: the run matched the members of the deleted and the long-pending providers, and not the others.
        const everyone = [planted.live.id, pendingOld?.member.id, pendingNew?.member.id, gone?.member.id, gone?.removed.id].filter((id) => typeof id === 'number');
        const shouldMatch = [pendingOld?.member.id, gone?.member.id, gone?.removed.id].filter((id) => typeof id === 'number');
        expect(thirdRun.idsIn('provider_crew_members', /** @type {number[]} */ (everyone)), 'the run matched the members of a deleted or long-pending provider and nobody else of the case').toEqual(ascending(/** @type {number[]} */ (shouldMatch)));
        if (!support.deleted && !support.pending) {
            expect(third.provider_deletion, 'no status value and no column to go by: the step is skipped and says so').toBe('not_in_schema');
        } else {
            expect(typeof third.provider_deletion, 'the step ran, so it reports a count and not not_in_schema').toBe('number');
        }
        if (pendingOld && pendingNew) {
            const erasedOld = await memberRow(pendingOld.member.id);
            expect(isErased(erasedOld), `pending_deletion for 72 hours (more than ${DELETION_GRACE_HOURS}): the member is erased and marked removed (${JSON.stringify(erasedOld)})`).toBe(true);
            expect(await countOf('SELECT COUNT(*) AS n FROM crew_number_checks WHERE crew_member_id = ?', [pendingOld.member.id]), 'the deletion proof went with the member').toBe(0);
            const waiting = await memberRow(pendingNew.member.id);
            expect(isIntact(waiting, pendingNew.member) && Number(waiting.removed) === 0, 'pending_deletion for 5 hours: untouched and still a member').toBe(true);
        }
        if (gone) {
            expect(isErased(await memberRow(gone.member.id)) && isErased(await memberRow(gone.removed.id)), 'a deleted provider\'s members are erased, removed recently or not').toBe(true);
        }
        // Provider deletion twice: the second run, watched, must not match any member of this case that the first one erased.
        const fourth = watching();
        const answer = await runCrewRetention(fourth.run);
        if (support.deleted || support.pending) {
            const erasedBefore = [pendingOld?.member.id, gone?.member.id, gone?.removed.id].filter((id) => typeof id === 'number');
            expect(erasedBefore.length > 0, 'the case planted a member for the deletion to erase').toBe(true);
            expect(fourth.idsIn('provider_crew_members', /** @type {number[]} */ (erasedBefore)), 'provider deletion is idempotent: the second run erases nobody the first one erased').toEqual([]);
            expect(typeof answer.provider_deletion, 'and still reports a count').toBe('number');
        } else {
            expect(answer.provider_deletion).toBe('not_in_schema');
        }

        // The same library against a database that lacks the status or the column: what its SQL says, whatever this database has.
        const sqls = [];
        const asIf = (columns) => async (sql, params) => {
            sqls.push(sql);
            if (/information_schema\.COLUMNS/.test(sql)) return columns;
            return execute(sql, params);
        };
        const deletionSql = () => sqls.filter((sql) => /service_providers p/.test(sql));

        const none = await runCrewRetention(asIf([]));
        expect(none.provider_deletion, 'no status column and no deletion column: not_in_schema').toBe('not_in_schema');
        expect(deletionSql(), 'and the deletion SQL never ran').toEqual([]);

        sqls.length = 0;
        const oldEnum = await runCrewRetention(asIf([{ name: 'status', type: "enum('active','inactive','pending')" }, { name: 'deletion_requested_at', type: 'timestamp' }]));
        expect(oldEnum.provider_deletion, 'an enum that lists neither status: not_in_schema').toBe('not_in_schema');
        expect(deletionSql(), 'and the deletion SQL never ran').toEqual([]);

        sqls.length = 0;
        const onlyDeleted = await runCrewRetention(asIf([{ name: 'status', type: "enum('active','deleted')" }]));
        expect(typeof onlyDeleted.provider_deletion, 'a status column that lists deleted only: the step runs').toBe('number');
        expect(deletionSql().length > 0 && deletionSql().every((sql) => !/deletion_requested_at/.test(sql)), 'and its SQL never names deletion_requested_at').toBe(true);

        sqls.length = 0;
        const noColumn = await runCrewRetention(asIf([{ name: 'status', type: "enum('active','pending_deletion')" }]));
        expect(noColumn.provider_deletion, 'pending_deletion without its timestamp column: not_in_schema (the statement would fail the whole run)').toBe('not_in_schema');
        expect(deletionSql(), 'and the deletion SQL never ran').toEqual([]);

        sqls.length = 0;
        const text = await runCrewRetention(asIf([{ name: 'status', type: 'varchar(40)' }, { name: 'deletion_requested_at', type: 'timestamp' }]));
        expect(text.provider_deletion, 'a status that is not an enum is not trusted: not_in_schema').toBe('not_in_schema');
    });

    test('Condition 1: a check-in and an event older than a year lose their position and keep the distance and the flag; younger ones are untouched; a second run counts nothing', async () => {
        test.setTimeout(120_000);
        const provider = await mkProvider();
        const job = await mkBooking(provider);
        const link = await mkLink(job);
        const m1 = await mkMember('Pos One', { provider });
        const m2 = await mkMember('Pos Two', { provider });
        const m3 = await mkMember('Pos Three', { provider });
        const tickAt = (memberId, days) =>
            execute(
                `INSERT INTO job_checkins (booking_id, crew_member_id, assignment_epoch, by_kind, by_ref, latitude, longitude, accuracy_m, distance_m, away, checked_in_at)
                 VALUES (?, ?, 1, 'cleaner', ?, 51.2, -114.2, 15, 640, 1, NOW() - INTERVAL ? DAY)`,
                [job, memberId, memberId, days]
            );
        const eventAt = (memberId, days) =>
            execute(
                `INSERT INTO job_link_events (link_id, booking_id, kind, actor_kind, actor_ref, crew_member_id, latitude, longitude, accuracy_m, created_at)
                 VALUES (?, ?, 'check_in', 'cleaner', ?, ?, 51.2, -114.2, 15, NOW() - INTERVAL ? DAY)`,
                [link.id, job, memberId, memberId, days]
            );
        const tickIds = [];
        const eventIds = [];
        for (const [memberId, days] of [[m1.id, 400], [m2.id, 364], [m3.id, 2]]) {
            tickIds.push((await tickAt(memberId, days)).insertId);
            eventIds.push((await eventAt(memberId, days)).insertId);
        }

        const firstRun = watching();
        const run = await runCrewRetention(firstRun.run);
        // The positive control of the watching below: the first run matched the year-old check-in and event and none of the younger ones.
        expect(firstRun.idsIn('job_checkins', tickIds), 'the first run\'s check-in update matched only the 400-day-old check-in').toEqual([tickIds[0]]);
        expect(firstRun.idsIn('job_link_events', eventIds), 'the first run\'s event update matched only the 400-day-old event').toEqual([eventIds[0]]);
        const ticks = await rows('SELECT crew_member_id, latitude, longitude, accuracy_m, distance_m, away FROM job_checkins WHERE booking_id = ? ORDER BY crew_member_id', [job]);
        const [tick1, tick2, tick3] = ticks;
        expect(
            tick1.latitude === null && tick1.longitude === null && tick1.accuracy_m === null && tick1.distance_m === 640 && tick1.away === 1,
            `a 400-day-old check-in loses its position and keeps its distance and flag (${JSON.stringify(tick1)})`
        ).toBe(true);
        expect(tick2.latitude !== null && tick2.longitude !== null && tick2.accuracy_m === 15, 'a 364-day-old check-in keeps its position').toBe(true);
        expect(tick3.latitude !== null && tick3.longitude !== null && tick3.accuracy_m === 15, 'a 2-day-old check-in keeps its position').toBe(true);
        const events = await rows('SELECT crew_member_id, latitude, longitude, accuracy_m FROM job_link_events WHERE link_id = ? ORDER BY crew_member_id', [link.id]);
        expect(events.length, 'the three events are there').toBe(3);
        expect(events[0].latitude === null && events[0].longitude === null && events[0].accuracy_m === null, 'the 400-day-old event loses its position').toBe(true);
        expect(events[1].latitude !== null && events[2].latitude !== null, 'the 364-day-old and the 2-day-old events keep theirs').toBe(true);
        expect(events[0].crew_member_id, 'and the event still names its member (a position expires, a member does not here)').toBe(m1.id);
        expect(run.check_in_positions >= 1 && run.event_positions >= 1, `the counts say a position was wiped in each table (${JSON.stringify([run.check_in_positions, run.event_positions])})`).toBe(true);

        // A second run, watched: it must not match a row of this case again (the position is already null, the others are not old), and the rows stay.
        const again = watching();
        await runCrewRetention(again.run);
        expect(again.idsIn('job_checkins', tickIds), 'a second run matches none of this case\'s check-ins (a position wiped once is not wiped twice)').toEqual([]);
        expect(again.idsIn('job_link_events', eventIds), 'a second run matches none of this case\'s events').toEqual([]);
        const [after1, after2] = await rows('SELECT latitude, distance_m, away FROM job_checkins WHERE booking_id = ? ORDER BY crew_member_id', [job]);
        expect(after1.latitude === null && after1.distance_m === 640 && after1.away === 1 && after2.latitude !== null, 'and the check-ins are as they were').toBe(true);
    });

    test('Condition 1: expired codes, sessions and unused number-check codes are deleted a week after they expire; a proof of the member\'s own number stays; a running session stays; old budget counters go', async () => {
        test.setTimeout(120_000);
        const provider = await mkProvider();
        const job = await mkBooking(provider);
        const link = await mkLink(job);
        const c1 = await mkMember('Codes', { provider });
        await putOnJob(job, c1.id);
        const other = '+14035550199';
        await addCode(link.id, c1.id, c1.phone, { expiredDays: 8, unique: 'plain-old' }); // expired 8 days ago, no session: goes
        await addCode(link.id, c1.id, c1.phone, { expiredDays: 3, unique: 'plain-young' }); // expired 3 days ago: stays
        await addCode(link.id, c1.id, c1.phone, { expiredDays: 9, sessionExpiredDays: 2, unique: 'session-recent' }); // its session ended 2 days ago: stays
        await addCode(link.id, c1.id, c1.phone, { expiredDays: 9, sessionExpiredDays: 8, unique: 'session-old' }); // both over a week ago: goes
        await addCode(link.id, c1.id, c1.phone, { expiredDays: 9, sessionExpiredDays: -1, unique: 'session-live' }); // its session still runs: stays
        await addCheck(c1.id, c1.phone, { used: false, expiredDays: 8, unique: 'ask-old' }); // goes
        await addCheck(c1.id, c1.phone, { used: false, expiredDays: 3, unique: 'ask-young' }); // stays
        await addCheck(c1.id, c1.phone, { used: true, expiredDays: 30, createdDaysAgo: 30, unique: 'proof-current' }); // the member's number, proved: stays for good
        await addCheck(c1.id, other, { used: true, expiredDays: 30, createdDaysAgo: 30, unique: 'proof-stale-old' }); // another number, 30 days old: goes
        await addCheck(c1.id, other, { used: true, expiredDays: 2, createdDaysAgo: 2, unique: 'proof-stale-young' }); // another number, 2 days old: stays a while
        const budgetOld = sha256Hex(`${RUN}-retention-budget-old`);
        const budgetNew = sha256Hex(`${RUN}-retention-budget-new`);
        budgetScopes.add(budgetOld);
        budgetScopes.add(budgetNew);
        await execute('INSERT INTO sms_budget (scope, window_started_at, used) VALUES (?, NOW() - INTERVAL 3 DAY, 4)', [budgetOld]);
        await execute('INSERT INTO sms_budget (scope, window_started_at, used) VALUES (?, NOW() - INTERVAL 1 HOUR, 4)', [budgetNew]);

        const run = await runCrewRetention(execute);
        const codeHashes = (await rows('SELECT code_hash FROM job_link_codes WHERE crew_member_id = ?', [c1.id])).map((row) => row.code_hash);
        const kept = (unique) => codeHashes.includes(sha256Hex(`c${unique}${RUN}`));
        expect(!kept('plain-old') && kept('plain-young'), 'codes: 8 days past expiry go, 3 days stay').toBe(true);
        expect(kept('session-recent') && !kept('session-old') && kept('session-live'), 'codes: a session that ended 2 days ago keeps its code, one that ended 8 days ago does not, a running one stays').toBe(true);
        const checkHashes = (await rows('SELECT code_hash FROM crew_number_checks WHERE crew_member_id = ?', [c1.id])).map((row) => row.code_hash);
        const keptCheck = (unique) => checkHashes.includes(sha256Hex(`n${unique}${RUN}`));
        expect(!keptCheck('ask-old') && keptCheck('ask-young'), 'number-check codes never used: 8 days past expiry go, 3 stay').toBe(true);
        expect(keptCheck('proof-current'), 'a proof of the member\'s current number stays however old').toBe(true);
        expect(!keptCheck('proof-stale-old') && keptCheck('proof-stale-young'), 'a proof of a number the member no longer has goes after a week, not before').toBe(true);
        expect(run.codes >= 2 && run.number_check_codes >= 1 && run.stale_number_checks >= 1, `the counts say each kind was deleted (${JSON.stringify([run.codes, run.number_check_codes, run.stale_number_checks])})`).toBe(true);
        expect(await countOf('SELECT COUNT(*) AS n FROM sms_budget WHERE scope = ?', [budgetOld]), 'pruneBudget runs: a counter whose window began 3 days ago is gone').toBe(0);
        expect(await countOf('SELECT COUNT(*) AS n FROM sms_budget WHERE scope = ?', [budgetNew]), 'and one from an hour ago is not').toBe(1);
        expect(run.budget_rows, 'and the count says a counter went').toBeGreaterThanOrEqual(1);
    });

    test('Condition 1: every statement the retention runs is prepared and carries no value from the data, and a failing statement reaches the caller', async () => {
        test.setTimeout(120_000);
        const texts = [];
        await runCrewRetention(async (sql, params) => {
            texts.push(sql);
            return execute(sql, params);
        });
        expect(texts.length, 'every statement runs through the injected execute').toBeGreaterThanOrEqual(10);
        const carrying = texts.filter((sql) => /\d{3,}/.test(sql.replace(/\s+/g, ' ').replace(/'x'/g, '')));
        expect(carrying.length, 'no statement carries a literal number from the data (only the x of x{id} and the status names)').toBe(0);
        await expect(
            runCrewRetention(async () => {
                throw new Error('boom');
            }),
            'a failing statement is not swallowed (the cron route needs to see it)'
        ).rejects.toThrow('boom');
    });
});

// ================================================================================================================================
// Condition 1: the cron route
// ================================================================================================================================

test.describe('Job link retention: the cron route', () => {
    sweepAround();

    test('Condition 1: GET /api/cron/crew-retention is 401 on the running app without the secret, with a wrong one, with Bearer undefined and with an empty ?secret=', async ({ request }) => {
        test.setTimeout(120_000);
        const probes = [
            ['no credential', CRON_PATH, {}],
            ['a wrong Bearer', CRON_PATH, { authorization: 'Bearer not-the-cron-secret' }],
            ['Bearer undefined', CRON_PATH, { authorization: 'Bearer undefined' }],
            ['an empty Bearer', CRON_PATH, { authorization: 'Bearer ' }],
            ['a wrong ?secret=', `${CRON_PATH}?secret=not-the-cron-secret`, {}],
            ['?secret=undefined', `${CRON_PATH}?secret=undefined`, {}],
            ['an empty ?secret=', `${CRON_PATH}?secret=`, {}],
            ['another scheme', CRON_PATH, { authorization: 'Basic not-the-cron-secret' }],
        ];
        for (const [what, url, headers] of probes) {
            const response = await request.get(String(url), { headers: /** @type {any} */ (headers), maxRetries: RESET_RETRIES, timeout: 60_000 });
            expect(response.status(), `${what}: status`).toBe(401);
            expect(await response.json().catch(() => null), `${what}: body`).toEqual({ success: false, message: 'Unauthorized' });
        }
    });

    test('Condition 1: the cron handler, run in plain Node with a secret set, is 401 until the secret is given as a Bearer or as ?secret=, then it runs the retention and answers the summary; a failure logs the error code only', async () => {
        test.setTimeout(120_000);
        const SECRET = `eng015-retention-spec-${RUN}`;
        secrets.credentials.add(SECRET);
        const globals = /** @type {any} */ (globalThis);
        const saved = { pool: globals.mysqlPool, jwt: process.env.JWT_SECRET, cron: process.env.CRON_SECRET, run: globals.__eng015RetentionExecute };
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eng015-retention-route-'));
        try {
            // api-auth.js reaches db.js through mobile-auth.js, which makes a pool when first imported unless one is set; the guard never asks it
            // anything. The route's own @/lib/db is a stand-in over this file's connection, so the route runs on the dev database as itself.
            globals.mysqlPool = {
                async getConnection() {
                    throw new Error('retention spec stub: the cron guard never asks the pool');
                },
            };
            process.env.JWT_SECRET = saved.jwt || 'eng015-retention-spec-jwt-secret, not a real one';
            process.env.CRON_SECRET = SECRET;
            globals.__eng015RetentionExecute = execute;

            const write = (name, text) => {
                fs.writeFileSync(path.join(dir, name), text);
                return pathToFileURL(path.join(dir, name)).href;
            };
            const imports = {
                'next/server': write('next-server.mjs', `import { createRequire } from 'node:module';\nexport const { NextResponse } = createRequire(${JSON.stringify(path.join(ROOT, 'package.json'))})('next/server');\n`),
                '@/lib/db': write('db.mjs', 'export const execute = (sql, params) => globalThis.__eng015RetentionExecute(sql, params);\n'),
                '@/lib/api-auth': pathToFileURL(path.join(ROOT, 'src/lib/api-auth.js')).href,
                '@/lib/crew-retention': pathToFileURL(path.join(ROOT, 'src/lib/crew-retention.js')).href,
            };
            const source = textOf('src/app/api/cron/crew-retention/route.js').replace(/from\s+(['"])([^'"]+)\1/g, (whole, quote, specifier) => {
                if (!(specifier in imports)) throw new Error(`the route imports ${specifier}, which this spec has no stand-in for`);
                return `from '${imports[specifier]}'`;
            });
            const route = await import(write('route.mjs', source));
            const call = (suffix = '', headers = {}) => route.GET(new Request(`http://localhost${CRON_PATH}${suffix}`, { headers }));

            const provider = await mkProvider();
            const victim = await mkMember('Route Victim', { provider, removedDaysAgo: 420 });
            const second = await mkMember('Route Victim Two', { provider, removedDaysAgo: 430 });

            // Refused callers: 401 with the one body, and no work done (the member is still whole).
            for (const [what, suffix, headers] of /** @type {[string, string, Record<string, string>][]} */ ([
                ['no credential', '', {}],
                ['a wrong Bearer', '', { authorization: 'Bearer not-the-cron-secret' }],
                ['Bearer undefined', '', { authorization: 'Bearer undefined' }],
                ['a wrong ?secret=', '?secret=not-the-cron-secret', {}],
                ['an empty ?secret=', '?secret=', {}],
            ])) {
                const response = await call(suffix, headers);
                expect(response.status, `${what}: status`).toBe(401);
                expect(await response.json(), `${what}: body`).toEqual({ success: false, message: 'Unauthorized' });
            }
            expect(isIntact(await memberRow(victim.id), victim), 'a refused caller ran nothing: the member removed 420 days ago is still whole').toBe(true);

            // The secret as a Bearer: the retention runs and the answer is the summary.
            const bearer = await call('', { authorization: `Bearer ${SECRET}` });
            expect(bearer.status, 'the secret as a Bearer: status').toBe(200);
            expect(bearer.headers.get('cache-control'), 'the answer is not cached').toBe('no-store');
            const body = await bearer.json();
            expect(body.success, 'the answer says success').toBe(true);
            expect(Object.keys(body.data).sort(), 'and holds the summary of every step').toEqual([...SUMMARY_KEYS].sort());
            expect(isErased(await memberRow(victim.id)), 'and the member removed 420 days ago is anonymised').toBe(true);

            // The secret as ?secret=: the same.
            const query = await call(`?secret=${SECRET}`);
            expect(query.status, 'the secret as ?secret=: status').toBe(200);
            expect((await query.json()).success, 'the secret as ?secret=: success').toBe(true);
            expect(isErased(await memberRow(second.id)), 'and the second member removed 430 days ago is anonymised').toBe(true);

            // A failure: 500, the one message, and the log line holds the error code and nothing the driver said (its message holds a fixture number).
            globals.__eng015RetentionExecute = async () => {
                throw Object.assign(new Error('Duplicate entry for +14035550183 in provider_crew_members'), { code: 'ER_E2E_FIXTURE' });
            };
            const { result: failed, lines } = await logsOf(() => call('', { authorization: `Bearer ${SECRET}` }));
            expect(failed.status, 'a failing run: status').toBe(500);
            expect(await failed.json(), 'a failing run: body').toEqual({ success: false, message: 'Failed to trim the crew data' });
            expect(lines, 'a failing run logs the error code and nothing else').toEqual([['error', 'Error trimming the crew data: ER_E2E_FIXTURE']]);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
            if (saved.pool === undefined) delete globals.mysqlPool;
            else globals.mysqlPool = saved.pool;
            if (saved.jwt === undefined) delete process.env.JWT_SECRET;
            else process.env.JWT_SECRET = saved.jwt;
            if (saved.cron === undefined) delete process.env.CRON_SECRET;
            else process.env.CRON_SECRET = saved.cron;
            if (saved.run === undefined) delete globals.__eng015RetentionExecute;
            else globals.__eng015RetentionExecute = saved.run;
        }
    });
});

// ================================================================================================================================
// Condition 6: what the libraries log
// ================================================================================================================================

// Runs `work(calls)` with the three Twilio variables set (or all unset), globalThis.fetch replaced by a stub that records each call and answers with
// answer(call number), and everything put back.
async function withTwilio({ configured = true, answer = () => new Response('{}', { status: 201 }) }, work) {
    const saved = { fetch: globalThis.fetch, sid: process.env.TWILIO_ACCOUNT_SID, token: process.env.TWILIO_AUTH_TOKEN, from: process.env.TWILIO_PHONE_NUMBER };
    const calls = [];
    if (configured) {
        process.env.TWILIO_ACCOUNT_SID = `ACeng015je${RUN}`;
        process.env.TWILIO_AUTH_TOKEN = `tokeng015je${RUN}`;
        process.env.TWILIO_PHONE_NUMBER = '+14035550198';
        secrets.credentials.add(process.env.TWILIO_ACCOUNT_SID);
        secrets.credentials.add(process.env.TWILIO_AUTH_TOKEN);
    } else {
        delete process.env.TWILIO_ACCOUNT_SID;
        delete process.env.TWILIO_AUTH_TOKEN;
        delete process.env.TWILIO_PHONE_NUMBER;
    }
    globalThis.fetch = /** @type {any} */ (async (url, init) => {
        calls.push({ url: String(url), form: new URLSearchParams(String(init?.body ?? '')) });
        return answer(calls.length);
    });
    try {
        return await work(calls);
    } finally {
        globalThis.fetch = saved.fetch;
        for (const [name, value] of [['TWILIO_ACCOUNT_SID', saved.sid], ['TWILIO_AUTH_TOKEN', saved.token], ['TWILIO_PHONE_NUMBER', saved.from]]) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    }
}

test.describe('Job link retention: logs', () => {
    sweepAround();

    test('Condition 6: sendSMS logs fixed lines only; a refused number makes no call; the Twilio failure line carries the status and the Twilio code and never the body or a number', async () => {
        test.setTimeout(120_000);
        const number = (last) => `+1403555${String(last).padStart(4, '0')}`;
        const only = async (config, work, expected, what) => {
            const { lines, result } = await logsOf(() => withTwilio(config, work));
            expect(lines, `${what}: what was logged`).toEqual(expected);
            return result;
        };

        // Refused before the credentials and the network: no call, one fixed line, and the line holds none of what was typed.
        await only({ configured: true }, async (calls) => {
            expect(await sendSMS('403-555-0181 ext 5', 'body for 0181'), 'a number with an extension is refused').toBe(false);
            expect(await sendSMS('', 'x'), 'an empty number is refused').toBe(false);
            expect(calls.length, 'a refused number makes no call').toBe(0);
        }, [['log', 'SMS not sent: bad_number'], ['log', 'SMS not sent: bad_number']], 'a number that is not a number');
        await only({ configured: true }, async (calls) => {
            expect(await sendSMS('+1 212 555 0100', 'x'), 'a number in the United States is refused').toBe(false);
            expect(await sendSMS('+44 20 7183 8750', 'x'), 'a number in the United Kingdom is refused').toBe(false);
            expect(calls.length, 'a refused destination makes no call').toBe(0);
        }, [['log', 'SMS not sent: destination_not_allowed'], ['log', 'SMS not sent: destination_not_allowed']], 'a number that is not Canadian');
        await only({ configured: false }, async (calls) => {
            expect(await sendSMS(number(182), 'x'), 'without credentials nothing is sent').toBe(false);
            expect(calls.length, 'and nothing is called').toBe(0);
        }, [['log', 'Twilio credentials not configured in .env. Skipping SMS.']], 'no credentials');

        // Accepted: the one fixed line, and the call carried the number as E.164.
        await only({ configured: true }, async (calls) => {
            expect(await sendSMS(number(183), 'a text'), 'Twilio accepts').toBe(true);
            expect(calls.length, 'one call').toBe(1);
            expect(calls[0].form.get('To'), 'to the E.164 number').toBe(number(183));
        }, [['log', 'SMS sent']], 'a text that went');

        // Failures: the status and the Twilio code, from a body that holds a fixture number and says so at length.
        const holding = (code) => JSON.stringify({ code, message: `The 'To' number ${number(184)} is not a valid phone number for ${number(185)}`, more_info: `https://www.twilio.com/docs/errors/${code}?to=${number(184)}`, status: 400 });
        await only({ configured: true, answer: () => new Response(holding(21211), { status: 400 }) }, async () => {
            expect(await sendSMS(number(184), 'x'), 'Twilio answers 400').toBe(false);
        }, [['error', 'Twilio error 400 21211']], 'a 400 whose body holds a number');
        await only({ configured: true, answer: () => new Response(`Server error while texting ${number(186)}`, { status: 500 }) }, async () => {
            expect(await sendSMS(number(186), 'x'), 'Twilio answers 500 with text').toBe(false);
        }, [['error', 'Twilio error 500 unknown']], 'a 500 with a body that is not JSON');
        await only({ configured: true, answer: () => new Response(JSON.stringify({ code: number(187) }), { status: 429 }) }, async () => {
            expect(await sendSMS(number(187), 'x'), 'Twilio answers 429').toBe(false);
        }, [['error', 'Twilio error 429 unknown']], 'a code that is a string (a number) and not an integer is not logged');
        await only({ configured: true, answer: () => new Response(JSON.stringify({ code: 21608 }), { status: 400 }) }, async () => {
            expect(await sendSMS(number(188), 'x'), 'Twilio answers 400 with another code').toBe(false);
        }, [['error', 'Twilio error 400 21608']], 'another Twilio code');

        // The network fails: the error's code or name, and never its message (which here holds a number).
        const breaks = (props, message) => () => {
            throw Object.assign(new Error(message), props);
        };
        await only({ configured: true, answer: breaks({ code: 'ECONNRESET' }, `socket hang up while posting ${number(189)}`) }, async () => {
            expect(await sendSMS(number(189), 'x'), 'a reset connection').toBe(false);
        }, [['error', 'Error sending SMS via Twilio: ECONNRESET']], 'a network error with a code');
        await only({ configured: true, answer: breaks({ name: 'TimeoutError' }, `The operation timed out for ${number(190)}`) }, async () => {
            expect(await sendSMS(number(190), 'x'), 'a timeout').toBe(false);
        }, [['error', 'Error sending SMS via Twilio: TimeoutError']], 'a timeout');
        await only({ configured: true, answer: breaks({}, `boom ${number(191)}`) }, async () => {
            expect(await sendSMS(number(191), 'x'), 'a plain error').toBe(false);
        }, [['error', 'Error sending SMS via Twilio: Error']], 'an error with neither code nor a special name');
    });

    test('Condition 6: a code asked for, texted through sendSMS and entered logs one fixed line, and the code, the number, the name and the session appear in no log line', async () => {
        test.setTimeout(120_000);
        const provider = await mkProvider();
        const job = await mkBooking(provider);
        const link = await mkLink(job);
        const member = await mkMember('Flow', { provider });
        await putOnJob(job, member.id);
        await addCheck(member.id, member.phone, { used: true, unique: 'flow-proof' });
        for (const scope of [['ask', link.id], ['cooldown', link.id, member.id], ['verify', link.id], ['number', member.phone], ['provider', provider]]) trackScope(...scope);
        const target = { id: link.id, booking_id: job, generation: 1, provider_id: provider };
        const typed = `(403) 555-${member.phone.slice(-4)}`;

        const { lines, result } = await logsOf(() =>
            withTwilio({ configured: true }, async (calls) => {
                const asked = await requestCode({ execute, sendText: sendSMS, link: target, rawPhone: typed });
                expect(asked, 'asking for a code answers requested').toEqual({ status: 'requested' });
                expect(calls.length, 'one text went out').toBe(1);
                expect(calls[0].form.get('To'), 'to the member\'s E.164 number').toBe(member.phone);
                const code = /\b(\d{6})\b/.exec(calls[0].form.get('Body') ?? '')?.[1];
                expect(typeof code, 'the text holds a six-digit code').toBe('string');
                secrets.codes.add(/** @type {string} */ (code));

                const nobody = await requestCode({ execute, sendText: sendSMS, link: target, rawPhone: '(403) 555-0188' });
                expect(nobody, 'a number nobody has answers the same').toEqual({ status: 'requested' });
                expect(calls.length, 'and sends nothing').toBe(1);

                const wrong = code === '000000' ? '111111' : '000000';
                secrets.codes.add(wrong);
                expect((await verifyCode({ execute, link: target, rawPhone: typed, code: wrong })).status, 'a wrong code fails').toBe('failed');
                const right = await verifyCode({ execute, link: target, rawPhone: typed, code: /** @type {string} */ (code) });
                expect(right.status, 'the right code signs in').toBe('signed_in');
                if (right.status === 'signed_in') {
                    secrets.cookies.add(String(right.session));
                    expect(right.member.id, 'as the member').toBe(member.id);
                }
                return calls.length;
            })
        );
        expect(result, 'the whole flow made one call to Twilio').toBe(1);
        expect(lines, 'the flow logged the one fixed line of the text that went, and nothing else').toEqual([['log', 'SMS sent']]);
    });
});

// ================================================================================================================================
// Condition 6, last: everything the file logged
// ================================================================================================================================

test.describe('Job link retention: everything logged', () => {
    // Mutant that turns this case red: any library, route or helper the cases ran logs a number, a name, a token, a code, a session or a Twilio body.
    // It is the last case of the file: the spy has been listening since before the first.
    test('Condition 6: no fixture number, name, token, code or cookie value appears in anything the file logged, and every line is one of the fixed ones', async () => {
        // The spy listened: the lines the earlier cases made on purpose are there.
        const texts = captured.map((entry) => entry.text);
        expect(captured.length, 'the spy captured the whole file\'s output').toBeGreaterThan(0);
        expect(texts.includes('Twilio error 400 21211'), 'the Twilio failure line of an earlier case is in the capture').toBe(true);
        expect(texts.includes('SMS sent'), 'and the success line').toBe(true);

        const everything = texts.join('\n');
        for (const [kind, values] of Object.entries(secrets)) {
            let index = 0;
            for (const value of values) {
                index += 1;
                // Only the kind and the position are in the message: a value that did get logged must not be copied into a report.
                expect(everything.includes(value), `a fixture ${kind.replace(/s$/, '')} (${index} of ${values.size}) appears in the logged text`).toBe(false);
            }
        }
        expect(secrets.numbers.size >= 20 && secrets.names.size >= 1, 'the check had fixture numbers and names to look for').toBe(true);

        // Every line is a fixed one, or a fixed one with a status, a Twilio code or an error code in it.
        const FIXED = [
            /^SMS not sent: (?:bad_number|destination_not_allowed)$/,
            /^Twilio credentials not configured in \.env\. Skipping SMS\.$/,
            /^SMS sent$/,
            /^Twilio error \d{3} (?:\d+|unknown)$/,
            /^Error sending SMS via Twilio: [A-Za-z0-9_]+$/,
            /^Error trimming the crew data: [A-Za-z0-9_]+$/,
        ];
        const outside = texts.filter((text) => !FIXED.some((pattern) => pattern.test(text)));
        expect(outside.length, 'lines outside the fixed vocabulary (a count only: such a line may hold what it should not)').toBe(0);
    });
});
