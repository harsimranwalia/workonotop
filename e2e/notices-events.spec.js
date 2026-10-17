// e2e/notices-events.spec.js
//
// ENG-018, step 5: who is told, for each event (src/lib/notice-events.js), against the dev database and a RECORDING transport. The event functions are
// given the two transports as `deps`, so nothing here reaches Twilio or SMTP and nothing is sent; what is proved is the recipient, the channel, the words
// the transport would receive, and the row that records the attempt. A receipt for this file says "verified by what the code attempts", never "delivered".
// The routes that call these functions are step 6 and have their own file (e2e/notices-routes.spec.js); E19 and E20 live there.
//
// The database is the dev database the way e2e/notices-send.spec.js reaches it (mysql2/promise, assertDevTarget before it connects, assertNoRealPeople on
// it). Every row this file makes has an e-mail address that starts with EMAIL_PREFIX (bookings, providers, users, quote requests) and every number is in
// +1403555 0450-0469, so the sweep before and after each case removes exactly its own rows and spent budget. The dev database also holds the fixtures'
// own admins, who are part of the admin team and so are told by a report: a case looks only at the calls and the rows that are about its own people.
import fs from 'node:fs';
import path from 'node:path';
import { format } from 'node:util';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';
import {
    NOTICE_EVENTS, noticeQuoteRequested, noticeCardLink, noticeBooked, noticeAssigned, noticeClaimed, noticeJobLink, noticeJobLinksOfMember, noticeReport,
    noticeJobStarted, noticeJobFinished,
} from '../src/lib/notice-events.js';
import { NOTICE_KINDS, templateFor } from '../src/lib/notice-templates.js';
import { budgetScope, TEXTS_PER_PLATFORM_DAY } from '../src/lib/sms-budget.js';
import { newLinkToken, sha256Hex } from '../src/lib/link-token.js';
import { normalisePhone } from '../src/lib/phone.js';
import { AUTO_RELEASE_HOURS } from '../src/lib/auto-release.js';

test.use({ trace: 'off' });

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RUN = Date.now().toString(36);
const EMAIL_PREFIX = 'ev018-';
const ORIGIN = 'https://app.example.test';
const SERVICE_NAME = 'Probe service';
const SLOT = 'Oct 17: Morning';
const BLOCK_SIZE = 20;
const e164At = (i) => `+1403555${String(450 + i).padStart(4, '0')}`;
const typed = (e164) => e164.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3');
let numbersUsed = 0;
const nextNumber = () => {
    if (numbersUsed >= BLOCK_SIZE) throw new Error('the case needs more numbers than the block has');
    numbersUsed += 1;
    return e164At(numbersUsed - 1);
};
let seq = 0;
const mail = (label) => `${EMAIL_PREFIX}${label}-${RUN}-${seq++}@notices.test`;

// ---- the console spy: installed before the first case, restored after the last ----

/** @type {{ method: string, text: string }[]} */
const captured = [];
/** @type {Record<string, any>} */
const realConsole = {};
const SPIED = ['log', 'info', 'warn', 'error', 'debug'];
let spying = false;
let ranFirst = false;

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
const rows = (sql, params = []) => /** @type {Promise<any[]>} */ (execute(sql, params));

const madeProviders = new Set();
let startMax = 0;
let serviceId = 0;

async function sweep() {
    const open = await db();
    const mine = `${EMAIL_PREFIX}%`;
    await open.execute('DELETE FROM notice_attempts WHERE booking_id IN (SELECT id FROM bookings WHERE customer_email LIKE ?)', [mine]);
    await open.execute("DELETE FROM notice_attempts WHERE id > ? AND booking_id IS NULL AND kind = 'quote_requested'", [startMax]);
    await open.execute('DELETE FROM quote_requests WHERE customer_email LIKE ?', [mine]);
    await open.execute('DELETE FROM job_reports WHERE booking_id IN (SELECT id FROM bookings WHERE customer_email LIKE ?)', [mine]);
    await open.execute('DELETE FROM bookings WHERE customer_email LIKE ?', [mine]);
    await open.execute('DELETE FROM provider_crew_members WHERE provider_id IN (SELECT id FROM service_providers WHERE email LIKE ?)', [mine]);
    await open.execute('DELETE FROM service_providers WHERE email LIKE ?', [mine]);
    await open.execute('DELETE FROM users WHERE email LIKE ?', [mine]);
    const scopes = [budgetScope('platform', 'day')];
    for (const shift of [0, -86_400_000, 86_400_000]) scopes.push(budgetScope('platform-warned', new Date(Date.now() + shift).toISOString().slice(0, 10)));
    for (let i = 0; i < BLOCK_SIZE; i += 1) scopes.push(budgetScope('number', e164At(i)), budgetScope('kind', 'quote_requested', e164At(i)));
    for (const id of madeProviders) scopes.push(budgetScope('provider', id));
    // The fixtures' admins are told by a report too, and their numbers spend a day each.
    for (const admin of await rows("SELECT phone FROM users WHERE role = 'admin' AND phone IS NOT NULL")) {
        const phone = normalisePhone(admin.phone);
        if (phone.ok) scopes.push(budgetScope('number', phone.phone), budgetScope('kind', 'quote_requested', phone.phone));
    }
    for (const scope of scopes) await open.execute('DELETE FROM sms_budget WHERE scope = ?', [scope]);
    madeProviders.clear();
}

async function usedOf(scope) {
    const found = await rows('SELECT used FROM sms_budget WHERE scope = ?', [scope]);
    return found.length === 0 ? null : Number(found[0].used);
}

// ---- rows the cases plant (SQL only; no route and no other spec's rows) ----

async function mkUser({ role = 'user', phone = null, label = 'u' } = {}) {
    const email = mail(label);
    const made = await execute("INSERT INTO users (email, password_hash, first_name, last_name, phone, role) VALUES (?, 'x', 'Probe', 'User', ?, ?)", [email, phone, role]);
    return { id: /** @type {number} */ (made.insertId), email, phone };
}

async function mkProvider({ status = 'active', phone = nextNumber() } = {}) {
    const email = mail('prov');
    const made = await execute("INSERT INTO service_providers (name, email, phone, password, status) VALUES (?, ?, ?, 'x', ?)", [`Probe ${status}`, email, phone, status]);
    const id = /** @type {number} */ (made.insertId);
    madeProviders.add(id);
    return { id, email, phone };
}

