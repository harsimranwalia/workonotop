// @ts-check
// The payment of a booking: the amounts a card payment can take, the payment bound to the booking at the checkout, and the
// one charge when the job is done. Thirty-eight cases, each titled for what it shows. The first thirty import the module
// (src/lib/booking-payment.js) in this process and drive it with a scripted client that records every call and answers per
// a script (the precedent is e2e/price-of-record.spec.js); the next five run the two completion routes (approve and
// auto-release) in this process against a pool of a few connections; the last three go through the dev app. The dev stack
// holds no payment key, so the dev app books unverified (recorded pending, no held amount); the verified path is the scripted
// client's and, later, a run with test keys.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, expect } from '@playwright/test';
import { getCredentialHeaders } from './auth/credentials.js';
import { RESET_RETRIES } from './support/auth.js';

const {
    paymentAmountCents,
    paymentCheckMode,
    checkHeldPayment,
    collectBookingPayment,
} = await import('../src/lib/booking-payment.js');

// A scripted Stripe client: each entry in `script` answers the next call to the named method, either a value or an error.
// Every call is recorded as [method, id, params, options].
function scriptedClient(script = {}) {
    const calls = [];
    const wrap = (method) => async (...args) => {
        calls.push([method, ...args]);
        const queue = script[method] || [];
        const step = queue.length > 1 ? queue.shift() : queue[0];
        if (step === undefined) throw new Error(`scripted client: no answer scripted for ${method}`);
        if (step instanceof Error) throw step;
        return typeof step === 'function' ? step(...args) : step;
    };
    return {
        calls,
        paymentIntents: {
            retrieve: wrap('retrieve'),
            capture: wrap('capture'),
            create: wrap('create'),
            confirm: wrap('confirm'),
        },
        charges: {
            retrieve: wrap('charge'),
        },
    };
}

const cardError = (code) => Object.assign(new Error('card error'), { type: 'StripeCardError', code });
const connError = () => Object.assign(new Error('connection'), { type: 'StripeConnectionError' });
const missingError = () => Object.assign(new Error("No such payment_intent: 'pi_hold_1'"), { type: 'StripeInvalidRequestError', code: 'resource_missing', statusCode: 404 });

const BOOKING = { id: 42, service_price: '135.00', payment_intent_id: 'pi_hold_1' };
const EXPECTED = 13500;
const OPTS = {
    currency: 'cad',
    saveIntentId: async () => true,
    readIntentId: async () => 'pi_hold_1',
};

function heldIntent(over = {}) {
    return {
        id: 'pi_hold_1', status: 'requires_capture', capture_method: 'manual',
        amount: EXPECTED, amount_capturable: EXPECTED, currency: 'cad', customer: 'cus_1',
        latest_charge: 'ch_1', payment_method: 'pm_1', metadata: {}, ...over,
    };
}

const NOW = 1_760_000_000;

// ── The completion routes, in this process ───────────────────────────────────────────────────────────────────────────
// approve and auto-release run here with the real src/lib/db.js, booking-price.js and booking-payment.js, against a database
// whose pool has a few connections: a request for a connection waits, with no limit, until one is released (the app's pool is
// built with waitForConnections and no queue limit), and a SELECT ... FOR UPDATE holds the booking's row until its connection
// commits, rolls back or is released. The route files are copied into a scratch folder with their imports pointed at stand-ins
// for next/server, stripe, the mail and push senders and the logger, and the driver behind db.js is replaced by that pool.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const NO_ANSWER = Symbol('no answer');

// The answer of a promise, or NO_ANSWER when it has not come within `ms`.
function within(ms, promise) {
    let timer;
    const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve(NO_ANSWER), ms); });
    return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

// The pool. A SELECT answers with its rows and a write with { affectedRows }, as mysql2 does through execute().
class FakeDatabase {
    constructor(size, rows) {
        this.size = size;
        this.inUse = 0;
        this.waiting = [];
        this.rows = new Map(rows.map((row) => [row.id, { ...row }]));
        this.owners = new Map();
        this.rowQueue = new Map();
        this.statements = [];
        this.payouts = [];
        this.credits = [];
    }

    getConnection() {
        return new Promise((resolve) => {
            const take = () => { this.inUse += 1; resolve(new FakeConnection(this)); };
            if (this.inUse < this.size) take(); else this.waiting.push(take);
        });
    }

    giveBack() {
        this.inUse -= 1;
        const next = this.waiting.shift();
        if (next) next();
    }

    async lock(id, connection) {
        while (this.owners.has(id) && this.owners.get(id) !== connection) {
            await new Promise((resume) => { this.rowQueue.set(id, [...(this.rowQueue.get(id) || []), resume]); });
        }
        this.owners.set(id, connection);
    }

    unlock(connection) {
        for (const [id, owner] of [...this.owners]) {
            if (owner !== connection) continue;
            this.owners.delete(id);
            const resumes = this.rowQueue.get(id) || [];
            this.rowQueue.delete(id);
            resumes.forEach((resume) => resume());
        }
    }

    async run(connection, sql, params) {
        this.statements.push([connection, sql]);
        const byId = (value) => this.rows.get(Number(value));
        if (sql.includes('WHERE b.id = ? AND b.user_id = ?')) {
            const row = byId(params[0]);
            return row && row.user_id === params[1] ? [{ ...row }] : [];
        }
        if (sql.includes("WHERE b.status = 'awaiting_approval'")) {
            return [...this.rows.values()].filter((row) => row.status === 'awaiting_approval').map((row) => ({ ...row }));
        }
        if (sql === 'SELECT id FROM bookings WHERE id = ?') return byId(params[0]) ? [{ id: byId(params[0]).id }] : [];
        if (sql.startsWith('SELECT email, first_name, last_name FROM users')) return [{ email: 'customer@example.test', first_name: 'Cass', last_name: 'Customer' }];
        if (sql === 'SELECT payment_intent_id FROM bookings WHERE id = ?') return byId(params[0]) ? [{ payment_intent_id: byId(params[0]).payment_intent_id }] : [];
        if (sql.startsWith('UPDATE bookings SET payment_intent_id = ?')) {
            const row = byId(params[1]);
            const swapped = Boolean(row) && row.payment_intent_id === params[2];
            if (swapped) row.payment_intent_id = params[0];
            return { affectedRows: swapped ? 1 : 0 };
        }
        if (/^SELECT .* FROM bookings WHERE id = \? FOR UPDATE$/.test(sql)) {
            const row = byId(params[0]);
            if (!row) return [];
            await this.lock(row.id, connection);
            return [{ status: row.status }];
        }
        if (sql.startsWith("UPDATE bookings SET status = 'completed'")) {
            Object.assign(byId(params[params.length - 1]), { status: 'completed', payment_status: 'paid' });
            return { affectedRows: 1 };
        }
        if (sql.startsWith("UPDATE bookings SET payment_status = 'failed'")) {
            byId(params[params.length - 1]).payment_status = 'failed';
            return { affectedRows: 1 };
        }
        if (sql.startsWith('INSERT INTO provider_payouts')) {
            this.payouts.push(params);
            return { affectedRows: 1 };
        }
        if (sql.startsWith('UPDATE service_providers SET total_earnings')) {
            this.credits.push(params[0]);
            return { affectedRows: 1 };
        }
        if (sql.startsWith('UPDATE invoices SET status') || sql.startsWith('INSERT INTO booking_status_history')) return { affectedRows: 1 };
        if (sql.startsWith("SELECT id FROM users WHERE role = 'admin'")) return [];
        throw new Error(`the stand-in database has no answer for: ${sql}`);
    }
}

