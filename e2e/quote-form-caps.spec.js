// e2e/quote-form-caps.spec.js
//
// ENG-018, security gate round 1, finding B1 (A04, Medium): the quote form (POST /api/quote-requests) is open to anyone and makes the business's own
// mailbox and text account speak to whatever a stranger types on it. Three holes, one fix each (src/lib/sms-budget.js, src/lib/notices.js,
// src/lib/notice-events.js):
//   the texts    one number is held to two quote texts a day, but a client that types a different number each time was held by nothing except the
//                platform's whole day of texts (500), which every sign-in code shares: 520 simultaneous requests spent all of it. The kind now has a day of
//                its own for the platform (KIND_TEXTS_PER_PLATFORM_DAY, 50), taken after the number's kind cap and before the number's, the provider's and
//                the platform's, so a refused quote text spends none of the shared count
//   the e-mails  an e-mail had no cap at all. The kind now has two: 2 a day for one address and 100 a day for the platform (reserveMail), taken in
//                deliver after the claim and before the transport; a refusal is the outcome 'mail_cap', and lets go of the key like the text caps
//   the name     the e-mail's greeting carried the first word the stranger typed as a name; it now says 'Hello,'
//
// The cases (the numbers are this file's own; the letters are the security entry's):
//   Q1  (a)  the library: the 51st quote text of a day is refused 'kind_cap' whatever the number, and spends neither that number's, the provider's nor
//            the platform's count
//   Q2  (b)  the library: the third quote e-mail to one address (in any case of letters) is 'mail_cap', the transport is not called, the row is settled
//            and has let go of its key; a fourth to another address and the third of a kind that is not capped (job_booked) are sent
//   Q3  (c)  the route: 60 simultaneous quote requests with 60 numbers attempt at most 50 texts, the rest are 'kind_cap', the kind's day and the
//            platform's day hold at most 50, and an active provider's claim straight after is not refused 'platform_cap'
//   Q4       the route, with the kind's day for the platform one text from full: 8 simultaneous requests attempt exactly one more text, and the other
//            seven are 'kind_cap' (the same property as Q3, with no dependence on how many of a burst the route's own soft caps let in)
//   Q5  (d)  the route: 40 simultaneous requests naming one address attempt at most 2 e-mails, the rest are 'mail_cap', and the address's day holds 2
//   Q6  (e)  the library: the quote e-mail's text holds no part of the name typed on the form ('Hello,')
//   Q7       the library: the 101st quote e-mail of a day, to any address, is 'mail_cap', the transport is not called, and the platform's count stays at 100
//
// The database is the dev database the way e2e/number-check-status.spec.js reaches it. The route cases ask the running app, whose transports have no
// credential in the dev stack (each case annotates itself with credentialGap: with none, every attempted channel must end 'not_configured'); the library
// cases give the library a RECORDING transport, so nothing leaves. Every number is in +1403555 0520-0599 and every address starts with EMAIL_PREFIX, so
// the sweep before and after each case removes exactly the rows and the counters this file spent (ENG-018 review N10: a spec that posts a quote
// request deletes the scopes the request spends, the new ones included).
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { getCredentialHeaders } from './auth/credentials.js';
import { RESET_RETRIES } from './support/auth.js';
import { credentialGap } from './support/credentials.js';
import { providers } from '../database/fixtures/accounts.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';
import { sendNotice } from '../src/lib/notices.js';
import { noticeQuoteRequested } from '../src/lib/notice-events.js';
import { normalisePhone } from '../src/lib/phone.js';
import { budgetScope, reserve, reserveText } from '../src/lib/sms-budget.js';

test.use({ trace: 'off' });

const RUN = Date.now().toString(36);
const EMAIL_PREFIX = 'qfc018-';
const FIRST_NUMBER = 520;
const BLOCK_SIZE = 80;
const e164At = (i) => `+1403555${String(FIRST_NUMBER + i).padStart(4, '0')}`;
const typed = (e164) => e164.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3');
let numbersUsed = 0;
const nextNumber = () => {
    if (numbersUsed >= BLOCK_SIZE) throw new Error('the case needs more numbers than the block has');
    numbersUsed += 1;
    return e164At(numbersUsed - 1);
};
let seq = 0;
/** @type {string[]} */
const addressesMade = [];
const mail = (label) => {
    const address = `${EMAIL_PREFIX}${label}-${RUN}-${seq++}@notices.test`;
    addressesMade.push(address);
    return address;
};
const marks = (list) => list.map(() => '?').join(', ');

