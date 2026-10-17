// e2e/notices-send.spec.js
//
// ENG-018, step 4: the one send path (src/lib/notices.js) against the dev database and a RECORDING transport. sendNotice is given the two
// transports as `deps`, so nothing here reaches Twilio or SMTP and nothing is sent; what is proved is the recipient, the channel, the words the
// transport would receive, and the row that records the attempt. A receipt for this file says "verified by what the code attempts", never
// "delivered".
//
// The database is the dev database the way e2e/notices-library.spec.js reaches it (mysql2/promise, assertDevTarget before it connects,
// assertNoRealPeople on it). Every row this file makes has a booking_id in BOOKING..BOOKING+999 or a recipient_ref in REF..REF+999, and every
// number is in +1403555 0430-0449, so the sweep before and after each case removes exactly its own rows and spent budget and no one else's.
// Cases run in the order of the file, one worker; the last one asks what the others between them produced.
import { createHash } from 'node:crypto';
import { format } from 'node:util';
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';
import { sendNotice, noticeKey, appOrigin, afterCommit, pruneNotices, NOTICE_KEEP_DAYS, PENDING_STALE_MINUTES, NOTICE_OUTCOMES } from '../src/lib/notices.js';
import { templateFor } from '../src/lib/notice-templates.js';
import { budgetScope, TEXTS_PER_NUMBER_DAY, TEXTS_PER_PROVIDER_DAY, TEXTS_PER_PLATFORM_DAY } from '../src/lib/sms-budget.js';

test.use({ trace: 'off' });

const RUN = Date.now().toString(36);
const BOOKING = 870_000_000;
const REF = 2_000_000_000;
const PROVIDER = 2_100_000_500;
const ORIGIN = 'https://app.example.test';
const TOKEN = 'Q'.repeat(43);
const numberAt = (i) => `+1403555${String(430 + (i % 20)).padStart(4, '0')}`;
const typedAt = (i) => numberAt(i).replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3');
const mailAt = (i) => `notice-${RUN}-${i}@notices.test`;
// The quote notices of the budget cases: one address for each, so the kind's text cap is what refuses the third text and an e-mail is never refused for it,
// and one address that three quote forms name, for the e-mail's own cap.
const QUOTE_ADDRESSES = [0, 1, 2].map((index) => mailAt(`17-${index}`));
const CAPPED_ADDRESS = mailAt('capped');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha = (text) => createHash('sha256').update(text).digest('hex');

// ---- the console spy: installed before the first case, restored after the last ----

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

test.afterAll(async () => {
    if (spying) {
        spying = false;
        for (const method of SPIED) /** @type {any} */ (console)[method] = realConsole[method];
    }
    if (connection) {
        await connection.end();
        connection = null;
    }
});

/** Runs `work` and returns its result with what it logged, as [method, text] pairs. */
async function logsOf(work) {
    const before = captured.length;
    const result = await work();
    return { result, lines: captured.slice(before).map((entry) => [entry.method, entry.text]) };
}

// ---- the dev database ----

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

const PLATFORM = budgetScope('platform', 'day');
const warnedScopes = () => [0, -86_400_000, 86_400_000].map((shift) => budgetScope('platform-warned', new Date(Date.now() + shift).toISOString().slice(0, 10)));

async function sweep() {
    const open = await db();
    await open.execute('DELETE FROM notice_attempts WHERE (booking_id BETWEEN ? AND ?) OR (recipient_ref BETWEEN ? AND ?)', [BOOKING, BOOKING + 999, REF, REF + 999]);
    const scopes = [PLATFORM, ...warnedScopes()];
    for (let i = 0; i < 20; i += 1) scopes.push(budgetScope('number', numberAt(i)), budgetScope('kind', 'quote_requested', numberAt(i)));
    for (let i = 0; i < 5; i += 1) scopes.push(budgetScope('provider', PROVIDER + i));
    for (const nobody of [null, undefined]) scopes.push(budgetScope('provider', nobody));
    // ENG-018 security B1: a quote notice also spends the kind's day for the platform, and its e-mail the address's day and the kind's day for the platform.
    scopes.push(budgetScope('kind-platform', 'quote_requested'), budgetScope('mail-kind', 'quote_requested'));
    for (const address of [...QUOTE_ADDRESSES, CAPPED_ADDRESS]) scopes.push(budgetScope('mail', 'quote_requested', address.toLowerCase()));
    for (const scope of scopes) await open.execute('DELETE FROM sms_budget WHERE scope = ?', [scope]);
}

async function usedOf(scope) {
    const found = await execute('SELECT used FROM sms_budget WHERE scope = ?', [scope]);
    return found.length === 0 ? null : Number(found[0].used);
}

async function setUsed(scope, used) {
    await execute('INSERT INTO sms_budget (scope, window_started_at, used) VALUES (?, NOW(), ?) ON DUPLICATE KEY UPDATE used = ?, window_started_at = NOW()', [scope, used, used]);
}

/** Every outcome any case below found in a row, for the last case to compare with the vocabulary. */
const seen = new Set();
// A failed case restarts the worker, and `seen` starts again empty; the last case says so and skips, instead of failing a second time for it.
let ranFirst = false;

async function rowsOf(column, value) {
    const rows = await execute(
        `SELECT id, event_key, kind, channel, recipient_kind, recipient_ref, booking_id, outcome, settled_at FROM notice_attempts WHERE ${column} = ? ORDER BY id`,
        [value]
    );
    for (const row of rows) seen.add(row.outcome);
    return rows;
}

const byBooking = (request) => rowsOf('booking_id', request.bookingId);
const shape = (rows) => rows.map((row) => [row.channel, row.outcome, row.event_key === null ? 'no key' : 'key']);

