// @ts-check
// ENG-017, the source pins of the design's "Pins" row (agents/architect/designs/ENG-017-on-site-reports-and-added-item-approval.md) and the named values a
// library exports, each asserted at its value. No app, no database, no browser: a case reads files of the repo, or imports a library that loads in
// plain Node, and says which file and which text it found. Each title starts with "Pins:", and the file's name, the describe and the title together are
// its baseline key:
//   Tables   job_reports is named, outside comments, under src/ in no file but src/lib/job-reports.js, src/lib/report-desk.js and
//            src/lib/job-photo-retention.js.
//   Disk     no new file imports node:fs (the store owns the disk).
//   SQL      no new file calls query( (prepared execute only); the SELECTs of src/lib/job-reports.js, which feed the link, hold no customer, user, price,
//            amount, commission, payment, stripe or booking_number word.
//   Money    src/lib/booking-payment.js imports nothing; src/lib/job-reports.js imports neither it nor src/lib/report-desk.js; collectAddedItems is
//            imported by src/lib/report-desk.js and by no other file under src/.
//   Gate     every handler of the two admin report routes calls requireCaller(request, ['admin']) as its first statement.
//   Self     the report route calls findJobLink( before resolveAccess( and before any body reader.
//   Sent     the three routes, src/lib/job-reports.js, src/lib/report-desk.js and src/lib/booking-payment.js name none of sendEmail, sendSMS,
//            sendPushNotification and notifyUser and import none of src/lib/email.js, sms.js and push.js; the names are real ones (other files of src/ name them).
//   Log      every console call in the new files is a fixed string, or a fixed string and error?.code || error?.name, with the caught value named error.
//   Named    REPORT_NOTE_MAX, REPORTS_MAX_PER_BOOKING, DECISION_NOTE_MAX, CHARGEABLE_STATUSES and REPORT_LIST_LIMIT are at their values; the five report
//            types are the same five in the library, the migration, database/schema.js and the event details of src/lib/job-link-base.js.
//   Schema   the 0010 migration pair exists and database/schema.js carries the same columns and keys as the migration.
// "A new file" is NEW_FILES below, written out: the files ENG-017 adds under src/. The list is not widened from git (see e2e/job-timer-pins.spec.js). The
// files are read with their comments blanked, and each case that depends on that reading checks that what it looked for is really there, so a reading
// that finds nothing fails and does not pass.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { EVENT_DETAILS } from '../src/lib/job-link-base.js';
import { REPORT_NOTE_MAX, REPORT_TYPES, REPORTS_MAX_PER_BOOKING } from '../src/lib/job-reports.js';
import { CHARGEABLE_STATUSES, DECISION_NOTE_MAX, REPORT_LIST_LIMIT } from '../src/lib/report-desk.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const NEW_FILES = [
    'src/lib/job-reports.js',
    'src/lib/report-desk.js',
    'src/app/api/job/[token]/reports/route.js',
    'src/app/api/admin/reports/route.js',
    'src/app/api/admin/reports/[id]/route.js',
];
const ADMIN_ROUTES = ['src/app/api/admin/reports/route.js', 'src/app/api/admin/reports/[id]/route.js'];
const SELF_ROUTE = 'src/app/api/job/[token]/reports/route.js';

const textOf = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

// The text with block comments and whole-line and trailing line comments blanked. A `//` inside a string is kept (a URL, a path) because a line comment
// is taken only where a space or the start of the line comes before it.
function codeOf(file) {
    return textOf(file)
        .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
        .split('\n')
        .map((line) => line.replace(/(^|\s)\/\/.*$/, '$1'))
        .join('\n');
}

function sourceFiles(dir) {
    const found = [];
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const relative = `${dir}/${entry.name}`;
        if (entry.isDirectory()) found.push(...sourceFiles(relative));
        else if (/\.(js|jsx)$/.test(entry.name)) found.push(relative);
    }
    return found;
}

function newFiles() {
    const missing = NEW_FILES.filter((file) => !fs.existsSync(path.join(ROOT, file)));
    expect(missing, 'files ENG-017 adds (NEW_FILES at the head of e2e/job-reports-pins.spec.js) that are not in the tree').toEqual([]);
    return NEW_FILES;
}

