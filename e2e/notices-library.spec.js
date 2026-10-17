// e2e/notices-library.spec.js
//
// ENG-018 (ADR-018): the vectors for the libraries every notice is sent through, before any notice is. src/lib/sms.js: sendSMSResult says why a
// text did or did not go ('sent', 'bad_number', 'destination_not_allowed', 'not_configured', 'rejected', 'unsure') and sendSMS is its `ok`.
// src/lib/sms-budget.js: reserveText gains the platform's daily ceiling, the per-kind cap on a number and a provider id that may be null.
// src/lib/notice-templates.js: what a notice may say (pure; no stack and no database needed).
//
// Twilio is a stub that records each call (globalThis.fetch is replaced and put back), so no case reaches Twilio, and there are no Twilio credentials
// in the dev environment either. What is proved here is what the code ATTEMPTS: the number, the body and the form the transport would receive, and the
// reason it answers. A text is never "delivered" in this file.
//
// The database is the dev database the way e2e/job-link-retention.spec.js reaches it (mysql2/promise, assertDevTarget before it connects,
// assertNoRealPeople on it), opened only by the budget cases. They plant no row of a table other than sms_budget, set the platform's and the
// providers' counts by SQL where a case needs a count near its cap, and the sweep deletes every scope the file touched, the platform's included.
// The platform's count is global to the dev database, so the sweep leaves it as the fixture loader does (no row).
//
// The phone block of this file is +14035550400 to +14035550429. The notices specs that follow use 430 to 499. No other spec uses this range.
import { format } from 'node:util';
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';
import { sendSMS, sendSMSResult } from '../src/lib/sms.js';
import { budgetScope, reserveText, TEXTS_PER_NUMBER_DAY, TEXTS_PER_PROVIDER_DAY, TEXTS_PER_PLATFORM_DAY, KIND_TEXTS_PER_NUMBER_DAY } from '../src/lib/sms-budget.js';
import { NOTICE_KINDS, SMS_BODY_MAX, NAME_MAX, cleanLine, templateFor } from '../src/lib/notice-templates.js';
import { REPORT_TYPES } from '../src/lib/job-reports.js';

// Cases run in the order of the file, one worker, and each plants its own rows, so one failure does not hide the next.
test.use({ trace: 'off' });

const RUN = Date.now().toString(36);
const numberAt = (last) => `+1403555${String(400 + last).padStart(4, '0')}`;
const TYPED_FORMS_OF_0423 = ['4035550423', '(403) 555-0423', '+14035550423', '14035550423'];

// ---- the console spy: installed before the first case, restored after the last, so a case can ask what was logged and the last can ask about all ----

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

/** Runs `work` and returns its result with what it logged, as [method, text] pairs. */
async function logsOf(work) {
    const before = captured.length;
    const result = await work();
    return { result, lines: captured.slice(before).map((entry) => [entry.method, entry.text]) };
}

// ---- Twilio: a stub that records the calls ---------------------------------------------------------------------------------------------------

const SID = `ACeng018nl${RUN}`;
const TOKEN = `tokeng018nl${RUN}`;
const FROM = '+14035550428';
// What a log line must never hold, by kind: every number and body and credential this file puts in a call.
const secrets = { numbers: new Set(), bodies: new Set(), credentials: new Set([SID, TOKEN]) };
for (let last = 0; last < 30; last += 1) {
    const four = String(400 + last).padStart(4, '0');
    for (const form of [`+1403555${four}`, `403555${four}`, `(403) 555-${four}`, `403-555-${four}`, `403 555 ${four}`]) secrets.numbers.add(form);
}