// ---- a recording transport and a request ----

/** The transports as `deps`: they answer what they are told to and record what they were given. `origin` null is an unusable origin. */
function recorder({ sms, mail, origin = ORIGIN } = {}) {
    const calls = { sms: [], mail: [] };
    const answer = (what, fallback, ...args) => (typeof what === 'function' ? what(...args) : (what ?? fallback));
    return {
        calls,
        deps: {
            sendSMS: async (to, body) => {
                calls.sms.push({ to, body });
                return answer(sms, { ok: true, reason: 'sent' }, to, body);
            },
            sendMail: async (message) => {
                calls.mail.push(message);
                return answer(mail, { success: true, messageId: 'recorded' }, message);
            },
            appOrigin: () => origin,
        },
    };
}

/** A job_booked notice to a customer who has a typed number and an address; case `i` has its own booking, number and address. */
function request(i, overrides = {}) {
    return {
        kind: 'job_booked',
        subject: [BOOKING + i],
        bookingId: BOOKING + i,
        to: { kind: 'customer', ref: null, phone: typedAt(i), email: mailAt(i), checked: false, active: false },
        channels: ['sms', 'email'],
        values: { n: `BK${BOOKING + i}`, name: 'Piiname Zed', service: 'Home cleaning' },
        spendFor: null,
        ...overrides,
    };
}

const keyOf = (r, channel) => noticeKey({ kind: r.kind, subject: r.subject, recipientKind: r.to.kind, recipientRef: r.to.ref ?? null, channel });