// The customer's contact is what was typed on the booking; `typedPhone` plants it the way a person types it.
async function mkBooking({ providerId = null, userId = null, status = 'confirmed', phone = nextNumber(), typedPhone = false, price = 10 } = {}) {
    const email = mail('b');
    const number = `EV${RUN}${seq++}`.toUpperCase();
    const made = await execute(
        `INSERT INTO bookings (booking_number, user_id, service_id, service_name, service_price, customer_first_name, customer_last_name, customer_email, customer_phone,
           job_date, job_time_slot, job_description, address_line1, city, postal_code, worker_count, status, payment_status, provider_id, latitude, longitude)
         VALUES (?, ?, ?, ?, ?, 'Rhea', 'Rowe', ?, ?, DATE_FORMAT(CURDATE(), '%Y-%m-%d'), ?, 'x', '1 Probe Street', 'Calgary', 'T2P 0A1', 3,
           ?, 'pending', ?, 51.04473, -114.07192)`,
        [number, userId, serviceId, SERVICE_NAME, price, email, typedPhone ? typed(phone) : phone, SLOT, status, providerId]
    );
    const id = /** @type {number} */ (made.insertId);
    const [{ day }] = await rows("SELECT DATE_FORMAT(job_date, '%Y-%m-%d') AS day FROM bookings WHERE id = ?", [id]);
    return { id, number, email, phone, day, price };
}

async function mkQuote({ phone = null, name = 'Rhea Rowe', userId = null } = {}) {
    const email = mail('q');
    const made = await execute(
        "INSERT INTO quote_requests (user_id, service_id, service_name, customer_name, customer_email, customer_phone, address, message, answers, picks) VALUES (?, ?, ?, ?, ?, ?, NULL, 'Probe message', '{}', '[]')",
        [userId, serviceId, SERVICE_NAME, name, email, phone]
    );
    return { id: /** @type {number} */ (made.insertId), email };
}

async function mkLink(bookingId, { off = false } = {}) {
    const token = newLinkToken();
    const made = await execute(`INSERT INTO job_links (booking_id, token, off_at) VALUES (?, ?, ${off ? 'NOW()' : 'NULL'})`, [bookingId, token]);
    return { id: /** @type {number} */ (made.insertId), token };
}

async function mkMember(providerId, name, phone = nextNumber()) {
    const made = await execute('INSERT INTO provider_crew_members (provider_id, name, phone) VALUES (?, ?, ?)', [providerId, name, phone]);
    return { id: /** @type {number} */ (made.insertId), name, phone };
}

const putOnJob = (bookingId, memberId, secondsLater = 0) =>
    execute('INSERT INTO booking_crew (booking_id, crew_member_id, assigned_at) VALUES (?, ?, NOW() + INTERVAL ? SECOND)', [bookingId, memberId, secondsLater]);

const checkNumber = (member) =>
    execute('INSERT INTO crew_number_checks (crew_member_id, phone, code_hash, expires_at, used_at) VALUES (?, ?, ?, NOW() + INTERVAL 1 DAY, NOW())', [member.id, member.phone, sha256Hex(`n${member.id}${RUN}`)]);

const NOTE = 'PROBE NOTE the customer was rude and the dog bit me';
const PHOTO = '/uploads/probe-secret-photo.jpg';

async function mkReport(bookingId, linkId, { type = 'no_answer', by = 'cleaner', ref }) {
    const made = await execute(
        'INSERT INTO job_reports (booking_id, link_id, report_type, note, photo_url, reporter_kind, reporter_ref) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [bookingId, linkId, type, NOTE, PHOTO, by, ref]
    );
    return /** @type {number} */ (made.insertId);
}

// ---- reading back ----

const rowsOfBooking = (bookingId) => rows('SELECT channel, outcome, recipient_kind, recipient_ref, kind, event_key FROM notice_attempts WHERE booking_id = ? ORDER BY id', [bookingId]);
const maxId = async () => Number((await rows('SELECT COALESCE(MAX(id), 0) AS m FROM notice_attempts'))[0].m);
const quoteRowsSince = (mark) => rows("SELECT channel, outcome, recipient_kind, recipient_ref, kind FROM notice_attempts WHERE id > ? AND booking_id IS NULL AND kind = 'quote_requested' ORDER BY id", [mark]);
const brief = (list) => list.map((row) => [row.recipient_kind, row.channel, row.outcome]);

// The recipient's entry in what an event answered, by the person (kind and ref).
const entryOf = (told, to, ref = null) => told.find((entry) => entry.to === to && entry.ref === ref);

// ---- a recording transport ----

/** The transports as `deps`: they answer what they are told to and record what they were given. */
function recorder({ sms, mail: mailAnswer, origin = ORIGIN } = {}) {
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
                return answer(mailAnswer, { success: true, messageId: 'recorded' }, message);
            },
            appOrigin: () => origin,
        },
    };
}

const withEnv = (deps, adminEmail) => ({ ...deps, env: { ADMIN_EMAIL: adminEmail } });
const smsTo = (calls, number) => calls.sms.filter((call) => call.to === number);
const mailTo = (calls, address) => calls.mail.filter((message) => message.to.toLowerCase() === address.toLowerCase());

// The words a notice would have, as templateFor makes them for the same values and the path of its link.
const wordsOf = (kind, values, urlPath) => templateFor(kind, { ...values, url: urlPath === undefined ? undefined : `${ORIGIN}${urlPath}` });
const facts = (b) => ({ n: b.number, service: SERVICE_NAME, date: b.day, slot: SLOT });
const customerFacts = (b) => ({ ...facts(b), name: 'Rhea' });

