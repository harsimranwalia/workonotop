// What a Stripe transfer event does to a provider payout (ENG-027, ADR-017). Each case is titled for what it shows:
//   1   reversalOf tells a full reversal, a partial one and none from the transfer alone (plain vectors, no database);
//   2   transfer.created marks the payout of that transfer paid at the time Stripe sent it, with one history line;
//   3   a full reversal fails the payout, flagged reversed or only reported as the whole amount reversed;
//   4   a partial reversal keeps the status and writes one line for each amount;
//   5   an event moves the payout that carries its transfer id and no other payout, not even one of the same booking;
//   6   an event for an unknown transfer that was made for a payout is answered 503 and writes nothing;
//   7   an event for a transfer that no payout was made for is answered 200 and writes nothing;
//   8   an event ahead of its payout row is answered 503 without waiting on the writer, and lands when it is sent again;
//   9   the same event twice, or ten at once, changes the payout once;
//   10  events in any order only move a payout forward;
//   11  no transfer event changes the provider's balances (the retired transfer.paid included);
//   12  a failed history write rolls the move back and is thrown;
//   13  a payout with no booking is moved and writes no history line;
//   14  the route refuses an unsigned request and a changed body, ignores transfer.updated and answers its ping;
//   15  a transfer.reversed that reverses nothing changes nothing, in every status a payout can be moved from;
//   16  the same partial reversal ten at once writes one line (its idempotency is a read, not a status guard, so only the lock's order holds it);
//   17  the library, given an event type it does not know, moves no payout;
//   18  source pins: the library names no balance, moves a payout only by its key and finds the payouts of a transfer with no lock while it
//       locks one row at a time by key; the route verifies the signature first, keeps no handler of its own for the transfer events and
//       leaves no way to match a payout by its booking; every transfer written to a payout carries provider_id, which is how an event
//       ahead of its row is told from one that has no row to wait for.
// The cases call the real route, loaded the way e2e/booking-payment.spec.js loads its routes (a copy in a temporary directory whose
// imports are a closed list) with two differences: the stripe package is the real one, so the signature check is the real check, and
// the pool is a real one on the dev database. Events are signed with the package's own test-header helper and a secret made up here, so
// nothing reaches Stripe and no key is needed. What this cannot show is Stripe's own delivery (its retry timing and its real events),
// which needs a Stripe account the dev stack has no key for; the receipt for this ticket says so.
// Rows the cases make are one booking each (e-mail prefix 'e2e-eng027-', a reserved test name) and their payouts (notes 'ENG-027 probe');
// the cases delete them before and after. The one provider is fixture provider 1; its balances are set for case 11 and put back.
// The database helper reaches the dev database the way the department's test command lets it (--network host, 127.0.0.1:3307) and
// checks the target and the rows in it first, the two guards the fixture loader uses.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mysql from 'mysql2/promise';
import Stripe from 'stripe';
import { test, expect } from '@playwright/test';
import { providers } from '../database/fixtures/accounts.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';
import { reversalOf, recordTransferEvent } from '../src/lib/transfer-events.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const [PROVIDER1] = providers;
const EMAIL_PREFIX = 'e2e-eng027-';
// Stand-ins, not Stripe credentials: the key makes no request, and the secret signs only the events this spec builds.
const KEY = 'sk_test_stand_in';
const SECRET = 'whsec_eng027_probe';
// A time no delivery in a case could be mistaken for: 2025-10-09, long before the cases run.
const EVENT_TIME = 1_760_000_000;
const PLANTED = '2026-10-01 10:00:00';

const DB = { host: '127.0.0.1', port: 3307, user: 'root', password: 'root123', database: 'workontap_db' };

/** @type {import('mysql2/promise').Connection | null} */
let connection = null;
/** @type {import('mysql2/promise').Pool | null} */
let pool = null;
// The webhook route, and what the run changed that has to be put back.
let route = null;
let routeDir = '';
let saved = null;

async function connect() {
    assertDevTarget(DB);
    let opened;
    try {
        opened = await mysql.createConnection(DB);
    } catch (error) {
        throw new Error(`the dev database did not accept a connection at ${DB.host}:${DB.port} (${error.code || 'no code'}); the test command runs the container with --network host`);
    }
    try {
        await assertNoRealPeople(opened);
    } catch (error) {
        await opened.end();
        throw error;
    }
    return opened;
}

async function db() {
    if (!connection) connection = await connect();
    return connection;
}

async function rows(sql, params) {
    const [found] = await (await db()).query(sql, params);
    return /** @type {any[]} */ (found);
}

let sequence = 0;
const stamp = () => `${Date.now().toString(36)}${(sequence += 1)}`;