test.describe('Notices send path', () => {
    test.beforeAll(sweep);
    test.beforeEach(sweep);
    test.afterEach(sweep);

    test('a notice to a customer goes out on both channels once: the text to the number in E.164 with the template\'s words, the e-mail as plain text, and a settled row for each that holds the key', async () => {
        ranFirst = true;
        const r = request(1);
        const { calls, deps } = recorder();
        expect(await sendNotice(execute, r, deps)).toEqual({ sms: 'sent', email: 'sent' });
        const words = templateFor('job_booked', r.values);
        expect(calls.sms, 'the number was typed as (403) 555-0431').toEqual([{ to: numberAt(1), body: words.sms }]);
        expect(calls.mail).toEqual([{ to: mailAt(1), subject: words.subject, text: words.text }]);
        expect(Object.keys(calls.mail[0]).sort(), 'plain text: there is no html key').toEqual(['subject', 'text', 'to']);
        const rows = await byBooking(r);
        expect(rows.map((row) => [row.channel, row.outcome, row.event_key, row.recipient_kind, row.recipient_ref, row.kind])).toEqual([
            ['sms', 'sent', keyOf(r, 'sms'), 'customer', null, 'job_booked'],
            ['email', 'sent', keyOf(r, 'email'), 'customer', null, 'job_booked'],
        ]);
        for (const row of rows) expect(row.settled_at, `${row.channel} is settled`).not.toBeNull();
    });

    test('the same notice again sends nothing: a duplicate on both channels, no call and no new row', async () => {
        const r = request(2);
        const first = recorder();
        await sendNotice(execute, r, first.deps);
        const second = recorder();
        expect(await sendNotice(execute, r, second.deps)).toEqual({ sms: 'duplicate', email: 'duplicate' });
        expect([second.calls.sms.length, second.calls.mail.length]).toEqual([0, 0]);
        expect((await byBooking(r)).length).toBe(2);
        expect(await usedOf(budgetScope('number', numberAt(2))), 'the repeat did not spend the number\'s day').toBe(1);
    });

    test('two identical notices at once make one call on each channel: the loser is a duplicate and spends nothing from the budget', async () => {
        const r = request(3);
        const slow = recorder({
            sms: async () => { await sleep(80); return { ok: true, reason: 'sent' }; },
            mail: async () => { await sleep(80); return { success: true, messageId: 'recorded' }; },
        });
        const answers = await Promise.all([sendNotice(execute, r, slow.deps), sendNotice(execute, r, slow.deps)]);
        expect(answers.map((answer) => answer.sms).sort()).toEqual(['duplicate', 'sent']);
        expect(answers.map((answer) => answer.email).sort()).toEqual(['duplicate', 'sent']);
        expect([slow.calls.sms.length, slow.calls.mail.length], 'one call on each channel').toEqual([1, 1]);
        expect((await byBooking(r)).length).toBe(2);
        expect(await usedOf(budgetScope('number', numberAt(3)))).toBe(1);
    });

    const TEXT_REFUSALS = [
        ['no_contact', 'no number', { phone: null }],
        ['no_contact', 'a blank number', { phone: '   ' }],
        ['bad_contact', 'words', { phone: 'call me' }],
        ['bad_contact', 'too few digits', { phone: '12345' }],
        ['cannot_text', 'a number outside Canada', { phone: '+442079460958' }],
        ['cannot_text', 'a United States number', { phone: '+12125550123' }],
        ['unchecked', 'a cleaner whose number is not checked', { kind: 'cleaner', ref: REF + 1, checked: false }],
        ['unchecked', 'a cleaner with no check recorded', { kind: 'cleaner', ref: REF + 1 }],
        ['unchecked', 'a cleaner whose "checked" is not the boolean true', { kind: 'cleaner', ref: REF + 1, checked: 'yes' }],
        ['not_active', 'a provider whose status is not active', { kind: 'provider', ref: REF + 2, active: false }],
        ['not_active', 'a provider with no status read', { kind: 'provider', ref: REF + 2 }],
        ['not_active', 'a provider whose "active" is not the boolean true', { kind: 'provider', ref: REF + 2, active: 1 }],
    ];

    test('a text that cannot go is refused with its own outcome and a row with no key, and makes no call and spends nothing: no_contact, bad_contact, cannot_text, unchecked and not_active', async () => {
        for (const [outcome, why, to] of TEXT_REFUSALS) {
            const r = request(4, { channels: ['sms'], to: { ...request(4).to, ...to } });
            const { calls, deps } = recorder();
            expect(await sendNotice(execute, r, deps), `${outcome}: ${why}`).toEqual({ sms: outcome, email: null });
            expect(calls.sms, `${outcome}: ${why}: no call`).toEqual([]);
            const rows = await byBooking(r);
            expect(shape(rows), `${outcome}: ${why}: one row, no key`).toEqual([['sms', outcome, 'no key']]);
            expect(rows[0].settled_at, `${outcome}: ${why}: settled`).not.toBeNull();
            expect(await usedOf(budgetScope('number', numberAt(4))), `${outcome}: ${why}: nothing spent`).toBeNull();
            await sweep();
        }
    });

    const MAIL_REFUSALS = [
        ['no_contact', 'no address', { email: null }],
        ['no_contact', 'a blank address', { email: '  ' }],
        ['bad_contact', 'two addresses', { email: 'a@b.test, c@d.test' }],
        ['bad_contact', 'a display name', { email: 'Sam <sam@x.test>' }],
        ['bad_contact', 'no dot in the domain', { email: 'sam@x' }],
        ['bad_contact', 'a line break and a second header', { email: 'sam@x.test\r\nBcc: v@x.test' }],
        ['bad_contact', 'a quoted local part', { email: '"sam"@x.test' }],
        ['bad_contact', 'longer than an address can be', { email: `${'a'.repeat(250)}@x.test` }],
        ['not_active', 'a provider whose status is not active', { kind: 'provider', ref: REF + 2, active: false }],
    ];

    test('an e-mail that cannot go is refused the same way: one address and nothing else, and a provider who is not active is told nothing by e-mail either', async () => {
        for (const [outcome, why, to] of MAIL_REFUSALS) {
            const r = request(5, { channels: ['email'], to: { ...request(5).to, ...to } });
            const { calls, deps } = recorder();
            expect(await sendNotice(execute, r, deps), `${outcome}: ${why}`).toEqual({ sms: null, email: outcome });
            expect(calls.mail, `${outcome}: ${why}: no call`).toEqual([]);
            expect(shape(await byBooking(r)), `${outcome}: ${why}: one row, no key`).toEqual([['email', outcome, 'no key']]);
            await sweep();
        }
    });

    test('a cured cause then sends and holds the key: a cleaner whose number was not checked is refused with no key, and the same notice after the check goes', async () => {
        const base = request(6, { kind: 'job_link', channels: ['sms'], path: `/job/${TOKEN}`, subject: [BOOKING + 6, 1, REF + 6, 1], values: { n: `BK${BOOKING + 6}` } });
        const cleaner = (checked) => ({ ...base, to: { kind: 'cleaner', ref: REF + 6, phone: typedAt(6), email: null, checked } });
        const { calls, deps } = recorder();
        expect(await sendNotice(execute, cleaner(false), deps)).toEqual({ sms: 'unchecked', email: null });
        expect(calls.sms.length).toBe(0);
        expect(await sendNotice(execute, cleaner(true), deps)).toEqual({ sms: 'sent', email: null });
        expect(calls.sms.length).toBe(1);
        const rows = await byBooking(base);
        expect(rows.map((row) => [row.outcome, row.event_key])).toEqual([['unchecked', null], ['sent', noticeKey({ kind: 'job_link', subject: base.subject, recipientKind: 'cleaner', recipientRef: REF + 6, channel: 'sms' })]]);
        expect(await sendNotice(execute, cleaner(true), deps), 'and once it has gone it does not go again').toEqual({ sms: 'duplicate', email: null });
    });

    test('not_configured lets go of the key and the notice is tried again; the text and the e-mail alike', async () => {
        const r = request(7);
        const down = recorder({ sms: { ok: false, reason: 'not_configured' }, mail: { success: false, error: 'Email configuration missing' } });
        expect(await sendNotice(execute, r, down.deps)).toEqual({ sms: 'not_configured', email: 'not_configured' });
        expect(shape(await byBooking(r))).toEqual([['sms', 'not_configured', 'no key'], ['email', 'not_configured', 'no key']]);
        const up = recorder();
        expect(await sendNotice(execute, r, up.deps), 'a credential was set').toEqual({ sms: 'sent', email: 'sent' });
        expect([up.calls.sms.length, up.calls.mail.length]).toEqual([1, 1]);
        expect(shape(await byBooking(r))).toEqual([['sms', 'not_configured', 'no key'], ['email', 'not_configured', 'no key'], ['sms', 'sent', 'key'], ['email', 'sent', 'key']]);
    });

    const KEPT = [
        ['rejected', { ok: false, reason: 'rejected' }, { success: false, error: 'Invalid login: 535 5.7.8' }, 'unsure'],
        ['unsure', { ok: false, reason: 'unsure' }, { success: false, error: 'connect ETIMEDOUT' }, 'unsure'],
        ['sent', { ok: true, reason: 'sent' }, { success: true, messageId: 'recorded' }, 'sent'],
    ];

    test('rejected, unsure and sent keep the key, so a carrier error or a timeout is never answered with a second text; a mail failure that is not the missing configuration is unsure', async () => {
        for (const [index, [outcome, smsAnswer, mailAnswer, mailOutcome]] of KEPT.entries()) {
            const r = request(8 + index);
            const first = recorder({ sms: smsAnswer, mail: mailAnswer });
            expect(await sendNotice(execute, r, first.deps), outcome).toEqual({ sms: outcome, email: mailOutcome });
            expect(shape(await byBooking(r)), outcome).toEqual([['sms', outcome, 'key'], ['email', mailOutcome, 'key']]);
            const again = recorder();
            expect(await sendNotice(execute, r, again.deps), `${outcome}: again`).toEqual({ sms: 'duplicate', email: 'duplicate' });
            expect([again.calls.sms.length, again.calls.mail.length], `${outcome}: again makes no call`).toEqual([0, 0]);
        }
    });

    // What the transport itself says of a number that the library's own checks let through (src/lib/sms.js: bad_number, destination_not_allowed): the same two outcomes
    // as the library's own refusals before the call, and, as with a carrier's error, the key is kept, so the same notice is never put to the carrier twice.
    const REFUSED_BY_THE_TRANSPORT = [
        ['bad_contact', { ok: false, reason: 'bad_number' }],
        ['cannot_text', { ok: false, reason: 'destination_not_allowed' }],
    ];

    test('a number the transport itself refuses is bad_contact (bad_number) or cannot_text (destination_not_allowed), and keeps the key', async () => {
        for (const [index, [outcome, smsAnswer]] of REFUSED_BY_THE_TRANSPORT.entries()) {
            const r = request(8 + index);
            const first = recorder({ sms: smsAnswer });
            expect(await sendNotice(execute, r, first.deps), outcome).toEqual({ sms: outcome, email: 'sent' });
            expect(shape(await byBooking(r)), outcome).toEqual([['sms', outcome, 'key'], ['email', 'sent', 'key']]);
            const again = recorder();
            expect(await sendNotice(execute, r, again.deps), `${outcome}: again`).toEqual({ sms: 'duplicate', email: 'duplicate' });
            expect([again.calls.sms.length, again.calls.mail.length], `${outcome}: again makes no call`).toEqual([0, 0]);
        }
    });

    test('the channels do not depend on each other: a text refused for its number leaves the e-mail to go, and a missing address leaves the text to go', async () => {
        const far = request(11, { to: { ...request(11).to, phone: '+442079460958' } });
        const farCalls = recorder();
        expect(await sendNotice(execute, far, farCalls.deps)).toEqual({ sms: 'cannot_text', email: 'sent' });
        expect([farCalls.calls.sms.length, farCalls.calls.mail.length]).toEqual([0, 1]);
        const bare = request(12, { to: { ...request(12).to, email: null } });
        const bareCalls = recorder();
        expect(await sendNotice(execute, bare, bareCalls.deps)).toEqual({ sms: 'sent', email: 'no_contact' });
        expect([bareCalls.calls.sms.length, bareCalls.calls.mail.length]).toEqual([1, 0]);
    });

    test('a transport that throws is an error and not a throw: the row says error and keeps the key so a retry does not send twice, and the one line logged holds neither the number nor the address', async () => {
        const r = request(13);
        const throwing = recorder({
            sms: () => { throw Object.assign(new Error(`socket hang up to ${numberAt(13)} for Piiname`), { code: 'ECONNRESET' }); },
            mail: () => { throw new TypeError(`bad envelope ${mailAt(13)}`); },
        });
        const { result, lines } = await logsOf(() => sendNotice(execute, r, throwing.deps));
        expect(result).toEqual({ sms: 'error', email: 'error' });
        expect(lines).toEqual([['error', 'Notice error: ECONNRESET'], ['error', 'Notice error: TypeError']]);
        expect(shape(await byBooking(r))).toEqual([['sms', 'error', 'key'], ['email', 'error', 'key']]);
        const again = recorder();
        expect(await sendNotice(execute, r, again.deps)).toEqual({ sms: 'duplicate', email: 'duplicate' });
    });

    test('a transport that answers something it should not is an error too, and so is a template that refuses its values or has no e-mail', async () => {
        const odd = [undefined, true, {}, { ok: 'yes' }, { ok: false }];
        for (const [index, answer] of odd.entries()) {
            const r = request(14, { subject: [BOOKING + 140 + index], bookingId: BOOKING + 14, channels: ['sms'] });
            expect(await sendNotice(execute, r, recorder({ sms: () => answer }).deps), `a text answered ${JSON.stringify(answer)}`).toEqual({ sms: 'error', email: null });
        }
        const mails = [undefined, true, {}, { success: 'yes' }];
        for (const [index, answer] of mails.entries()) {
            const r = request(14, { subject: [BOOKING + 150 + index], bookingId: BOOKING + 14, channels: ['email'] });
            expect(await sendNotice(execute, r, recorder({ mail: () => answer }).deps), `an e-mail answered ${JSON.stringify(answer)}`).toEqual({ sms: null, email: 'error' });
        }
        await sweep();

        const bad = request(15, { values: { n: 'bad number!' } });
        const refused = recorder();
        const refusal = await logsOf(() => sendNotice(execute, bad, refused.deps));
        expect(refusal.result).toEqual({ sms: 'error', email: 'error' });
        expect(refusal.lines, 'logged once, with the code and not the value').toEqual([['error', 'Notice error: bad_notice_value']]);
        expect([refused.calls.sms.length, refused.calls.mail.length]).toEqual([0, 0]);
        expect(shape(await byBooking(bad))).toEqual([['sms', 'error', 'no key'], ['email', 'error', 'no key']]);

        const unknown = request(15, { kind: 'nope', subject: [BOOKING + 160] });
        expect(await sendNotice(execute, unknown, refused.deps), 'a kind with no template').toEqual({ sms: 'error', email: 'error' });

        const quiet = request(15, { kind: 'job_started', channels: ['email'], subject: [BOOKING + 170], values: { n: 'BK15', workers: 1, hours: 1, price: 10 } });
        const noMail = await logsOf(() => sendNotice(execute, quiet, refused.deps));
        expect(noMail.result, 'job_started has no e-mail, and asking for one is a wiring error and not a skip').toEqual({ sms: null, email: 'error' });
        expect(noMail.lines).toEqual([['error', 'Notice error: no_email_template']]);
        expect([refused.calls.sms.length, refused.calls.mail.length], 'and none of it called a transport').toEqual([0, 0]);
    });

    test('a request that makes no sense answers nothing, writes no row and logs one fixed line', async () => {
        const base = request(16);
        const NONSENSE = [
            ['bad_notice_request', undefined],
            ['bad_notice_request', null],
            ['bad_notice_request', { ...base, to: undefined }],
            ['bad_notice_request', { ...base, to: { ...base.to, kind: 'root' } }],
            ['bad_notice_request', { ...base, to: { ...base.to, ref: -4 } }],
            ['bad_notice_request', { ...base, channels: [] }],
            ['bad_notice_request', { ...base, channels: ['fax'] }],
            ['bad_notice_request', { ...base, channels: 'sms' }],
            ['bad_notice_request', { ...base, bookingId: '12' }],
            ['bad_notice_request', { ...base, spendFor: 0 }],
            ['bad_notice_key', { ...base, subject: [] }],
            ['bad_notice_key', { ...base, subject: ['a:b'] }],
            ['bad_notice_key', { ...base, kind: 'has space' }],
        ];
        for (const [code, bad] of NONSENSE) {
            const { calls, deps } = recorder();
            const { result, lines } = await logsOf(() => sendNotice(execute, bad, deps));
            expect(result, `${code} ${JSON.stringify(bad)?.slice(0, 60)}`).toEqual({ sms: null, email: null });
            expect(lines).toEqual([['error', `Notice error: ${code}`]]);
            expect([calls.sms.length, calls.mail.length]).toEqual([0, 0]);
        }
        expect(await byBooking(base), 'and no row').toEqual([]);
    });

    test('the budget refuses a text and not an e-mail: the kind\'s two a day for a quote request, then the number\'s, the provider\'s and the platform\'s day, each with its own outcome and a released key', async () => {
        const quote = (index) => ({
            kind: 'quote_requested', subject: [BOOKING + 200 + index], bookingId: null, spendFor: null, channels: ['sms', 'email'], values: {},
            to: { kind: 'customer', ref: REF + 20, phone: typedAt(17), email: QUOTE_ADDRESSES[index], checked: false, active: false },
        });
        const { calls, deps } = recorder();
        const answers = [];
        for (let index = 0; index < 3; index += 1) answers.push(await sendNotice(execute, quote(index), deps));
        expect(answers).toEqual([{ sms: 'sent', email: 'sent' }, { sms: 'sent', email: 'sent' }, { sms: 'kind_cap', email: 'sent' }]);
        expect([calls.sms.length, calls.mail.length], 'two texts and three e-mails').toEqual([2, 3]);
        const rows = await rowsOf('recipient_ref', REF + 20);
        expect(shape(rows)).toEqual([
            ['sms', 'sent', 'key'], ['email', 'sent', 'key'], ['sms', 'sent', 'key'], ['email', 'sent', 'key'], ['sms', 'kind_cap', 'no key'], ['email', 'sent', 'key'],
        ]);
        expect(await usedOf(budgetScope('number', numberAt(17))), 'the third did not spend the number\'s day').toBe(2);

        const capped = [
            ['number_cap', 18, () => setUsed(budgetScope('number', numberAt(18)), TEXTS_PER_NUMBER_DAY), null],
            ['provider_cap', 19, () => setUsed(budgetScope('provider', PROVIDER + 1), TEXTS_PER_PROVIDER_DAY), PROVIDER + 1],
            ['platform_cap', 20, () => setUsed(PLATFORM, TEXTS_PER_PLATFORM_DAY), null],
        ];
        for (const [outcome, index, fill, spendFor] of capped) {
            const r = request(index, { spendFor });
            await fill();
            const refused = recorder();
            expect(await sendNotice(execute, r, refused.deps), outcome).toEqual({ sms: outcome, email: 'sent' });
            expect([refused.calls.sms.length, refused.calls.mail.length], `${outcome}: no text, an e-mail`).toEqual([0, 1]);
            expect(shape(await byBooking(r)), outcome).toEqual([['sms', outcome, 'no key'], ['email', 'sent', 'key']]);
            await sweep();
        }

        // The cap lifted, the same notice can be made again: the refusal let go of the key.
        const again = request(21);
        await setUsed(budgetScope('number', numberAt(21)), TEXTS_PER_NUMBER_DAY);
        await sendNotice(execute, again, recorder().deps);
        await setUsed(budgetScope('number', numberAt(21)), 0);
        const lifted = recorder();
        expect(await sendNotice(execute, again, lifted.deps)).toEqual({ sms: 'sent', email: 'duplicate' });
        expect(lifted.calls.sms.length).toBe(1);
    });

    test('an e-mail has a hard cap of its own: the third quote e-mail of a day to one address, in any case of letters, is mail_cap, never reaches the transport, and its row is settled with the key let go', async () => {
        // ENG-018 security B1: the platform e-mails any address a stranger types, so the address's day and the kind's day for the platform are taken before the
        // transport, through the same atomic counter the texts use. Each form here names a different number, so no text is refused.
        const quote = (index, address) => ({
            kind: 'quote_requested', subject: [BOOKING + 210 + index], bookingId: null, spendFor: null, channels: ['sms', 'email'], values: {},
            to: { kind: 'customer', ref: REF + 23, phone: typedAt(10 + index), email: address, checked: false, active: false },
        });
        const { calls, deps } = recorder();
        const answers = [];
        for (const [index, address] of [CAPPED_ADDRESS, CAPPED_ADDRESS, CAPPED_ADDRESS.toUpperCase()].entries()) answers.push(await sendNotice(execute, quote(index, address), deps));
        expect(answers).toEqual([{ sms: 'sent', email: 'sent' }, { sms: 'sent', email: 'sent' }, { sms: 'sent', email: 'mail_cap' }]);
        expect([calls.sms.length, calls.mail.length], 'three texts, two e-mails: the third never reached the transport').toEqual([3, 2]);
        expect(shape(await rowsOf('recipient_ref', REF + 23))).toEqual([
            ['sms', 'sent', 'key'], ['email', 'sent', 'key'], ['sms', 'sent', 'key'], ['email', 'sent', 'key'], ['sms', 'sent', 'key'], ['email', 'mail_cap', 'no key'],
        ]);
        expect(await usedOf(budgetScope('mail', 'quote_requested', CAPPED_ADDRESS.toLowerCase())), 'the refused third did not spend the address\'s day').toBe(2);
        expect(await usedOf(budgetScope('mail-kind', 'quote_requested')), 'nor the platform\'s mail day for the kind').toBe(2);
        expect(await usedOf(budgetScope('kind-platform', 'quote_requested')), 'the three texts spent the kind\'s day for the platform').toBe(3);
        // Another address has its own two, and a kind with no mail cap is not stopped by the quote kind's.
        const other = recorder();
        expect(await sendNotice(execute, quote(3, QUOTE_ADDRESSES[0]), other.deps), 'another address').toEqual({ sms: 'sent', email: 'sent' });
        const booked = request(31, { to: { kind: 'customer', ref: null, phone: typedAt(31), email: CAPPED_ADDRESS, checked: false, active: false } });
        expect(await sendNotice(execute, booked, other.deps), 'another kind to the capped address: the cap is the quote kind\'s').toEqual({ sms: 'sent', email: 'sent' });
    });

    test('a text is spent against the provider whose action caused it, and a text no provider caused takes no provider scope', async () => {
        const withProvider = request(22, { spendFor: PROVIDER + 2 });
        await sendNotice(execute, withProvider, recorder().deps);
        expect(await usedOf(budgetScope('provider', PROVIDER + 2))).toBe(1);
        expect(await usedOf(budgetScope('number', numberAt(22)))).toBe(1);

        await sendNotice(execute, request(23, { spendFor: null }), recorder().deps);
        await sendNotice(execute, request(24, { spendFor: undefined }), recorder().deps);
        for (const nobody of [null, undefined]) expect(await usedOf(budgetScope('provider', nobody)), `no scope for ${nobody}`).toBeNull();
    });

    test('a link is made from the origin and the path, whole, in the text and the e-mail, and the row does not hold it; a url the caller passes is ignored', async () => {
        const r = request(25, {
            kind: 'card_link', path: `/card/${TOKEN}`, values: { n: `BK${BOOKING + 25}`, price: 125, name: 'Piiname Zed', url: 'https://evil.test/steal' },
        });
        const { calls, deps } = recorder();
        expect(await sendNotice(execute, r, deps)).toEqual({ sms: 'sent', email: 'sent' });
        const link = `${ORIGIN}/card/${TOKEN}`;
        expect(calls.sms[0].body.endsWith(link), 'the text ends with the whole link').toBe(true);
        expect(calls.mail[0].text).toContain(link);
        expect(`${calls.sms[0].body}${calls.mail[0].text}`).not.toContain('evil.test');
        expect(JSON.stringify(await byBooking(r)), 'no token in the record').not.toContain(TOKEN);
    });

    test('with no usable origin a notice that cannot do without its link is refused as no_origin on both channels, and one that carries the link as a convenience goes without it', async () => {
        for (const [kind, to, values] of [
            ['card_link', request(26).to, { n: 'BK26', price: 10 }],
            ['job_link', { kind: 'cleaner', ref: REF + 26, phone: typedAt(26), email: mailAt(26), checked: true }, { n: 'BK26' }],
        ]) {
            const r = request(26, { kind, to, values, path: `/job/${TOKEN}`, channels: ['sms', 'email'], subject: [BOOKING + 26, 1] });
            const none = recorder({ origin: null });
            // job_link has no e-mail, and asking for one is a wiring error (below); the missing origin is read first, so it is no_origin on both.
            expect(await sendNotice(execute, r, none.deps), kind).toEqual({ sms: 'no_origin', email: 'no_origin' });
            expect([none.calls.sms.length, none.calls.mail.length], `${kind}: nothing called`).toEqual([0, 0]);
            expect(shape(await byBooking(r)), `${kind}: refused with no key, so the link can be made once an origin is set`).toEqual([['sms', 'no_origin', 'no key'], ['email', 'no_origin', 'no key']]);
            await sweep();
        }

        const assigned = request(27, { kind: 'job_assigned', to: { kind: 'provider', ref: PROVIDER + 3, phone: typedAt(27), email: mailAt(27), active: true }, path: '/provider/jobs', values: { n: 'BK27' } });
        const none = recorder({ origin: null });
        expect(await sendNotice(execute, assigned, none.deps)).toEqual({ sms: 'sent', email: 'sent' });
        expect(none.calls.mail[0].text, 'the e-mail went without its convenience link').not.toMatch(/provider\/jobs|null|undefined/);
    });

    test('no row and no log line holds a number, an address, a name, a body or a link, whatever the notice did: sent, refused, capped, thrown or not rendered', async () => {
        const secrets = [numberAt(28).slice(-7), mailAt(28), 'Piiname', 'WorkOnTap', ORIGIN, TOKEN, 'Home cleaning'];
        const r = request(28, { kind: 'card_link', path: `/card/${TOKEN}`, values: { n: `BK${BOOKING + 28}`, price: 125, name: 'Piiname Zed', service: 'Home cleaning' } });
        const { lines } = await logsOf(async () => {
            await sendNotice(execute, r, recorder().deps);
            await sendNotice(execute, { ...r, subject: [BOOKING + 280], to: { ...r.to, phone: '+442079460958' } }, recorder().deps);
            await sendNotice(execute, { ...r, subject: [BOOKING + 281] }, recorder({ origin: null }).deps);
            await sendNotice(execute, { ...r, subject: [BOOKING + 282], values: { ...r.values, n: 'bad number!' } }, recorder().deps);
            await sendNotice(execute, { ...r, subject: [BOOKING + 283] }, recorder({
                sms: () => { throw new Error(`failed for ${numberAt(28)} Piiname ${ORIGIN}/card/${TOKEN}`); },
                mail: () => { throw new Error(`failed for ${mailAt(28)}`); },
            }).deps);
            await setUsed(budgetScope('number', numberAt(28)), TEXTS_PER_NUMBER_DAY);
            await sendNotice(execute, { ...r, subject: [BOOKING + 284] }, recorder().deps);
        });
        const rows = JSON.stringify(await execute('SELECT * FROM notice_attempts WHERE booking_id BETWEEN ? AND ?', [BOOKING + 28, BOOKING + 28]));
        const all = JSON.stringify(await execute('SELECT * FROM notice_attempts WHERE booking_id = ?', [r.bookingId]));
        expect(all.length, 'the rows of this case exist').toBeGreaterThan(2);
        for (const secret of secrets) {
            expect(rows + all, `a row holds ${secret.slice(0, 8)}`).not.toContain(secret);
            for (const [, text] of lines) expect(text, `a log line holds ${secret.slice(0, 8)}`).not.toContain(secret);
        }
        expect(lines.length, 'the cases logged').toBeGreaterThan(2);
        for (const [, text] of lines) expect(text, 'every line is a fixed Notice error line').toMatch(/^Notice error: [A-Za-z_]+$/);
    });
});

