// @ts-check
// ENG-016, the retention of the photos taken at the job link: the "Retention" row of the design's table
// (agents/architect/designs/ENG-016-photos-and-countdown-timer-on-the-job-link.md, "Cases and baseline"), run on src/lib/job-photo-retention.js against
// the dev database, and on GET /api/cron/job-photos. Each title starts with the design's id for the row it settles, and the file's name, the describe
// and the title together are its baseline key:
//   Retention  a link photo older than a year is gone, row and file, whoever took it (a cleaner, the provider or an admin), at 400, 366 and 800 days;
//        one of 364 or 300 days stays; a legacy photo (taken_by_kind NULL, the provider's own page) of 400 days stays; a link photo on a disputed
//        booking stays, row and file, until the booking moves on; a file with no row is deleted when it is more than a day old (48 and 25 hours) and
//        stays when it is not (23 hours, 1 hour, just made); a file with a row of any kind stays; a file left by a deleted booking goes; a file the
//        store did not make is never touched; an old row whose file is already gone does not stop the run, and a run that stopped between the file
//        and the row is finished by the next; a row with an address the store did not give out stays and is counted in skipped, no file outside the
//        store is touched on its account, and 210 of them in front of the rest do not hold the run back; every statement is prepared and carries no
//        value from the data; the run logs nothing; a failing statement reaches the caller; a second run deletes nothing. GET /api/cron/job-photos
//        is 401 on the running app for no secret, a wrong one, Bearer undefined and an empty ?secret= (the dev app has no CRON_SECRET, so it can only
//        ever answer 401), and the handler itself is run in plain Node with a secret set: 401 until the secret is given as a Bearer or as ?secret=,
//        then it trims and answers the counts, and a failure logs the error code and nothing the driver said. The route's source is the guard first
//        and the library run with the pool's execute; a spy on console, installed before the first case and restored after the last, sees the whole
//        file, and the last case looks for every fixture address, e-mail, number and secret in what was logged.
// Not here: the constants (PHOTO_DAYS 365, ORPHAN_GRACE_HOURS 24) and the schedule in vercel.json are pinned by e2e/job-timer-pins.spec.js, who may call
// the route at all is e2e/auth/route-matrix.js, and the store itself (the address pattern, removePhoto's refusals, storedPhotos) is
// e2e/job-photos.spec.js. This file asserts what the sweep does with them.
// Where the files go: the retention deletes by age across the whole table and across the whole directory, so a case never lets it near the stack's
// photo store. Every case points the store at a scratch directory of its own (usePhotoDir, the store's test-only seam), makes its files there, and
// puts the store back and removes the directory afterwards. Besides, the real store is listed before and after every case and must hold the same
// files: that is the check, when this file runs in the checkout the stack serves, that nothing here reached the stack's disk. The ages of the files
// are set from the database's own clock (UNIX_TIMESTAMP(NOW() - INTERVAL n HOUR) and fs.utimes), the ages of the rows with
// uploaded_at = NOW() - INTERVAL n DAY, the way the sweep itself judges them, so a case does not depend on the two clocks agreeing.
// The rows: every booking belongs to the e-mail prefix e2e-jpr- (provider 1's, so the foreign keys hold) and every photo row to such a booking, so
// the sweep (before the first case of a describe, after every case, after the last) deletes only those, the photo rows going with their bookings.
// The retention works on the whole table, so a case never asserts a count another spec's rows could move: it looks for ITS OWN ids in what a run
// selected and deleted (watching() reads the two statements back as the ids they matched) and asserts counts only where the scratch directory makes
// them exact, as the files are. The customer number of the probe bookings is +1 403 555 0299, the last of this ticket's block.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { format } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { RESET_RETRIES } from './support/auth.js';
import { providers } from '../database/fixtures/accounts.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';
import { runJobPhotoRetention } from '../src/lib/job-photo-retention.js';
import { PHOTO_URL_BASE, savePhoto, storedPhotos, usePhotoDir } from '../src/lib/job-photo-store.js';

// The cases send no credential that matters, but the convention of the other server specs is kept: tracing is off. Cases run in the order of the
// file, one worker; they are independent (each plants its own rows and files), so one failure does not hide the next.
test.use({ trace: 'off' });

const [PROVIDER1] = providers;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EMAIL_PREFIX = 'e2e-jpr-';
const CUSTOMER_PHONE = '+14035550299';
const RUN = Date.now().toString(36);
const CRON_PATH = '/api/cron/job-photos';
const SUMMARY_KEYS = ['deleted_photos', 'deleted_report_photos', 'orphan_files', 'skipped']; // sorted; ENG-017 adds deleted_report_photos
// What a probe file holds: the store writes whatever bytes it is given, and nothing here reads a picture.
const PROBE_BYTES = Buffer.from('ENG-016 retention probe, not a picture');

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

const secrets = { addresses: new Set(), emails: new Set(), numbers: new Set([CUSTOMER_PHONE, '4035550299', '(403) 555-0299', '403-555-0299']), credentials: new Set() };

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

// The library takes `execute` in the shape of src/lib/db.js: the rows for a SELECT, the result header for a write.
async function execute(sql, params = []) {
    const [result] = await (await db()).execute(sql, params);
    return /** @type {any} */ (result);
}
const rows = (sql, params = []) => /** @type {Promise<any[]>} */ (execute(sql, params));
const countOf = async (sql, params = []) => Number((await rows(sql, params))[0].n);