async function cleanUp() {
    const open = await db();
    await open.query("DELETE FROM provider_payouts WHERE notes LIKE 'ENG-027 probe%'");
    await open.query('DELETE FROM bookings WHERE customer_email LIKE ?', [`${EMAIL_PREFIX}%`]);
}

// The route is loaded once for the file: a copy of it and of the library files it imports, every import named in `imports`.
test.beforeAll(async () => {
    await db();
    pool = mysql.createPool({ ...DB, connectionLimit: 12 });
    routeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transfer-events-'));
    const put = (relative, text) => {
        fs.mkdirSync(path.dirname(path.join(routeDir, relative)), { recursive: true });
        fs.writeFileSync(path.join(routeDir, relative), text);
    };
    const imports = {
        'next/server': '../stubs/next-server.mjs',
        stripe: '../stubs/stripe.mjs',
        'mysql2/promise': '../stubs/mysql.mjs',
        '@/lib/db': '../lib/db.mjs',
        '@/lib/booking-price': '../lib/booking-price.mjs',
        '@/lib/transfer-events': '../lib/transfer-events.mjs',
        './booking-crew.js': './booking-crew.mjs',
        './phone.js': './phone.mjs',
    };
    const copy = (relative) => fs.readFileSync(path.join(REPO, relative), 'utf8').replace(/from '([^']+)'/g, (whole, specifier) => {
        if (!(specifier in imports)) throw new Error(`the route stand-ins have none for the import '${specifier}' in ${relative}`);
        return `from '${imports[specifier]}'`;
    });
    put('stubs/next-server.mjs', 'export const NextResponse = { json: (body, init = {}) => ({ body, status: init.status || 200 }) };\n');
    put('stubs/stripe.mjs', 'export default class Stripe { constructor(...args) { return new globalThis.__routeStripe(...args); } }\n');
    put('stubs/mysql.mjs', "export default { createPool() { throw new Error('the case supplies the pool'); } };\n");
    put('lib/db.mjs', copy('src/lib/db.js'));
    put('lib/booking-price.mjs', copy('src/lib/booking-price.js'));
    put('lib/booking-crew.mjs', copy('src/lib/booking-crew.js'));
    put('lib/phone.mjs', copy('src/lib/phone.js'));
    put('lib/transfer-events.mjs', copy('src/lib/transfer-events.js'));
    put('routes/webhook.mjs', copy('src/app/api/stripe/webhook/route.js'));

    saved = { pool: globalThis.mysqlPool, key: process.env.STRIPE_SECRET_KEY, secret: process.env.STRIPE_WEBHOOK_SECRET, log: console.log, error: console.error, warn: console.warn };
    globalThis.mysqlPool = pool;
    globalThis.__routeStripe = Stripe;
    process.env.STRIPE_SECRET_KEY = KEY;
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    // The route prints each body it is sent; a case that fails says what it saw in its own message.
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};
    route = await import(pathToFileURL(path.join(routeDir, 'routes', 'webhook.mjs')).href);
    await cleanUp();
});

test.afterAll(async () => {
    try {
        if (connection) await cleanUp();
    } finally {
        if (saved) {
            Object.assign(console, { log: saved.log, error: saved.error, warn: saved.warn });
            for (const [name, value] of [['STRIPE_SECRET_KEY', saved.key], ['STRIPE_WEBHOOK_SECRET', saved.secret]]) {
                if (value === undefined) delete process.env[name]; else process.env[name] = value;
            }
            if (saved.pool === undefined) delete globalThis.mysqlPool; else globalThis.mysqlPool = saved.pool;
        }
        delete globalThis.__routeStripe;
        if (routeDir) fs.rmSync(routeDir, { recursive: true, force: true });
        if (pool) await pool.end();
        if (connection) await connection.end();
        connection = null;
        pool = null;
    }
});

test.afterEach(async () => {
    await cleanUp();
});

// ---- events and requests

const signer = new Stripe(KEY);

function transfer(id, fields = {}) {
    return { id, object: 'transfer', amount: 4500, amount_reversed: 0, reversed: false, currency: 'cad', description: 'ENG-027 probe', metadata: { provider_id: String(PROVIDER1.id) }, ...fields };
}

function event(type, object, created = EVENT_TIME) {
    return { id: `evt_eng027_${stamp()}`, object: 'event', api_version: '2026-05-27.dahlia', created, livemode: false, type, data: { object } };
}

// The route's POST, given what Stripe would send: the body and a signature made over it. `body` replaces the body after it is signed.
async function deliver(sent, { signed = true, body } = {}) {
    const payload = JSON.stringify(sent);
    const headers = new Headers();
    if (signed) headers.set('stripe-signature', signer.webhooks.generateTestHeaderString({ payload, secret: SECRET }));
    return route.POST({ text: async () => body ?? payload, headers });
}