const PROVIDER = providers[0];
const KIND = 'quote_requested';
// The design's numbers, pinned to the constants in e2e/notices-library.spec.js.
const TEXTS_A_DAY_FOR_THE_PLATFORM = 50;
const MAILS_A_DAY_FOR_AN_ADDRESS = 2;
const MAILS_A_DAY_FOR_THE_PLATFORM = 100;
const REACHED = ['sent', 'not_configured', 'rejected', 'unsure'];
const COMMERCIAL = { property_type: 'commercial' };
const SERVICE_NAME = 'Fixture Standard Clean';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- the dev database ----

const DB = { host: '127.0.0.1', port: 3307, user: 'root', password: 'root123', database: 'workontap_db' };

/** @type {import('mysql2/promise').Connection | null} */
let connection = null;
let firstNoticeId = 0;

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

// ---- the sweep: what this file made, and what it spent ----

async function sweep() {
    const open = await db();
    const block = Array.from({ length: BLOCK_SIZE }, (_, i) => e164At(i));
    const made = (await rows('SELECT id FROM bookings WHERE customer_email LIKE ?', [`${EMAIL_PREFIX}%`])).map((row) => row.id);
    if (made.length > 0) {
        await open.execute(`DELETE FROM notice_attempts WHERE booking_id IN (${marks(made)})`, made);
        await open.execute(`DELETE FROM activity_logs WHERE entity_type = 'booking' AND entity_id IN (${marks(made)})`, made);
        await open.execute(`DELETE FROM bookings WHERE id IN (${marks(made)})`, made);
    }
    await open.execute('DELETE FROM quote_requests WHERE customer_email LIKE ?', [`${EMAIL_PREFIX}%`]);
    // The notices this file made are the quote ones and the job_booked ones of Q2's control, written with no booking and after the id this file began at.
    await open.execute("DELETE FROM notice_attempts WHERE id > ? AND booking_id IS NULL AND kind IN ('quote_requested', 'job_booked')", [firstNoticeId]);
    await open.execute("UPDATE service_providers SET status = 'active' WHERE id = ?", [PROVIDER.id]);

    const scopes = [
        budgetScope('platform', 'day'), budgetScope('provider', PROVIDER.id), budgetScope('platform-warned', new Date().toISOString().slice(0, 10)),
        budgetScope('kind-platform', KIND), budgetScope('mail-kind', KIND), budgetScope('mail-kind', 'job_booked'),
    ];
    const own = normalisePhone(PROVIDER.phone);
    if (own.ok) scopes.push(budgetScope('number', own.phone));
    for (const number of block) scopes.push(budgetScope('number', number), budgetScope('kind', KIND, number));
    for (const address of addressesMade) scopes.push(budgetScope('mail', KIND, address.toLowerCase()), budgetScope('mail', 'job_booked', address.toLowerCase()));
    await open.execute(`DELETE FROM sms_budget WHERE scope IN (${marks(scopes)})`, scopes);
}

test.beforeAll(async () => {
    firstNoticeId = Number((await rows('SELECT COALESCE(MAX(id), 0) AS m FROM notice_attempts'))[0].m);
    await sweep();
});
test.beforeEach(async () => {
    numbersUsed = 0;
    await sweep();
});
test.afterEach(sweep);
test.afterAll(async () => {
    if (!connection) return;
    try {
        await sweep();
    } finally {
        await connection.end();
        connection = null;
    }
});

// ---- reading the record ----

async function usedOf(scope) {
    const found = await rows('SELECT used FROM sms_budget WHERE scope = ?', [scope]);
    return found.length === 0 ? null : Number(found[0].used);
}
const maxId = async () => Number((await rows('SELECT COALESCE(MAX(id), 0) AS m FROM notice_attempts'))[0].m);
const quoteRowsSince = (mark) => rows("SELECT id, channel, outcome, event_key FROM notice_attempts WHERE id > ? AND booking_id IS NULL AND kind = 'quote_requested' ORDER BY id", [mark]);