// Deletes what this file made: the bookings of the e-mail prefix, and with them, by the foreign key, their photo rows.
async function clearRows() {
    await (await db()).execute('DELETE FROM bookings WHERE customer_email LIKE ?', [`${EMAIL_PREFIX}%`]);
}

// ---- the scratch store ------------------------------------------------------------------------------------------------------------------

/** @type {{ root: string, directory: string, earlier: string, listed: string[] } | null} */
let scratch = null;

const here = () => {
    if (!scratch) throw new Error('the scratch store is not open');
    return scratch;
};

/** The addresses of the files the store lists now, sorted. */
const filesNow = async () => (await storedPhotos()).map((file) => file.url).sort();
const fileOf = (url) => path.join(here().directory, url.slice(PHOTO_URL_BASE.length));

// Points the store at a directory of its own, after listing the real one.
async function openStore() {
    const listed = await filesNow();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eng016-retention-'));
    const directory = path.join(root, 'job-photos');
    scratch = { root, directory, earlier: usePhotoDir(directory), listed };
}

// Puts the store back, removes the scratch directory, and asks that the real store holds what it held when the case began.
async function closeStore() {
    const held = scratch;
    scratch = null;
    if (!held) return;
    usePhotoDir(held.earlier);
    try {
        fs.rmSync(held.root, { recursive: true, force: true });
    } finally {
        expect(await filesNow(), 'the real photo store holds the files it held before the case: the case wrote to its scratch directory only').toEqual(held.listed);
    }
}

// The hooks of a describe that uses the database and the store: a sweep before its first case, the scratch store opened for every case and closed
// after it (also a case that failed or timed out), the sweep after every case and after the last, then the connection is closed.
function around() {
    test.beforeAll(clearRows);
    test.beforeEach(openStore);
    test.afterEach(async () => {
        try {
            await closeStore();
        } finally {
            await clearRows();
        }
    });
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

// ---- rows and files the cases plant (SQL and the store only; no route and no other spec's rows) -----------------------------------------

let bookingSeq = 0;

// A booking of provider 1, in the given status: the photo rows hang on it, and the retention reads only its status.
async function mkBooking(status = 'confirmed') {
    const id = `${RUN}${bookingSeq++}`;
    const email = `${EMAIL_PREFIX}${id}@example.invalid`;
    secrets.emails.add(email);
    const made = await execute(
        `INSERT INTO bookings (booking_number, service_id, service_name, service_price, customer_first_name, customer_last_name, customer_email, customer_phone,
           job_date, job_time_slot, job_description, address_line1, city, status, payment_status, provider_id)
         VALUES (?, 1, 'Probe service', 100.00, 'E2E', 'Probe', ?, ?, DATE_FORMAT(CURDATE(), '%Y-%m-%d'), 'Oct 17: Morning', 'ENG-016 retention probe, deleted by the case', '1 Probe Street', 'Calgary', ?, 'pending', ?)`,
        [`E2EJPR${id}`, email, CUSTOMER_PHONE, status, PROVIDER1.id]
    );
    return Number(made.insertId);
}

// Sets a file's modification time to `hoursOld` hours ago by the database's own clock, the clock the sweep judges it by.
async function backdate(file, hoursOld) {
    const [{ epoch }] = await rows('SELECT UNIX_TIMESTAMP(NOW() - INTERVAL ? HOUR) AS epoch', [hoursOld]);
    fs.utimesSync(file, Number(epoch), Number(epoch));
}

// A file in the scratch store, made by the store (so named as it names them), `hoursOld` hours old; its address.
async function mkFile(hoursOld = 0) {
    const { url } = await savePhoto(PROBE_BYTES, 'jpg');
    secrets.addresses.add(url);
    if (hoursOld > 0) await backdate(fileOf(url), hoursOld);
    return url;
}

// A photo row of a booking, uploaded `days` days ago, with the file it names (three days old unless `hours` says otherwise, so that the orphan step
// would delete it were it no row's) or, with `file: false`, an address the store gave out whose file is gone. `kind` is who took it at the link
// ('cleaner', 'provider' or 'admin') or null for a photo the provider's own page took.
async function mkPhoto(bookingId, { days, kind, type = 'before', hours = 72, file = true }) {
    const url = await mkFile(hours);
    if (!file) fs.rmSync(fileOf(url));
    const made = await execute(
        'INSERT INTO job_photos (booking_id, photo_url, photo_type, uploaded_by, taken_by_kind, taken_by_ref, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, NOW() - INTERVAL ? DAY)',
        [bookingId, url, type, PROVIDER1.id, kind, kind === null ? null : 1, days]
    );
    return { id: Number(made.insertId), url };
}

// A photo row with an address of the case's choosing and no file.
async function mkRowOnly(bookingId, url, days) {
    const made = await execute(
        "INSERT INTO job_photos (booking_id, photo_url, photo_type, uploaded_by, taken_by_kind, taken_by_ref, uploaded_at) VALUES (?, ?, 'before', ?, 'cleaner', 1, NOW() - INTERVAL ? DAY)",
        [bookingId, url, PROVIDER1.id, days]
    );
    return Number(made.insertId);
}

const rowIds = async (...bookings) => (await rows(`SELECT id FROM job_photos WHERE booking_id IN (${bookings.map(() => '?').join(', ')}) ORDER BY id`, bookings)).map((row) => Number(row.id));
const ascending = (ids) => [...ids].sort((a, b) => a - b);
const urlsOf = (photos) => photos.map((photo) => photo.url).sort();
// The ids of `mine` that are in `ids`, once each, in order.
const among = (ids, mine) => ascending([...new Set(ids.filter((id) => mine.includes(id)))]);

// What one run of the retention selected and deleted, by id, found without reading any global count: the statement that finds the old link photos
// is read back as the ids it returned, the delete as the ids it was given. A case looks for ITS OWN ids in them and says nothing about anybody else's
// rows, which other specs may be planting at the same moment. A case that expects a photo to be found checks first that the watching saw it, so
// if the library's statements change shape and the watching stops seeing them, that case fails and no "nothing was deleted" passes for nothing.
function watching() {
    /** @type {number[]} */
    const selected = [];
    /** @type {number[]} */
    const deleted = [];
    const run = async (sql, params = []) => {
        const out = await execute(sql, params);
        if (/^\s*SELECT p\.id, p\.photo_url FROM job_photos p/.test(sql)) selected.push(...out.map((row) => Number(row.id)));
        else if (/^\s*DELETE FROM job_photos/.test(sql)) deleted.push(...params.map(Number));
        return out;
    };
    return { run, selected, deleted };
}

// ---- source reading (as e2e/job-link-retention.spec.js does it) ----------------------------------------------------------------------------

// One pass over the characters of a source file: its text with the comments taken out (line breaks kept). A comment marker inside a string is text.
// Regex literals and `${ }` are not tracked; the file read here needs neither.
function codeWithoutComments(text) {
    let code = '';
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
            code += text.slice(i, j + 1);
            i = j + 1;
        } else {
            code += ch;
            i++;
        }
    }
    return code;
}