class FakeConnection {
    constructor(db) {
        this.db = db;
        this.released = false;
    }

    async query(sql) {
        await tick();
        const text = sql.trim();
        this.db.statements.push([this, text]);
        if (text === 'COMMIT' || text === 'ROLLBACK') this.db.unlock(this);
        return [[]];
    }

    async execute(sql, params = []) {
        await tick();
        return [await this.db.run(this, sql.replace(/\s+/g, ' ').trim(), params)];
    }

    release() {
        if (this.released) throw new Error('a connection was released twice');
        this.released = true;
        this.db.unlock(this);
        this.db.giveBack();
    }
}

// A Stripe stand-in that keeps state. The booking's hold is live (requires_capture) or has lapsed (cancelled, expired). The
// capture, the charge made for a lapsed hold and each transfer happen once per idempotency key, as Stripe has them.
function statefulStripe(lapsed, { onCapture } = {}) {
    const intents = new Map([['pi_hold_1', lapsed
        ? heldIntent({ status: 'canceled', cancellation_reason: 'expired', amount_capturable: 0, latest_charge: 'ch_old' })
        : heldIntent()]]);
    const keyed = new Map();
    const once = (key, make) => {
        if (!keyed.has(key)) keyed.set(key, make());
        return keyed.get(key);
    };
    const calls = [];
    const call = (name, work) => async (...args) => {
        calls.push([name, ...args]);
        await pause(5);
        return work(...args);
    };
    return {
        calls,
        paymentIntents: {
            retrieve: call('retrieve', (id) => structuredClone(intents.get(id))),
            capture: call('capture', (id, params, options) => once(options.idempotencyKey, () => {
                if (onCapture) onCapture();
                Object.assign(intents.get(id), { status: 'succeeded', amount_received: params.amount_to_capture, latest_charge: 'ch_1' });
                return structuredClone(intents.get(id));
            })),
            create: call('create', (params, options) => once(options.idempotencyKey, () => {
                const made = {
                    id: 'pi_new_1', status: 'requires_confirmation', customer: params.customer, payment_method: params.payment_method,
                    amount: params.amount, currency: params.currency, metadata: params.metadata, latest_charge: null,
                };
                intents.set(made.id, made);
                return structuredClone(made);
            })),
            confirm: call('confirm', (id) => {
                Object.assign(intents.get(id), { status: 'succeeded', amount_received: intents.get(id).amount, latest_charge: 'ch_new' });
                return structuredClone(intents.get(id));
            }),
        },
        charges: { retrieve: call('charge', () => ({ payment_method: 'pm_1' })) },
        transfers: { create: call('transfer', (params, options) => once(options.idempotencyKey, () => ({ id: `tr_${keyed.size + 1}` }))) },
    };
}

const routeBooking = (over = {}) => ({
    id: 5, user_id: 7, status: 'awaiting_approval', payment_status: 'authorized', payment_intent_id: 'pi_hold_1',
    service_price: '135.00', additional_price: '40.00', provider_id: 3, stripe_account_id: 'acct_1', stripe_onboarding_complete: 1,
    provider_name: 'Pat Provider', provider_email: 'pat@example.test', booking_number: 'BK5', service_name: 'Clean', job_date: '2026-02-02',
    ...over,
});

// The arguments of the approve route's POST for the booking named by `id` in the address.
const approveCall = (id = '5') => [{ json: async () => ({ action: 'approve' }) }, { params: Promise.resolve({ id }) }];