// Runs `work(calls)` with the three Twilio variables set (or all unset, or all but `without`), globalThis.fetch replaced by a stub that records each
// call and answers with answer(call number, init), and everything put back.
async function withTwilio({ configured = true, without = null, answer = () => new Response('{}', { status: 201 }) }, work) {
    const saved = { fetch: globalThis.fetch, sid: process.env.TWILIO_ACCOUNT_SID, token: process.env.TWILIO_AUTH_TOKEN, from: process.env.TWILIO_PHONE_NUMBER };
    const calls = [];
    const values = { TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: TOKEN, TWILIO_PHONE_NUMBER: FROM };
    for (const name of Object.keys(values)) {
        if (configured && name !== without) process.env[name] = values[name];
        else delete process.env[name];
    }
    globalThis.fetch = /** @type {any} */ (async (url, init) => {
        calls.push({ url: String(url), form: new URLSearchParams(String(init?.body ?? '')), method: init?.method, authorization: init?.headers?.Authorization, signal: init?.signal });
        return answer(calls.length, init);
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

/** One sendSMSResult through the stub: { result, calls, lines }. */
async function attempt(to, message, config = {}) {
    const bodyText = String(message ?? '');
    if (bodyText) secrets.bodies.add(bodyText);
    return withTwilio(config, async (calls) => {
        const { result, lines } = await logsOf(() => sendSMSResult(to, message));
        return { result, calls: [...calls], lines };
    });
}

// ================================================================================================================================
// sendSMSResult
// ================================================================================================================================

test.describe('Notices library: sendSMSResult', () => {
    for (const typed of TYPED_FORMS_OF_0423) {
        test(`AC7: a Canadian number typed as ${typed} reaches Twilio as To=+14035550423 with the body unchanged`, async () => {
            const body = `Quote ready. Details: https://example.test/card/abc-DEF_123 ${typed}`;
            const { result, calls, lines } = await attempt(typed, body);
            expect(result, 'the answer').toEqual({ ok: true, reason: 'sent' });
            expect(calls.length, 'one call to Twilio').toBe(1);
            expect(calls[0].url, 'the call goes to this account\'s Messages endpoint').toBe(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`);
            expect(calls[0].method).toBe('POST');
            expect(calls[0].form.get('To'), 'the number is in E.164 with +1, the way a Canadian number is written however it was typed').toBe('+14035550423');
            expect(calls[0].form.get('Body'), 'the body is exactly what was given').toBe(body);
            expect(calls[0].form.get('From'), 'from the configured number').toBe(FROM);
            expect(calls[0].authorization, 'basic auth from the two credentials').toBe(`Basic ${Buffer.from(`${SID}:${TOKEN}`).toString('base64')}`);
            expect(calls[0].signal instanceof AbortSignal, 'the call carries a timeout, so a slow Twilio cannot hold a request open').toBe(true);
            expect([...calls[0].form.keys()].sort(), 'the form holds these three fields and no other').toEqual(['Body', 'From', 'To']);
            expect(lines, 'one fixed line').toEqual([['log', 'SMS sent']]);
        });
    }

    test('AC7: a number outside Canada makes no call: +442079460958 and a ten-digit number with a United States area code are destination_not_allowed', async () => {
        for (const to of ['+442079460958', '2125550100', '+1 212 555 0100', '+91 98765 43210']) {
            const { result, calls, lines } = await attempt(to, 'x');
            expect(result, `${to}: the answer`).toEqual({ ok: false, reason: 'destination_not_allowed' });
            expect(calls.length, `${to}: no call is made`).toBe(0);
            expect(lines, `${to}: one fixed line that holds none of what was typed`).toEqual([['log', 'SMS not sent: destination_not_allowed']]);
        }
    });

    test('a value that is not a number makes no call and is bad_number: text, empty, an extension, null and undefined', async () => {
        for (const to of ['abc', '', '   ', '403-555-0423 ext 5', '+', '1', null, undefined]) {
            const { result, calls, lines } = await attempt(to, 'x');
            expect(result, `${JSON.stringify(to)}: the answer`).toEqual({ ok: false, reason: 'bad_number' });
            expect(calls.length, `${JSON.stringify(to)}: no call is made`).toBe(0);
            expect(lines, `${JSON.stringify(to)}: one fixed line`).toEqual([['log', 'SMS not sent: bad_number']]);
        }
    });

    test('without credentials the answer is not_configured and nothing is called; one missing variable is enough', async () => {
        const none = await attempt('4035550423', 'x', { configured: false });
        expect(none.result, 'no variable set').toEqual({ ok: false, reason: 'not_configured' });
        expect(none.calls.length, 'no call').toBe(0);
        expect(none.lines, 'one fixed line').toEqual([['log', 'Twilio credentials not configured in .env. Skipping SMS.']]);
        for (const name of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER']) {
            const one = await attempt('4035550423', 'x', { without: name });
            expect(one.result, `${name} missing`).toEqual({ ok: false, reason: 'not_configured' });
            expect(one.calls.length, `${name} missing: no call`).toBe(0);
        }
    });

    test('a number that cannot be texted is refused as such even when the credentials are missing: the number is checked before the credentials', async () => {
        // The order matters to a caller that releases its send-once key on not_configured: a number that is never going to work must not look like a
        // missing credential, or the notice would try again for ever.
        const { result, calls } = await attempt('+442079460958', 'x', { configured: false });
        expect(result).toEqual({ ok: false, reason: 'destination_not_allowed' });
        expect(calls.length).toBe(0);
        const bad = await attempt('abc', 'x', { configured: false });
        expect(bad.result).toEqual({ ok: false, reason: 'bad_number' });
    });

    test('a 2xx answer is sent, whatever the body: 200, 201 and 202 with an empty body', async () => {
        for (const status of [200, 201, 202]) {
            const { result, lines } = await attempt('4035550423', 'x', { answer: () => new Response('', { status }) });
            expect(result, `status ${status}`).toEqual({ ok: true, reason: 'sent' });
            expect(lines, `status ${status}: one fixed line`).toEqual([['log', 'SMS sent']]);
        }
    });

    test('a 400 with a Twilio code is rejected and the log line names the status and the code and nothing Twilio said about the number', async () => {
        const answer = () => new Response(JSON.stringify({ code: 21211, message: 'The \'To\' number +14035550423 is not a valid phone number.', more_info: `https://www.twilio.com/docs/errors/21211?sid=${SID}` }), { status: 400 });
        const { result, calls, lines } = await attempt('4035550423', 'body for 0423', { answer });
        expect(result, 'the answer').toEqual({ ok: false, reason: 'rejected' });
        expect(calls.length, 'one call, and it is not tried again').toBe(1);
        expect(lines, 'one line: the status and the code').toEqual([['error', 'Twilio error 400 21211']]);
    });

    test('an error answer whose body is not JSON, has no code, or has a code that is not a number is rejected with the code "unknown"', async () => {
        const cases = [
            ['an HTML 502', new Response('<html>Bad gateway for +14035550423</html>', { status: 502 }), 'Twilio error 502 unknown'],
            ['a JSON body with no code', new Response(JSON.stringify({ message: 'for +14035550423' }), { status: 403 }), 'Twilio error 403 unknown'],
            ['a code that is a string', new Response(JSON.stringify({ code: '21211; DROP TABLE users' }), { status: 400 }), 'Twilio error 400 unknown'],
            ['an empty body', new Response('', { status: 500 }), 'Twilio error 500 unknown'],
        ];
        for (const [what, response, line] of cases) {
            const { result, lines } = await attempt('4035550423', 'x', { answer: () => response });
            expect(result, `${what}: the answer`).toEqual({ ok: false, reason: 'rejected' });
            expect(lines, `${what}: one fixed line`).toEqual([['error', line]]);
        }
    });

    test('a call that times out or fails is unsure, not rejected: the message may have gone, and the log line names the error code or name only', async () => {
        const timeout = Object.assign(new Error('The operation was aborted due to timeout for +14035550423'), { name: 'TimeoutError' });
        const reset = Object.assign(new Error('read ECONNRESET to api.twilio.com for +14035550423'), { code: 'ECONNRESET' });
        for (const [what, thrown, line] of [['a timeout', timeout, 'Error sending SMS via Twilio: TimeoutError'], ['a reset', reset, 'Error sending SMS via Twilio: ECONNRESET'], ['an error with neither', Object.assign(new Error('x'), { name: '' }), 'Error sending SMS via Twilio: unknown']]) {
            const { result, calls, lines } = await attempt('4035550423', 'x', { answer: () => { throw thrown; } });
            expect(result, `${what}: the answer`).toEqual({ ok: false, reason: 'unsure' });
            expect(calls.length, `${what}: one call`).toBe(1);
            expect(lines, `${what}: one fixed line`).toEqual([['error', line]]);
        }
    });

    test('sendSMS is the ok of sendSMSResult for every reason, so the code flows that inject a sendText keep the boolean they were written against', async () => {
        const table = [
            ['4035550423', {}, true],
            ['abc', {}, false],
            ['+442079460958', {}, false],
            ['4035550423', { configured: false }, false],
            ['4035550423', { answer: () => new Response('{}', { status: 400 }) }, false],
            ['4035550423', { answer: () => { throw new Error('x'); } }, false],
        ];
        for (const [to, config, expected] of table) {
            const detailed = await attempt(to, 'x', config);
            const plain = await withTwilio(config, () => sendSMS(to, 'x'));
            expect(detailed.result.ok, `${to} ${JSON.stringify(Object.keys(config))}: sendSMSResult`).toBe(expected);
            expect(plain, `${to} ${JSON.stringify(Object.keys(config))}: sendSMS`).toBe(expected);
            expect(typeof plain, 'a boolean and not a truthy value').toBe('boolean');
        }
    });

    test('a message that is not a string is sent as text and the body is not invented: undefined becomes the empty body', async () => {
        const { result, calls } = await attempt('4035550423', undefined);
        expect(result).toEqual({ ok: true, reason: 'sent' });
        expect(calls[0].form.get('Body'), 'no "undefined" text goes out').toBe('');
    });

    test('everything the cases above logged is a fixed line, and none holds a number, a body or a credential', async () => {
        const FIXED = [
            /^SMS sent$/, /^SMS not sent: (bad_number|destination_not_allowed)$/, /^Twilio credentials not configured in \.env\. Skipping SMS\.$/,
            /^Twilio error \d{3} (\d+|unknown)$/, /^Error sending SMS via Twilio: [A-Za-z_]+$/,
        ];
        expect(captured.length, 'the cases above logged something').toBeGreaterThan(20);
        for (const entry of captured) {
            expect(FIXED.some((pattern) => pattern.test(entry.text)), `not a fixed line: ${entry.text.slice(0, 80)}`).toBe(true);
            for (const kind of Object.keys(secrets)) {
                for (const secret of secrets[/** @type {keyof typeof secrets} */ (kind)]) {
                    if (secret.length < 4) continue;
                    expect(entry.text.includes(secret), `a ${kind} value is in a log line: ${entry.text.slice(0, 60)}`).toBe(false);
                }
            }
        }
    });
});

// ================================================================================================================================
// reserveText
// ================================================================================================================================

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
const providerIdOf = (n) => 2_100_000_000 + n;
/** @type {Set<string>} */
const touched = new Set();
const warnedScopes = () => {
    // The warn counter is keyed by the UTC date; a run across midnight uses two.
    const now = Date.now();
    return [new Date(now).toISOString().slice(0, 10), new Date(now - 86_400_000).toISOString().slice(0, 10), new Date(now + 86_400_000).toISOString().slice(0, 10)].map((day) => budgetScope('platform-warned', day));
};

async function usedOf(scope) {
    const found = await execute('SELECT used FROM sms_budget WHERE scope = ?', [scope]);
    return found.length === 0 ? null : Number(found[0].used);
}

async function setUsed(scope, used) {
    await execute('INSERT INTO sms_budget (scope, window_started_at, used) VALUES (?, NOW(), ?) ON DUPLICATE KEY UPDATE used = ?, window_started_at = NOW()', [scope, used, used]);
}

async function clearBudget() {
    const open = await db();
    for (let last = 0; last < 30; last += 1) {
        touched.add(budgetScope('number', numberAt(last)));
        touched.add(budgetScope('kind', 'quote_requested', numberAt(last)));
        touched.add(budgetScope('kind', 'job_booked', numberAt(last)));
    }
    for (let n = 1; n <= 9; n += 1) touched.add(budgetScope('provider', providerIdOf(n)));
    // The scopes a text with no provider must not make, so a row left by a broken run of the code cannot fail the next case.
    for (const nobody of [null, undefined, '', 'null', 'undefined']) touched.add(budgetScope('provider', nobody));
    touched.add(PLATFORM);
    for (const scope of warnedScopes()) touched.add(scope);
    for (const scope of touched) await open.execute('DELETE FROM sms_budget WHERE scope = ?', [scope]);
    touched.clear();
}

/** Spends from the number's scopes the way a caller does and returns every answer in order. */
async function spend(count, phone, providerId, options) {
    const answers = [];
    for (let i = 0; i < count; i += 1) answers.push(await reserveText(execute, phone, providerId, options));
    return answers;
}

test.describe('Notices library: reserveText', () => {
    test.beforeAll(clearBudget);
    test.beforeEach(clearBudget);
    test.afterEach(clearBudget);
    test.afterAll(async () => {
        if (!connection) return;
        try {
            await clearBudget();
        } finally {
            await connection.end();
            connection = null;
        }
    });

    test('the constants are the ones the design names', () => {
        expect(TEXTS_PER_NUMBER_DAY).toBe(8);
        expect(TEXTS_PER_PROVIDER_DAY).toBe(200);
        expect(TEXTS_PER_PLATFORM_DAY).toBe(500);
        expect(KIND_TEXTS_PER_NUMBER_DAY).toEqual({ quote_requested: 2 });
        expect(Object.isFrozen(KIND_TEXTS_PER_NUMBER_DAY), 'the per-kind caps cannot be changed at run time').toBe(true);
    });

    test('the platform ceiling refuses the 501st text of a day with platform_cap, and the 500th goes', async () => {
        await setUsed(PLATFORM, 499);
        expect(await reserveText(execute, numberAt(1), null), 'the 500th').toBeNull();
        expect(await usedOf(PLATFORM), 'the count is 500').toBe(500);
        expect(await reserveText(execute, numberAt(2), null), 'the 501st').toBe('platform_cap');
        expect(await usedOf(PLATFORM), 'a refusal is not counted').toBe(500);
        expect(await reserveText(execute, numberAt(3), providerIdOf(1)), 'a provider\'s text is refused the same').toBe('platform_cap');
    });

    test('every text that goes spends one of the platform\'s count, a number at its cap does not, and a provider at its cap does not', async () => {
        await setUsed(PLATFORM, 10);
        const answers = await spend(TEXTS_PER_NUMBER_DAY + 2, numberAt(4), null);
        expect(answers, 'eight go and the rest are refused by the number').toEqual([...Array(TEXTS_PER_NUMBER_DAY).fill(null), 'number_cap', 'number_cap']);
        expect(await usedOf(PLATFORM), 'the platform\'s count rose by the eight that went and not by the two refused').toBe(10 + TEXTS_PER_NUMBER_DAY);
        await setUsed(budgetScope('provider', providerIdOf(2)), TEXTS_PER_PROVIDER_DAY);
        expect(await reserveText(execute, numberAt(5), providerIdOf(2)), 'a provider at its cap').toBe('provider_cap');
        expect(await usedOf(PLATFORM), 'the platform\'s count did not move for the text the provider\'s cap refused').toBe(10 + TEXTS_PER_NUMBER_DAY);
    });

    test('quote_requested has a cap of two a day per number: the third is kind_cap, another number has its own two, another kind has none', async () => {
        expect(await spend(4, numberAt(6), null, { kind: 'quote_requested' }), 'two go, then kind_cap').toEqual([null, null, 'kind_cap', 'kind_cap']);
        expect(await spend(3, numberAt(7), null, { kind: 'quote_requested' }), 'a second number has its own two').toEqual([null, null, 'kind_cap']);
        expect(await spend(5, numberAt(6), null, { kind: 'job_booked' }), 'another kind to the same number is not stopped by the quote kind\'s cap').toEqual([null, null, null, null, null]);
        expect(await spend(3, numberAt(14), null, { kind: 'a_kind_nobody_has_made' }), 'a kind with no entry has no per-kind cap').toEqual([null, null, null]);
        expect(await spend(3, numberAt(14), null), 'and neither has a call with no kind, the way the existing callers make it').toEqual([null, null, null]);
    });

    test('the kind cap is taken before the number\'s: a stranger\'s quote forms spend two of a victim\'s eight texts, not eight', async () => {
        // A quote form takes any number the visitor types, free, so this kind is the one text anyone can cause to a number that is not theirs.
        // Were the number's day taken first, seven forms would use seven of the victim's eight and leave one for the real notices.
        const forms = await spend(7, numberAt(8), null, { kind: 'quote_requested' });
        expect(forms, 'two go').toEqual([null, null, 'kind_cap', 'kind_cap', 'kind_cap', 'kind_cap', 'kind_cap']);
        expect(await usedOf(budgetScope('number', numberAt(8))), 'the number\'s day has been spent twice').toBe(2);
        expect(await usedOf(PLATFORM), 'and the platform\'s day twice').toBe(2);
        expect(await spend(7, numberAt(8), null, { kind: 'job_booked' }), 'six of the eight are left for the notices that matter, and then the number\'s cap').toEqual([null, null, null, null, null, null, 'number_cap']);
    });

    test('a provider id of null or undefined takes no provider scope, and a provider id takes one', async () => {
        const before = await execute('SELECT COUNT(*) AS n FROM sms_budget');
        await reserveText(execute, numberAt(9), null);
        await reserveText(execute, numberAt(9), undefined);
        await reserveText(execute, numberAt(9), undefined, { kind: null });
        const rows = await execute('SELECT scope, used FROM sms_budget');
        const nobody = [budgetScope('provider', null), budgetScope('provider', undefined), budgetScope('provider', ''), budgetScope('provider', 'null'), budgetScope('provider', 'undefined')];
        for (const scope of nobody) touched.add(scope);
        expect(rows.some((row) => nobody.includes(row.scope)), 'no provider row for a text no provider caused').toBe(false);
        expect(Number(rows.length) - Number(before[0].n), 'the number\'s row and the platform\'s: two rows for three texts').toBe(2);
        expect(await usedOf(budgetScope('number', numberAt(9))), 'all three counted against the number').toBe(3);
        expect(await reserveText(execute, numberAt(9), providerIdOf(3)), 'with a provider id').toBeNull();
        expect(await usedOf(budgetScope('provider', providerIdOf(3))), 'the provider\'s count is 1').toBe(1);
        touched.add(budgetScope('provider', providerIdOf(3)));
    });

    test('the first platform_cap of a day logs "SMS platform ceiling reached" once, however many texts are refused after it', async () => {
        await setUsed(PLATFORM, TEXTS_PER_PLATFORM_DAY);
        const { result, lines } = await logsOf(() => spend(4, numberAt(10), null));
        expect(result, 'all four refused').toEqual(['platform_cap', 'platform_cap', 'platform_cap', 'platform_cap']);
        expect(lines, 'one line, at warn level, with no number in it').toEqual([['warn', 'SMS platform ceiling reached']]);
    });

    test('when the once-a-day counter itself cannot be read the refusal still warns, and says why in a fixed line', async () => {
        await setUsed(PLATFORM, TEXTS_PER_PLATFORM_DAY);
        const broken = warnedScopes();
        const failing = async (sql, params = []) => {
            if (broken.includes(params?.[0])) throw Object.assign(new Error('boom with +14035550410 in it'), { code: 'ER_E2E_FIXTURE' });
            return execute(sql, params);
        };
        const { result, lines } = await logsOf(() => reserveText(failing, numberAt(11), null));
        expect(result, 'still refused').toBe('platform_cap');
        expect(lines, 'the failure and then the ceiling, in fixed lines').toEqual([['warn', 'SMS platform ceiling check failed: ER_E2E_FIXTURE'], ['warn', 'SMS platform ceiling reached']]);
    });

    test('the three-argument call the existing code makes still gets the number\'s and the provider\'s caps: eight go, the ninth is number_cap, and the provider counted eight', async () => {
        expect(await spend(TEXTS_PER_NUMBER_DAY + 1, numberAt(12), providerIdOf(4))).toEqual([...Array(TEXTS_PER_NUMBER_DAY).fill(null), 'number_cap']);
        expect(await usedOf(budgetScope('provider', providerIdOf(4))), 'the refused ninth did not reach the provider\'s count').toBe(TEXTS_PER_NUMBER_DAY);
        touched.add(budgetScope('provider', providerIdOf(4)));
        // The existing callers (job-link-code.js, crew-number-check.js) pass a provider id and read only null versus not null.
        expect(await reserveText(execute, numberAt(13), providerIdOf(4)), 'a text to another number from the same provider goes').toBeNull();
    });
});

// ================================================================================================================================
// notice-templates
// ================================================================================================================================

const N = 'BK17000000000001234';
const CARD_URL = `https://www.workontap.com/card/${'A'.repeat(43)}`;
const JOB_URL = `https://www.workontap.com/job/${'B'.repeat(43)}`;
// The eleven texts: nine kinds, of which job_claimed and job_finished have two.
const VARIANTS = [
    ['quote_requested', {}],
    ['card_link', { n: N, price: 125, url: CARD_URL }],
    ['job_booked', { n: N }],
    ['job_assigned', { n: N }],
    ['job_claimed', { n: N, audience: 'customer' }],
    ['job_claimed', { n: N, audience: 'provider' }],
    ['job_link', { n: N, url: JOB_URL }],
    ['report_added', { n: N, label: 'Customer did not answer' }],
    ['job_started', { n: N, workers: 2, hours: 1.5, price: 125 }],
    ['job_finished', { n: N }],
    ['job_finished', { n: N, guest: true, hours: 24 }],
];
const variantKey = (kind, values) => `${kind}${values.audience ? `:${values.audience}` : ''}${values.guest ? ':guest' : ''}`;
// A link that is exactly the longest the templates accept: an origin of 31 characters, the path and the 43-character token.
const longUrl = (path) => `https://${'h'.repeat(80 - 8 - path.length - 43)}${path}${'T'.repeat(43)}`;
// The longest values a route can make, by the bounds templateFor enforces.
const LONG_N = 'B'.repeat(20);
const LONGEST = [
    ['card_link', { n: LONG_N, price: 99999.99, url: longUrl('/card/') }],
    ['job_link', { n: LONG_N, url: longUrl('/job/') }],
    ['job_started', { n: LONG_N, workers: 999, hours: 998.99, price: 99999.99 }],
    ['job_finished', { n: LONG_N, guest: true, hours: 999 }],
    ['report_added', { n: LONG_N, label: 'Unable to complete the job' }],
    ['job_booked', { n: LONG_N }],
    ['job_claimed', { n: LONG_N, audience: 'customer' }],
    ['job_claimed', { n: LONG_N, audience: 'provider' }],
    ['job_assigned', { n: LONG_N }],
    ['job_finished', { n: LONG_N }],
    ['quote_requested', {}],
];

/** The error templateFor throws for these values: { code, message }, or null when it does not throw. */
function thrown(kind, values) {
    try {
        templateFor(kind, values);
    } catch (error) {
        return { code: /** @type {any} */ (error).code, message: String(/** @type {any} */ (error).message) };
    }
    return null;
}

test.describe('Notices library: templates', () => {
    test('there is a template for every kind and for nothing else: the nine kinds, in order, and a kind that is not one of them throws bad_notice_kind', () => {
        expect(NOTICE_KINDS).toEqual(['quote_requested', 'card_link', 'job_booked', 'job_assigned', 'job_claimed', 'job_link', 'report_added', 'job_started', 'job_finished']);
        expect(Object.isFrozen(NOTICE_KINDS)).toBe(true);
        expect(new Set(VARIANTS.map(([kind]) => kind)), 'the variants cover every kind').toEqual(new Set(NOTICE_KINDS));
        for (const [kind, values] of VARIANTS) expect(thrown(kind, values), `${kind} makes its text`).toBeNull();
        for (const kind of ['nope', '', 'QUOTE_REQUESTED', '__proto__', 'constructor', 'toString', 'hasOwnProperty', undefined, null, 7, ['card_link']]) {
            expect(thrown(/** @type {any} */ (kind), { n: N }), `${String(kind)} is not a kind`).toEqual({ code: 'bad_notice_kind', message: 'notice kind is not valid' });
        }
    });

    test('the eleven texts are the ones the design names, word for word; the two with a link are shortened so a quote or a link fits one segment', () => {
        const said = Object.fromEntries(VARIANTS.map(([kind, values]) => [variantKey(kind, values), templateFor(kind, values).sms]));
        expect(said).toEqual({
            quote_requested: 'WorkOnTap: we got your quote request. We will email you your quote soon.',
            card_link: `WorkOnTap: quote for booking #${N} is $125.00. Add your card: ${CARD_URL}`,
            job_booked: `WorkOnTap: booking #${N} is confirmed. We will tell you when a professional is assigned.`,
            job_assigned: `WorkOnTap: you have a new job, booking #${N}. Open the app for the details.`,
            'job_claimed:customer': `WorkOnTap: a professional has accepted your booking #${N}.`,
            'job_claimed:provider': `WorkOnTap: you accepted booking #${N}. Open the app for the details.`,
            job_link: `WorkOnTap: job link #${N}: ${JOB_URL} A code is texted when you open it.`,
            report_added: `WorkOnTap: on-site report on booking #${N}: Customer did not answer. Open Job Requests.`,
            job_started: `WorkOnTap: your professional has started booking #${N}. Professionals: 2. Estimated time: 1.5 hrs. Price: $125.00.`,
            job_finished: `WorkOnTap: your invoice for booking #${N} is ready. Please approve and pay.`,
            'job_finished:guest': `WorkOnTap: booking #${N} is finished. Your card on file is charged in 24 hours. Questions: support@workontap.com`,
        });
    });

    test('every text is printable ASCII in one segment with nothing left over, with ordinary values and with the longest the templates accept', () => {
        for (const [kind, values] of [...VARIANTS, ...LONGEST]) {
            const { sms } = templateFor(kind, values);
            const what = `${variantKey(kind, values)} ${sms.length} characters`;
            expect(sms, `${what}: printable ASCII`).toMatch(/^[\x20-\x7E]+$/);
            expect(sms.length, `${what}: at most ${SMS_BODY_MAX}`).toBeLessThanOrEqual(SMS_BODY_MAX);
            expect(sms, `${what}: nothing left over`).not.toMatch(/undefined|NaN|null|[{}]|\[object/);
            expect(sms.startsWith('WorkOnTap: '), `${what}: says who it is from`).toBe(true);
        }
        expect(SMS_BODY_MAX).toBe(160);
        // The bound is tight: the longest quote text is the whole segment, so no character of room is wasted on a bound that cannot be reached.
        expect(templateFor('card_link', LONGEST[0][1]).sms.length, 'the longest quote text').toBe(160);
    });

    test('a text carries no typed word: a hostile name, service, date, slot, address, phone and note appear in no SMS, and no address, phone, note or photo in any e-mail', () => {
        const hostile = { name: 'ZZNAMEZZ', service: 'ZZSERVICEZZ', date: 'ZZDATEZZ', slot: 'ZZSLOTZZ', address: 'ZZADDRESSZZ', phone: 'ZZPHONEZZ', note: 'ZZNOTEZZ', photo: '/uploads/ZZPHOTOZZ.jpg', email: 'ZZMAILZZ@x.test' };
        for (const [kind, values] of VARIANTS) {
            const made = templateFor(kind, { ...values, ...hostile });
            expect(made.sms, `${variantKey(kind, values)}: the text`).not.toMatch(/ZZ/);
            for (const part of [made.subject, made.text]) expect(part ?? '', `${variantKey(kind, values)}: an address, phone, note or photo is in no e-mail`).not.toMatch(/ZZ(ADDRESS|PHONE|NOTE|PHOTO|MAIL)ZZ/);
        }
    });

    test('a value that is missing or not valid throws bad_notice_value naming the field and never the value', () => {
        const cases = [
            ['card_link', { n: N, price: 125, url: CARD_URL }, 'n', ['', 'BK 123', 'BK\n123', '<script>', 'B'.repeat(21), 17, null, undefined, 'a/b']],
            ['card_link', { n: N, price: 125, url: CARD_URL }, 'price', [Number.NaN, -1, 100_000, 1e9, Infinity, '125', null, undefined]],
            ['card_link', { n: N, price: 125, url: CARD_URL }, 'url', ['javascript:alert(1)', 'http://', 'https://x.test/a b', `https://x.test/${'a'.repeat(70)}`, 'ftp://x.test/a', 7, '', 'https://x.test/{n}', undefined]],
            ['job_link', { n: N, url: JOB_URL }, 'url', [undefined, null]],
            ['job_started', { n: N, workers: 2, hours: 1.5, price: 125 }, 'workers', [0.5, -1, 1000, '2', null, Number.NaN]],
            ['job_started', { n: N, workers: 2, hours: 1.5, price: 125 }, 'hours', [-1, 1000, Number.NaN, '1.5', null, Infinity]],
            ['job_finished', { n: N, guest: true, hours: 24 }, 'hours', [1.5, -1, 1000, '24', null, undefined]],
            ['report_added', { n: N, label: 'Customer did not answer' }, 'label', ['', 'Pay me 5 dollars', 'a{b}', 'line\nbreak', 'x'.repeat(60), 7, undefined]],
            ['job_claimed', { n: N, audience: 'customer' }, 'audience', ['admin', '', undefined, null, 7]],
            ['job_booked', { n: N }, 'visits', [-1, 401, 1.5, '4', null]],
        ];
        for (const [kind, ok, field, values] of cases) {
            for (const value of values) {
                const seen = thrown(kind, { ...ok, [field]: value });
                expect(seen?.code, `${kind}.${field}=${JSON.stringify(value)}`).toBe('bad_notice_value');
                expect(seen?.message, `${kind}.${field}: the message names the field`).toBe(`notice ${field} is not valid`);
            }
        }
        // A value that would leave a word behind is refused: a booking number that is the text "undefined", "NaN" or "null".
        for (const n of ['undefined', 'NaN', 'null']) expect(thrown('job_booked', { n })?.code, `n=${n}`).toBe('bad_notice_value');
    });

    test('a link may hold the letters NaN, null or undefined by chance (about one token in 6,000 holds NaN) and is still texted whole', () => {
        for (const token of ['NaN'.padEnd(43, 'x'), `${'x'.repeat(20)}null${'y'.repeat(19)}`, 'undefined'.padEnd(43, 'z')]) {
            const url = `https://www.workontap.com/job/${token}`;
            expect(templateFor('job_link', { n: N, url }).sms, 'the whole link').toContain(url);
            expect(templateFor('card_link', { n: N, price: 10, url }).sms, 'the whole link in a quote').toContain(url);
        }
    });

    test('cleanLine makes one line: breaks, controls and reordering marks become spaces, runs collapse, and the cut is by character and not in the middle of a pair', () => {
        expect(cleanLine('Sam\r\nBcc: x@y.test')).toBe('Sam Bcc: x@y.test');
        expect(cleanLine('a\tb\u0000c\u007Fd\u0085e f g')).toBe('a b c d e f g');
        expect(cleanLine('‮evil‬ ​name⁦⁩﻿!')).toBe('evil name !');
        expect(cleanLine('   a    b   ')).toBe('a b');
        expect(cleanLine('x'.repeat(100))).toBe('x'.repeat(NAME_MAX));
        expect(cleanLine('x'.repeat(100), 5)).toBe('xxxxx');
        expect(NAME_MAX).toBe(60);
        const pairs = '\u{1F600}'.repeat(80);
        expect(Array.from(cleanLine(pairs)).length, 'sixty characters, each a pair, none split').toBe(60);
        expect(cleanLine(pairs)).toBe('\u{1F600}'.repeat(60));
        for (const nothing of [undefined, null, 7, {}, ['a'], true]) expect(cleanLine(/** @type {any} */ (nothing)), `${String(nothing)} is no line`).toBe('');
    });

    test('an e-mail is plain text with a fixed subject of one line that names the booking, and its greeting takes a typed name only through cleanLine', () => {
        const withMail = VARIANTS.filter(([kind]) => kind !== 'job_link' && kind !== 'job_started');
        for (const [kind, values] of withMail) {
            const made = templateFor(kind, { ...values, name: 'Sam\r\nBcc: attacker@x.test‮' });
            const what = variantKey(kind, values);
            expect(typeof made.subject, `${what}: a subject`).toBe('string');
            expect(made.subject, `${what}: one line`).not.toMatch(/[\r\n]/);
            expect(made.subject, `${what}: fixed words`).toMatch(/^[\x20-\x7E]+$/);
            expect(made.text, `${what}: ends with a line break`).toMatch(/\n$/);
            expect(made.text, `${what}: nothing left over`).not.toMatch(/undefined|NaN|\[object|[{}]/);
            expect(made.text, `${what}: no markup`).not.toMatch(/<[a-z/!]/i);
            expect(made.text, `${what}: no control character but the line breaks`).not.toMatch(/[\u0000-\u0009\u000B-\u001F\u007F‮]/);
            expect(made.text.split('\n').some((row) => row.startsWith('Bcc:')), `${what}: no typed line of its own`).toBe(false);
        }
        expect(templateFor('quote_requested', { name: 'Sam\r\nBcc: x' }).text.split('\n')[0]).toBe('Hi Sam Bcc: x,');
        expect(templateFor('quote_requested', { name: '  \n ' }).text.split('\n')[0], 'no name, no "Hi ,"').toBe('Hello,');
        expect(templateFor('quote_requested', {}).text.split('\n')[0]).toBe('Hello,');
        expect(templateFor('quote_requested', {}).text, 'a quote form takes any address, so the e-mail says how to ignore it').toContain('you can ignore this message');
    });

    test('the subjects are one fixed phrase and the booking number', () => {
        const withMail = VARIANTS.filter(([kind]) => kind !== 'job_link' && kind !== 'job_started');
        expect(Object.fromEntries(withMail.map(([kind, values]) => [variantKey(kind, values), templateFor(kind, values).subject]))).toEqual({
            quote_requested: 'We got your quote request',
            card_link: `Your quote for booking #${N}`,
            job_booked: `Booking #${N} is confirmed`,
            job_assigned: `New job: booking #${N}`,
            'job_claimed:customer': `A professional accepted booking #${N}`,
            'job_claimed:provider': `You accepted booking #${N}`,
            report_added: `On-site report on booking #${N}`,
            job_finished: `Your invoice for booking #${N} is ready`,
            'job_finished:guest': `Booking #${N} is finished`,
        });
    });

    test('the two kinds with no e-mail have none, and every other kind has a subject and a text', () => {
        for (const [kind, values] of VARIANTS) {
            const made = templateFor(kind, values);
            if (kind === 'job_link' || kind === 'job_started') expect([made.subject, made.text], `${kind} has no e-mail`).toEqual([null, null]);
            else expect([typeof made.subject, typeof made.text, made.text.length > 20], `${variantKey(kind, values)} has an e-mail`).toEqual(['string', 'string', true]);
        }
    });

    test('a guest and an account-holder are told different things when a job is finished: the guest cannot approve, and is told when the card is charged and who to ask', () => {
        const account = templateFor('job_finished', { n: N, price: 125, name: 'Sam', service: 'Home cleaning' });
        const guest = templateFor('job_finished', { n: N, guest: true, hours: 24, name: 'Sam', service: 'Home cleaning' });
        expect(account.sms).toContain('approve and pay');
        expect(account.text).toContain('Please approve and pay.');
        expect(account.text).toContain('Price: $125.00');
        expect(guest.sms).not.toMatch(/approve/i);
        expect(guest.text).not.toMatch(/approve/i);
        expect(guest.sms).toContain('charged in 24 hours');
        expect(guest.text).toContain('charged in 24 hours');
        expect(guest.sms).toContain('support@workontap.com');
        expect(thrown('job_finished', { n: N, guest: true })?.code, 'a guest text without the window is refused and does not say "undefined hours"').toBe('bad_notice_value');
        expect(templateFor('job_finished', { n: N, guest: 'true', price: 1 }).sms, 'only the boolean true is a guest').toContain('approve and pay');
    });

    test('a price is written with two places and hours with at most two, so a float\'s tail never reaches a text', () => {
        const quote = (price) => templateFor('card_link', { n: N, price, url: CARD_URL }).sms;
        expect(quote(125)).toContain('is $125.00.');
        expect(quote(99.5)).toContain('is $99.50.');
        expect(quote(0.1 + 0.2)).toContain('is $0.30.');
        expect(quote(0)).toContain('is $0.00.');
        const started = (hours) => templateFor('job_started', { n: N, workers: 1, hours, price: 10 }).sms;
        expect(started(1)).toContain('Estimated time: 1 hrs.');
        expect(started(1.5)).toContain('Estimated time: 1.5 hrs.');
        expect(started(0.1 + 0.2)).toContain('Estimated time: 0.3 hrs.');
        expect(started(2.256)).toContain('Estimated time: 2.26 hrs.');
    });

    test('the report text carries one of the five fixed labels and never the note or the photo address; every label of REPORT_TYPES is accepted', () => {
        expect(REPORT_TYPES.length).toBe(5);
        for (const { label } of REPORT_TYPES) {
            const made = templateFor('report_added', { n: N, label, note: 'ZZNOTEZZ', photo: '/uploads/ZZPHOTOZZ.jpg' });
            expect(made.sms, `${label}: the text`).toBe(`WorkOnTap: on-site report on booking #${N}: ${label}. Open Job Requests.`);
            expect(made.text, `${label}: the e-mail`).toContain(label);
            expect(`${made.sms}${made.subject}${made.text}`, `${label}: no note and no photo`).not.toMatch(/ZZ/);
        }
    });

    test('the claim names its audience: the customer is told a professional accepted, the provider is told they did, and neither is greeted by the other\'s name', () => {
        const customer = templateFor('job_claimed', { n: N, audience: 'customer', name: 'Sam' });
        const provider = templateFor('job_claimed', { n: N, audience: 'provider', name: 'Sam' });
        expect(customer.sms).toBe(`WorkOnTap: a professional has accepted your booking #${N}.`);
        expect(provider.sms).toBe(`WorkOnTap: you accepted booking #${N}. Open the app for the details.`);
        expect(customer.text.split('\n')[0]).toBe('Hi Sam,');
        expect(provider.text.split('\n')[0], 'a provider is not greeted with a customer\'s name').toBe(`You accepted booking #${N}.`);
        expect(provider.text).not.toContain('Sam');
    });
});