test.describe('Pins: where job_reports, the disk and the SQL words may appear', () => {
    test('Pins: job_reports is named under src/ only by the library, the desk and the retention sweep', () => {
        const owners = ['src/lib/job-reports.js', 'src/lib/report-desk.js', 'src/lib/job-photo-retention.js'];
        const naming = sourceFiles('src').filter((file) => /\bjob_reports\b/.test(codeOf(file)));
        expect(naming.sort(), 'the files that name job_reports outside comments').toEqual([...owners].sort());
    });

    test('Pins: no new file imports node:fs', () => {
        const files = newFiles();
        const importing = files.filter((file) => /from\s+['"](node:)?fs(\/promises)?['"]|require\(\s*['"](node:)?fs(\/promises)?['"]\s*\)/.test(codeOf(file)));
        expect(importing, 'new files that import fs').toEqual([]);
        expect(/from\s+['"]\.\/job-photo-store\.js['"]/.test(codeOf('src/lib/job-reports.js')), 'the library reaches the disk through the store').toBe(true);
    });

    test('Pins: no new file calls query( and the SELECTs of the library hold no money word', () => {
        for (const file of newFiles()) expect(/\bquery\(/.test(codeOf(file)), `${file} calls query(`).toBe(false);
        const code = codeOf('src/lib/job-reports.js');
        const selects = [...code.matchAll(/(['"`])((?:(?!\1)[^\\]|\\.)*?\bSELECT\b(?:(?!\1)[^\\]|\\.)*?)\1/g)].map((match) => match[2]);
        const columns = /const REPORT_COLUMNS = '([^']*)'/.exec(code)?.[1];
        expect(selects.length, 'the library has SELECT statements and the reading found them').toBeGreaterThan(0);
        expect(typeof columns, 'the library names the columns it reads from a report row').toBe('string');
        for (const text of [...selects, String(columns)]) {
            expect(text, 'a SELECT that feeds the link names no customer, user, price, amount, commission, payment, stripe or booking_number').not.toMatch(/customer_|user_id|price|amount|commission|payment|stripe|booking_number/i);
        }
    });
});

test.describe('Pins: the money path', () => {
    test('Pins: booking-payment.js imports nothing, and the library imports neither it nor the desk', () => {
        expect(/^\s*import\b/m.test(codeOf('src/lib/booking-payment.js')), 'src/lib/booking-payment.js has an import').toBe(false);
        const imports = [...codeOf('src/lib/job-reports.js').matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
        expect(imports.length, 'the library has imports and the reading found them').toBeGreaterThan(0);
        expect(imports.filter((name) => /booking-payment|report-desk/.test(name)), 'imports of the library that reach the money path').toEqual([]);
    });

    test('Pins: collectAddedItems is imported by the desk and by no other file under src/', () => {
        const importing = sourceFiles('src').filter((file) => /import\s*\{[^}]*\bcollectAddedItems\b[^}]*\}\s*from/.test(codeOf(file)));
        expect(importing).toEqual(['src/lib/report-desk.js']);
        expect(/\bcollectAddedItems\s*\(/.test(codeOf('src/lib/report-desk.js')), 'the desk calls it').toBe(true);
    });
});

test.describe('Pins: nothing is sent', () => {
    // The senders of src/: sendEmail (src/lib/email.js), sendSMS (src/lib/sms.js), sendPushNotification and notifyUser (src/lib/push.js).
    const SENDERS = ['sendEmail', 'sendSMS', 'sendPushNotification', 'notifyUser'];
    const SENDER_MODULES = /from\s+['"][^'"]*\/(?:email|sms|push)(?:\.js)?['"]/;

    test('Pins: the three routes, the library, the desk and the money library name no e-mail, SMS or push sender and import none of their modules', () => {
        const checked = [...newFiles(), 'src/lib/booking-payment.js'];
        for (const file of checked) {
            const code = codeOf(file);
            for (const sender of SENDERS) expect(new RegExp(`\\b${sender}\\b`).test(code), `${file} names ${sender}`).toBe(false);
            expect(SENDER_MODULES.test(code), `${file} imports src/lib/email.js, sms.js or push.js`).toBe(false);
        }
    });

    test('Pins: the sender names are real ones, each named by files of src/ outside the files checked', () => {
        const checked = new Set([...NEW_FILES, 'src/lib/booking-payment.js']);
        const others = sourceFiles('src').filter((file) => !checked.has(file));
        for (const sender of SENDERS) {
            const naming = others.filter((file) => new RegExp(`\\b${sender}\\b`).test(codeOf(file)));
            expect(naming.length, `files outside the checked ones that name ${sender} (a renamed sender would leave the pin above reading nothing)`).toBeGreaterThan(0);
        }
        expect(others.some((file) => SENDER_MODULES.test(codeOf(file))), 'files outside the checked ones that import a sender module').toBe(true);
    });
});

test.describe('Pins: the routes', () => {
    test('Pins: every handler of the admin report routes calls requireCaller(request, [\'admin\']) first', () => {
        let handlers = 0;
        for (const file of ADMIN_ROUTES) {
            const code = codeOf(file);
            const declared = [...code.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].length;
            const gated = [...code.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\([^)]*\)\s*\{\s*const auth = await requireCaller\(request, \['admin'\]\)\s*if \(!auth\.ok\) return auth\.response/g)].length;
            expect(declared, `${file} has handlers and the reading found them`).toBeGreaterThan(0);
            expect(gated, `${file}: handlers that start with the admin gate`).toBe(declared);
            handlers += declared;
        }
        expect(handlers, 'the queue GET and the report GET and POST').toBe(3);
    });

    test('Pins: the report route calls findJobLink( before resolveAccess( and before any body reader', () => {
        const code = codeOf(SELF_ROUTE);
        const find = code.indexOf('findJobLink(');
        const access = code.indexOf('resolveAccess(');
        const readers = ['readCappedBody(', '.formData(', 'request.json(', 'request.text(', 'request.arrayBuffer(', 'request.body'].map((reader) => ({ reader, at: code.indexOf(reader) })).filter((one) => one.at !== -1);
        expect(find, 'the route looks the link up').toBeGreaterThan(-1);
        expect(find, 'before the access is resolved').toBeLessThan(access);
        expect(readers.some((one) => one.reader === 'readCappedBody('), 'the route reads the body, and the reading found it').toBe(true);
        for (const one of readers) expect(find, `findJobLink( comes before ${one.reader}`).toBeLessThan(one.at);
    });

    test('Pins: every console call in the new files is a fixed string, or a fixed string and error?.code || error?.name', () => {
        let calls = 0;
        for (const file of newFiles()) {
            for (const match of codeOf(file).matchAll(/console\.(?:error|warn|log|info)\(((?:[^()]|\([^()]*\))*)\)/g)) {
                calls += 1;
                expect(match[1].trim(), `${file}: ${match[0].slice(0, 80)}`).toMatch(/^'[^'`$\\]*'(?:, error\?\.code \|\| error\?\.name)?$/);
            }
        }
        expect(calls, 'the new files log and the reading found it').toBeGreaterThanOrEqual(5);
    });
});

test.describe('Pins: the named values', () => {
    test('Pins: the limits and the chargeable statuses are at their values', () => {
        expect(REPORT_NOTE_MAX).toBe(1000);
        expect(REPORTS_MAX_PER_BOOKING).toBe(20);
        expect(DECISION_NOTE_MAX).toBe(500);
        expect([...CHARGEABLE_STATUSES]).toEqual(['confirmed', 'in_progress', 'awaiting_approval', 'completed']);
        expect(REPORT_LIST_LIMIT).toEqual({ page: 20, max: 50 });
    });

    test('Pins: the five report types are the same five in the library, the migration, schema.js and the event details', () => {
        const five = ['no_answer', 'details_wrong', 'unhygienic', 'add_items', 'cannot_complete'];
        expect(REPORT_TYPES.map((type) => type.code), 'the library').toEqual(five);
        expect(REPORT_TYPES.map((type) => type.label), 'the labels the ticket names').toEqual(['Customer did not answer', 'Job details are incorrect', 'Unhygienic conditions', 'Add more items', 'Unable to complete the job']);
        const enumOf = (text) => /report_type\s+ENUM\(([^)]*)\)/.exec(text)?.[1].split(',').map((one) => one.trim().replace(/'/g, ''));
        expect(enumOf(textOf('database/migrations/0010-job-reports.up.sql')), 'the migration').toEqual(five);
        expect(enumOf(textOf('database/schema.js')), 'database/schema.js').toEqual(five);
        for (const type of five) expect([...EVENT_DETAILS], `EVENT_DETAILS names ${type}`).toContain(type);
    });
});

test.describe('Pins: the 0010 migration', () => {
    test('Pins: the pair exists and database/schema.js carries the migration\'s columns and keys', () => {
        const up = textOf('database/migrations/0010-job-reports.up.sql');
        expect(/DROP TABLE (IF EXISTS )?job_reports/i.test(textOf('database/migrations/0010-job-reports.down.sql')), 'the down migration drops the table').toBe(true);
        // The lines of the CREATE TABLE body that are a column or a key: the same in the migration and in schema.js, whitespace aside.
        const bodyOf = (text) => {
            const start = text.search(/CREATE TABLE (IF NOT EXISTS )?job_reports\s*\(/);
            expect(start, 'the CREATE TABLE is there').toBeGreaterThan(-1);
            const lines = text.slice(start).split('\n').slice(1);
            const end = lines.findIndex((line) => /^\s*\)/.test(line));
            return lines.slice(0, end).map((line) => line.replace(/--.*$/, '').replace(/\s+/g, ' ').trim().replace(/,$/, '')).filter(Boolean);
        };
        const fromMigration = bodyOf(up);
        const fromSchema = bodyOf(textOf('database/schema.js'));
        expect(fromMigration.length, 'the migration has columns and the reading found them').toBeGreaterThan(20);
        expect(fromSchema).toEqual(fromMigration);
    });
});