// Runs `body` with the two routes loaded against a database whose pool has `poolSize` connections. `stripe(db)` makes the
// Stripe stand-in the routes are given. Everything the case set up is put back afterwards.
async function withRoutes({ poolSize, rows, stripe }, body) {
    const db = new FakeDatabase(poolSize, rows);
    const standIn = stripe(db);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booking-routes-'));
    const put = (relative, text) => {
        fs.mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
        fs.writeFileSync(path.join(dir, relative), text);
    };
    const imports = {
        'next/server': '../stubs/next-server.mjs',
        stripe: '../stubs/stripe.mjs',
        'mysql2/promise': '../stubs/mysql.mjs',
        '@/lib/db': '../lib/db.mjs',
        '@/lib/api-auth': '../stubs/api-auth.mjs',
        '@/lib/email': '../stubs/email.mjs',
        '@/lib/push': '../stubs/push.mjs',
        '@/lib/logger': '../stubs/logger.mjs',
        '@/lib/booking-price': '../lib/booking-price.mjs',
        '@/lib/booking-payment': '../lib/booking-payment.mjs',
    };
    const copy = (relative) => fs.readFileSync(path.join(REPO, relative), 'utf8').replace(/from '([^']+)'/g, (whole, specifier) => {
        if (!(specifier in imports)) throw new Error(`the route stand-ins have none for the import '${specifier}' in ${relative}`);
        return `from '${imports[specifier]}'`;
    });
    put('stubs/next-server.mjs', 'export const NextResponse = { json: (body, init = {}) => ({ body, status: init.status || 200 }) };\n');
    put('stubs/stripe.mjs', 'export default class Stripe { constructor() { return globalThis.__routeStripe; } }\n');
    put('stubs/mysql.mjs', "export default { createPool() { throw new Error('the case supplies the pool'); } };\n");
    put('stubs/api-auth.mjs', "export const requireCaller = async () => ({ ok: true, caller: { id: 7, role: 'customer' } });\nexport const requireCronSecret = () => ({ ok: true });\n");
    put('stubs/email.mjs', 'export const sendEmail = async () => {};\n');
    put('stubs/push.mjs', 'export const notifyUser = async () => {};\n');
    put('stubs/logger.mjs', 'export const logActivity = () => {};\n');
    put('lib/db.mjs', copy('src/lib/db.js'));
    put('lib/booking-price.mjs', copy('src/lib/booking-price.js'));
    put('lib/booking-payment.mjs', copy('src/lib/booking-payment.js'));
    put('routes/approve.mjs', copy('src/app/api/customer/bookings/[id]/approve/route.js'));
    put('routes/auto-release.mjs', copy('src/app/api/cron/auto-release/route.js'));

    const before = { pool: globalThis.mysqlPool, key: process.env.STRIPE_SECRET_KEY, currency: process.env.STRIPE_CURRENCY };
    const quiet = { log: console.log, error: console.error, warn: console.warn };
    globalThis.mysqlPool = db;
    globalThis.__routeStripe = standIn;
    process.env.STRIPE_SECRET_KEY = 'sk_test_stand_in';
    process.env.STRIPE_CURRENCY = 'cad';
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};
    try {
        const load = (name) => import(pathToFileURL(path.join(dir, 'routes', `${name}.mjs`)).href);
        return await body({ db, stripe: standIn, approve: await load('approve'), autoRelease: await load('auto-release') });
    } finally {
        Object.assign(console, quiet);
        for (const [name, value] of [['STRIPE_SECRET_KEY', before.key], ['STRIPE_CURRENCY', before.currency]]) {
            if (value === undefined) delete process.env[name]; else process.env[name] = value;
        }
        if (before.pool === undefined) delete globalThis.mysqlPool; else globalThis.mysqlPool = before.pool;
        delete globalThis.__routeStripe;
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test.describe('Booking payment', () => {
    test('the smallest price a card payment takes is 0.50, and 0.49 is refused', () => {
        expect(paymentAmountCents(0.50)).toEqual({ ok: true, cents: 50 });
        expect(paymentAmountCents(0.49)).toEqual({ ok: false, reason: 'below_minimum' });
    });

    test('a by-the-hour price that rounds to 0.45 is refused as below the card minimum', () => {
        expect(paymentAmountCents(0.45)).toEqual({ ok: false, reason: 'below_minimum' });
        // The price is rounded to the nearest cent: 19.99 times 100 is 1998.9999999999998 and is 1999 cents; 0.495 is 49.5 and is 50.
        expect(paymentAmountCents(19.99)).toEqual({ ok: true, cents: 1999 });
        expect(paymentAmountCents(0.495)).toEqual({ ok: true, cents: 50 });
    });

    test('999,999.99 is taken and 1,000,000.00 is refused as larger than a card payment can take', () => {
        expect(paymentAmountCents(999999.99)).toEqual({ ok: true, cents: 99999999 });
        expect(paymentAmountCents(1000000.00)).toEqual({ ok: false, reason: 'too_large' });
    });

    test('without a payment key, production refuses a booking and other environments book it unverified', () => {
        expect(paymentCheckMode({ hasKey: false, nodeEnv: 'production' })).toBe('refuse');
        expect(paymentCheckMode({ hasKey: false, nodeEnv: 'development' })).toBe('unverified');
        expect(paymentCheckMode({ hasKey: true, nodeEnv: 'production' })).toBe('verify');
        expect(paymentCheckMode({ hasKey: true, nodeEnv: 'development' })).toBe('verify');
    });

    test('a hold of the booking price for the booking account is accepted as authorized at the held amount', () => {
        const check = checkHeldPayment(heldIntent(), { amountCents: EXPECTED, currency: 'cad', customerId: 'cus_1', nowSeconds: NOW });
        expect(check).toEqual({ ok: true, paymentStatus: 'authorized', authorizedCents: EXPECTED });
    });

    test('a hold one cent away from the booking price is refused as a changed price', () => {
        const check = checkHeldPayment(heldIntent({ amount: EXPECTED - 1, amount_capturable: EXPECTED - 1 }), { amountCents: EXPECTED, currency: 'cad', customerId: 'cus_1', nowSeconds: NOW });
        expect(check.ok).toBe(false);
        expect(check.status).toBe(409);
        expect(check.message).toBe('The price of this booking has changed since the card was authorized. Please confirm the booking again.');
        // One cent above the price is a changed price too: the hold is for exactly this booking's price.
        const above = checkHeldPayment(heldIntent({ amount: EXPECTED + 1, amount_capturable: EXPECTED + 1 }), { amountCents: EXPECTED, currency: 'cad', customerId: 'cus_1', nowSeconds: NOW });
        expect(above.ok).toBe(false);
        expect(above.status).toBe(409);
    });

    test('a hold for another account gets the general refusal even when its amount also differs', () => {
        const check = checkHeldPayment(heldIntent({ customer: 'cus_other', amount: 1, amount_capturable: 1 }), { amountCents: EXPECTED, currency: 'cad', customerId: 'cus_1', nowSeconds: NOW });
        expect(check).toEqual({ ok: false, status: 400, message: 'This payment does not match this booking.', check: 'match' });
        // No account to compare with is the same refusal, whatever the intent says.
        const none = checkHeldPayment(heldIntent({ customer: undefined }), { amountCents: EXPECTED, currency: 'cad', customerId: undefined, nowSeconds: NOW });
        expect(none).toEqual({ ok: false, status: 400, message: 'This payment does not match this booking.', check: 'match' });
    });

    test('a hold in another currency is refused', () => {
        const check = checkHeldPayment(heldIntent({ currency: 'usd' }), { amountCents: EXPECTED, currency: 'cad', customerId: 'cus_1', nowSeconds: NOW });
        expect(check).toEqual({ ok: false, status: 400, message: 'This payment does not match this booking.', check: 'match' });
        // The configured currency is compared without regard to case: Stripe writes it in lower case.
        expect(checkHeldPayment(heldIntent(), { amountCents: EXPECTED, currency: 'CAD', customerId: 'cus_1', nowSeconds: NOW }).ok).toBe(true);
    });

    test('a hold whose capturable amount is below its amount is refused', () => {
        const check = checkHeldPayment(heldIntent({ amount_capturable: EXPECTED - 1 }), { amountCents: EXPECTED, currency: 'cad', customerId: 'cus_1', nowSeconds: NOW });
        expect(check).toEqual({ ok: false, status: 400, message: 'This payment does not match this booking.', check: 'match' });
    });

    test('an intent that is not a hold (needs a payment method, cancelled, processing) is refused', () => {
        for (const status of ['requires_payment_method', 'canceled', 'processing']) {
            const check = checkHeldPayment(heldIntent({ status }), { amountCents: EXPECTED, currency: 'cad', customerId: 'cus_1', nowSeconds: NOW });
            expect(check.ok, `status ${status}`).toBe(false);
        }
        // An intent that waits for capture but is set to automatic capture is not a hold.
        const automatic = checkHeldPayment(heldIntent({ capture_method: 'automatic' }), { amountCents: EXPECTED, currency: 'cad', customerId: 'cus_1', nowSeconds: NOW });
        expect(automatic).toEqual({ ok: false, status: 400, message: 'This payment does not match this booking.', check: 'match' });
    });

    test('a payment taken by automatic capture in the last day is accepted as paid when it received the booking price', () => {
        const intent = heldIntent({ status: 'succeeded', capture_method: 'automatic', amount_received: EXPECTED, created: NOW - 3600 });
        const check = checkHeldPayment(intent, { amountCents: EXPECTED, currency: 'cad', customerId: 'cus_1', nowSeconds: NOW });
        expect(check).toEqual({ ok: true, paymentStatus: 'paid', authorizedCents: EXPECTED });
        // Received one cent either side of the booking price is a changed price.
        for (const received of [EXPECTED - 1, EXPECTED + 1]) {
            const off = checkHeldPayment({ ...intent, amount_received: received }, { amountCents: EXPECTED, currency: 'cad', customerId: 'cus_1', nowSeconds: NOW });
            expect(off.ok, `received ${received}`).toBe(false);
            expect(off.status, `received ${received}`).toBe(409);
        }
        // An intent made with no capture method carries Stripe's default, automatic_async: it is taken by automatic capture too.
        const byDefault = checkHeldPayment({ ...intent, capture_method: 'automatic_async' }, { amountCents: EXPECTED, currency: 'cad', customerId: 'cus_1', nowSeconds: NOW });
        expect(byDefault).toEqual({ ok: true, paymentStatus: 'paid', authorizedCents: EXPECTED });
    });

    test('a taken payment older than a day, or one made with manual capture, is refused', () => {
        const old = checkHeldPayment(heldIntent({ status: 'succeeded', capture_method: 'automatic', amount_received: EXPECTED, created: NOW - 90000 }), { amountCents: EXPECTED, currency: 'cad', customerId: 'cus_1', nowSeconds: NOW });
        expect(old.ok).toBe(false);
        const manual = checkHeldPayment(heldIntent({ status: 'succeeded', capture_method: 'manual', amount_received: EXPECTED, created: NOW - 60 }), { amountCents: EXPECTED, currency: 'cad', customerId: 'cus_1', nowSeconds: NOW });
        expect(manual.ok).toBe(false);
        // A completion charge names its booking and is never taken as the payment for another.
        const completion = checkHeldPayment(heldIntent({ status: 'succeeded', capture_method: 'automatic_async', amount_received: EXPECTED, created: NOW - 60, metadata: { booking_id: '7' } }), { amountCents: EXPECTED, currency: 'cad', customerId: 'cus_1', nowSeconds: NOW });
        expect(completion).toEqual({ ok: false, status: 400, message: 'This payment does not match this booking.', check: 'match' });
    });

    test('a held card is captured once for the recorded price with the booking key, and the charge id is returned', async () => {
        const stripe = scriptedClient({
            retrieve: [heldIntent(), heldIntent({ status: 'succeeded', amount_received: EXPECTED })],
            capture: [{}],
        });
        const result = await collectBookingPayment(stripe, BOOKING, OPTS);
        expect(result).toEqual({ ok: true, chargeId: 'ch_1', amountCents: EXPECTED, overCollected: false });
        expect(stripe.calls).toEqual([
            ['retrieve', 'pi_hold_1'],
            ['capture', 'pi_hold_1', { amount_to_capture: EXPECTED }, { idempotencyKey: 'booking-42-capture' }],
            ['retrieve', 'pi_hold_1'],
        ]);
        // The recorded price is rounded to the nearest cent: 19.99 is captured as 1999.
        const odd = scriptedClient({
            retrieve: [heldIntent({ amount: 1999, amount_capturable: 1999 }), heldIntent({ status: 'succeeded', amount: 1999, amount_received: 1999 })],
            capture: [{}],
        });
        expect(await collectBookingPayment(odd, { ...BOOKING, service_price: '19.99' }, OPTS)).toEqual({ ok: true, chargeId: 'ch_1', amountCents: 1999, overCollected: false });
        expect(odd.calls[1]).toEqual(['capture', 'pi_hold_1', { amount_to_capture: 1999 }, { idempotencyKey: 'booking-42-capture' }]);
    });

    test('a hold larger than the recorded price is captured for the recorded price', async () => {
        const stripe = scriptedClient({
            retrieve: [heldIntent({ amount: 20000, amount_capturable: 20000 }), heldIntent({ status: 'succeeded', amount_received: EXPECTED })],
            capture: [{}],
        });
        const result = await collectBookingPayment(stripe, BOOKING, OPTS);
        expect(result.ok).toBe(true);
        expect(stripe.calls[1]).toEqual(['capture', 'pi_hold_1', { amount_to_capture: EXPECTED }, { idempotencyKey: 'booking-42-capture' }]);
    });

    test('a hold smaller than the recorded price is not captured and is reported as a mismatch', async () => {
        const stripe = scriptedClient({ retrieve: [heldIntent({ amount: 10000, amount_capturable: 10000 })] });
        const result = await collectBookingPayment(stripe, BOOKING, OPTS);
        expect(result).toEqual({ ok: false, reason: 'mismatch' });
        expect(stripe.calls.filter(([m]) => m === 'capture')).toEqual([]);
    });

    test('a payment already taken for the recorded price is carried on with no second capture', async () => {
        const stripe = scriptedClient({ retrieve: [heldIntent({ status: 'succeeded', amount_received: EXPECTED })] });
        const result = await collectBookingPayment(stripe, BOOKING, OPTS);
        expect(result).toEqual({ ok: true, chargeId: 'ch_1', amountCents: EXPECTED, overCollected: false });
        expect(stripe.calls).toEqual([['retrieve', 'pi_hold_1']]);
    });

    test('a payment taken for less than the recorded price is a mismatch with nothing to pay from', async () => {
        const stripe = scriptedClient({ retrieve: [heldIntent({ status: 'succeeded', amount_received: EXPECTED - 1 })] });
        const result = await collectBookingPayment(stripe, BOOKING, OPTS);
        expect(result).toEqual({ ok: false, reason: 'mismatch' });
        // A payment that names no charge has nothing to tie a payout to, and a booking with no recorded price has nothing to take.
        const noCharge = scriptedClient({ retrieve: [heldIntent({ status: 'succeeded', amount_received: EXPECTED, latest_charge: null })] });
        expect(await collectBookingPayment(noCharge, BOOKING, OPTS)).toEqual({ ok: false, reason: 'mismatch' });
        const noPrice = scriptedClient({ retrieve: [heldIntent()] });
        expect(await collectBookingPayment(noPrice, { ...BOOKING, service_price: null }, OPTS)).toEqual({ ok: false, reason: 'mismatch' });
        expect(noPrice.calls).toEqual([]);
    });

    test('a payment taken for more than the recorded price is carried on and marked over-collected', async () => {
        const stripe = scriptedClient({ retrieve: [heldIntent({ status: 'succeeded', amount_received: EXPECTED + 500 })] });
        const result = await collectBookingPayment(stripe, BOOKING, OPTS);
        expect(result).toEqual({ ok: true, chargeId: 'ch_1', amountCents: EXPECTED + 500, overCollected: true });
    });

    test('a hold Stripe let lapse is charged on the saved card for the recorded price, saved on the booking before it is confirmed', async () => {
        const lapsed = heldIntent({ status: 'canceled', cancellation_reason: 'automatic' });
        const created = { id: 'pi_new_1', status: 'requires_confirmation', payment_method: 'pm_1', metadata: { booking_id: '42' } };
        const stripe = scriptedClient({
            retrieve: [lapsed, { ...created, status: 'succeeded', amount_received: EXPECTED, latest_charge: 'ch_9' }],
            create: [created],
            confirm: [{}],
        });
        const saved = [];
        const result = await collectBookingPayment(stripe, BOOKING, {
            ...OPTS,
            saveIntentId: async (newId, oldId) => { saved.push([newId, oldId]); return true; },
        });
        expect(result).toEqual({ ok: true, chargeId: 'ch_9', amountCents: EXPECTED, overCollected: false });
        // The create carries the recorded price, the saved card and the per-booking key, unconfirmed.
        expect(stripe.calls[1]).toEqual(['create', {
            amount: EXPECTED, currency: 'cad', customer: 'cus_1', payment_method: 'pm_1',
            metadata: { booking_id: '42' }, confirm: false,
            automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
        }, { idempotencyKey: 'booking-42-completion-charge' }]);
        // Saved on the booking before it is confirmed.
        expect(saved).toEqual([['pi_new_1', 'pi_hold_1']]);
        expect(stripe.calls[2][0]).toBe('confirm');
        // The charge is created in the currency the route passes in, and in cad when none is passed.
        const again = () => scriptedClient({ retrieve: [lapsed, { ...created, status: 'succeeded', amount_received: EXPECTED, latest_charge: 'ch_9' }], create: [created], confirm: [{}] });
        const inUsd = again();
        await collectBookingPayment(inUsd, BOOKING, { ...OPTS, currency: 'usd' });
        expect(inUsd.calls[1][1].currency).toBe('usd');
        const inDefault = again();
        await collectBookingPayment(inDefault, BOOKING, { saveIntentId: OPTS.saveIntentId, readIntentId: OPTS.readIntentId });
        expect(inDefault.calls[1][1].currency).toBe('cad');
        // The save is ordered before the confirm in the same log: the save is the call between the create and the confirm.
        const order = [];
        const ordered = again();
        for (const method of ['create', 'confirm']) { const original = ordered.paymentIntents[method]; ordered.paymentIntents[method] = async (...args) => { order.push(method); return original(...args); }; }
        await collectBookingPayment(ordered, BOOKING, { ...OPTS, saveIntentId: async () => { order.push('save'); return true; } });
        expect(order).toEqual(['create', 'save', 'confirm']);
    });

    test('a lapsed hold with no payment method of its own uses the payment method of its latest charge', async () => {
        const lapsed = heldIntent({ status: 'canceled', cancellation_reason: 'expired', payment_method: null, latest_charge: { id: 'ch_1', payment_method: 'pm_from_charge' } });
        const created = { id: 'pi_new_1', status: 'requires_confirmation', payment_method: 'pm_from_charge', metadata: { booking_id: '42' } };
        const stripe = scriptedClient({
            retrieve: [lapsed, { ...created, status: 'succeeded', amount_received: EXPECTED, latest_charge: 'ch_9' }],
            create: [created],
            confirm: [{}],
        });
        const result = await collectBookingPayment(stripe, BOOKING, OPTS);
        expect(result.ok).toBe(true);
        expect(stripe.calls[1][1].payment_method).toBe('pm_from_charge');

        // The charge arrives as its id, as the API returns it: it is read, and its payment method is the card charged.
        const byId = scriptedClient({
            retrieve: [heldIntent({ status: 'canceled', cancellation_reason: 'expired', payment_method: null, latest_charge: 'ch_1' }), { ...created, status: 'succeeded', amount_received: EXPECTED, latest_charge: 'ch_9' }],
            charge: [{ id: 'ch_1', payment_method: 'pm_from_charge' }],
            create: [created],
            confirm: [{}],
        });
        const result2 = await collectBookingPayment(byId, BOOKING, OPTS);
        expect(result2.ok).toBe(true);
        expect(byId.calls.map(([method]) => method)).toEqual(['retrieve', 'charge', 'create', 'confirm', 'retrieve']);
        expect(byId.calls[1]).toEqual(['charge', 'ch_1']);
        expect(byId.calls[2][1].payment_method).toBe('pm_from_charge');
    });

    test('a lapsed hold with no saved card is reported and no charge is attempted', async () => {
        const lapsed = heldIntent({ status: 'canceled', cancellation_reason: 'automatic', payment_method: null, latest_charge: null });
        const stripe = scriptedClient({ retrieve: [lapsed] });
        const result = await collectBookingPayment(stripe, BOOKING, OPTS);
        expect(result).toEqual({ ok: false, reason: 'no_payment_method' });
        expect(stripe.calls.filter(([m]) => m === 'create')).toEqual([]);
    });

    test('a hold a person cancelled is never charged again', async () => {
        const stripe = scriptedClient({ retrieve: [heldIntent({ status: 'canceled', cancellation_reason: 'abandoned' })] });
        const result = await collectBookingPayment(stripe, BOOKING, OPTS);
        expect(result).toEqual({ ok: false, reason: 'cancelled_by_person' });
        expect(stripe.calls.filter(([m]) => m === 'create' || m === 'confirm')).toEqual([]);
        // Every other reason a cancellation can carry, and none, is a person's too.
        for (const reason of [null, 'duplicate', 'fraudulent', 'requested_by_customer']) {
            const other = scriptedClient({ retrieve: [heldIntent({ status: 'canceled', cancellation_reason: reason })] });
            expect(await collectBookingPayment(other, BOOKING, OPTS), String(reason)).toEqual({ ok: false, reason: 'cancelled_by_person' });
            expect(other.calls.filter(([m]) => m === 'create' || m === 'confirm'), String(reason)).toEqual([]);
        }
    });

    test('a declined saved-card charge is reported as declined, and one that needs the customer as action required', async () => {
        const lapsed = heldIntent({ status: 'canceled', cancellation_reason: 'automatic' });
        const created = { id: 'pi_new_1', status: 'requires_confirmation', payment_method: 'pm_1', metadata: { booking_id: '42' } };
        const declined = scriptedClient({
            retrieve: [lapsed, { ...created, status: 'requires_payment_method', payment_method: null }],
            create: [created],
            confirm: [cardError('card_declined')],
        });
        const result = await collectBookingPayment(declined, BOOKING, OPTS);
        expect(result).toEqual({ ok: false, reason: 'declined' });

        const needsAction = scriptedClient({
            retrieve: [heldIntent({ status: 'canceled', cancellation_reason: 'automatic' }), { ...created, status: 'requires_action' }],
            create: [created],
            confirm: [cardError('authentication_required')],
        });
        const result2 = await collectBookingPayment(needsAction, BOOKING, OPTS);
        expect(result2).toEqual({ ok: false, reason: 'action_required' });

        // A saved charge found on a retry that needs the customer is reported so, and nothing is created or confirmed.
        const waiting = { id: 'pi_new_1', status: 'requires_action', payment_method: 'pm_1', metadata: { booking_id: '42' } };
        const retryAction = scriptedClient({ retrieve: [waiting] });
        expect(await collectBookingPayment(retryAction, { ...BOOKING, payment_intent_id: 'pi_new_1' }, OPTS)).toEqual({ ok: false, reason: 'action_required' });
        expect(retryAction.calls.filter(([m]) => m === 'create' || m === 'confirm')).toEqual([]);
        // A call that returns with the charge not taken is read from the intent: needs the customer, or declined.
        for (const [status, reason] of [['requires_action', 'action_required'], ['requires_payment_method', 'declined']]) {
            const unsettled = scriptedClient({ retrieve: [heldIntent(), heldIntent({ status })], capture: [{}] });
            expect(await collectBookingPayment(unsettled, BOOKING, OPTS), status).toEqual({ ok: false, reason });
        }
    });

    test('a retry finds the saved charge waiting for confirmation and confirms it without creating another', async () => {
        const savedCharge = { id: 'pi_new_1', status: 'requires_confirmation', payment_method: 'pm_1', metadata: { booking_id: '42' } };
        const stripe = scriptedClient({
            retrieve: [savedCharge, { ...savedCharge, status: 'succeeded', amount_received: EXPECTED, latest_charge: 'ch_9' }],
            confirm: [{}],
        });
        const result = await collectBookingPayment(stripe, { ...BOOKING, payment_intent_id: 'pi_new_1' }, OPTS);
        expect(result).toEqual({ ok: true, chargeId: 'ch_9', amountCents: EXPECTED, overCollected: false });
        expect(stripe.calls.filter(([m]) => m === 'create')).toEqual([]);
        expect(stripe.calls.filter(([m]) => m === 'confirm')).toEqual([['confirm', 'pi_new_1', { payment_method: 'pm_1', off_session: true }]]);

        // Only a charge made for this booking is confirmed: one that names another booking, or none, is not.
        for (const metadata of [{ booking_id: '99' }, {}]) {
            const other = scriptedClient({ retrieve: [{ ...savedCharge, metadata }], confirm: [{}] });
            expect(await collectBookingPayment(other, { ...BOOKING, payment_intent_id: 'pi_new_1' }, OPTS), JSON.stringify(metadata)).toEqual({ ok: false, reason: 'mismatch' });
            expect(other.calls.filter(([m]) => m === 'confirm'), JSON.stringify(metadata)).toEqual([]);
        }
        // A saved charge that has lost its card is reported, and nothing is confirmed.
        const cardless = scriptedClient({ retrieve: [{ ...savedCharge, payment_method: null }], confirm: [{}] });
        expect(await collectBookingPayment(cardless, { ...BOOKING, payment_intent_id: 'pi_new_1' }, OPTS)).toEqual({ ok: false, reason: 'no_payment_method' });
        expect(cardless.calls.filter(([m]) => m === 'confirm')).toEqual([]);
    });

    test('a retry finds the saved charge taken and carries on without charging again', async () => {
        const savedCharge = { id: 'pi_new_1', status: 'succeeded', amount_received: EXPECTED, latest_charge: 'ch_9', metadata: { booking_id: '42' } };
        const stripe = scriptedClient({ retrieve: [savedCharge] });
        const result = await collectBookingPayment(stripe, { ...BOOKING, payment_intent_id: 'pi_new_1' }, OPTS);
        expect(result).toEqual({ ok: true, chargeId: 'ch_9', amountCents: EXPECTED, overCollected: false });
        expect(stripe.calls.filter(([m]) => m === 'create' || m === 'confirm' || m === 'capture')).toEqual([]);

        // The same when the booking this call holds still names the lapsed hold and another call has saved its charge since: the
        // charge on the booking is read and carried on with, and no second charge is created.
        const lapsed = heldIntent({ status: 'canceled', cancellation_reason: 'automatic' });
        const since = scriptedClient({ retrieve: [lapsed, savedCharge] });
        const result2 = await collectBookingPayment(since, BOOKING, { ...OPTS, readIntentId: async () => 'pi_new_1' });
        expect(result2).toEqual({ ok: true, chargeId: 'ch_9', amountCents: EXPECTED, overCollected: false });
        expect(since.calls.filter(([m]) => m === 'create' || m === 'confirm' || m === 'capture')).toEqual([]);
    });

    test('when another call saved its charge first, this call continues with that one', async () => {
        const lapsed = heldIntent({ status: 'canceled', cancellation_reason: 'automatic' });
        const mine = { id: 'pi_mine', status: 'requires_confirmation', payment_method: 'pm_1', metadata: { booking_id: '42' } };
        const theirs = { id: 'pi_theirs', status: 'requires_confirmation', payment_method: 'pm_1', metadata: { booking_id: '42' } };
        const stripe = scriptedClient({
            retrieve: [lapsed, theirs, { ...theirs, status: 'succeeded', amount_received: EXPECTED, latest_charge: 'ch_theirs' }],
            create: [mine],
            confirm: [{}],
        });
        // The booking holds the lapsed hold when this call starts; when its own save loses, the booking holds the other call's charge.
        const reads = ['pi_hold_1', 'pi_theirs'];
        const result = await collectBookingPayment(stripe, BOOKING, {
            ...OPTS,
            saveIntentId: async () => false,
            readIntentId: async () => reads.shift(),
        });
        expect(result).toEqual({ ok: true, chargeId: 'ch_theirs', amountCents: EXPECTED, overCollected: false });
        // Only the charge on the booking is confirmed; the one this call created is left unconfirmed.
        expect(stripe.calls.filter(([m]) => m === 'confirm')).toEqual([['confirm', 'pi_theirs', { payment_method: 'pm_1', off_session: true }]]);

        // A save that loses with nothing else on the booking confirms nothing.
        const alone = scriptedClient({ retrieve: [lapsed], create: [mine], confirm: [{}] });
        const result2 = await collectBookingPayment(alone, BOOKING, { ...OPTS, saveIntentId: async () => false, readIntentId: async () => 'pi_hold_1' });
        expect(result2).toEqual({ ok: false, reason: 'unavailable' });
        expect(alone.calls.filter(([m]) => m === 'confirm')).toEqual([]);
    });

    test('a capture error is settled by reading the intent again, not by the error text', async () => {
        const stripe = scriptedClient({
            retrieve: [heldIntent(), heldIntent({ status: 'succeeded', amount_received: EXPECTED })],
            capture: [Object.assign(new Error('You cannot capture this PaymentIntent because it has a status of succeeded'), { statusCode: 400 })],
        });
        const result = await collectBookingPayment(stripe, BOOKING, OPTS);
        expect(result).toEqual({ ok: true, chargeId: 'ch_1', amountCents: EXPECTED, overCollected: false });

        // A capture error with no message to read is settled the same way.
        const silent = scriptedClient({ retrieve: [heldIntent(), heldIntent({ status: 'succeeded', amount_received: EXPECTED })], capture: [connError()] });
        expect(await collectBookingPayment(silent, BOOKING, OPTS)).toEqual({ ok: true, chargeId: 'ch_1', amountCents: EXPECTED, overCollected: false });

        // The same for a confirm: the charge was taken though the call failed.
        const lapsed = heldIntent({ status: 'canceled', cancellation_reason: 'automatic' });
        const created = { id: 'pi_new_1', status: 'requires_confirmation', payment_method: 'pm_1', metadata: { booking_id: '42' } };
        const confirmed = scriptedClient({
            retrieve: [lapsed, { ...created, status: 'succeeded', amount_received: EXPECTED, latest_charge: 'ch_9' }],
            create: [created],
            confirm: [connError()],
        });
        expect(await collectBookingPayment(confirmed, BOOKING, OPTS)).toEqual({ ok: true, chargeId: 'ch_9', amountCents: EXPECTED, overCollected: false });
        // And when the intent cannot be read again either, the kind of error decides.
        const unreadable = scriptedClient({ retrieve: [heldIntent(), connError()], capture: [connError()] });
        expect(await collectBookingPayment(unreadable, BOOKING, OPTS)).toEqual({ ok: false, reason: 'unavailable' });
    });

    test('Stripe out of reach leaves the booking untouched for a later try', async () => {
        const stripe = scriptedClient({ retrieve: [connError()] });
        const result = await collectBookingPayment(stripe, BOOKING, OPTS);
        expect(result).toEqual({ ok: false, reason: 'unavailable' });

        // Every call a charge makes is a try-later when Stripe is out of reach, and so is an intent that is still processing.
        const lapsed = heldIntent({ status: 'canceled', cancellation_reason: 'automatic' });
        const created = { id: 'pi_new_1', status: 'requires_confirmation', payment_method: 'pm_1', metadata: { booking_id: '42' } };
        const later = {
            'the lookup of the card': [scriptedClient({ retrieve: [heldIntent({ status: 'canceled', cancellation_reason: 'automatic', payment_method: null, latest_charge: 'ch_1' })], charge: [connError()] }), OPTS, BOOKING],
            'the create of the charge': [scriptedClient({ retrieve: [lapsed], create: [connError()] }), OPTS, BOOKING],
            'the read of a charge another call saved': [scriptedClient({ retrieve: [lapsed, connError()] }), { ...OPTS, readIntentId: async () => 'pi_new_1' }, BOOKING],
            'the read after a confirm': [scriptedClient({ retrieve: [lapsed, connError()], create: [created], confirm: [{}] }), OPTS, BOOKING],
            'a hold still processing': [scriptedClient({ retrieve: [heldIntent({ status: 'processing' })] }), OPTS, BOOKING],
            'a charge another call saved, still processing': [scriptedClient({ retrieve: [lapsed, { ...created, status: 'processing' }] }), { ...OPTS, readIntentId: async () => 'pi_new_1' }, BOOKING],
            'a capture that returns with the charge still processing': [scriptedClient({ retrieve: [heldIntent(), heldIntent({ status: 'processing' })], capture: [{}] }), OPTS, BOOKING],
            'a rate limit': [scriptedClient({ retrieve: [Object.assign(new Error('rate limit'), { type: 'StripeRateLimitError' })] }), OPTS, BOOKING],
            'a server error': [scriptedClient({ retrieve: [Object.assign(new Error('server error'), { type: 'StripeAPIError', statusCode: 500 })] }), OPTS, BOOKING],
            'a key Stripe refuses': [scriptedClient({ retrieve: [Object.assign(new Error('invalid key'), { type: 'StripeAuthenticationError', statusCode: 401 })] }), OPTS, BOOKING],
        };
        for (const [name, [client, opts, booking]] of Object.entries(later)) {
            expect(await collectBookingPayment(client, booking, opts), name).toEqual({ ok: false, reason: 'unavailable' });
        }
    });

    test('with no payment client nothing is called and the answer is not configured', async () => {
        const result = await collectBookingPayment(null, BOOKING, OPTS);
        expect(result).toEqual({ ok: false, reason: 'not_configured' });
    });

    test('an intent Stripe does not know, or a request it refuses for this booking, is a mismatch and nothing is charged', async () => {
        const stripe = scriptedClient({ retrieve: [missingError()] });
        const result = await collectBookingPayment(stripe, BOOKING, OPTS);
        expect(result).toEqual({ ok: false, reason: 'mismatch' });
        expect(stripe.calls).toEqual([['retrieve', 'pi_hold_1']]);
        // A request Stripe refuses as malformed or conflicting is about this booking, whichever call it answers.
        const invalid = Object.assign(new Error('invalid request'), { type: 'StripeInvalidRequestError', code: 'parameter_invalid_empty', statusCode: 400 });
        const conflict = Object.assign(new Error('idempotency'), { type: 'StripeIdempotencyError', statusCode: 400 });
        const atCreate = scriptedClient({ retrieve: [heldIntent({ status: 'canceled', cancellation_reason: 'automatic' })], create: [invalid] });
        expect(await collectBookingPayment(atCreate, BOOKING, OPTS)).toEqual({ ok: false, reason: 'mismatch' });
        const atCapture = scriptedClient({ retrieve: [heldIntent()], capture: [conflict] });
        expect(await collectBookingPayment(atCapture, BOOKING, OPTS)).toEqual({ ok: false, reason: 'mismatch' });
    });

    // ── The completion routes, in this process, against a pool of a few connections ─────────────────────────────────

    test('a booking whose hold lapsed is charged, paid out and recorded when the pool has a single connection', async () => {
        await withRoutes({ poolSize: 1, rows: [routeBooking()], stripe: () => statefulStripe(true) }, async ({ db, stripe, approve }) => {
            const answer = await within(4000, approve.POST(...approveCall()));
            expect(answer, 'the route answers').not.toBe(NO_ANSWER);
            expect(answer.status, JSON.stringify(answer.body)).toBe(200);
            expect(db.rows.get(5)).toMatchObject({ status: 'completed', payment_status: 'paid', payment_intent_id: 'pi_new_1' });
            expect(stripe.calls.filter(([name]) => name === 'transfer')).toHaveLength(1);
            expect(db.payouts).toHaveLength(1);
        });
    });

    test('three approvals of one lapsed booking at once, with three connections, all answer and the booking is recorded once', async () => {
        await withRoutes({ poolSize: 3, rows: [routeBooking()], stripe: () => statefulStripe(true) }, async ({ db, stripe, approve }) => {
            const answers = await within(6000, Promise.all([1, 2, 3].map(() => approve.POST(...approveCall()))));
            expect(answers, 'every request answers').not.toBe(NO_ANSWER);
            expect(answers.map((answer) => answer.status).sort()).toEqual([200, 400, 400]);
            expect(answers.filter((answer) => answer.status === 400).map((answer) => answer.body.message))
                .toEqual(Array(2).fill("Booking status is 'completed', expected 'awaiting_approval'"));
            expect(db.rows.get(5)).toMatchObject({ status: 'completed', payment_status: 'paid', payment_intent_id: 'pi_new_1' });
            expect(stripe.calls.filter(([name]) => name === 'transfer')).toHaveLength(1);
            expect(db.payouts).toHaveLength(1);
            expect(db.credits).toEqual([108]);
        });
    });

    test('a lapsed booking is released by the hourly run when the pool has a single connection', async () => {
        await withRoutes({ poolSize: 1, rows: [routeBooking()], stripe: () => statefulStripe(true) }, async ({ db, stripe, autoRelease }) => {
            const answer = await within(4000, autoRelease.GET({}));
            expect(answer, 'the run answers').not.toBe(NO_ANSWER);
            expect(answer.body.results).toEqual([{ booking_id: 5, status: 'released' }]);
            expect(db.rows.get(5)).toMatchObject({ status: 'completed', payment_status: 'paid', payment_intent_id: 'pi_new_1' });
            expect(stripe.calls.filter(([name]) => name === 'transfer')).toHaveLength(1);
        });
    });

    test('a booking that another request finished while the payment was being taken is not recorded again', async () => {
        const finishedElsewhere = (db) => () => { db.rows.get(5).status = 'completed'; };
        await withRoutes({ poolSize: 3, rows: [routeBooking()], stripe: (db) => statefulStripe(false, { onCapture: finishedElsewhere(db) }) }, async ({ db, stripe, approve }) => {
            const answer = await within(4000, approve.POST(...approveCall()));
            expect(answer, 'the route answers').not.toBe(NO_ANSWER);
            expect(answer.status, JSON.stringify(answer.body)).toBe(400);
            expect(answer.body.message).toBe("Booking status is 'completed', expected 'awaiting_approval'");
            expect(stripe.calls.filter(([name]) => name === 'transfer')).toHaveLength(0);
            expect(db.payouts).toHaveLength(0);
            expect(db.credits).toHaveLength(0);
            expect(db.statements.some(([, sql]) => sql.startsWith("UPDATE bookings SET status = 'completed'"))).toBe(false);
        });
    });

    test('the payout key is built from the booking id, whichever way the id is written in the address', async () => {
        await withRoutes({ poolSize: 3, rows: [routeBooking()], stripe: () => statefulStripe(false) }, async ({ stripe, approve }) => {
            const answer = await within(4000, approve.POST(...approveCall('05')));
            expect(answer, 'the route answers').not.toBe(NO_ANSWER);
            expect(answer.status, JSON.stringify(answer.body)).toBe(200);
            const [transfer] = stripe.calls.filter(([name]) => name === 'transfer');
            expect(transfer[2]).toEqual({ idempotencyKey: 'booking-5-transfer-ch_1' });
            expect(transfer[1].metadata.booking_id).toBe('5');
        });
    });

    // ── Through the dev app (no payment key: bookings are recorded pending, unverified) ─────────────────────────────

    const tag = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const bookingBody = (fields = {}) => {
        const t = tag();
        return {
            service_id: 1, service_name: 'Fixture Standard Clean', service_price: 80, additional_price: 40,
            first_name: 'E2E', last_name: 'Payment', email: `e2e-eng008-${t}@workontap.test`, phone: '+14035550199',
            job_date: '2026-02-01', job_time_slot: '09:00', job_description: 'E2E booking-payment case, deleted by the case.',
            address_line1: '1 Probe Street', city: 'Calgary', payment_intent_id: `pi_e2e_eng008_${t}`,
            ...fields,
        };
    };

    test('a booking made where no payment key is set is recorded as pending with no held amount', async ({ request, baseURL }) => {
        const styles = await getCredentialHeaders(String(baseURL));
        const body = bookingBody();
        const created = await request.post('/api/bookings', { data: body, maxRetries: RESET_RETRIES, timeout: 60_000 });
        expect(created.status(), 'checkout makes the booking').toBe(200);
        const answer = await created.json();
        expect(answer.authorized_amount, 'the answer holds no held amount').toBeNull();
        expect(answer.message, 'the answer says the payment was not verified').toBe('Booking confirmed. Payment was not verified: payments are not configured on this server.');
        const read = await request.get(`/api/bookings/${answer.booking_id}`, { headers: styles['admin-bearer'] });
        const row = (await read.json()).data;
        expect(row.payment_status, 'the stored payment status').toBe('pending');
        expect(row.authorized_amount, 'the stored held amount is null').toBeNull();
        await request.delete(`/api/bookings?id=${answer.booking_id}`, { headers: styles['admin-bearer'] });
    });

    test('a booking and create-intent refuse a price below the card minimum with the same answer', async ({ request, baseURL }) => {
        const styles = await getCredentialHeaders(String(baseURL));
        // Fixture service 1's 'hourly' option is 45.00 by the hour, so one hundredth of an hour prices at 0.45. The date is
        // a Monday: a weekend date would add the weekend line and the price would clear the card minimum.
        const answers = { option: 'hourly', hours: 0.01 };
        const intent = await request.post('/api/payment/create-intent', { headers: styles['customer-bearer'], data: { service_id: 1, answers } });
        expect(intent.status(), 'create-intent refuses the price').toBe(400);
        const intentBody = await intent.json();
        expect(intentBody).toEqual({ success: false, message: 'The price for these answers is below the smallest amount a card payment can take', field: 'answers' });

        const booking = await request.post('/api/bookings', { data: bookingBody({ answers, job_date: '2026-02-02' }), maxRetries: RESET_RETRIES, timeout: 60_000 });
        expect(booking.status(), 'the booking refuses the price').toBe(400);
        expect(await booking.json()).toEqual({ success: false, message: 'The price for these answers is below the smallest amount a card payment can take', field: 'answers' });
    });

    test('a payment already attached to a booking is refused with 409', async ({ request, baseURL }) => {
        const styles = await getCredentialHeaders(String(baseURL));
        const body = bookingBody();
        const created = await request.post('/api/bookings', { data: body, maxRetries: RESET_RETRIES, timeout: 60_000 });
        expect(created.status(), 'the first booking is made').toBe(200);
        const first = await created.json();
        try {
            const again = await request.post('/api/bookings', { data: bookingBody({ payment_intent_id: body.payment_intent_id }), maxRetries: RESET_RETRIES, timeout: 60_000 });
            expect(again.status(), 'the same payment id is refused').toBe(409);
            expect(await again.json()).toEqual({ success: false, message: 'This payment is already attached to a booking.' });
        } finally {
            await request.delete(`/api/bookings?id=${first.booking_id}`, { headers: styles['admin-bearer'] });
        }
    });
});
