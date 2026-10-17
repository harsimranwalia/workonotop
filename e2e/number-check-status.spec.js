// e2e/number-check-status.spec.js
//
// ENG-018, code review round 1, finding B1 (ENG-015 security review, F1, fix (2): "status = 'active' required for any route that sends"): the ask for a number
// check (src/lib/crew-number-check.js, askNumberCheck, behind POST /api/provider/crew/[id]/number-check) texts a six-digit code to a cleaner's number and spends
// three day counters to do it: the number's, the provider's and the PLATFORM's (500 a day for every provider together; once it is spent every text the platform
// sends is switched off until the day turns). A public sign-up makes a provider 'inactive' until an admin approves them, and such a provider can sign in (login
// refuses a status of 'rejected' and, for a status that is not 'active', an unverified e-mail address), while requireCaller reads no table. So the ask has to read
// the provider's status itself: after it has found the member (a member that is not the caller's is the same 404 for everyone) and before it spends anything.
// confirmNumberCheck sends no text and is not in question.
//
// The cases (the numbers are this file's own):
//   S1-S4  the library, for a provider whose status is inactive, pending, rejected, suspended: 403 'Your account is not active yet.', the transport is not called,
//          no code row is made, and none of the four counters the ask spends (the member's one-a-minute, the number's, the provider's, the platform's) moves
//   S5     the library, for an active provider: the ask is served and each of those four counters moves by one, so that S1-S4's "as they were" is about counters
//          that do move
//   S6     the route, for a signed-in provider whose status has become inactive: 403 with the same words and no-store, no code row, nothing spent; the same
//          provider made active again asks at once and is served (the refusal did not use up the minute)
//
// The database is the dev database the way e2e/notices-events.spec.js reaches it (mysql2/promise, assertDevTarget before it connects, assertNoRealPeople on it).
// S1-S5 give the library a RECORDING transport, so nothing leaves and nothing here reads a body (it holds the code). S6 asks the running app, whose transport is
// the app's own: its served ask is a real attempt, to a +1403555 number, as the ask cases of e2e/job-link-access.spec.js are, and it reads the answer and the
// code row, never that a text arrived. Every provider this file makes has an e-mail address that starts with EMAIL_PREFIX and every number is in +1403555
// 0500-0519, so the sweep before and after each case removes exactly its own rows and the counters it spent; it also puts the fixture provider S6 uses back to
// 'active'.
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { getCredentialHeaders } from './auth/credentials.js';
import { RESET_RETRIES } from './support/auth.js';
import { providers } from '../database/fixtures/accounts.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';
import { askNumberCheck } from '../src/lib/crew-number-check.js';
import { budgetScope } from '../src/lib/sms-budget.js';

test.use({ trace: 'off' });

const RUN = Date.now().toString(36);
const EMAIL_PREFIX = 'ncs018-';
const FIRST_NUMBER = 500;
const BLOCK_SIZE = 20;
const e164At = (i) => `+1403555${String(FIRST_NUMBER + i).padStart(4, '0')}`;
let numbersUsed = 0;
const nextNumber = () => {
    if (numbersUsed >= BLOCK_SIZE) throw new Error('the case needs more numbers than the block has');
    numbersUsed += 1;
    return e164At(numbersUsed - 1);
};
let seq = 0;
const mail = (label) => `${EMAIL_PREFIX}${label}-${RUN}-${seq++}@notices.test`;
const marks = (list) => list.map(() => '?').join(', ');

const PROVIDER = providers[0];
const NOT_ACTIVE = 'Your account is not active yet.';
const REFUSED = ['inactive', 'pending', 'rejected', 'suspended'];

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

// The library takes `execute` in the shape of src/lib/db.js: the rows for a SELECT, the result header for a write.
async function execute(sql, params = []) {
    const [result] = await (await db()).execute(sql, params);
    return /** @type {any} */ (result);
}
const rows = (sql, params = []) => /** @type {Promise<any[]>} */ (execute(sql, params));

// ---- the sweep: what this file made, and what it spent ----

async function sweep() {
    const open = await db();
    const mine = `${EMAIL_PREFIX}%`;
    const block = Array.from({ length: BLOCK_SIZE }, (_, i) => e164At(i));
    const made = await rows('SELECT id FROM service_providers WHERE email LIKE ?', [mine]);
    // The cleaners this file makes: those of the providers it makes, and those it adds to the fixture provider's list (a number of its block).
    const members = await rows(
        `SELECT id FROM provider_crew_members WHERE provider_id IN (SELECT id FROM service_providers WHERE email LIKE ?) OR (provider_id = ? AND phone IN (${marks(block)}))`,
        [mine, PROVIDER.id, ...block]
    );
    if (members.length > 0) await open.execute(`DELETE FROM provider_crew_members WHERE id IN (${marks(members)})`, members.map((member) => member.id));
    await open.execute('DELETE FROM service_providers WHERE email LIKE ?', [mine]);
    await open.execute("UPDATE service_providers SET status = 'active' WHERE id = ?", [PROVIDER.id]);

    const scopes = [budgetScope('platform', 'day'), budgetScope('provider', PROVIDER.id)];
    for (const number of block) scopes.push(budgetScope('number', number));
    for (const provider of made) scopes.push(budgetScope('provider', provider.id));
    for (const member of members) scopes.push(budgetScope('check_ask', member.id));
    await open.execute(`DELETE FROM sms_budget WHERE scope IN (${marks(scopes)})`, scopes);
}