// ---- rows

async function booking() {
    const id = stamp();
    const [made] = /** @type {any[]} */ (await (await db()).execute(
        `INSERT INTO bookings (booking_number, service_id, service_name, service_price, customer_first_name, customer_last_name, customer_email, customer_phone,
           job_date, job_time_slot, job_description, address_line1, city, status, payment_status, provider_id)
         VALUES (?, 1, 'Probe service', 100.00, 'E2E', 'Probe', ?, '+14035550199', '2026-02-01', '09:00', 'ENG-027 transfer events probe, deleted by the case', '1 Probe Street', 'Calgary', 'completed', 'paid', ?)`,
        [`E2EP27${id}`, `${EMAIL_PREFIX}${id}@example.invalid`, PROVIDER1.id]
    ));
    return Number(made.insertId);
}

// A payout row with a planted updated_at, so a row that was written shows in it. `via` is the connection that makes the row.
async function payout({ bookingId, transferId, status = 'pending', amount = 45, via = null }) {
    const [made] = /** @type {any[]} */ (await (via ?? await db()).execute(
        `INSERT INTO provider_payouts (provider_id, amount, status, stripe_transfer_id, booking_id, notes, created_at, updated_at, paid_at)
         VALUES (?, ?, ?, ?, ?, 'ENG-027 probe, deleted by the case', ?, ?, ?)`,
        [PROVIDER1.id, amount, status, transferId, bookingId, PLANTED, PLANTED, status === 'paid' ? PLANTED : null]
    ));
    return Number(made.insertId);
}

async function payoutRow(id) {
    const [row] = await rows('SELECT status, UNIX_TIMESTAMP(paid_at) AS paid, UNIX_TIMESTAMP(updated_at) AS touched FROM provider_payouts WHERE id = ?', [id]);
    return { status: row.status, paid: row.paid === null ? null : Number(row.paid), touched: Number(row.touched) };
}

async function lines(bookingId) {
    return (await rows('SELECT status, notes FROM booking_status_history WHERE booking_id = ? ORDER BY id', [bookingId])).map((row) => [row.status, row.notes]);
}

async function balances() {
    const [row] = await rows('SELECT available_balance, pending_balance, total_earnings, lifetime_balance FROM service_providers WHERE id = ?', [PROVIDER1.id]);
    return Object.fromEntries(Object.entries(row).map(([name, value]) => [name, Number(value)]));
}

// A booking with one payout in `status` and the transfer id the case gives it.
async function pair(status = 'pending', amount = 45) {
    const bookingId = await booking();
    const transferId = `tr_eng027_${stamp()}`;
    const id = await payout({ bookingId, transferId, status, amount });
    return { bookingId, transferId, id };
}

const ok = (answer, what) => expect({ status: answer.status, body: answer.body }, what).toEqual({ status: 200, body: { received: true } });