test.describe('Notice events', () => {
    test.beforeAll(async () => {
        startMax = await maxId();
        const found = await rows('SELECT id FROM services ORDER BY id LIMIT 1');
        if (found.length === 0) throw new Error('the dev database has no service to plant a booking on');
        serviceId = found[0].id;
        await sweep();
    });
    test.beforeEach(async () => {
        numbersUsed = 0;
        await sweep();
    });
    test.afterEach(sweep);

    // ---- the quote form ----

    test('E1 a quote request with a phone: the customer is texted and e-mailed, one row each, with the template\'s words', async () => {
        ranFirst = true;
        const phone = nextNumber();
        const mark = await maxId();
        const quote = await mkQuote({ phone: typed(phone) });
        const { calls, deps } = recorder();
        expect(await noticeQuoteRequested(execute, { quoteRequestId: quote.id }, deps)).toEqual([{ to: 'customer', ref: null, sms: 'sent', email: 'sent' }]);
        const words = wordsOf('quote_requested', { name: 'Rhea', service: SERVICE_NAME });
        expect(calls.sms, 'the number was typed as a person types it').toEqual([{ to: phone, body: words.sms }]);
        expect(calls.mail).toEqual([{ to: quote.email, subject: words.subject, text: words.text }]);
        expect(brief(await quoteRowsSince(mark))).toEqual([['customer', 'sms', 'sent'], ['customer', 'email', 'sent']]);
    });

    test('E2 a quote request without a phone (none, or blanks) is an e-mail only: no text, no refusal row for the text', async () => {
        for (const blank of [null, '', '   ']) {
            const mark = await maxId();
            const quote = await mkQuote({ phone: blank });
            const { calls, deps } = recorder();
            expect(await noticeQuoteRequested(execute, { quoteRequestId: quote.id }, deps), `phone ${JSON.stringify(blank)}`).toEqual([{ to: 'customer', ref: null, sms: null, email: 'sent' }]);
            expect(calls.sms, 'no text').toEqual([]);
            expect(calls.mail.map((message) => message.to)).toEqual([quote.email]);
            expect(brief(await quoteRowsSince(mark)), 'one row: the e-mail').toEqual([['customer', 'email', 'sent']]);
            await sweep();
        }
    });

    test('E3 a third quote request to one number in a day: the text is refused as kind_cap and the e-mail beside it goes', async () => {
        const phone = nextNumber();
        const { calls, deps } = recorder();
        const answers = [];
        let mark = 0;
        for (let i = 0; i < 3; i += 1) {
            mark = await maxId();
            const quote = await mkQuote({ phone: typed(phone) });
            answers.push(await noticeQuoteRequested(execute, { quoteRequestId: quote.id }, deps));
        }
        expect(answers.map((told) => [told[0].sms, told[0].email])).toEqual([['sent', 'sent'], ['sent', 'sent'], ['kind_cap', 'sent']]);
        expect(calls.sms.length, 'two texts reached the number, not three').toBe(2);
        expect(calls.mail.length, 'three e-mails').toBe(3);
        expect(brief(await quoteRowsSince(mark)), 'the third request\'s rows').toEqual([['customer', 'sms', 'kind_cap'], ['customer', 'email', 'sent']]);
    });

    // ---- an admin's on-behalf booking ----

    test('E4 the card link: the text and the e-mail hold /card/{token} with the raw token they were given; the record holds no token; a token of the wrong shape sends nothing', async () => {
        const b = await mkBooking();
        const token = newLinkToken();
        const { calls, deps } = recorder();
        expect(await noticeCardLink(execute, { bookingId: b.id, token }, deps)).toEqual([{ to: 'customer', ref: null, sms: 'sent', email: 'sent' }]);
        const words = wordsOf('card_link', { ...customerFacts(b), price: 10 }, `/card/${token}`);
        expect(calls.sms).toEqual([{ to: b.phone, body: words.sms }]);
        expect(calls.mail).toEqual([{ to: b.email, subject: words.subject, text: words.text }]);
        expect(calls.sms[0].body).toContain(`${ORIGIN}/card/${token}`);
        expect(calls.mail[0].text).toContain(`${ORIGIN}/card/${token}`);
        expect(JSON.stringify(await rowsOfBooking(b.id)), 'the record holds no token').not.toContain(token);

        for (const bad of [undefined, null, '', 'short', 'x'.repeat(42), 'x'.repeat(44), `${'x'.repeat(42)} `, `${'x'.repeat(40)}/..`, 12345]) {
            const none = recorder();
            const { result, lines } = await logsOf(() => noticeCardLink(execute, { bookingId: b.id, token: bad }, none.deps));
            expect(result, `token ${JSON.stringify(bad)}`).toEqual([]);
            expect(lines, 'one fixed line').toEqual([['error', 'Notice error: bad_notice_value']]);
            expect([none.calls.sms.length, none.calls.mail.length], 'nothing sent').toEqual([0, 0]);
        }
    });

    // ---- a booking ----

    test('E5 a four-visit series is one pair of rows, and the same booking again sends nothing more', async () => {
        const b = await mkBooking();
        const { calls, deps } = recorder();
        expect(await noticeBooked(execute, { bookingId: b.id, visits: 4 }, deps)).toEqual([{ to: 'customer', ref: null, sms: 'sent', email: 'sent' }]);
        const words = wordsOf('job_booked', { ...customerFacts(b), visits: 4 });
        expect(calls.sms).toEqual([{ to: b.phone, body: words.sms }]);
        expect(calls.mail).toEqual([{ to: b.email, subject: words.subject, text: words.text }]);
        expect(brief(await rowsOfBooking(b.id))).toEqual([['customer', 'sms', 'sent'], ['customer', 'email', 'sent']]);
        const again = recorder();
        expect(await noticeBooked(execute, { bookingId: b.id, visits: 4 }, again.deps)).toEqual([{ to: 'customer', ref: null, sms: 'duplicate', email: 'duplicate' }]);
        expect([again.calls.sms.length, again.calls.mail.length]).toEqual([0, 0]);
        expect((await rowsOfBooking(b.id)).length, 'no new row').toBe(2);
        // A count that is not a plausible number of visits is not shown: it is a booking of one.
        for (const odd of [0, 1.5, -2, 401, '4', NaN]) {
            const other = await mkBooking();
            const probe = recorder();
            await noticeBooked(execute, { bookingId: other.id, visits: odd }, probe.deps);
            expect(probe.calls.sms[0].body, `visits ${String(odd)}`).toBe(wordsOf('job_booked', customerFacts(other)).sms);
        }
    });

    // ---- an assignment, a reassign, a claim ----

    test('E6 an assignment tells an active provider by text and e-mail with the link to Job Requests, and any other status is not_active with no call', async () => {
        const provider = await mkProvider();
        const b = await mkBooking({ providerId: provider.id });
        const { calls, deps } = recorder();
        expect(await noticeAssigned(execute, { bookingId: b.id, providerId: provider.id }, deps)).toEqual([{ to: 'provider', ref: provider.id, sms: 'sent', email: 'sent' }]);
        const words = wordsOf('job_assigned', facts(b), '/provider/jobs');
        expect(calls.sms).toEqual([{ to: provider.phone, body: words.sms }]);
        expect(calls.mail).toEqual([{ to: provider.email, subject: words.subject, text: words.text }]);
        expect(calls.mail[0].text).toContain(`${ORIGIN}/provider/jobs`);

        for (const status of ['inactive', 'pending', 'rejected', 'suspended']) {
            const held = await mkProvider({ status });
            const job = await mkBooking({ providerId: held.id });
            const none = recorder();
            expect(await noticeAssigned(execute, { bookingId: job.id, providerId: held.id }, none.deps), status).toEqual([{ to: 'provider', ref: held.id, sms: 'not_active', email: 'not_active' }]);
            expect([none.calls.sms.length, none.calls.mail.length], `${status}: no call`).toEqual([0, 0]);
        }
    });

    test('E7 a reassign tells the new provider only: the old provider no longer holds the job, so nothing is sent to them', async () => {
        const first = await mkProvider();
        const second = await mkProvider();
        const b = await mkBooking({ providerId: first.id });
        await execute('UPDATE bookings SET provider_id = ? WHERE id = ?', [second.id, b.id]);
        const { calls, deps } = recorder();
        expect(await noticeAssigned(execute, { bookingId: b.id, providerId: first.id }, deps), 'the old provider').toEqual([]);
        expect(await noticeAssigned(execute, { bookingId: b.id, providerId: second.id }, deps), 'the new provider').toEqual([{ to: 'provider', ref: second.id, sms: 'sent', email: 'sent' }]);
        expect(smsTo(calls, first.phone), 'no text to the old provider').toEqual([]);
        expect(mailTo(calls, first.email), 'no e-mail to the old provider').toEqual([]);
        expect(smsTo(calls, second.phone).length).toBe(1);
        expect(brief(await rowsOfBooking(b.id))).toEqual([['provider', 'sms', 'sent'], ['provider', 'email', 'sent']]);
        // A job nobody holds, a provider who does not exist and a booking that does not exist tell no one.
        await execute('UPDATE bookings SET provider_id = NULL WHERE id = ?', [b.id]);
        expect(await noticeAssigned(execute, { bookingId: b.id, providerId: second.id }, deps)).toEqual([]);
        expect(await noticeAssigned(execute, { bookingId: b.id, providerId: 2_000_000_000 }, deps)).toEqual([]);
        expect(await noticeAssigned(execute, { bookingId: 2_000_000_000, providerId: second.id }, deps)).toEqual([]);
    });

    test('E8 a claim tells the customer and the provider on both channels, and the customer is reached through the booking\'s own contact: a booking with no account, and an account whose own contact differs', async () => {
        const provider = await mkProvider();
        // No account: the F10 shape, where a join on users gives NULL.
        const guest = await mkBooking({ providerId: provider.id, typedPhone: true });
        const { calls, deps } = recorder();
        const told = await noticeClaimed(execute, { bookingId: guest.id, providerId: provider.id }, deps);
        expect(told).toEqual([
            { to: 'customer', ref: null, sms: 'sent', email: 'sent' },
            { to: 'provider', ref: provider.id, sms: 'sent', email: 'sent' },
        ]);
        const forCustomer = wordsOf('job_claimed', { audience: 'customer', ...customerFacts(guest) });
        const forProvider = wordsOf('job_claimed', { audience: 'provider', ...facts(guest) }, '/provider/jobs');
        expect(calls.sms).toEqual([{ to: guest.phone, body: forCustomer.sms }, { to: provider.phone, body: forProvider.sms }]);
        expect(calls.mail).toEqual([
            { to: guest.email, subject: forCustomer.subject, text: forCustomer.text },
            { to: provider.email, subject: forProvider.subject, text: forProvider.text },
        ]);
        expect(forCustomer.sms, 'the two audiences are told different things').not.toBe(forProvider.sms);
        expect(await usedOf(budgetScope('provider', provider.id)), 'both texts count against the claimer').toBe(2);

        // A second attempt by the same provider on the same booking sends nothing more (E20, the library half).
        const second = recorder();
        const again = await noticeClaimed(execute, { bookingId: guest.id, providerId: provider.id }, second.deps);
        expect(again.map((entry) => [entry.to, entry.sms, entry.email])).toEqual([['customer', 'duplicate', 'duplicate'], ['provider', 'duplicate', 'duplicate']]);
        expect([second.calls.sms.length, second.calls.mail.length]).toEqual([0, 0]);
        expect((await rowsOfBooking(guest.id)).length, 'four rows and no more').toBe(4);
        // A claim that does not stand (the booking is another provider's now) tells no one.
        const other = await mkProvider();
        expect(await noticeClaimed(execute, { bookingId: guest.id, providerId: other.id }, second.deps)).toEqual([]);

        // An account whose own phone and address differ from the ones typed on the booking: only the booking's are used.
        const accountPhone = nextNumber();
        const account = await mkUser({ phone: accountPhone, label: 'acct' });
        const held = await mkBooking({ providerId: provider.id, userId: account.id });
        const mixed = recorder();
        const toldHeld = await noticeClaimed(execute, { bookingId: held.id, providerId: provider.id }, mixed.deps);
        expect(entryOf(toldHeld, 'customer', account.id), 'the pointer to the account is kept').toEqual({ to: 'customer', ref: account.id, sms: 'sent', email: 'sent' });
        expect(smsTo(mixed.calls, held.phone).length, 'the booking\'s number was texted').toBe(1);
        expect(mailTo(mixed.calls, held.email).length, 'the booking\'s address was written to').toBe(1);
        expect(smsTo(mixed.calls, accountPhone), 'the account\'s number was not').toEqual([]);
        expect(mailTo(mixed.calls, account.email), 'the account\'s address was not').toEqual([]);
    });

    // ---- a job link ----

    test('E9 a job link texts the cleaners on the job: a checked number is sent, an unchecked one is unchecked and a number outside Canada is cannot_text; the same call again sends nothing more', async () => {
        const provider = await mkProvider();
        const b = await mkBooking({ providerId: provider.id });
        const link = await mkLink(b.id);
        const checked = await mkMember(provider.id, 'A checked');
        const unchecked = await mkMember(provider.id, 'B unchecked');
        const abroad = await mkMember(provider.id, 'C abroad', '+442079460958');
        for (const member of [checked, unchecked, abroad]) await putOnJob(b.id, member.id);
        await checkNumber(checked);

        const { calls, deps } = recorder();
        const told = await noticeJobLink(execute, { bookingId: b.id }, deps);
        expect(told.map((entry) => [entry.to, entry.ref, entry.sms, entry.email])).toEqual([
            ['cleaner', checked.id, 'sent', null],
            ['cleaner', unchecked.id, 'unchecked', null],
            ['cleaner', abroad.id, 'cannot_text', null],
        ]);
        const words = wordsOf('job_link', { n: b.number }, `/job/${link.token}`);
        expect(calls.sms, 'one text, to the checked number, with the link').toEqual([{ to: checked.phone, body: words.sms }]);
        expect(calls.mail, 'a cleaner has no address on file').toEqual([]);
        expect(brief(await rowsOfBooking(b.id))).toEqual([['cleaner', 'sms', 'sent'], ['cleaner', 'sms', 'unchecked'], ['cleaner', 'sms', 'cannot_text']]);
        expect(await usedOf(budgetScope('provider', provider.id)), 'the text counts against the job\'s owner').toBe(1);

        const second = recorder();
        const again = await noticeJobLink(execute, { bookingId: b.id }, second.deps);
        expect(again.map((entry) => entry.sms)).toEqual(['duplicate', 'unchecked', 'cannot_text']);
        expect(second.calls.sms, 'nothing more is sent').toEqual([]);
    });

    test('E10 a reissued link texts the checked member again with the new token, and a member put on the job again is texted again', async () => {
        const provider = await mkProvider();
        const b = await mkBooking({ providerId: provider.id });
        const link = await mkLink(b.id);
        const member = await mkMember(provider.id, 'A checked');
        await putOnJob(b.id, member.id);
        await checkNumber(member);
        const { calls, deps } = recorder();
        expect((await noticeJobLink(execute, { bookingId: b.id }, deps)).map((entry) => entry.sms)).toEqual(['sent']);

        const reissued = newLinkToken();
        await execute('UPDATE job_links SET token = ?, generation = generation + 1 WHERE id = ?', [reissued, link.id]);
        expect((await noticeJobLink(execute, { bookingId: b.id }, deps)).map((entry) => entry.sms), 'a new generation is a new notice').toEqual(['sent']);
        expect(calls.sms.length).toBe(2);
        expect(calls.sms[0].body).toContain(`/job/${link.token}`);
        expect(calls.sms[1].body).toContain(`/job/${reissued}`);
        expect(calls.sms[1].body, 'the old token is gone from the new text').not.toContain(link.token);
        expect((await noticeJobLink(execute, { bookingId: b.id }, deps)).map((entry) => entry.sms), 'the same generation again is not').toEqual(['duplicate']);

        // Taken off and put on again: a new assignment, so a new key.
        await execute('DELETE FROM booking_crew WHERE booking_id = ? AND crew_member_id = ?', [b.id, member.id]);
        await putOnJob(b.id, member.id, 30);
        expect((await noticeJobLink(execute, { bookingId: b.id }, deps)).map((entry) => entry.sms)).toEqual(['sent']);
        expect(calls.sms.length, 'three texts in all').toBe(3);
    });

    test('E11 a crew save that adds one member texts that member only', async () => {
        const provider = await mkProvider();
        const b = await mkBooking({ providerId: provider.id });
        const link = await mkLink(b.id);
        const first = await mkMember(provider.id, 'A first');
        const added = await mkMember(provider.id, 'B added');
        await putOnJob(b.id, first.id);
        await checkNumber(first);
        await checkNumber(added);
        const { calls, deps } = recorder();
        await noticeJobLink(execute, { bookingId: b.id }, deps);
        expect(calls.sms.map((call) => call.to)).toEqual([first.phone]);

        await putOnJob(b.id, added.id);
        const told = await noticeJobLink(execute, { bookingId: b.id, memberIds: [added.id] }, deps);
        expect(told.map((entry) => [entry.ref, entry.sms])).toEqual([[added.id, 'sent']]);
        expect(calls.sms.map((call) => call.to), 'one more text, to the new member').toEqual([first.phone, added.phone]);
        expect(calls.sms[1].body).toContain(`/job/${link.token}`);
        // A member who is not on the job is not texted by asking for them.
        const stranger = await mkMember(provider.id, 'C stranger');
        await checkNumber(stranger);
        expect(await noticeJobLink(execute, { bookingId: b.id, memberIds: [stranger.id] }, deps)).toEqual([]);
        expect(await noticeJobLink(execute, { bookingId: b.id, memberIds: ['1'] }, deps), 'ids that are not ids').toEqual([]);
    });

    test('E12 a number that has just passed its check is texted for each open job with a link on, and for no job whose status closed the link, whose link is off or that is not theirs', async () => {
        const provider = await mkProvider();
        const member = await mkMember(provider.id, 'A member');
        const jobs = {
            confirmed: await mkBooking({ providerId: provider.id, status: 'confirmed' }),
            running: await mkBooking({ providerId: provider.id, status: 'in_progress' }),
            closed: await mkBooking({ providerId: provider.id, status: 'awaiting_approval' }),
            off: await mkBooking({ providerId: provider.id, status: 'confirmed' }),
            elsewhere: await mkBooking({ providerId: provider.id, status: 'confirmed' }),
        };
        const links = {
            confirmed: await mkLink(jobs.confirmed.id),
            running: await mkLink(jobs.running.id),
            closed: await mkLink(jobs.closed.id),
            off: await mkLink(jobs.off.id, { off: true }),
            elsewhere: await mkLink(jobs.elsewhere.id),
        };
        for (const key of ['confirmed', 'running', 'closed', 'off']) await putOnJob(jobs[key].id, member.id);
        // elsewhere has a link but the member is not on it.

        const before = recorder();
        const refused = await noticeJobLinksOfMember(execute, { memberId: member.id }, before.deps);
        expect(refused.map((entry) => entry.sms), 'before the check: unchecked, once for each open job with a link on').toEqual(['unchecked', 'unchecked']);
        expect(before.calls.sms).toEqual([]);

        await checkNumber(member);
        const { calls, deps } = recorder();
        const told = await noticeJobLinksOfMember(execute, { memberId: member.id }, deps);
        expect(told.map((entry) => [entry.ref, entry.sms])).toEqual([[member.id, 'sent'], [member.id, 'sent']]);
        expect(calls.sms.map((call) => call.to), 'the member\'s number, twice').toEqual([member.phone, member.phone]);
        const bodies = calls.sms.map((call) => call.body);
        expect(bodies.some((body) => body.includes(links.confirmed.token))).toBe(true);
        expect(bodies.some((body) => body.includes(links.running.token))).toBe(true);
        for (const key of ['closed', 'off', 'elsewhere']) expect(bodies.some((body) => body.includes(links[key].token)), `no text for the ${key} job`).toBe(false);

        const second = recorder();
        const again = await noticeJobLinksOfMember(execute, { memberId: member.id }, second.deps);
        expect(again.map((entry) => entry.sms)).toEqual(['duplicate', 'duplicate']);
        expect(second.calls.sms).toEqual([]);

        // A member who has been removed is not texted.
        await execute('UPDATE provider_crew_members SET removed_at = NOW() WHERE id = ?', [member.id]);
        expect(await noticeJobLinksOfMember(execute, { memberId: member.id }, second.deps)).toEqual([]);
    });

    test('E13 a link that is off, a job that is not open, an owner who is not active or a job nobody holds texts no one and writes no row', async () => {
        const provider = await mkProvider();
        const idle = await mkProvider({ status: 'inactive' });
        const cases = [];
        const add = async (why, { owner = provider, status = 'confirmed', off = false } = {}) => {
            const b = await mkBooking({ providerId: owner === null ? null : owner.id, status });
            if (owner !== null) {
                const link = await mkLink(b.id, { off });
                const member = await mkMember(owner.id, 'A member');
                await putOnJob(b.id, member.id);
                await checkNumber(member);
                cases.push({ why, b, link });
            } else {
                cases.push({ why, b });
            }
        };
        await add('the link is off', { off: true });
        for (const status of ['awaiting_approval', 'completed', 'cancelled', 'disputed']) await add(`the job is ${status}`, { status });
        await add('the owner is not active', { owner: idle });
        await add('nobody holds the job', { owner: null });
        const { calls, deps } = recorder();
        for (const { why, b } of cases) {
            expect(await noticeJobLink(execute, { bookingId: b.id }, deps), why).toEqual([]);
            expect(await rowsOfBooking(b.id), `${why}: no row`).toEqual([]);
        }
        expect([calls.sms.length, calls.mail.length]).toEqual([0, 0]);
    });

    // ---- an on-site report ----

    test('E14 a report tells the owning provider and each admin (one without a phone is only e-mailed, an address is told once however it is listed), never the one who sent it; a replay tells no one', async () => {
        const provider = await mkProvider();
        const b = await mkBooking({ providerId: provider.id });
        const link = await mkLink(b.id);
        const member = await mkMember(provider.id, 'A cleaner');
        await putOnJob(b.id, member.id);
        const adminPhone = nextNumber();
        const admin = await mkUser({ role: 'admin', phone: adminPhone, label: 'admin' });
        const quiet = await mkUser({ role: 'admin', phone: null, label: 'quiet' });
        const bystander = await mkUser({ role: 'user', phone: nextNumber(), label: 'bystander' });
        const mine = [provider.phone, adminPhone, provider.email.toLowerCase(), admin.email.toLowerCase(), quiet.email.toLowerCase()];
        const reportId = await mkReport(b.id, link.id, { type: 'no_answer', by: 'cleaner', ref: member.id });

        // ADMIN_EMAIL names an admin who is already a user, in capitals: still one notice for that address.
        const { calls, deps } = recorder();
        const told = await noticeReport(execute, { reportId }, withEnv(deps, admin.email.toUpperCase()));
        expect(entryOf(told, 'provider', provider.id)).toEqual({ to: 'provider', ref: provider.id, sms: 'sent', email: 'sent' });
        expect(entryOf(told, 'admin', admin.id)).toEqual({ to: 'admin', ref: admin.id, sms: 'sent', email: 'sent' });
        expect(entryOf(told, 'admin', quiet.id), 'no phone: refused as no_contact, e-mailed').toEqual({ to: 'admin', ref: quiet.id, sms: 'no_contact', email: 'sent' });
        expect(told.filter((entry) => entry.to === 'admin' && entry.ref === null), 'the address in ADMIN_EMAIL is already an admin').toEqual([]);
        expect(smsTo(calls, bystander.phone), 'a customer\'s account is not on the admin team').toEqual([]);
        expect(mailTo(calls, bystander.email)).toEqual([]);
        expect(mailTo(calls, admin.email).length, 'one e-mail to that address').toBe(1);
        expect(smsTo(calls, adminPhone).length).toBe(1);
        expect(smsTo(calls, provider.phone).length).toBe(1);
        // Every text a report sends, the owner's and each admin's, is spent against the job's owner (the fixtures' own admins are texted too, so it is the count of calls).
        expect(await usedOf(budgetScope('provider', provider.id)), 'each text of a report counts against the job\'s owner').toBe(calls.sms.length);
        const forProvider = wordsOf('report_added', { n: b.number, label: 'Customer did not answer' }, '/provider/jobs');
        const forAdmin = wordsOf('report_added', { n: b.number, label: 'Customer did not answer' }, '/admin/jobs');
        expect(smsTo(calls, provider.phone)[0].body).toBe(forProvider.sms);
        expect(mailTo(calls, provider.email)[0]).toEqual({ to: provider.email, subject: forProvider.subject, text: forProvider.text });
        expect(mailTo(calls, admin.email)[0].text).toBe(forAdmin.text);
        expect(mailTo(calls, admin.email)[0].text).toContain(`${ORIGIN}/admin/jobs`);

        // E15: the words hold the report's fixed label and the booking number, and never the note or the photo's address.
        const everything = JSON.stringify([calls.sms.filter((call) => mine.includes(call.to)), calls.mail.filter((message) => mine.includes(message.to.toLowerCase()))]);
        expect(everything).toContain('Customer did not answer');
        expect(everything).toContain(b.number);
        expect(everything, 'no note').not.toContain(NOTE.slice(0, 12));
        expect(everything, 'no photo address').not.toContain(PHOTO);
        expect(everything, 'no photo address, by its name').not.toContain('probe-secret-photo');

        // A replay tells no one new.
        const replay = recorder();
        await noticeReport(execute, { reportId }, withEnv(replay.deps, admin.email.toUpperCase()));
        expect(replay.calls.sms.filter((call) => mine.includes(call.to)), 'no text to a person of this case').toEqual([]);
        expect(replay.calls.mail.filter((message) => mine.includes(message.to.toLowerCase())), 'no e-mail to a person of this case').toEqual([]);

        // An address in ADMIN_EMAIL that is not a user is told, by e-mail only.
        const extra = mail('extra');
        const second = recorder();
        const reportTwo = await mkReport(b.id, link.id, { type: 'unhygienic', by: 'cleaner', ref: member.id });
        const toldTwo = await noticeReport(execute, { reportId: reportTwo }, withEnv(second.deps, extra));
        expect(entryOf(toldTwo, 'admin', null)).toEqual({ to: 'admin', ref: null, sms: 'no_contact', email: 'sent' });
        expect(mailTo(second.calls, extra).length).toBe(1);
    });

    test('E14 a provider who sent the report is not told it, and an admin who sent it is not told it; everyone else is', async () => {
        const provider = await mkProvider();
        const b = await mkBooking({ providerId: provider.id });
        const link = await mkLink(b.id);
        const sender = await mkUser({ role: 'admin', phone: nextNumber(), label: 'sender' });
        const other = await mkUser({ role: 'admin', phone: nextNumber(), label: 'other' });

        const byProvider = await mkReport(b.id, link.id, { type: 'add_items', by: 'provider', ref: provider.id });
        const first = recorder();
        const toldFirst = await noticeReport(execute, { reportId: byProvider }, withEnv(first.deps, ''));
        expect(entryOf(toldFirst, 'provider', provider.id), 'the provider sent it').toBeUndefined();
        expect(smsTo(first.calls, provider.phone)).toEqual([]);
        expect(mailTo(first.calls, provider.email)).toEqual([]);
        expect(entryOf(toldFirst, 'admin', sender.id)?.sms, 'the admins are told').toBe('sent');
        expect(entryOf(toldFirst, 'admin', other.id)?.sms).toBe('sent');

        const byAdmin = await mkReport(b.id, link.id, { type: 'cannot_complete', by: 'admin', ref: sender.id });
        const second = recorder();
        const toldSecond = await noticeReport(execute, { reportId: byAdmin }, withEnv(second.deps, ''));
        expect(entryOf(toldSecond, 'admin', sender.id), 'the admin sent it').toBeUndefined();
        expect(smsTo(second.calls, sender.phone)).toEqual([]);
        expect(mailTo(second.calls, sender.email)).toEqual([]);
        expect(entryOf(toldSecond, 'provider', provider.id)?.sms, 'the provider is told').toBe('sent');
        expect(entryOf(toldSecond, 'admin', other.id)?.sms).toBe('sent');
        expect(smsTo(second.calls, other.phone).length).toBe(1);
    });

    // ---- the start and the finish ----

    test('E16 the start and the finish reach a customer with no account; a restart is another notice; the finish says when a guest\'s card is charged, which an account holder\'s does not', async () => {
        const provider = await mkProvider();
        const guest = await mkBooking({ providerId: provider.id });
        const { calls, deps } = recorder();
        const start = { bookingId: guest.id, startEpoch: 1_800_000_000, workers: 2, hours: 4 };
        expect(await noticeJobStarted(execute, start, deps)).toEqual([{ to: 'customer', ref: null, sms: 'sent', email: null }]);
        expect(calls.sms).toEqual([{ to: guest.phone, body: wordsOf('job_started', { n: guest.number, workers: 2, hours: 4, price: 10 }).sms }]);
        expect(calls.mail, 'the start has no e-mail').toEqual([]);
        expect(await usedOf(budgetScope('provider', provider.id)), 'the start text counts against the provider who started').toBe(1);
        expect((await noticeJobStarted(execute, start, deps))[0].sms, 'the same start again').toBe('duplicate');
        expect((await noticeJobStarted(execute, { ...start, startEpoch: 1_800_000_900 }, deps))[0].sms, 'a start after a pause is another notice').toBe('sent');
        expect(calls.sms.length).toBe(2);
        expect(await usedOf(budgetScope('provider', provider.id)), 'the same start again counted nothing, and the restart counted one').toBe(2);
        for (const startEpoch of [undefined, 0, -5, 1.5, '1800000000']) {
            expect(await noticeJobStarted(execute, { ...start, startEpoch }, deps), `startEpoch ${String(startEpoch)}`).toEqual([]);
        }

        const member = await mkUser({ phone: nextNumber(), label: 'acct' });
        const held = await mkBooking({ providerId: provider.id, userId: member.id });
        const done = recorder();
        expect(await noticeJobFinished(execute, { bookingId: guest.id }, done.deps)).toEqual([{ to: 'customer', ref: null, sms: 'sent', email: 'sent' }]);
        // An account holder is told by text only: their e-mail is the finish route's own (the summary and the photos), which e2e/job-completed-email.spec.js pins.
        expect(await noticeJobFinished(execute, { bookingId: held.id }, done.deps)).toEqual([{ to: 'customer', ref: member.id, sms: 'sent', email: null }]);
        expect(await usedOf(budgetScope('provider', provider.id)), 'each finish text counts against the provider who finished, on top of the two starts').toBe(4);
        const guestWords = wordsOf('job_finished', { n: guest.number, name: 'Rhea', service: SERVICE_NAME, guest: true, hours: AUTO_RELEASE_HOURS });
        const holderWords = wordsOf('job_finished', { n: held.number, name: 'Rhea', service: SERVICE_NAME, guest: false, hours: AUTO_RELEASE_HOURS });
        expect(smsTo(done.calls, guest.phone)).toEqual([{ to: guest.phone, body: guestWords.sms }]);
        expect(smsTo(done.calls, held.phone)).toEqual([{ to: held.phone, body: holderWords.sms }]);
        expect(guestWords.sms).toContain(`${AUTO_RELEASE_HOURS} hours`);
        expect(holderWords.sms, 'an account holder is asked to approve').toContain('approve');
        expect(holderWords.sms).not.toContain(`${AUTO_RELEASE_HOURS} hours`);
        expect(mailTo(done.calls, guest.email)[0].text).toContain(`${AUTO_RELEASE_HOURS} hours`);
        expect(mailTo(done.calls, held.email), 'an account holder is sent no notice e-mail').toEqual([]);
        expect(await noticeJobFinished(execute, { bookingId: guest.id }, done.deps)).toEqual([{ to: 'customer', ref: null, sms: 'duplicate', email: 'duplicate' }]);
    });

    // ---- the ceiling and the failures ----

    test('E17 the platform ceiling stops the text and the e-mail beside it goes', async () => {
        const b = await mkBooking();
        await execute('INSERT INTO sms_budget (scope, window_started_at, used) VALUES (?, NOW(), ?) ON DUPLICATE KEY UPDATE used = ?, window_started_at = NOW()', [budgetScope('platform', 'day'), TEXTS_PER_PLATFORM_DAY, TEXTS_PER_PLATFORM_DAY]);
        const { calls, deps } = recorder();
        expect(await noticeBooked(execute, { bookingId: b.id }, deps)).toEqual([{ to: 'customer', ref: null, sms: 'platform_cap', email: 'sent' }]);
        expect(calls.sms, 'no text').toEqual([]);
        expect(calls.mail.map((message) => message.to)).toEqual([b.email]);
        expect(brief(await rowsOfBooking(b.id))).toEqual([['customer', 'sms', 'platform_cap'], ['customer', 'email', 'sent']]);
    });

    test('E18 a transport that throws is an error outcome and one fixed line, never an exception; a database that throws is an empty answer and one fixed line with no SQL in it', async () => {
        const b = await mkBooking();
        const boom = recorder({
            sms: () => { throw new Error(`sms down for ${b.phone}`); },
            mail: () => { throw new Error(`smtp down for ${b.email}`); },
        });
        const { result, lines } = await logsOf(() => noticeBooked(execute, { bookingId: b.id }, boom.deps));
        expect(result).toEqual([{ to: 'customer', ref: null, sms: 'error', email: 'error' }]);
        expect(lines.length, 'a line for each failure and no more').toBeGreaterThan(0);
        for (const [, text] of lines) {
            expect(text).toMatch(/^Notice error: [A-Za-z0-9_]+$/);
            expect(text).not.toContain(b.phone);
            expect(text).not.toContain(b.email);
        }

        const broken = async () => { throw Object.assign(new Error('SELECT secret FROM somewhere'), { code: 'ER_PROBE' }); };
        for (const [name, event] of Object.entries(NOTICE_EVENTS)) {
            const none = recorder();
            const out = await logsOf(() => event(broken, { bookingId: 1, quoteRequestId: 1, reportId: 1, memberId: 1, providerId: 1, startEpoch: 1, token: newLinkToken() }, none.deps));
            expect(out.result, name).toEqual([]);
            expect(out.lines, `${name}: one fixed line`).toEqual([['error', 'Notice error: ER_PROBE']]);
            expect([none.calls.sms.length, none.calls.mail.length]).toEqual([0, 0]);
        }
    });

    test('a request that names nothing real tells no one and never throws: no values, bad ids, a row that is not there', async () => {
        const events = { ...NOTICE_EVENTS, noticeJobLinksOfMember };
        const { calls, deps } = recorder();
        for (const [name, event] of Object.entries(events)) {
            for (const bad of [undefined, {}, { bookingId: 'x' }, { bookingId: -1 }, { bookingId: 1.5 }, { bookingId: 2 ** 60 }, { quoteRequestId: 'x' }, { reportId: 0 }, { memberId: null }]) {
                const { result, lines } = await logsOf(() => event(execute, bad, deps));
                expect(result, `${name} ${JSON.stringify(bad)}`).toEqual([]);
                for (const [, text] of lines) expect(text).toMatch(/^Notice error: [A-Za-z0-9_]+$/);
            }
            const absent = { bookingId: 2_000_000_000, quoteRequestId: 2_000_000_000, reportId: 2_000_000_000, memberId: 2_000_000_000, providerId: 2_000_000_000, startEpoch: 1_800_000_000, token: newLinkToken() };
            expect(await event(execute, absent, deps), `${name}: a row that is not there`).toEqual([]);
        }
        expect([calls.sms.length, calls.mail.length], 'nothing was sent').toEqual([0, 0]);
    });

    // ---- the pins ----

    test('the events are the kinds: one function for each of NOTICE_KINDS and no other, frozen', () => {
        expect(Object.keys(NOTICE_EVENTS).sort()).toEqual([...NOTICE_KINDS].sort());
        expect(Object.isFrozen(NOTICE_EVENTS)).toBe(true);
        for (const [kind, event] of Object.entries(NOTICE_EVENTS)) expect(typeof event, kind).toBe('function');
    });

    test('the auto-release sweep takes its window from the one constant the finish notice says, and does not spell it as a number', () => {
        const source = fs.readFileSync(path.join(ROOT, 'src/app/api/cron/auto-release/route.js'), 'utf8');
        expect(source).toMatch(/import \{ AUTO_RELEASE_HOURS \} from '@\/lib\/auto-release'/);
        expect(source).toContain('INTERVAL ${AUTO_RELEASE_HOURS} HOUR');
        expect(source, 'no INTERVAL spelled as a number').not.toMatch(/INTERVAL\s+\d+\s+HOUR/i);
        expect(AUTO_RELEASE_HOURS).toBe(24);
    });

    test('no line this file logged holds a number, an address, a name, a link or a token', () => {
        test.skip(!ranFirst, 'a case failed and the worker restarted, so there is nothing logged to read');
        const secrets = [EMAIL_PREFIX, 'Rhea', 'Rowe', 'Probe', '/card/', '/job/', 'smtp down', 'sms down'];
        for (let i = 0; i < BLOCK_SIZE; i += 1) secrets.push(e164At(i), typed(e164At(i)), e164At(i).slice(2));
        // The only lines the libraries write are fixed ones: the error line of notices.js and notice-events.js, and the platform ceiling's own (E17).
        for (const { text } of captured) {
            expect(text, 'a logged line').toMatch(/^(Notice error: [A-Za-z0-9_]+|SMS platform ceiling reached)$/);
            for (const secret of secrets) expect(text).not.toContain(secret);
        }
        expect(captured.length, 'the cases did log the lines this case reads').toBeGreaterThan(0);
    });
});