const textOf = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

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

// ================================================================================================================================
// The route's source: no app and no database
// ================================================================================================================================

test.describe('Job photo retention: the route source', () => {
    // Mutant that turns this case red: the route does work before the guard, reads the secret by hand or skips the check in development, or runs the
    // library on something other than the pool's execute, so the sweep runs for anyone or on a connection the pool does not know.
    test("Retention: the cron route calls requireCronSecret first and runs the retention with the pool's execute", () => {
        const code = codeWithoutComments(textOf('src/app/api/cron/job-photos/route.js'));
        expect(code, 'the guard is imported from the shared module').toMatch(/import\s*\{\s*requireCronSecret\s*\}\s*from\s*['"]@\/lib\/api-auth['"]/);
        expect(code, 'the first statements of GET are the guard call and its refusal').toMatch(
            /export\s+async\s+function\s+GET\s*\(\s*request\s*\)\s*\{\s*const\s+secret\s*=\s*requireCronSecret\(\s*request\s*\)\s*;?\s*if\s*\(\s*!secret\.ok\s*\)\s*return\s+secret\.response\s*;?/
        );
        expect(code, 'there is no development skip and no secret read by hand').not.toMatch(/NODE_ENV|process\.env\.CRON_SECRET|searchParams\.get\(\s*['"]secret['"]\s*\)/);
        expect(callsOf(code, 'runJobPhotoRetention'), "the retention runs with the pool's execute").toEqual(['execute']);
    });
});

// ================================================================================================================================
// The library against the database
// ================================================================================================================================

test.describe('Job photo retention: the library', () => {
    around();

    // Mutant that turns this case red: the age is wrong (a year read as days of another count, a comparison the wrong way round), a kind of taker is not
    // swept, a legacy row (the provider's own page) is swept, a file is left behind its row or a row behind its file, or a second run finds work.
    test("Retention: a link photo older than a year is gone, row and file, whoever took it; one of 364 or 300 days stays; a legacy photo of the provider's own page stays; a second run deletes nothing", async () => {
        test.setTimeout(120_000);
        const booking = await mkBooking();
        // Gone: more than a year old, taken at the link by each kind of taker. 366 days is the near side of the boundary and 364 below is the other.
        const aged = [
            await mkPhoto(booking, { days: 400, kind: 'cleaner' }),
            await mkPhoto(booking, { days: 366, kind: 'provider', type: 'after' }),
            await mkPhoto(booking, { days: 800, kind: 'admin' }),
        ];
        // Stays: younger than a year, and a photo of the provider's own page whatever its age (its taken_by_kind is NULL).
        const kept = [
            await mkPhoto(booking, { days: 364, kind: 'cleaner' }),
            await mkPhoto(booking, { days: 300, kind: 'cleaner', type: 'after' }),
            await mkPhoto(booking, { days: 1, kind: 'provider' }),
            await mkPhoto(booking, { days: 400, kind: null }),
        ];
        const mine = ascending([...aged, ...kept].map((photo) => photo.id));
        const goneIds = ascending(aged.map((photo) => photo.id));
        const keptIds = ascending(kept.map((photo) => photo.id));
        expect(await filesNow(), 'seven files are in the scratch store before the run').toHaveLength(7);

        const first = watching();
        const { result: summary, lines } = await logsOf(() => runJobPhotoRetention(first.run));
        expect(lines, 'the retention run logs nothing at all').toEqual([]);
        expect(Object.keys(summary).sort(), 'the summary has the count of every step').toEqual(SUMMARY_KEYS);
        // The positive control of the watching below: the run found the three link photos over a year old, and none of the other four.
        expect(among(first.selected, mine), 'the first statement found the three link photos over a year old and none of the other four').toEqual(goneIds);
        expect(among(first.deleted, mine), 'and the delete was sent those three').toEqual(goneIds);
        expect(summary.deleted_photos, 'the count says at least those three went').toBeGreaterThanOrEqual(3);
        expect(summary.orphan_files, 'their files went with them, so the orphan step found no file without a row').toBe(0);
        expect(await rowIds(booking), 'the rows left are the four that are younger than a year or the provider\'s own').toEqual(keptIds);
        expect(await filesNow(), 'and so are their files, and only theirs').toEqual(urlsOf(kept));

        // A second run: nothing is left to do, and the rows and files are as they were.
        const second = watching();
        const again = await runJobPhotoRetention(second.run);
        expect(among(second.selected, mine), 'a second run finds nothing of the case old enough to go').toEqual([]);
        expect(among(second.deleted, mine), 'and deletes nothing of it').toEqual([]);
        expect(again.orphan_files, 'and finds no file without a row').toBe(0);
        expect(await rowIds(booking), 'the rows are as they were').toEqual(keptIds);
        expect(await filesNow(), 'and so are the files').toEqual(urlsOf(kept));
    });

    // Mutant that turns this case red (ENG-017): the report photos are not swept; the report row goes with its photo (the report must outlive the file); a
    // photo of a report under a year, or of a disputed booking, is taken; a file only a report names is taken for an orphan and deleted; or a second run
    // finds work.
    test('Retention: a report photo over a year old loses its file and its address and the report stays; a younger one, a disputed booking\'s and a file only a report names stay', async () => {
        test.setTimeout(120_000);
        const booking = await mkBooking();
        const disputed = await mkBooking('disputed');
        const linkOf = async (bookingId) => {
            const made = await execute('INSERT INTO job_links (booking_id, token, generation) VALUES (?, ?, 1)', [bookingId, randomBytes(32).toString('base64url').slice(0, 43)]);
            return Number(made.insertId);
        };
        const [link, disputedLink] = [await linkOf(booking), await linkOf(disputed)];
        // The file is three days old, so that the orphan step would delete it were it no row's.
        const mkReport = async (bookingId, linkId, days) => {
            const url = await mkFile(72);
            const made = await execute(
                "INSERT INTO job_reports (booking_id, link_id, report_type, note, photo_url, reporter_kind, reporter_ref, created_at) VALUES (?, ?, 'unhygienic', 'retention probe', ?, 'cleaner', 1, NOW() - INTERVAL ? DAY)",
                [bookingId, linkId, url, days]
            );
            return { id: Number(made.insertId), url };
        };
        const old = await mkReport(booking, link, 400);
        const young = await mkReport(booking, link, 300);
        const held = await mkReport(disputed, disputedLink, 400);
        const addressOf = async (report) => (await rows('SELECT photo_url FROM job_reports WHERE id = ?', [report.id]))[0]?.photo_url;
        expect(await filesNow(), 'three files are in the scratch store before the run').toHaveLength(3);

        const summary = await runJobPhotoRetention(execute);
        expect(summary.deleted_report_photos, 'the count says at least the one report photo went').toBeGreaterThanOrEqual(1);
        expect(await filesNow(), 'only the file of the old report went: the young one and the disputed one stay, and a file a report names is no orphan').toEqual(urlsOf([young, held]));
        expect(await countOf('SELECT COUNT(*) AS n FROM job_reports WHERE id = ?', [old.id]), 'the old report stays, so the office keeps what it was told').toBe(1);
        expect(await addressOf(old), 'its address is cleared').toBeNull();
        expect(await addressOf(young), 'a report under a year keeps its address').toBe(young.url);
        expect(await addressOf(held), 'so does a report on a disputed booking, however old').toBe(held.url);

        const again = await runJobPhotoRetention(execute);
        expect(again.orphan_files, 'a second run finds no file without a row').toBe(0);
        expect(await filesNow(), 'and takes nothing more of the case').toEqual(urlsOf([young, held]));
        expect([await addressOf(old), await addressOf(young), await addressOf(held)], 'and the addresses are as they were').toEqual([null, young.url, held.url]);
    });

    // Mutant that turns this case red: the disputed check is dropped (or looks at the wrong booking or the wrong status), or it is kept for ever, so a
    // photo that evidence may be needed from goes after a year, or one of a job whose dispute is over is never deleted.
    test('Retention: a link photo on a disputed booking stays, row and file, however old, until the booking moves on', async () => {
        test.setTimeout(120_000);
        const disputed = await mkBooking('disputed');
        const plain = await mkBooking('confirmed');
        const held = [await mkPhoto(disputed, { days: 400, kind: 'cleaner' }), await mkPhoto(disputed, { days: 700, kind: 'provider', type: 'after' })];
        const control = await mkPhoto(plain, { days: 400, kind: 'cleaner' });
        const mine = ascending([...held.map((photo) => photo.id), control.id]);

        const first = watching();
        await runJobPhotoRetention(first.run);
        expect(among(first.selected, mine), "the run found the old photo of the undisputed job and neither of the disputed job's").toEqual([control.id]);
        expect(await rowIds(disputed, plain), "the disputed job's two rows are there and the other job's is gone").toEqual(ascending(held.map((photo) => photo.id)));
        expect(await filesNow(), "and so are the disputed job's two files").toEqual(urlsOf(held));

        // The dispute is settled: the booking moves on, and the next run takes the photos.
        await execute("UPDATE bookings SET status = 'completed' WHERE id = ?", [disputed]);
        const second = watching();
        const { result: summary } = await logsOf(() => runJobPhotoRetention(second.run));
        expect(among(second.selected, mine), 'once the booking is not disputed the run finds both').toEqual(ascending(held.map((photo) => photo.id)));
        expect(among(second.deleted, mine), 'and deletes both').toEqual(ascending(held.map((photo) => photo.id)));
        expect(summary.deleted_photos, 'the count says at least those two').toBeGreaterThanOrEqual(2);
        expect(await rowIds(disputed, plain), 'no row of the case is left').toEqual([]);
        expect(await filesNow(), 'and no file').toEqual([]);
    });

    // Mutant that turns this case red: the grace is not a day (a file is judged by its row's age, by the name, or not at all), a file with a row of any
    // kind is taken for an orphan, a file left by a deleted booking is never collected, or a file the store did not make is deleted.
    test('Retention: a file with no row is deleted after a day and stays before it; a file with a row of any kind stays; a file left by a deleted booking goes; a file the store did not make is never touched', async () => {
        test.setTimeout(120_000);
        const booking = await mkBooking();
        const disputed = await mkBooking('disputed');
        const doomed = await mkBooking();

        // No row: 48 and 25 hours old are past the day and go; 23 hours, 1 hour and just now are not.
        const orphans = [await mkFile(48), await mkFile(25)];
        const young = [await mkFile(23), await mkFile(1), await mkFile(0)];
        // A row names its file, of any kind: a link photo, a legacy photo and a link photo on a disputed booking, with files three days old.
        const named = [
            await mkPhoto(booking, { days: 5, kind: 'cleaner' }),
            await mkPhoto(booking, { days: 400, kind: null }),
            await mkPhoto(disputed, { days: 400, kind: 'cleaner' }),
        ];
        // The control: a link photo over a year old on an ordinary booking, which the first step deletes with its file, so that the "deleted none of
        // the three" below is a statement about the three and not about a watching that saw nothing.
        const control = await mkPhoto(booking, { days: 400, kind: 'provider' });
        // A booking that is deleted takes its rows by the foreign key, and nothing removes its files.
        const left = await mkPhoto(doomed, { days: 10, kind: 'cleaner' });
        await execute('DELETE FROM bookings WHERE id = ?', [doomed]);
        expect(await countOf('SELECT COUNT(*) AS n FROM job_photos WHERE id = ?', [left.id]), 'the deleted booking took its photo row with it').toBe(0);
        expect(await filesNow(), "and left the photo's file behind").toContain(left.url);
        // Files the store never makes: it lists none of them, so the sweep never sees them, however old they are.
        const strangers = ['README.txt', `${'A'.repeat(32)}.jpg`, `${'0'.repeat(31)}.jpg`, `${'0'.repeat(32)}.gif`, 'photo.jpg'];
        for (const name of strangers) {
            const file = path.join(here().directory, name);
            fs.writeFileSync(file, 'not made by the store');
            await backdate(file, 72);
        }
        const staying = [...young, ...urlsOf(named)].sort();
        expect(await filesNow(), 'before the run the store lists the five files with no row, the four that a row names and the one a deleted booking left').toHaveLength(
            orphans.length + young.length + named.length + 2
        );

        const first = watching();
        const { result: summary, lines } = await logsOf(() => runJobPhotoRetention(first.run));
        expect(lines, 'the run logs nothing').toEqual([]);
        expect(summary.orphan_files, 'three files had no row and were more than a day old: 48 hours, 25 hours and the one the deleted booking left').toBe(3);
        expect(await filesNow(), 'the store holds the three young files and the three that a row names that the first step leaves').toEqual(staying);
        for (const name of strangers) expect(fs.existsSync(path.join(here().directory, name)), `a file the store did not make (${name}) is left alone`).toBe(true);
        const namedIds = ascending(named.map((photo) => photo.id));
        expect(among(first.deleted, [control.id, ...namedIds]), 'the first step deleted the control and none of the three rows that name a file here').toEqual([control.id]);
        expect(await rowIds(booking, disputed), 'those three are there and the control is gone').toEqual(namedIds);

        // A second run: no file is left without a row, and the files are as they were.
        const again = await runJobPhotoRetention(execute);
        expect(again.orphan_files, 'a second run deletes no file').toBe(0);
        expect(await filesNow(), 'and the store holds what it held').toEqual(staying);
    });

    // Mutant that turns this case red: a row whose file is gone stops the run (or is never deleted), so one lost file keeps every later photo past its
    // year, or the run deletes the row first and a crash between the two leaves a file nobody knows; or the order is the other way and the crash
    // leaves a row that can never be finished.
    test('Retention: an old row whose file is already gone does not stop the run, and a run that stopped between the file and the row is finished by the next', async () => {
        test.setTimeout(120_000);
        const booking = await mkBooking();
        // The row of a file that is gone comes first, so a run that gave up on it would never reach the second.
        const missing = await mkPhoto(booking, { days: 400, kind: 'cleaner', file: false });
        const present = await mkPhoto(booking, { days: 400, kind: 'cleaner' });
        const mine = ascending([missing.id, present.id]);
        expect(await filesNow(), 'one of the two files exists').toEqual([present.url]);

        const first = watching();
        const { result: summary, lines } = await logsOf(() => runJobPhotoRetention(first.run));
        expect(lines, 'the run logs nothing').toEqual([]);
        expect(among(first.selected, mine), 'the run found both rows').toEqual(mine);
        expect(among(first.deleted, mine), 'and deleted both, the one with no file as well').toEqual(mine);
        expect(summary.deleted_photos, 'the count says at least both went').toBeGreaterThanOrEqual(2);
        expect(await rowIds(booking), 'no row is left').toEqual([]);
        expect(await filesNow(), 'and the file that was there is gone').toEqual([]);

        // A run that stops after the file and before the row: the delete of the rows fails.
        const half = await mkPhoto(booking, { days: 400, kind: 'provider' });
        let refused = 0;
        const dies = async (sql, params) => {
            if (/^\s*DELETE FROM job_photos/.test(sql)) {
                refused += 1;
                throw new Error('simulated crash');
            }
            return execute(sql, params);
        };
        await expect(runJobPhotoRetention(dies), 'the crash reaches the caller').rejects.toThrow('simulated crash');
        expect(refused, 'the delete of the rows was the statement that failed').toBeGreaterThanOrEqual(1);
        expect(await filesNow(), 'the file was removed before the row').toEqual([]);
        expect(await rowIds(booking), 'and the row remains').toEqual([half.id]);

        const next = watching();
        const finished = await runJobPhotoRetention(next.run);
        expect(among(next.deleted, [half.id]), 'the next run deletes the row').toEqual([half.id]);
        expect(finished.deleted_photos, 'and counts it').toBeGreaterThanOrEqual(1);
        expect(await rowIds(booking), 'no row is left').toEqual([]);
    });

    // Mutant that turns this case red: a row's address is turned into a path without the store checking it (so a stored ../ reaches another file), a
    // bad row is deleted although its file was not, or a pile of bad rows at the head of the table keeps the run from the good ones behind them (the
    // next batch is asked for with no keyset, or the run stops at the first batch that deleted nothing).
    test('Retention: a row with an address the store did not give out stays, is counted in skipped and costs no other path its file, and 210 of them in front of the rest do not hold the run back', async () => {
        test.setTimeout(120_000);
        const booking = await mkBooking();
        // A file one level above the store, which an address with ../ in it would name, and another that a stored absolute path would.
        const canary = path.join(here().root, 'canary.jpg');
        fs.writeFileSync(canary, 'must stay');
        const outside = path.join(here().root, 'outside.jpg');
        fs.writeFileSync(outside, 'must stay');
        const named = [
            '/uploads/job-photos/../canary.jpg',
            '/uploads/job-photos/../../etc/passwd',
            `${outside}`,
            'https://example.invalid/photo.jpg',
            `/uploads/job-photos/${'A'.repeat(32)}.jpg`,
            `/uploads/job-photos/${'0'.repeat(32)}`,
            '/uploads/job-photos/',
            '',
        ];
        const bad = [];
        for (const url of named) {
            if (url !== '') secrets.addresses.add(url);
            bad.push(await mkRowOnly(booking, url, 400));
        }
        // 202 more, so that the bad rows are 210, more than the 200 of a batch, and all of them have lower ids than the rows behind them.
        for (let n = 0; n < 202; n += 1) {
            const url = `/uploads/job-photos/not-ours-${RUN}-${n}.jpg`;
            secrets.addresses.add(url);
            bad.push(await mkRowOnly(booking, url, 400));
        }
        const good = [];
        for (let n = 0; n < 30; n += 1) good.push(await mkPhoto(booking, { days: 400, kind: 'cleaner' }));
        const badIds = ascending(bad);
        const goodIds = ascending(good.map((photo) => photo.id));
        const mine = ascending([...badIds, ...goodIds]);
        expect(bad.length, 'the bad rows are more than a batch').toBe(210);

        const first = watching();
        const { result: summary, lines } = await logsOf(() => runJobPhotoRetention(first.run));
        expect(lines, 'the run logs nothing: not the address it would not remove either').toEqual([]);
        expect(among(first.selected, mine), 'the run found every row of the case, those behind the first batch too').toEqual(mine);
        expect(among(first.deleted, mine), 'and deleted the thirty good ones and none of the bad').toEqual(goodIds);
        expect(summary.skipped, 'and counted the 210 it would not remove').toBeGreaterThanOrEqual(210);
        expect(summary.deleted_photos, 'the count says at least the thirty good ones went').toBeGreaterThanOrEqual(30);
        expect(await rowIds(booking), 'the 210 bad rows are there and the thirty good ones are not').toEqual(badIds);
        expect(await filesNow(), 'the thirty files are gone').toEqual([]);
        expect(fs.readFileSync(canary, 'utf8'), 'the file one level above the store was not deleted by an address with ../ in it').toBe('must stay');
        expect(fs.readFileSync(outside, 'utf8'), 'nor the file an absolute address named').toBe('must stay');

        // A second run counts them again and deletes nothing more.
        const second = watching();
        const again = await runJobPhotoRetention(second.run);
        expect(among(second.selected, mine), 'the next run finds the 210 again').toEqual(badIds);
        expect(among(second.deleted, mine), 'and deletes none').toEqual([]);
        expect(again.skipped, 'and counts them again').toBeGreaterThanOrEqual(210);
        expect(await rowIds(booking), 'the rows are as they were').toEqual(badIds);
    });

    // Mutant that turns this case red: a statement is built with a value in it (a number, an address, a status from the data) and not bound, which is
    // how an injection reaches a table that holds the photos of people's homes; the run logs a count or an address; or a failing statement is swallowed
    // and the cron route answers success for a sweep that did not run.
    test('Retention: every statement is prepared and carries no value from the data, the run logs nothing and a failing statement reaches the caller', async () => {
        test.setTimeout(120_000);
        const booking = await mkBooking();
        await mkPhoto(booking, { days: 400, kind: 'cleaner' });
        await mkFile(48);

        const statements = [];
        const { result: summary, lines } = await logsOf(() =>
            runJobPhotoRetention(async (sql, params) => {
                statements.push({ sql, params });
                return execute(sql, params);
            })
        );
        expect(lines, 'the run logs nothing at all').toEqual([]);
        expect(Object.keys(summary).sort(), 'the summary has the four counts').toEqual(SUMMARY_KEYS);
        expect(
            Object.values(summary).every((count) => Number.isSafeInteger(count) && count >= 0),
            'and each is a whole number'
        ).toBe(true);
        expect(statements.length, 'every statement runs through the injected execute: the old rows, their delete, the cutoff and the orphans\' rows').toBeGreaterThanOrEqual(4);
        const unbound = statements.filter(({ sql, params }) => (sql.match(/\?/g) ?? []).length !== (params ?? []).length);
        expect(unbound.length, 'statements whose placeholders and values do not match one to one').toBe(0);
        // The only literals a statement may hold are the batch size, the one status it names and the 1 of an EXISTS.
        const carrying = statements.filter(({ sql }) => /['"`\d]/.test(sql.replace(/\s+/g, ' ').replace(/LIMIT \d+/g, 'LIMIT n').replace(/'disputed'/g, 'status').replace(/\bSELECT 1\b/g, 'SELECT one')));
        expect(carrying.length, 'statements that carry a literal other than the batch size, disputed and the 1 of an EXISTS').toBe(0);

        await expect(
            runJobPhotoRetention(async () => {
                throw new Error('boom');
            }),
            'a failing statement in the first step is not swallowed (the cron route needs to see it)'
        ).rejects.toThrow('boom');
        await expect(
            runJobPhotoRetention(async (sql, params) => {
                if (/UNIX_TIMESTAMP/.test(sql)) throw new Error('boom');
                return execute(sql, params);
            }),
            'nor one in the orphan step'
        ).rejects.toThrow('boom');
    });
});

// ================================================================================================================================
// The cron route
// ================================================================================================================================

test.describe('Job photo retention: the cron route', () => {
    around();

    test('Retention: GET /api/cron/job-photos is 401 on the running app without the secret, with a wrong one, with Bearer undefined and with an empty ?secret=', async ({ request }) => {
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

    test('Retention: the cron handler, run in plain Node with a secret set, is 401 until the secret is given as a Bearer or as ?secret=, then it trims and answers the counts; a failure logs the error code only', async () => {
        test.setTimeout(120_000);
        const SECRET = `eng016-photos-spec-${RUN}`;
        secrets.credentials.add(SECRET);
        const globals = /** @type {any} */ (globalThis);
        const saved = { pool: globals.mysqlPool, jwt: process.env.JWT_SECRET, cron: process.env.CRON_SECRET, execute: globals.__eng016PhotoExecute, run: globals.__eng016PhotoRun };
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eng016-photos-route-'));
        try {
            // api-auth.js reaches db.js through mobile-auth.js, which makes a pool when first imported unless one is set; the guard never asks it
            // anything. The route's own @/lib/db is a stand-in over this file's connection, so the route runs on the dev database as itself, and its
            // library is a stand-in over the one this file imported, so that it works on the scratch store this case set up.
            globals.mysqlPool = {
                async getConnection() {
                    throw new Error('photo retention spec stub: the cron guard never asks the pool');
                },
            };
            process.env.JWT_SECRET = saved.jwt || 'eng016-photos-spec-jwt-secret, not a real one';
            process.env.CRON_SECRET = SECRET;
            globals.__eng016PhotoExecute = execute;
            globals.__eng016PhotoRun = runJobPhotoRetention;

            const write = (name, text) => {
                fs.writeFileSync(path.join(dir, name), text);
                return pathToFileURL(path.join(dir, name)).href;
            };
            const imports = {
                'next/server': write('next-server.mjs', `import { createRequire } from 'node:module';\nexport const { NextResponse } = createRequire(${JSON.stringify(path.join(ROOT, 'package.json'))})('next/server');\n`),
                '@/lib/db': write('db.mjs', 'export const execute = (sql, params) => globalThis.__eng016PhotoExecute(sql, params);\n'),
                '@/lib/api-auth': pathToFileURL(path.join(ROOT, 'src/lib/api-auth.js')).href,
                '@/lib/job-photo-retention': write('retention.mjs', 'export const runJobPhotoRetention = (execute) => globalThis.__eng016PhotoRun(execute);\n'),
            };
            const source = textOf('src/app/api/cron/job-photos/route.js').replace(/from\s+(['"])([^'"]+)\1/g, (whole, quote, specifier) => {
                if (!(specifier in imports)) throw new Error(`the route imports ${specifier}, which this spec has no stand-in for`);
                return `from '${imports[specifier]}'`;
            });
            const route = await import(write('route.mjs', source));
            const call = (suffix = '', headers = {}) => route.GET(new Request(`http://localhost${CRON_PATH}${suffix}`, { headers }));

            // Two old photos with their files and two files with no row: one pair for each way the secret can be given.
            const booking = await mkBooking();
            const byBearer = await mkPhoto(booking, { days: 420, kind: 'cleaner' });
            const byQuery = await mkPhoto(booking, { days: 430, kind: 'provider' });
            const strayOne = await mkFile(48);
            const strayTwo = await mkFile(60);
            const everything = ascending([byBearer.id, byQuery.id]);
            const files = [byBearer.url, byQuery.url, strayOne, strayTwo].sort();

            // Refused callers: 401 with the one body, and no work done (the rows and the files are all there).
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
            expect(await rowIds(booking), 'a refused caller ran nothing: both old rows are there').toEqual(everything);
            expect(await filesNow(), 'and all four files').toEqual(files);

            // The secret as a Bearer: the sweep runs and the answer is the counts.
            const bearer = await call('', { authorization: `Bearer ${SECRET}` });
            expect(bearer.status, 'the secret as a Bearer: status').toBe(200);
            expect(bearer.headers.get('cache-control'), 'the answer is not cached').toBe('no-store');
            const body = await bearer.json();
            expect(body.success, 'the answer says success').toBe(true);
            expect(Object.keys(body.data).sort(), 'and holds the count of every step').toEqual(SUMMARY_KEYS);
            expect(body.data.deleted_photos, 'the old photos went: at least the two of this case').toBeGreaterThanOrEqual(2);
            expect(body.data.orphan_files, 'the two files with no row went, and they are the only files the scratch store held without one').toBe(2);
            expect(await rowIds(booking), 'no old row is left').toEqual([]);
            expect(await filesNow(), 'and no file').toEqual([]);

            // The secret as ?secret=: the same, on a pair made afresh.
            const again = await mkPhoto(booking, { days: 450, kind: 'admin' });
            const stray = await mkFile(30);
            const query = await call(`?secret=${SECRET}`);
            expect(query.status, 'the secret as ?secret=: status').toBe(200);
            const queryBody = await query.json();
            expect(queryBody.success, 'the secret as ?secret=: success').toBe(true);
            expect(queryBody.data.orphan_files, 'the file with no row went').toBe(1);
            expect(await rowIds(booking), 'the old row went').toEqual([]);
            expect(await filesNow(), 'and so did both files').toEqual([]);
            expect([again.url, stray].every((url) => !fs.existsSync(fileOf(url))), 'the two files are not on the disk').toBe(true);

            // A failure: 500, the one message, and the log line holds the error code and nothing the driver said (its message holds a fixture number
            // and a photo address).
            const driverSaid = `Duplicate entry for ${CUSTOMER_PHONE} in job_photos at ${again.url}`;
            globals.__eng016PhotoExecute = async () => {
                throw Object.assign(new Error(driverSaid), { code: 'ER_E2E_FIXTURE' });
            };
            const { result: failed, lines } = await logsOf(() => call('', { authorization: `Bearer ${SECRET}` }));
            expect(failed.status, 'a failing run: status').toBe(500);
            expect(await failed.json(), 'a failing run: body').toEqual({ success: false, message: 'Failed to trim the job photos' });
            expect(lines, 'a failing run logs the error code and nothing else').toEqual([['error', 'Error trimming the job photos: ER_E2E_FIXTURE']]);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
            if (saved.pool === undefined) delete globals.mysqlPool;
            else globals.mysqlPool = saved.pool;
            if (saved.jwt === undefined) delete process.env.JWT_SECRET;
            else process.env.JWT_SECRET = saved.jwt;
            if (saved.cron === undefined) delete process.env.CRON_SECRET;
            else process.env.CRON_SECRET = saved.cron;
            if (saved.execute === undefined) delete globals.__eng016PhotoExecute;
            else globals.__eng016PhotoExecute = saved.execute;
            if (saved.run === undefined) delete globals.__eng016PhotoRun;
            else globals.__eng016PhotoRun = saved.run;
        }
    });
});

// ================================================================================================================================
// Last: everything the file logged
// ================================================================================================================================

test.describe('Job photo retention: everything logged', () => {
    // Mutant that turns this case red: the library or the route logs a count, a photo address, a number or the driver's own message. It is the last
    // case of the file: the spy has been listening since before the first.
    test('Retention: no fixture address, e-mail, number or secret appears in anything the file logged, and every line is the one fixed line of the route', () => {
        const texts = captured.map((entry) => entry.text);
        // The spy listened: the line the route's failing case made on purpose is there.
        expect(texts.includes('Error trimming the job photos: ER_E2E_FIXTURE'), "the failure line of the route's earlier case is in the capture").toBe(true);

        const everything = texts.join('\n');
        for (const [kind, values] of Object.entries(secrets)) {
            let index = 0;
            for (const value of values) {
                index += 1;
                // Only the kind and the position are in the message: a value that did get logged must not be copied into a report.
                expect(everything.includes(value), `a fixture ${kind.replace(/es$|s$/, '')} (${index} of ${values.size}) appears in the logged text`).toBe(false);
            }
        }
        expect(secrets.addresses.size >= 20 && secrets.emails.size >= 1 && secrets.credentials.size >= 1, 'the check had addresses, e-mails and a secret to look for').toBe(true);

        const outside = texts.filter((text) => !/^Error trimming the job photos: [A-Za-z0-9_]+$/.test(text));
        expect(outside.length, 'lines outside the one fixed line (a count only: such a line may hold what it should not)').toBe(0);
    });
});