// Reads until `done` holds and nothing is 'pending' (the notice runs after the response), or `wait` has gone.
async function eventually(read, done, { wait = 30_000 } = {}) {
    const until = Date.now() + wait;
    for (;;) {
        const list = await read();
        if ((done(list) && list.every((row) => row.outcome !== 'pending')) || Date.now() >= until) return list;
        await sleep(250);
    }
}

// ---- asking the app ----

const call = (request, method, url, headers, data) => request.fetch(url, { method, headers, data, maxRetries: RESET_RETRIES, timeout: 120_000 });

function quoteBody(fields = {}) {
    return { service_id: 1, answers: COMMERCIAL, name: 'Rhea Rowe', email: mail('q'), phone: typed(nextNumber()), address: '1 Probe Street, Calgary', message: 'A warehouse floor of about 4,000 square feet, to be cleaned once.', ...fields };
}

// A recording transport: where a text or an e-mail would go, and the e-mail's words (an e-mail here is plain text and holds no code).
function recorder() {
    /** @type {{ to: string, body?: string }[]} */
    const texts = [];
    /** @type {{ to: string, subject: string, text: string }[]} */
    const mails = [];
    return {
        texts,
        mails,
        deps: {
            sendSMS: async (to, body) => { texts.push({ to, body }); return { ok: true }; },
            sendMail: async (message) => { mails.push(message); return { success: true }; },
            appOrigin: () => 'http://localhost:3000',
        },
    };
}

const quoteMail = (id, address) => ({
    kind: KIND, subject: [id], bookingId: null, to: { kind: 'customer', ref: null, phone: '', email: address },
    channels: ['email'], values: { service: SERVICE_NAME }, spendFor: null,
});

// ---- the cases ----