test.beforeAll(sweep);
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

// ---- rows the cases plant and read (SQL only) ----

async function mkProvider(status) {
    const made = await execute("INSERT INTO service_providers (name, email, phone, password, status) VALUES (?, ?, ?, 'x', ?)", [`Probe ${status}`, mail(status), nextNumber(), status]);
    return { id: /** @type {number} */ (made.insertId) };
}

async function mkMember(providerId, name) {
    const phone = nextNumber();
    const made = await execute('INSERT INTO provider_crew_members (provider_id, name, phone) VALUES (?, ?, ?)', [providerId, name, phone]);
    return { id: /** @type {number} */ (made.insertId), name, phone };
}

const setStatus = (providerId, status) => execute('UPDATE service_providers SET status = ? WHERE id = ?', [status, providerId]);

const codeRowsOf = async (memberId) => Number((await rows('SELECT COUNT(*) AS n FROM crew_number_checks WHERE crew_member_id = ?', [memberId]))[0].n);

async function usedOf(scope) {
    const found = await rows('SELECT used FROM sms_budget WHERE scope = ?', [scope]);
    return found.length === 0 ? null : Number(found[0].used);
}

// The four counters one ask spends (src/lib/crew-number-check.js: the member's one-a-minute, then reserveText's number, provider and platform), null for one never touched.
async function spentOf(member, providerId) {
    return {
        minute: await usedOf(budgetScope('check_ask', member.id)),
        number: await usedOf(budgetScope('number', member.phone)),
        provider: await usedOf(budgetScope('provider', providerId)),
        platform: await usedOf(budgetScope('platform', 'day')),
    };
}

// A transport that records where a text would go and how long it is, never what it says: the body holds the code.
function recorder() {
    /** @type {{ to: string, length: number }[]} */
    const calls = [];
    return {
        calls,
        send: async (to, body) => {
            calls.push({ to, length: String(body).length });
            return true;
        },
    };
}

// ---- the cases ----

test.describe('ENG-018 B1 (ENG-015 F1 fix 2): the ask for a number check needs an active provider', () => {
    for (const [i, status] of REFUSED.entries()) {
        test(`S${i + 1} (${status}): the ask is refused 403, no text is handed over, no code is made and no counter is spent`, async () => {
            const provider = await mkProvider(status);
            const member = await mkMember(provider.id, 'A cleaner');
            const texts = recorder();
            const before = await spentOf(member, provider.id);

            const answer = await askNumberCheck({ execute, sendText: texts.send, providerId: provider.id, memberId: member.id });

            expect(answer, `the ask of a provider whose status is ${status}`).toEqual({ ok: false, status: 403, message: NOT_ACTIVE });
            expect(texts.calls, 'no text is handed to the transport').toEqual([]);
            expect(await codeRowsOf(member.id), 'no code is made').toBe(0);
            expect(await spentOf(member, provider.id), 'the minute, the number, the provider and the platform are as they were').toEqual(before);
        });
    }

    test('S5 (active): the ask is served, the transport is handed the one text, one code is made, and each of the four counters moves by one', async () => {
        const provider = await mkProvider('active');
        const member = await mkMember(provider.id, 'A cleaner');
        const texts = recorder();
        const before = await spentOf(member, provider.id);

        const answer = await askNumberCheck({ execute, sendText: texts.send, providerId: provider.id, memberId: member.id });

        expect(answer, 'the ask of an active provider').toEqual({ ok: true, sent: true });
        expect(texts.calls.map((call) => call.to), 'the one text goes to the cleaner').toEqual([member.phone]);
        expect(await codeRowsOf(member.id), 'a code is made').toBe(1);
        expect(await spentOf(member, provider.id), 'each counter moved by one').toEqual({ minute: 1, number: 1, provider: 1, platform: (before.platform ?? 0) + 1 });
    });

    test('S6: a signed-in provider whose status has become inactive is refused 403 by the route and nothing is made or spent; made active again, the same provider is served at once', async ({ request, baseURL }) => {
        const headers = (await getCredentialHeaders(String(baseURL)))['provider-cookie'];
        const member = await mkMember(PROVIDER.id, 'A cleaner');
        const ask = () => request.fetch(`/api/provider/crew/${member.id}/number-check`, {
            method: 'POST', headers, data: { action: 'ask' }, maxRetries: RESET_RETRIES, timeout: 60_000,
        });
        await setStatus(PROVIDER.id, 'inactive');
        const before = await spentOf(member, PROVIDER.id);

        const refused = await ask();
        expect([refused.status(), refused.headers()['cache-control'], await refused.json()], 'the answer to an inactive provider').toEqual([403, 'no-store', { success: false, message: NOT_ACTIVE }]);
        expect(await codeRowsOf(member.id), 'no code is made').toBe(0);
        expect(await spentOf(member, PROVIDER.id), 'the minute, the number, the provider and the platform are as they were').toEqual(before);

        await setStatus(PROVIDER.id, 'active');
        const served = await ask();
        const body = await served.json();
        expect([served.status(), body.success, body.data?.asked, typeof body.data?.sent], 'the same provider, active, is served at once: the refusal did not use up the minute').toEqual([200, true, true, 'boolean']);
        expect(await codeRowsOf(member.id), 'the code is made').toBe(1);
    });
});