test.describe('Transfer events', () => {
    test('reversalOf tells a full reversal, a partial one and none from the transfer alone', () => {
        const vectors = [
            ['flagged reversed', { reversed: true, amount: 4500, amount_reversed: 4500 }, 'full'],
            ['flagged reversed with nothing counted', { reversed: true, amount: 4500 }, 'full'],
            ['the whole amount reversed, not flagged', { reversed: false, amount: 4500, amount_reversed: 4500 }, 'full'],
            ['more than the amount reversed', { reversed: false, amount: 4500, amount_reversed: 4600 }, 'full'],
            ['part of the amount reversed', { reversed: false, amount: 4500, amount_reversed: 1000 }, 'partial'],
            ['one cent reversed', { reversed: false, amount: 4500, amount_reversed: 1 }, 'partial'],
            ['nothing reversed', { reversed: false, amount: 4500, amount_reversed: 0 }, 'none'],
            ['no amount reversed given', { amount: 4500 }, 'none'],
            ['a zero transfer with nothing reversed', { amount: 0, amount_reversed: 0 }, 'none'],
            ['amounts that are not numbers', { amount: '4500', amount_reversed: '4500' }, 'none'],
            ['no transfer', undefined, 'none'],
            ['a null transfer', null, 'none'],
        ];
        for (const [what, given, expected] of vectors) expect(reversalOf(given), what).toBe(expected);
    });

    test('transfer.created marks the payout of that transfer paid at the time Stripe sent it, with one history line', async () => {
        const { bookingId, transferId, id } = await pair('pending');
        const answer = await deliver(event('transfer.created', transfer(transferId)));
        ok(answer, 'the answer to a transfer.created for a pending payout');
        const row = await payoutRow(id);
        expect(row.status, 'the payout').toBe('paid');
        expect(row.paid, 'paid_at is the time of the event').toBe(EVENT_TIME);
        const written = await lines(bookingId);
        expect(written.map(([status]) => status), 'the booking history').toEqual(['transfer_completed']);
        expect(written[0][1], 'the line names the amount').toContain('$45.00');

        const processing = await pair('processing');
        ok(await deliver(event('transfer.created', transfer(processing.transferId))), 'the answer for a payout being processed');
        expect((await payoutRow(processing.id)).status, 'a payout that was processing').toBe('paid');
    });

    test('a full reversal fails the payout, flagged reversed or only reported as the whole amount reversed', async () => {
        for (const [what, status, fields] of [
            ['a pending payout, flagged reversed', 'pending', { reversed: true, amount_reversed: 4500 }],
            ['a paid payout, flagged reversed', 'paid', { reversed: true, amount_reversed: 4500 }],
            ['a paid payout, not flagged but the whole amount reversed', 'paid', { reversed: false, amount_reversed: 4500 }],
        ]) {
            const { bookingId, transferId, id } = await pair(status);
            ok(await deliver(event('transfer.reversed', transfer(transferId, fields))), `the answer for ${what}`);
            expect((await payoutRow(id)).status, what).toBe('failed');
            const written = await lines(bookingId);
            expect(written.map(([line]) => line), `${what}: the booking history`).toEqual(['transfer_reversed']);
            expect(written[0][1], `${what}: the line names the amount`).toContain('$45.00');
        }
    });

    test('a partial reversal keeps the status and writes one line for each amount', async () => {
        const { bookingId, transferId, id } = await pair('paid');
        const partial = event('transfer.reversed', transfer(transferId, { amount_reversed: 1000 }));
        ok(await deliver(partial), 'the answer to a partial reversal');
        expect((await payoutRow(id)).status, 'the payout after a partial reversal').toBe('paid');
        let written = await lines(bookingId);
        expect(written.map(([line]) => line), 'the booking history').toEqual(['transfer_part_reversed']);
        expect(written[0][1], 'the line names the amount reversed').toContain('$10.00');
        expect(written[0][1], 'the line names the amount of the transfer').toContain('$45.00');

        ok(await deliver(partial), 'the answer to the same partial reversal again');
        expect(await lines(bookingId), 'the same partial reversal again').toEqual(written);

        ok(await deliver(event('transfer.reversed', transfer(transferId, { amount_reversed: 2000 }))), 'the answer to a larger partial reversal');
        written = await lines(bookingId);
        expect(written.map(([line]) => line), 'a larger partial reversal').toEqual(['transfer_part_reversed', 'transfer_part_reversed']);
        expect((await payoutRow(id)).status, 'the payout after two partial reversals').toBe('paid');

        const failed = await pair('failed');
        const before = await payoutRow(failed.id);
        ok(await deliver(event('transfer.reversed', transfer(failed.transferId, { amount_reversed: 1000 }))), 'the answer for a failed payout');
        expect(await lines(failed.bookingId), 'a failed payout gets no line').toEqual([]);
        expect(await payoutRow(failed.id), 'a failed payout is not written').toEqual(before);
    });

    test('an event moves the payout that carries its transfer id and no other payout, not even one of the same booking', async () => {
        const bookingId = await booking();
        const a = { transferId: `tr_eng027_${stamp()}` };
        a.id = await payout({ bookingId, transferId: a.transferId });
        const b = { transferId: `tr_eng027_${stamp()}` };
        b.id = await payout({ bookingId, transferId: b.transferId });
        const none = { id: await payout({ bookingId, transferId: null }) };
        const other = await pair('pending');
        const untouched = [await payoutRow(b.id), await payoutRow(none.id), await payoutRow(other.id)];

        // metadata.booking_id is what the retired handler matched on; the transfer id is all that counts now.
        const sent = event('transfer.created', transfer(a.transferId, { metadata: { provider_id: String(PROVIDER1.id), booking_id: String(bookingId) } }));
        ok(await deliver(sent), 'the answer');
        expect((await payoutRow(a.id)).status, 'the payout of the transfer').toBe('paid');
        expect([await payoutRow(b.id), await payoutRow(none.id), await payoutRow(other.id)], 'the other payouts').toEqual(untouched);
        expect((await lines(bookingId)).map(([line]) => line), 'the booking history').toEqual(['transfer_completed']);

        const reversed = event('transfer.reversed', transfer(b.transferId, { reversed: true, amount_reversed: 4500, metadata: { provider_id: String(PROVIDER1.id), booking_id: String(bookingId) } }));
        ok(await deliver(reversed), 'the answer to a reversal');
        expect([(await payoutRow(b.id)).status, (await payoutRow(none.id)).status, (await payoutRow(a.id)).status], 'b fails, the payout with no transfer stays, a stays paid').toEqual(['failed', 'pending', 'paid']);
    });

    test('an event for an unknown transfer that was made for a payout is answered 503 and writes nothing', async () => {
        for (const type of ['transfer.created', 'transfer.paid', 'transfer.reversed', 'transfer.failed']) {
            const { bookingId, id } = await pair('pending');
            const touched = await payoutRow(id);
            const answer = await deliver(event(type, transfer(`tr_eng027_${stamp()}`, { reversed: type === 'transfer.reversed', amount_reversed: type === 'transfer.reversed' ? 4500 : 0 })));
            expect(answer.status, `${type}: the answer`).toBe(503);
            expect(answer.body, `${type}: the answer says why`).toHaveProperty('error');
            expect(await payoutRow(id), `${type}: the other payout`).toEqual(touched);
            expect(await lines(bookingId), `${type}: the booking history`).toEqual([]);
        }
    });

    test('an event for a transfer that no payout was made for is answered 200 and writes nothing', async () => {
        const open = await db();
        const snapshot = async () => JSON.stringify((await open.query('CHECKSUM TABLE provider_payouts, booking_status_history, service_providers'))[0]);
        await pair('pending');
        const first = await snapshot();
        const shapes = [
            ['the metadata of an auto-release transfer', { booking_id: '12', booking_number: 'B-12' }],
            ['empty metadata', {}],
            ['no metadata', undefined],
        ];
        for (const type of ['transfer.created', 'transfer.paid', 'transfer.reversed', 'transfer.failed']) {
            for (const [what, metadata] of shapes) {
                const made = transfer(`tr_eng027_${stamp()}`, { metadata, reversed: type === 'transfer.reversed', amount_reversed: type === 'transfer.reversed' ? 4500 : 0 });
                ok(await deliver(event(type, made)), `${type} with ${what}`);
            }
        }
        expect(await snapshot(), 'the payouts, their history and the provider rows').toBe(first);
    });

    test('an event ahead of its payout row is answered 503 without waiting on the writer, and lands when it is sent again', async () => {
        const writer = await connect();
        let holding = false;
        try {
            const bookingId = await booking();
            const transferId = `tr_eng027_${stamp()}`;
            await writer.beginTransaction();
            holding = true;
            const id = await payout({ bookingId, transferId, via: writer });
            const sent = event('transfer.created', transfer(transferId));

            const started = Date.now();
            const early = await deliver(sent);
            const took = Date.now() - started;
            expect(early.status, 'the answer while the payout row is not committed').toBe(503);
            expect(took, 'it did not wait for the writer (milliseconds)').toBeLessThan(3000);

            await writer.commit();
            holding = false;
            ok(await deliver(sent), 'the answer to the same event once the row is there');
            expect((await payoutRow(id)).status, 'the payout').toBe('paid');
            expect((await lines(bookingId)).map(([line]) => line), 'the booking history').toEqual(['transfer_completed']);

            ok(await deliver(sent), 'the answer to the event a third time');
            expect((await lines(bookingId)).length, 'still one line').toBe(1);
        } finally {
            if (holding) await writer.rollback();
            await writer.end();
        }
    });

    test('the same event twice, or ten at once, changes the payout once', async () => {
        const again = await pair('pending');
        const paid = event('transfer.created', transfer(again.transferId));
        ok(await deliver(paid), 'the first delivery');
        const first = await payoutRow(again.id);
        ok(await deliver(paid), 'the second delivery');
        expect(await payoutRow(again.id), 'the payout after the second delivery').toEqual(first);
        expect((await lines(again.bookingId)).length, 'lines after two deliveries').toBe(1);

        const balancesBefore = await balances();
        for (const [what, type, fields, status, line] of [
            ['paid', 'transfer.created', {}, 'paid', 'transfer_completed'],
            ['reversed', 'transfer.reversed', { reversed: true, amount_reversed: 4500 }, 'failed', 'transfer_reversed'],
            ['failed', 'transfer.failed', { failure_message: 'No funds' }, 'failed', 'transfer_failed'],
        ]) {
            const { bookingId, transferId, id } = await pair('pending');
            const sent = event(type, transfer(transferId, fields));
            const answers = await Promise.all(Array.from({ length: 10 }, () => deliver(sent)));
            expect(answers.map((answer) => answer.status), `${what}: the ten answers`).toEqual(Array(10).fill(200));
            const row = await payoutRow(id);
            expect(row.status, `${what}: the payout`).toBe(status);
            if (status === 'paid') expect(row.paid, `${what}: paid_at`).toBe(EVENT_TIME);
            expect((await lines(bookingId)).map(([written]) => written), `${what}: the booking history`).toEqual([line]);
        }
        expect(await balances(), 'the provider balances').toEqual(balancesBefore);
    });

    test('events in any order only move a payout forward', async () => {
        const created = (id) => event('transfer.created', transfer(id));
        const reversed = (id) => event('transfer.reversed', transfer(id, { reversed: true, amount_reversed: 4500 }));
        const failed = (id) => event('transfer.failed', transfer(id, { failure_message: 'Account closed' }));
        const retired = (id) => event('transfer.paid', transfer(id));
        const orders = [
            ['created, reversed, created', [created, reversed, created], 'failed', ['transfer_completed', 'transfer_reversed']],
            ['reversed, created', [reversed, created], 'failed', ['transfer_reversed']],
            ['created, failed', [created, failed], 'failed', ['transfer_completed', 'transfer_failed']],
            ['failed, retired transfer.paid', [failed, retired], 'failed', ['transfer_failed']],
            ['reversed, reversed', [reversed, reversed], 'failed', ['transfer_reversed']],
            ['created, retired transfer.paid, created', [created, retired, created], 'paid', ['transfer_completed']],
        ];
        for (const [what, order, status, written] of orders) {
            const { bookingId, transferId, id } = await pair('pending');
            for (const make of order) ok(await deliver(make(transferId)), `${what}: an answer`);
            expect((await payoutRow(id)).status, `${what}: the payout`).toBe(status);
            expect((await lines(bookingId)).map(([line]) => line), `${what}: the booking history`).toEqual(written);
        }
    });

    test('no transfer event changes the provider balances, the retired transfer.paid included', async () => {
        const open = await db();
        const original = await balances();
        await open.execute('UPDATE service_providers SET available_balance = 100.00, pending_balance = 5.00, total_earnings = 250.00, lifetime_balance = 300.00 WHERE id = ?', [PROVIDER1.id]);
        try {
            const known = await balances();
            expect(known, 'the balances the case set').toEqual({ available_balance: 100, pending_balance: 5, total_earnings: 250, lifetime_balance: 300 });
            const { bookingId, transferId } = await pair('pending');
            const sends = [
                event('transfer.created', transfer(transferId, { metadata: { provider_id: String(PROVIDER1.id), booking_id: String(bookingId) } })),
                event('transfer.created', transfer(transferId)),
                event('transfer.paid', transfer(transferId, { metadata: { provider_id: String(PROVIDER1.id), booking_id: String(bookingId) } })),
                event('transfer.reversed', transfer(transferId, { amount_reversed: 1000 })),
            ];
            for (const sent of sends) {
                ok(await deliver(sent), `the answer to ${sent.type}`);
                expect(await balances(), `the balances after ${sent.type}`).toEqual(known);
            }
            const second = await pair('paid');
            ok(await deliver(event('transfer.reversed', transfer(second.transferId, { reversed: true, amount_reversed: 4500 }))), 'the answer to a full reversal');
            expect(await balances(), 'the balances after a full reversal').toEqual(known);
            const third = await pair('pending');
            ok(await deliver(event('transfer.failed', transfer(third.transferId, { failure_message: 'Closed' }))), 'the answer to a failure');
            expect(await balances(), 'the balances after a failed transfer').toEqual(known);
        } finally {
            await open.execute('UPDATE service_providers SET available_balance = ?, pending_balance = ?, total_earnings = ?, lifetime_balance = ? WHERE id = ?', [
                original.available_balance, original.pending_balance, original.total_earnings, original.lifetime_balance, PROVIDER1.id,
            ]);
        }
    });

    test('a failed history write rolls the move back and is thrown', async () => {
        const { bookingId, transferId, id } = await pair('pending');
        const connectionToFail = await pool.getConnection();
        try {
            const refusing = new Proxy(connectionToFail, {
                get(target, name) {
                    if (name === 'execute') {
                        return (sql, params) => (/INSERT INTO booking_status_history/.test(sql) ? Promise.reject(new Error('probe: the history write is refused')) : target.execute(sql, params));
                    }
                    const member = target[name];
                    return typeof member === 'function' ? member.bind(target) : member;
                },
            });
            const sent = event('transfer.created', transfer(transferId));
            await expect(recordTransferEvent(refusing, sent)).rejects.toThrow('probe: the history write is refused');
        } finally {
            connectionToFail.release();
        }
        expect((await payoutRow(id)).status, 'the payout was rolled back').toBe('pending');
        expect(await lines(bookingId), 'no history line').toEqual([]);
        // The row is free again: the same event, sent again, is recorded.
        ok(await deliver(event('transfer.created', transfer(transferId))), 'the answer to the event sent again');
        expect((await payoutRow(id)).status, 'the payout after the second try').toBe('paid');
    });

    test('a payout with no booking is moved and writes no history line', async () => {
        const transferId = `tr_eng027_${stamp()}`;
        const id = await payout({ bookingId: null, transferId });
        const count = async () => Number((await rows('SELECT COUNT(*) AS n FROM booking_status_history', []))[0].n);
        const written = await count();
        ok(await deliver(event('transfer.created', transfer(transferId))), 'the answer');
        expect((await payoutRow(id)).status, 'the payout').toBe('paid');
        expect(await count(), 'the history table').toBe(written);
        ok(await deliver(event('transfer.reversed', transfer(transferId, { reversed: true, amount_reversed: 4500 }))), 'the answer to a reversal');
        expect((await payoutRow(id)).status, 'the payout after a reversal').toBe('failed');
        expect(await count(), 'the history table after a reversal').toBe(written);
    });

    test('the route refuses an unsigned request and a changed body, ignores transfer.updated and answers its ping', async () => {
        const { id, transferId } = await pair('pending');
        const touched = await payoutRow(id);
        const sent = event('transfer.created', transfer(transferId));

        const unsigned = await deliver(sent, { signed: false });
        expect(unsigned.status, 'no signature').toBe(400);
        const changed = await deliver(sent, { body: `${JSON.stringify(sent)} ` });
        expect(changed.status, 'a body changed after it was signed').toBe(400);
        expect(await payoutRow(id), 'the payout after the refused requests').toEqual(touched);

        ok(await deliver(event('transfer.updated', transfer(transferId, { amount_reversed: 4500, reversed: true }))), 'the answer to transfer.updated');
        expect(await payoutRow(id), 'the payout after transfer.updated').toEqual(touched);

        const ping = await route.GET();
        expect(ping.status, 'the ping').toBe(200);
        expect(ping.body.message, 'the ping').toMatch(/ready/);
    });

    // A transfer.reversed whose object Stripe fills in differently (an older pinned api version, a field missing) must not be read as a
    // reversal: the library answers 'none' for it, and only the line that sets 'none' aside keeps it from failing the payout.
    test('a transfer.reversed that reverses nothing changes nothing, in every status a payout can be moved from', async () => {
        for (const [what, fields] of [
            ['nothing reversed', { reversed: false, amount_reversed: 0 }],
            ['no amount reversed given', { reversed: false, amount_reversed: undefined }],
            ['amounts that are not numbers', { reversed: false, amount: '4500', amount_reversed: '4500' }],
        ]) {
            for (const status of ['pending', 'processing', 'paid']) {
                const { bookingId, transferId, id } = await pair(status);
                const before = await payoutRow(id);
                ok(await deliver(event('transfer.reversed', transfer(transferId, fields))), `${what}, ${status}: the answer`);
                expect(await payoutRow(id), `${what}, ${status}: the payout`).toEqual(before);
                expect(await lines(bookingId), `${what}, ${status}: the booking history`).toEqual([]);
            }
        }
    });

    // The partial reversal is the one path whose idempotency is a read of the booking's lines and then an insert, not a status guard under the
    // row lock, so ten deliveries at once are one line only while the lock stays ahead of the read (and the transaction stays a transaction).
    test('the same partial reversal ten at once writes one line', async () => {
        const { bookingId, transferId, id } = await pair('paid');
        const before = await payoutRow(id);
        const sent = event('transfer.reversed', transfer(transferId, { amount_reversed: 1000 }));
        const answers = await Promise.all(Array.from({ length: 10 }, () => deliver(sent)));
        expect(answers.map((answer) => answer.status), 'the ten answers').toEqual(Array(10).fill(200));
        expect((await lines(bookingId)).map(([line]) => line), 'the booking history').toEqual(['transfer_part_reversed']);
        expect(await payoutRow(id), 'the payout').toEqual(before);
    });

    // The route's switch passes the library four types, so only a direct call reaches the library's own refusal of a type it does not know.
    test('the library, given an event type it does not know, moves no payout', async () => {
        const { bookingId, transferId, id } = await pair('pending');
        const before = await payoutRow(id);
        const held = await pool.getConnection();
        try {
            const result = await recordTransferEvent(held, event('transfer.updated', transfer(transferId, { reversed: true, amount_reversed: 4500 })));
            expect(result.outcome, 'the outcome').toBe('unmatched');
        } finally {
            held.release();
        }
        expect(await payoutRow(id), 'the payout').toEqual(before);
        expect(await lines(bookingId), 'the booking history').toEqual([]);
    });
});