test.describe('Notices send path: the origin, the key, after the commit and the retention', () => {
    test.beforeAll(sweep);
    test.afterEach(sweep);

    const ORIGINS = [
        [{}, 'http://localhost:3000'],
        [{ NEXT_PUBLIC_APP_URL: 'http://localhost:3100/' }, 'http://localhost:3100'],
        [{ NEXT_PUBLIC_APP_URL: ' https://www.workontap.com/// ' }, 'https://www.workontap.com'],
        [{ NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'https://www.workontap.com/' }, 'https://www.workontap.com'],
        [{ NODE_ENV: 'production' }, null],
        [{ NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'http://www.workontap.com' }, null],
        [{ NEXT_PUBLIC_APP_URL: 'javascript:alert(1)' }, null],
        [{ NEXT_PUBLIC_APP_URL: 'ftp://x.test' }, null],
        [{ NEXT_PUBLIC_APP_URL: 'not a url' }, null],
        [{ NEXT_PUBLIC_APP_URL: 'https://user:pw@x.test' }, null],
        [{ NEXT_PUBLIC_APP_URL: 'https://x.test/app' }, null],
        [{ NEXT_PUBLIC_APP_URL: 'https://x.test/?a=1' }, null],
        [{ NEXT_PUBLIC_APP_URL: 'https://x.test/#f' }, null],
    ];

    test('appOrigin is the configured origin without its trailing slash, localhost outside production, and nothing in production unless it is https; a value with credentials, a path, a query or another scheme is no origin', () => {
        for (const [env, origin] of ORIGINS) expect(appOrigin(env), JSON.stringify(env)).toBe(origin);
    });

    test('noticeKey is the SHA-256 of the kind, the subject, the recipient and the channel, so each of them makes a different key, and a part that could blur two keys is refused', () => {
        const base = { kind: 'job_booked', subject: [5], recipientKind: 'customer', recipientRef: null, channel: 'sms' };
        expect(noticeKey(base)).toBe(sha('job_booked:5:customer:0:sms'));
        expect(noticeKey({ ...base, recipientRef: 7 })).toBe(sha('job_booked:5:customer:7:sms'));
        expect(noticeKey({ kind: 'job_link', subject: [3, 2, 9, 1_700_000_000], recipientKind: 'cleaner', recipientRef: 9, channel: 'sms' })).toBe(sha('job_link:3:2:9:1700000000:cleaner:9:sms'));
        const variants = [base, { ...base, kind: 'job_assigned' }, { ...base, subject: [6] }, { ...base, subject: [5, 1] }, { ...base, recipientKind: 'admin' }, { ...base, recipientRef: 7 }, { ...base, channel: 'email' }];
        expect(new Set(variants.map(noticeKey)).size, 'seven different notices, seven different keys').toBe(variants.length);
        expect(noticeKey({ ...base, recipientRef: undefined }), 'no ref and a null ref are the same recipient').toBe(noticeKey(base));
        for (const bad of [{ subject: [] }, { subject: ['a:b'] }, { subject: [1.5] }, { subject: [-1] }, { subject: ['has space'] }, { subject: 'x' }, { kind: 'a:b' }, { recipientKind: 'root' }, { channel: 'fax' }, { recipientRef: 0 }, { recipientRef: -3 }, { recipientRef: '7' }]) {
            expect(() => noticeKey({ ...base, ...bad }), JSON.stringify(bad)).toThrow('bad_notice_key');
        }
        expect(() => noticeKey(undefined)).toThrow('bad_notice_key');
    });

    test('afterCommit runs the work, outside a request it runs detached, and a work that fails or is not a function is one fixed line and never a throw', async () => {
        expect(await new Promise((resolve) => { afterCommit(() => resolve('ran')); })).toBe('ran');
        const { result, lines } = await logsOf(async () => {
            const returned = [
                afterCommit(() => { throw Object.assign(new Error(`boom for ${numberAt(0)} and a@b.test`), { code: 'EBOOM' }); }),
                afterCommit(async () => { throw Object.assign(new Error(`late boom for ${numberAt(0)}`), { code: 'ELATE' }); }),
                afterCommit(undefined),
            ];
            await sleep(30);
            return returned;
        });
        expect(result, 'it returns nothing').toEqual([undefined, undefined, undefined]);
        expect(lines).toEqual([['error', 'Notice error: EBOOM'], ['error', 'Notice error: TypeError'], ['error', 'Notice error: ELATE']]);
    });

    test('a database that fails is an error and not a throw: a failed claim sends nothing, and a failed settle leaves the row pending with its key so the notice is not sent twice', async () => {
        const failing = (when) => async (sql, params) => {
            if (when(sql)) throw Object.assign(new Error(`deadlock for ${numberAt(30)} ${mailAt(30)}`), { code: 'ER_LOCK_DEADLOCK' });
            return execute(sql, params);
        };
        const r = request(30);
        const claimFails = recorder();
        const first = await logsOf(() => sendNotice(failing((sql) => sql.includes('INSERT INTO notice_attempts')), r, claimFails.deps));
        expect(first.result).toEqual({ sms: 'error', email: 'error' });
        expect(first.lines).toEqual([['error', 'Notice error: ER_LOCK_DEADLOCK'], ['error', 'Notice error: ER_LOCK_DEADLOCK']]);
        expect([claimFails.calls.sms.length, claimFails.calls.mail.length], 'nothing was claimed, so nothing was sent').toEqual([0, 0]);
        expect(await byBooking(r)).toEqual([]);

        const settleFails = recorder();
        const second = await logsOf(() => sendNotice(failing((sql) => sql.startsWith('UPDATE notice_attempts')), r, settleFails.deps));
        expect(second.result, 'the answer is an error, though the text went').toEqual({ sms: 'error', email: 'error' });
        expect([settleFails.calls.sms.length, settleFails.calls.mail.length]).toEqual([1, 1]);
        expect(shape(await byBooking(r)), 'pending, with the key').toEqual([['sms', 'pending', 'key'], ['email', 'pending', 'key']]);
        const again = recorder();
        expect(await sendNotice(execute, r, again.deps), 'a retry does not send a second time').toEqual({ sms: 'duplicate', email: 'duplicate' });
        expect([again.calls.sms.length, again.calls.mail.length]).toEqual([0, 0]);
    });

    test('pruneNotices deletes the rows older than 180 days and keeps the rest', async () => {
        const plant = (index, days) => execute(
            `INSERT INTO notice_attempts (event_key, kind, channel, recipient_kind, recipient_ref, booking_id, outcome, created_at, settled_at)
             VALUES (NULL, 'job_booked', 'sms', 'customer', NULL, ?, 'sent', NOW() - INTERVAL ? DAY, NOW() - INTERVAL ? DAY)`,
            [BOOKING + index, days, days]
        );
        for (const [index, days] of [[40, 200], [41, 181], [42, 179], [43, 1]]) await plant(index, days);
        expect(await pruneNotices(execute)).toBeGreaterThanOrEqual(2);
        const left = await execute('SELECT booking_id FROM notice_attempts WHERE booking_id BETWEEN ? AND ? ORDER BY booking_id', [BOOKING + 40, BOOKING + 43]);
        expect(left.map((row) => row.booking_id - BOOKING)).toEqual([42, 43]);
        expect(NOTICE_KEEP_DAYS).toBe(180);
    });

    test('the vocabulary is the design\'s, fits its column, and every outcome in it was found in a row by the cases above', () => {
        test.skip(!ranFirst, 'the cases above did not all run in this worker (one failed and restarted it, or this case was picked alone); read their failure');
        expect(NOTICE_OUTCOMES).toEqual([
            'pending', 'sent', 'not_configured', 'rejected', 'unsure', 'bad_contact', 'cannot_text', 'no_contact', 'unchecked', 'not_active',
            'number_cap', 'kind_cap', 'provider_cap', 'platform_cap', 'mail_cap', 'no_origin', 'error',
        ]);
        expect(Object.isFrozen(NOTICE_OUTCOMES)).toBe(true);
        for (const outcome of NOTICE_OUTCOMES) expect(outcome.length, `${outcome} fits VARCHAR(16)`).toBeLessThanOrEqual(16);
        expect(PENDING_STALE_MINUTES).toBe(10);
        expect([...seen].filter((outcome) => !NOTICE_OUTCOMES.includes(outcome)), 'a row held an outcome the vocabulary does not name').toEqual([]);
        expect(NOTICE_OUTCOMES.filter((outcome) => !seen.has(outcome)), 'an outcome no case produced').toEqual([]);
    });
});