test.describe('ENG-018 B1: the quote form cannot spend the platform\'s texts or mail a stranger without limit', () => {
    test('Q1 (a): the 51st quote text of a day is refused kind_cap whatever the number, and spends neither that number\'s, the provider\'s nor the platform\'s count', async () => {
        for (let i = 0; i < TEXTS_A_DAY_FOR_THE_PLATFORM; i += 1) {
            expect(await reserveText(execute, nextNumber(), null, { kind: KIND }), `quote text ${i + 1} of the day, to a number of its own`).toBeNull();
        }
        expect(await usedOf(budgetScope('platform', 'day')), 'fifty texts are counted against the platform\'s day').toBe(TEXTS_A_DAY_FOR_THE_PLATFORM);

        const number = nextNumber();
        const answer = await reserveText(execute, number, PROVIDER.id, { kind: KIND });

        expect(answer, 'the 51st, to a number nobody has texted today').toBe('kind_cap');
        expect(await usedOf(budgetScope('number', number)), 'the number\'s day is untouched').toBeNull();
        expect(await usedOf(budgetScope('provider', PROVIDER.id)), 'the provider\'s day is untouched').toBeNull();
        expect(await usedOf(budgetScope('platform', 'day')), 'the platform\'s day is as it was').toBe(TEXTS_A_DAY_FOR_THE_PLATFORM);
        expect(await usedOf(budgetScope('kind-platform', KIND)), 'the kind\'s day holds its cap and no more').toBe(TEXTS_A_DAY_FOR_THE_PLATFORM);
        // The cap is the kind's own: a text of another kind (a sign-in code passes none) is still served, and counts against the platform's day.
        expect(await reserveText(execute, nextNumber(), null), 'a text with no kind is not held by the kind\'s day').toBeNull();
        expect(await usedOf(budgetScope('platform', 'day')), 'and it is counted').toBe(TEXTS_A_DAY_FOR_THE_PLATFORM + 1);
    });

    test('Q2 (b): the third quote e-mail to one address, in any case of letters, is mail_cap and never reaches the transport; its row is settled and has let go of its key', async () => {
        const texts = recorder();
        const address = `${EMAIL_PREFIX}one-${RUN}@notices.test`;
        addressesMade.push(address);
        const asked = [address.replace('notices', 'Notices'), address, address.toUpperCase()];
        const answers = [];
        for (const [i, typedAddress] of asked.entries()) {
            answers.push((await sendNotice(execute, quoteMail(900_000_000 + i, typedAddress), texts.deps)).email);
        }

        expect(answers, 'the first two are sent and the third is refused').toEqual(['sent', 'sent', 'mail_cap']);
        expect(texts.mails.length, 'the transport was handed two e-mails and not a third').toBe(MAILS_A_DAY_FOR_AN_ADDRESS);
        const refused = await rows("SELECT outcome, event_key, settled_at FROM notice_attempts WHERE id > ? AND kind = 'quote_requested' AND channel = 'email' AND outcome = 'mail_cap'", [firstNoticeId]);
        expect(refused.map((row) => [row.outcome, row.event_key, row.settled_at !== null]), 'one row, settled, with no key').toEqual([['mail_cap', null, true]]);
        expect(await usedOf(budgetScope('mail', KIND, address.toLowerCase())), 'the address\'s day holds two').toBe(MAILS_A_DAY_FOR_AN_ADDRESS);
        expect(await usedOf(budgetScope('mail-kind', KIND)), 'the platform\'s day for the kind holds the two that went').toBe(MAILS_A_DAY_FOR_AN_ADDRESS);

        const other = `${EMAIL_PREFIX}two-${RUN}@notices.test`;
        addressesMade.push(other);
        expect((await sendNotice(execute, quoteMail(900_000_010, other), texts.deps)).email, 'another address is not held by the first one\'s day').toBe('sent');

        // A kind that no stranger can cause is not counted: three e-mails of it to one address all go.
        const booked = [];
        for (let i = 0; i < 3; i += 1) {
            booked.push((await sendNotice(execute, {
                kind: 'job_booked', subject: [900_000_020 + i], bookingId: null, to: { kind: 'customer', ref: null, phone: '', email: address },
                channels: ['email'], values: { n: `BK${RUN}${i}`, service: SERVICE_NAME }, spendFor: null,
            }, texts.deps)).email);
        }
        expect(booked, 'three job_booked e-mails to the same address are all sent').toEqual(['sent', 'sent', 'sent']);
        expect(await usedOf(budgetScope('mail', 'job_booked', address.toLowerCase())), 'and nothing is counted for the kind').toBeNull();
    });

    test('Q3 (c): 60 simultaneous quote requests with 60 numbers attempt at most 50 texts, the rest are kind_cap, nothing else is refused, and an active provider\'s claim straight after is not platform_cap', async ({ request, baseURL }, testInfo) => {
        const claimHeaders = (await getCredentialHeaders(String(baseURL)))['provider-cookie'];
        const mark = await maxId();
        const answers = await Promise.all(Array.from({ length: 60 }, () => call(request, 'POST', '/api/quote-requests', {}, quoteBody())));
        const saved = answers.filter((answer) => answer.status() === 201).length;
        expect(saved, 'the burst is saved in the numbers the route\'s own counts let in (a handful at least)').toBeGreaterThan(0);

        const told = await eventually(() => quoteRowsSince(mark), (list) => list.length >= saved * 2);
        const texts = told.filter((row) => row.channel === 'sms');
        const reached = texts.filter((row) => REACHED.includes(row.outcome));
        const refused = texts.filter((row) => row.outcome === 'kind_cap');
        if (credentialGap(testInfo, 'sms').length > 0) expect(new Set(reached.map((row) => row.outcome)), 'no credential is set, so every text that was attempted is not_configured').toEqual(new Set(reached.length > 0 ? ['not_configured'] : []));
        expect(texts.length, 'a text for each request saved').toBe(saved);
        expect(reached.length, 'the texts attempted').toBe(Math.min(saved, TEXTS_A_DAY_FOR_THE_PLATFORM));
        expect(refused.length, 'the texts refused are refused as the kind\'s cap and as nothing else').toBe(saved - reached.length);
        expect(await usedOf(budgetScope('kind-platform', KIND)), 'the kind\'s day for the platform holds at most its cap').toBe(reached.length);
        expect(await usedOf(budgetScope('platform', 'day')), 'the platform\'s day holds only what was attempted').toBe(reached.length);

        // The shared day is not starved: a provider's claim straight after is texted (nothing is refused for the platform's day).
        const job = await mkOpenBooking();
        const claimed = await call(request, 'POST', `/api/provider/available-jobs/${job.id}`, claimHeaders, {});
        expect(claimed.status(), 'the active provider\'s claim').toBe(200);
        const claimRows = await eventually(() => rows("SELECT channel, outcome FROM notice_attempts WHERE booking_id = ? AND kind = 'job_claimed' ORDER BY id", [job.id]), (list) => list.length >= 4);
        expect(claimRows.length, 'the customer and the provider, by text and by e-mail').toBe(4);
        expect(claimRows.map((row) => row.outcome).filter((outcome) => !REACHED.includes(outcome)), 'none of the four is refused').toEqual([]);
    });

    test('Q4: with the kind\'s day for the platform one text from full, 8 simultaneous quote requests attempt exactly one more text and the other seven are kind_cap', async ({ request }, testInfo) => {
        // One text from full: the scope is spent to 49 of 50 by the reserve the library itself uses.
        for (let i = 0; i < TEXTS_A_DAY_FOR_THE_PLATFORM - 1; i += 1) expect(await reserve(execute, budgetScope('kind-platform', KIND), TEXTS_A_DAY_FOR_THE_PLATFORM, 86_400)).toBe(true);
        const mark = await maxId();
        const answers = await Promise.all(Array.from({ length: 8 }, () => call(request, 'POST', '/api/quote-requests', {}, quoteBody())));
        expect(answers.map((answer) => answer.status()), 'all eight are saved').toEqual(Array(8).fill(201));

        const told = await eventually(() => quoteRowsSince(mark), (list) => list.length >= 16);
        const texts = told.filter((row) => row.channel === 'sms');
        const reached = texts.filter((row) => REACHED.includes(row.outcome));
        expect(reached.length, 'one text is attempted').toBe(1);
        expect(texts.filter((row) => row.outcome === 'kind_cap').length, 'the other seven are refused as the kind\'s cap').toBe(7);
        if (credentialGap(testInfo, 'sms').length > 0) expect(reached.map((row) => row.outcome), 'no credential is set, so the text attempted is not_configured').toEqual(['not_configured']);
        expect(await usedOf(budgetScope('kind-platform', KIND)), 'the kind\'s day for the platform is full and no more').toBe(TEXTS_A_DAY_FOR_THE_PLATFORM);
        expect(await usedOf(budgetScope('platform', 'day')), 'the platform\'s day holds the one text').toBe(1);
    });

    test('Q5 (d): 40 simultaneous quote requests naming one address attempt at most 2 e-mails, the rest are mail_cap, and the address\'s day holds 2', async ({ request }, testInfo) => {
        const address = mail('same');
        const mark = await maxId();
        const answers = await Promise.all(Array.from({ length: 40 }, () => call(request, 'POST', '/api/quote-requests', {}, quoteBody({ email: address, phone: undefined }))));
        const saved = answers.filter((answer) => answer.status() === 201).length;
        expect(saved, 'more than two of the burst are saved (the route holds an address to three an hour, and the count is read before the write)').toBeGreaterThan(MAILS_A_DAY_FOR_AN_ADDRESS);

        const told = await eventually(() => quoteRowsSince(mark), (list) => list.length >= saved);
        const mails = told.filter((row) => row.channel === 'email');
        const reached = mails.filter((row) => REACHED.includes(row.outcome));
        if (credentialGap(testInfo, 'email').length > 0) expect(reached.map((row) => row.outcome), 'no credential is set, so every e-mail attempted is not_configured').toEqual(Array(reached.length).fill('not_configured'));
        expect(told.filter((row) => row.channel === 'sms'), 'no phone was typed, so no text is asked for and none is refused').toEqual([]);
        expect(mails.length, 'an e-mail row for each request saved').toBe(saved);
        expect(reached.length, 'the e-mails attempted').toBe(MAILS_A_DAY_FOR_AN_ADDRESS);
        expect(mails.filter((row) => row.outcome === 'mail_cap').length, 'the rest are refused as mail_cap').toBe(saved - MAILS_A_DAY_FOR_AN_ADDRESS);
        expect(mails.filter((row) => row.outcome === 'mail_cap').map((row) => row.event_key), 'a refused e-mail has let go of its key').toEqual(Array(saved - MAILS_A_DAY_FOR_AN_ADDRESS).fill(null));
        expect(await usedOf(budgetScope('mail', KIND, address.toLowerCase())), 'the address\'s day holds two').toBe(MAILS_A_DAY_FOR_AN_ADDRESS);
    });

    test('Q6 (e): the quote e-mail greets with "Hello," and holds no part of the name typed on the form', async () => {
        const recording = recorder();
        const address = mail('named');
        const made = await execute(
            `INSERT INTO quote_requests (user_id, service_id, service_name, customer_name, customer_email, customer_phone, address, message, answers, picks)
             VALUES (NULL, 1, ?, 'Zebulon Quillfeather', ?, '', '1 Probe Street', 'x', '{}', '[]')`,
            [SERVICE_NAME, address]
        );

        const told = await noticeQuoteRequested(execute, { quoteRequestId: made.insertId }, recording.deps);

        expect(told.map((entry) => [entry.to, entry.email]), 'the customer is told by e-mail').toEqual([['customer', 'sent']]);
        expect(recording.mails.length, 'one e-mail is handed over').toBe(1);
        const [message] = recording.mails;
        expect(message.text.split('\n')[0], 'the greeting').toBe('Hello,');
        expect(`${message.subject}\n${message.text}`, 'no part of the typed name is in it').not.toMatch(/zebulon|quillfeather/i);
        expect(message.text, 'the service, which the catalog names and nobody typed, is still there').toContain(`Service: ${SERVICE_NAME}`);
    });

    test('Q7: the quote e-mails of a day are held to 100 for the platform: the 101st, to any address, is mail_cap, never reaches the transport, and is not counted', async () => {
        const texts = recorder();
        const scope = budgetScope('mail-kind', KIND);
        await execute('INSERT INTO sms_budget (scope, window_started_at, used) VALUES (?, NOW(), ?) ON DUPLICATE KEY UPDATE used = ?, window_started_at = NOW()', [scope, MAILS_A_DAY_FOR_THE_PLATFORM - 1, MAILS_A_DAY_FOR_THE_PLATFORM - 1]);
        const first = `${EMAIL_PREFIX}plat-a-${RUN}@notices.test`;
        const second = `${EMAIL_PREFIX}plat-b-${RUN}@notices.test`;
        addressesMade.push(first, second);

        expect((await sendNotice(execute, quoteMail(900_000_100, first), texts.deps)).email, 'the 100th of the day goes').toBe('sent');
        expect((await sendNotice(execute, quoteMail(900_000_101, second), texts.deps)).email, 'the 101st, to an address nobody has mailed today, is refused').toBe('mail_cap');

        expect(texts.mails.length, 'the transport was handed one e-mail and not a second').toBe(1);
        const refused = await rows("SELECT outcome, event_key, settled_at FROM notice_attempts WHERE id > ? AND kind = 'quote_requested' AND channel = 'email' AND outcome = 'mail_cap'", [firstNoticeId]);
        expect(refused.map((row) => [row.outcome, row.event_key, row.settled_at !== null]), 'one row, settled, with no key').toEqual([['mail_cap', null, true]]);
        expect(await usedOf(scope), 'the platform\'s day for the kind holds its cap and no more').toBe(MAILS_A_DAY_FOR_THE_PLATFORM);
    });
});

// ---- a job for Q3's claim (SQL only, so that the route under test is the one sender) ----

async function mkOpenBooking() {
    const number = `QF${RUN}${seq++}`.toUpperCase();
    const made = await execute(
        `INSERT INTO bookings (booking_number, user_id, service_id, service_name, service_price, customer_first_name, customer_last_name, customer_email, customer_phone,
           job_date, job_time_slot, job_description, address_line1, city, postal_code, worker_count, status, payment_status, provider_id, latitude, longitude, marketplace_pushed_at)
         VALUES (?, NULL, 1, ?, 80, 'Rhea', 'Rowe', ?, ?, DATE_FORMAT(CURDATE(), '%Y-%m-%d'), 'Oct 17: Morning', 'x', '1 Probe Street', 'Calgary', 'T2P 0A1', 3, 'pending', 'pending', NULL, 51.04473, -114.07192, NOW())`,
        [number, SERVICE_NAME, mail('b'), nextNumber()]
    );
    return { id: /** @type {number} */ (made.insertId), number };
}