// ---- source pins

const read = (relative) => fs.readFileSync(path.join(REPO, relative), 'utf8');

function sourceFiles(directory) {
    const found = [];
    for (const entry of fs.readdirSync(path.join(REPO, directory), { withFileTypes: true })) {
        const relative = path.join(directory, entry.name);
        if (entry.isDirectory()) found.push(...sourceFiles(relative));
        else if (/\.(js|mjs)$/.test(entry.name)) found.push(relative);
    }
    return found;
}

test.describe('Transfer events, source pins', () => {
    test('the library names no balance and moves a payout only by its key', () => {
        const library = read('src/lib/transfer-events.js');
        for (const name of ['available_balance', 'pending_balance', 'total_earnings', 'lifetime_balance', 'service_providers']) {
            expect(library, `the library names ${name}`).not.toContain(name);
        }
        const updates = [...library.matchAll(/(["'`])(UPDATE provider_payouts(?:(?!\1)[\s\S])*)\1/g)].map((found) => found[2]);
        expect(updates.length, 'the statements that move a payout').toBeGreaterThan(0);
        for (const update of updates) expect(update, 'a payout is moved by its key').toMatch(/WHERE id = \?$/);
        expect(library, 'a payout is matched by its booking').not.toMatch(/OR\s+booking_id/i);
    });

    // ADR-017's central decision. stripe_transfer_id has no index, so a statement that searches by it under a lock scans the table and locks
    // the gap where every new payout row goes; no case can see that without a second writer at the right moment.
    test('the library finds the payouts of a transfer with no lock and locks them one at a time by key', () => {
        const library = read('src/lib/transfer-events.js');
        const reads = [...library.matchAll(/(["'`])(SELECT(?:(?!\1)[\s\S])*FROM provider_payouts(?:(?!\1)[\s\S])*)\1/g)].map((found) => found[2]);
        const byTransfer = reads.filter((statement) => statement.includes('stripe_transfer_id'));
        const byKey = reads.filter((statement) => !statement.includes('stripe_transfer_id'));
        expect(byTransfer.length, 'the read that finds the payouts of a transfer').toBeGreaterThan(0);
        for (const statement of byTransfer) expect(statement, 'the transfer id is searched with no lock').not.toMatch(/FOR UPDATE|LOCK IN SHARE MODE/i);
        expect(byKey.length, 'the reads that lock a payout').toBeGreaterThan(0);
        for (const statement of byKey) expect(statement, 'a payout is locked by its key').toMatch(/WHERE id = \? FOR UPDATE$/);
    });

    test('the route checks the signature first, keeps no handler of its own for the transfer events and cannot match a payout by its booking', () => {
        const route = read('src/app/api/stripe/webhook/route.js');
        const post = route.indexOf('export async function POST');
        const verify = route.indexOf('constructEvent(');
        const dispatch = route.indexOf('switch (event.type)');
        expect(post, 'POST is in the route').toBeGreaterThanOrEqual(0);
        expect(verify, 'the signature is checked inside POST').toBeGreaterThan(post);
        expect(dispatch, 'the signature is checked before the event is read').toBeGreaterThan(verify);
        for (const type of ['transfer.created', 'transfer.paid', 'transfer.reversed', 'transfer.failed']) {
            expect(route, `the route answers ${type}`).toContain(`case '${type}':`);
        }
        expect(route, 'the route hands the transfer events to the library').toContain('recordTransferEvent(');
        expect(route, 'the old paid handler').not.toContain('handleTransferPaid');
        expect(route, 'the old failed handler').not.toContain('handleTransferFailed');
        expect(route, 'a payout matched by its booking').not.toMatch(/stripe_transfer_id = \? OR booking_id/);
    });

    test('every transfer that is written to a payout carries the provider id', () => {
        const writers = sourceFiles('src').filter((file) => {
            const text = read(file);
            return text.includes('transfers.create(') && text.includes('INSERT INTO provider_payouts');
        });
        expect(writers.length, 'the routes that make a transfer and write its payout').toBeGreaterThanOrEqual(2);
        for (const file of writers) {
            const text = read(file);
            const starts = [];
            for (let at = text.indexOf('transfers.create('); at !== -1; at = text.indexOf('transfers.create(', at + 1)) starts.push(at);
            starts.forEach((at, index) => {
                const metadata = text.slice(at, starts[index + 1]).match(/metadata:\s*\{([^}]*)\}/);
                expect(metadata, `${file}: a transfer written to a payout carries metadata`).not.toBeNull();
                expect(metadata[1], `${file}: a transfer written to a payout names its provider`).toMatch(/provider_id\s*:/);
            });
        }
    });
});
