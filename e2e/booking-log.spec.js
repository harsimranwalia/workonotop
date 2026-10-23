// @ts-check
// ENG-030 (BUG-016): the booking route writes no value of a customer's, and no value of an admin's edit, to the application log.
// POST /api/bookings (the public checkout) used to log the customer's e-mail and then an object holding name, e-mail, phone, address and job
// description; PUT /api/bookings (an admin's edit) logged the whole request body; and the three failure lines printed the whole error object, whose
// message can quote what was sent. The log is the server's console, so these cases read it where it is written: the real POST, PUT and DELETE
// handlers are loaded in plain Node against the dev database with a spy on console, the technique already in the suite in e2e/booking-payment.spec.js
// (withRoutes) and e2e/job-link-retention.spec.js (the cron case). Only the neighbours that would send something or need a session are stand-ins.
//   1  a public checkout: the answer, the stored booking and its one history row are what they were, no value of the customer's is in any logged line,
//      and the lines are exactly the one that names the booking number.
//   2  a checkout that fails, by the INSERT (an error whose message quotes the customer's values) and by a request that cannot be parsed (a SyntaxError
//      whose message quotes one): 500, no booking, and the line holds the error's code, or its name when it has no code, and nothing it said.
//   3  an admin's edit whose body holds all six fields the handler reads and the customer's details: the answer, the booking and its history are what
//      they were (the note is stored), and the lines are the id and the commission line, which names a percent and an amount.
//   4  an edit that fails: 500, the booking is as it was, and both failure lines hold the code only.
// The answer and the rows are asserted before the log, so a case that fails on the old route fails on the log and not on the booking.
// The values are this file's own: each carries the run's marker, the e-mail starts e2e-bl- and the number is +1 403 555 0172. Every booking a case
// makes is deleted through the route's own DELETE after the case, and the e-mails of the prefix are swept through it before the first and after the last.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { format } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EMAIL_PREFIX = 'e2e-bl-';
const RUN = Date.now().toString(36);
const DB = { host: '127.0.0.1', port: 3307, user: 'root', password: 'root123', database: 'workontap_db' };

// What the customer typed at the checkout, and what the admin typed in the note of the edit.
const CUSTOMER = {
    first_name: `First${RUN}`,
    last_name: `Last${RUN}`,
    email: `${EMAIL_PREFIX}${RUN}@workontap.test`,
    phone: '+14035550172',
    address_line1: `${RUN} Logline Street`,
    address_line2: `Unit ${RUN}`,
    postal_code: 'T2P 1Z9',
    instructions: `Instr ${RUN} leave the parcel with the neighbour`,
    job_description: `Scrub ${RUN} the kitchen floor`,
};
const NOTE = `Note ${RUN} kept in the booking history`;
const PHONE_FORMS = ['+14035550172', '14035550172', '4035550172', '(403) 555-0172', '403-555-0172', '403 555 0172'];

// Every value of the above that a log line must never hold, by kind.
const REGISTRY = [
    ['first name', CUSTOMER.first_name], ['last name', CUSTOMER.last_name], ['e-mail', CUSTOMER.email],
    ...PHONE_FORMS.map((form) => ['phone', form]),
    ['street address', CUSTOMER.address_line1], ['second address line', CUSTOMER.address_line2], ['postal code', CUSTOMER.postal_code],
    ['instructions', CUSTOMER.instructions], ['job description', CUSTOMER.job_description], ['admin note', NOTE],
];

// ---- the console spy: installed before the first case of the file, restored after the last, so it sees every case ---------------------

/** @type {{ method: string, text: string }[]} */
const captured = [];
/** @type {Record<string, any>} */
const realConsole = {};
const SPIED = ['log', 'info', 'warn', 'error', 'debug'];
let spying = false;

/** Runs `work` and returns its result with what it logged, as [method, text] pairs. */
async function logsOf(work) {
    const before = captured.length;
    const result = await work();
    return { result, lines: captured.slice(before).map((entry) => [entry.method, entry.text]) };
}

/** The kinds of value of the customer's, or the admin's, that the lines hold, each with the line it is in. Empty is the answer the cases want. */
function leaksIn(lines) {
    /** @type {string[]} */
    const found = [];
    lines.forEach(([method, text], index) => {
        for (const [kind, value] of REGISTRY) if (text.includes(value)) found.push(`${kind} in logged line ${index + 1} (${method})`);
    });
    return found;
}

// ---- the database, and the statement a case can make fail ---------------------------------------------------------------------------

/** @type {import('mysql2/promise').Pool | null} */
let pool = null;
/** @type {{ pattern: RegExp, error: Error } | null} */
let injected = null;

/** The next statement whose text matches `pattern` fails with `error`; the one after it runs as usual. */
const failNext = (pattern, error) => {
    injected = { pattern, error };
};

/** An error shaped like the driver's: a code, and a message that quotes what was sent. */
function driverError() {
    const message = `Incorrect string value: '${CUSTOMER.job_description}' for column 'job_description' at row 1 (${CUSTOMER.first_name} ${CUSTOMER.last_name}, ${CUSTOMER.email})`;
    return Object.assign(new Error(message), { code: 'ER_E2E_FIXTURE', sqlMessage: message });
}

// A connection of the real pool whose execute and query can be told to fail, everything else as it is.
function wrapConnection(real) {
    return new Proxy(real, {
        get(target, name) {
            const member = Reflect.get(target, name, target);
            if (typeof member !== 'function') return member;
            if (name === 'execute' || name === 'query') {
                return (sql, ...rest) => {
                    if (injected && typeof sql === 'string' && injected.pattern.test(sql)) {
                        const { error } = injected;
                        injected = null;
                        return Promise.reject(error);
                    }
                    return member.call(target, sql, ...rest);
                };
            }
            return member.bind(target);
        },
    });
}

const rows = async (sql, params = []) => /** @type {any[]} */ ((await /** @type {any} */ (pool).execute(sql, params))[0]);

// ---- the route, loaded the way the suite loads one in plain Node -----------------------------------------------------------------------

// The route and the libraries it needs are copied to a temp directory with every import rewritten through a table that throws on a specifier it
// has no entry for, so a new import in the route stops this file and does not silently reach for the real thing.
const REAL_LIBS = ['db', 'location', 'booking-price', 'pricing-rules', 'booking-payment', 'visit-series'];
const NEIGHBOURS = ['booking-price', 'visit-series', 'booking-answers'];

async function loadRoute(adminId) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booking-log-'));
    const put = (relative, text) => {
        fs.mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
        fs.writeFileSync(path.join(dir, relative), text);
    };
    /** @type {Record<string, string>} */
    const imports = {
        stripe: '../stubs/stripe.mjs',
        'mysql2/promise': '../stubs/mysql.mjs',
        'next/server': '../stubs/next-server.mjs',
        '@/lib/api-auth': '../stubs/api-auth.mjs',
        '@/lib/push': '../stubs/push.mjs',
        '@/lib/notices': '../stubs/notices.mjs',
        '@/lib/notice-events': '../stubs/notice-events.mjs',
        '@/lib/logger': '../stubs/logger.mjs',
        '@/lib/marketplace': '../stubs/marketplace.mjs',
        '@/lib/booking-crew': '../stubs/booking-crew.mjs',
    };
    for (const name of REAL_LIBS) imports[`@/lib/${name}`] = `../lib/${name}.mjs`;
    for (const name of NEIGHBOURS) imports[`./${name}.js`] = `./${name}.mjs`;
    const copy = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/from\s+(['"])([^'"]+)\1/g, (whole, quote, specifier) => {
        if (!(specifier in imports)) throw new Error(`the route stand-ins have none for the import '${specifier}' in ${relative}`);
        return `from '${imports[specifier]}'`;
    });

    // Stand-ins: nothing is sent, nothing needs a session, nothing is constructed. The route calls .catch on what notifyUser returns, so each one that
    // it calls that on answers with a promise; afterCommit drops its work.
    put('stubs/stripe.mjs', "export default class Stripe { constructor() { throw new Error('booking-log spec: the route must not construct Stripe'); } }\n");
    put('stubs/mysql.mjs', "export default { createPool() { throw new Error('booking-log spec: the case supplies the pool'); } };\n");
    put('stubs/next-server.mjs', `import { createRequire } from 'node:module';\nexport const { NextResponse } = createRequire(${JSON.stringify(path.join(ROOT, 'package.json'))})('next/server');\n`);
    put('stubs/api-auth.mjs', `export const callerFrom = async () => null;\nexport const requireCaller = async () => ({ ok: true, caller: { role: 'admin', id: ${Number(adminId)}, email: null, via: 'cookie' } });\n`);
    put('stubs/push.mjs', 'export const notifyUser = async () => {};\n');
    put('stubs/notices.mjs', 'export const afterCommit = () => {};\n');
    put('stubs/notice-events.mjs', 'export const noticeBooked = async () => {};\nexport const noticeAssigned = async () => {};\n');
    put('stubs/logger.mjs', 'export const logActivity = async () => {};\n');
    put('stubs/marketplace.mjs', "export const queueStateOf = () => 'waiting';\n");
    put('stubs/booking-crew.mjs', 'export const clearBookingCrew = async () => {};\n');
    for (const name of REAL_LIBS) put(`lib/${name}.mjs`, copy(`src/lib/${name}.js`));
    put('lib/booking-answers.mjs', copy('src/lib/booking-answers.js'));
    put('routes/bookings.mjs', copy('src/app/api/bookings/route.js'));

    // db.js takes the pool from globalThis when one is set; the route reads STRIPE_SECRET_KEY once, at load, and books unverified without one.
    const globals = /** @type {any} */ (globalThis);
    const saved = { pool: globals.mysqlPool, key: process.env.STRIPE_SECRET_KEY };
    globals.mysqlPool = {
        async getConnection() {
            return wrapConnection(await /** @type {any} */ (pool).getConnection());
        },
    };
    delete process.env.STRIPE_SECRET_KEY;
    try {
        return { dir, route: await import(pathToFileURL(path.join(dir, 'routes', 'bookings.mjs')).href) };
    } finally {
        if (saved.pool === undefined) delete globals.mysqlPool;
        else globals.mysqlPool = saved.pool;
        if (saved.key === undefined) delete process.env.STRIPE_SECRET_KEY;
        else process.env.STRIPE_SECRET_KEY = saved.key;
    }
}

// ---- the requests ---------------------------------------------------------------------------------------------------------------------

let sequence = 0;
/** The body of a public checkout, as e2e/admin-job-queue.spec.js makes one, with this file's customer. Each call holds a payment of its own. */
function checkout() {
    sequence += 1;
    return {
        service_id: 1, service_name: 'Fixture Standard Clean', service_price: 80, additional_price: 40,
        first_name: CUSTOMER.first_name, last_name: CUSTOMER.last_name, email: CUSTOMER.email, phone: CUSTOMER.phone,
        job_date: '2026-02-01', job_time_slot: '09:00', instructions: CUSTOMER.instructions, job_description: CUSTOMER.job_description,
        address_line1: CUSTOMER.address_line1, address_line2: CUSTOMER.address_line2, city: 'Calgary', postal_code: CUSTOMER.postal_code,
        payment_intent_id: `pi_e2e_bl_${RUN}_${sequence}`,
    };
}

/** The customer's details, as an admin's edit might carry them next to the six fields the handler reads. */
const customerDetails = () => ({
    first_name: CUSTOMER.first_name, last_name: CUSTOMER.last_name, email: CUSTOMER.email, phone: CUSTOMER.phone,
    address_line1: CUSTOMER.address_line1, address_line2: CUSTOMER.address_line2, postal_code: CUSTOMER.postal_code,
    instructions: CUSTOMER.instructions, job_description: CUSTOMER.job_description,
});

/** @type {any} */
let route = null;
/** @type {string | null} */
let routeDir = null;
let providerId = 0;
/** The bookings the running case made, deleted by afterEach. */
const made = new Set();

const post = (body) => route.POST(new Request('http://localhost/api/bookings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const edit = (id, body) => route.PUT(new Request(`http://localhost/api/bookings?id=${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

/** A booking made through the checkout, outside any case's log window; it is deleted when the case ends. */
async function makeBooking() {
    const response = await post(checkout());
    const answer = await response.json();
    if (answer.booking_id) made.add(answer.booking_id);
    expect(response.status, 'the booking the case starts from is made').toBe(200);
    return answer;
}

async function removeBookings(ids) {
    for (const id of ids) {
        const response = await route.DELETE(new Request(`http://localhost/api/bookings?id=${id}`, { method: 'DELETE' }));
        if (response.status !== 200) throw new Error(`booking ${id} was not deleted: ${response.status}`);
    }
}

const sweep = async () => removeBookings((await rows('SELECT id FROM bookings WHERE customer_email LIKE ?', [`${EMAIL_PREFIX}%`])).map((row) => row.id));

const bookingOf = async (id) => (await rows(
    `SELECT booking_number, service_id, customer_first_name, customer_last_name, customer_email, customer_phone, address_line1, address_line2, city, postal_code,
            job_description, instructions, job_time_slot, status, payment_status, provider_id, commission_percent, provider_amount, service_price, payment_intent_id
       FROM bookings WHERE id = ?`,
    [id],
))[0];

const historyOf = async (id) => (await rows('SELECT status, notes FROM booking_status_history WHERE booking_id = ? ORDER BY id', [id])).map((row) => ({ status: row.status, notes: row.notes }));

const PENDING_ROW = { status: 'pending', notes: 'Booking created after payment authorization' };

// ---- the cases ------------------------------------------------------------------------------------------------------------------------

test.describe('Booking log', () => {
    test.beforeAll(async () => {
        if (!spying) {
            spying = true;
            for (const method of SPIED) {
                realConsole[method] = /** @type {any} */ (console)[method];
                /** @type {any} */ (console)[method] = (/** @type {any[]} */ ...args) => {
                    captured.push({ method, text: format(...args) });
                };
            }
        }
        assertDevTarget(DB);
        pool = mysql.createPool({ ...DB, connectionLimit: 6 });
        let connection;
        try {
            connection = await pool.getConnection();
        } catch (error) {
            throw new Error(`the dev database did not accept a connection at ${DB.host}:${DB.port} (${/** @type {any} */ (error).code || 'no code'}); the test command runs the container with --network host`, { cause: error });
        }
        try {
            await assertNoRealPeople(connection);
        } finally {
            connection.release();
        }
        const [admin] = await rows("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
        const [provider] = await rows('SELECT id FROM service_providers ORDER BY id LIMIT 1');
        expect(admin && provider, 'the fixtures hold an admin and a provider (npm run db:fixtures)').toBeTruthy();
        providerId = provider.id;
        ({ dir: routeDir, route } = await loadRoute(admin.id));
        await sweep();
    });

    test.afterEach(async () => {
        injected = null;
        const ids = [...made];
        made.clear();
        await removeBookings(ids);
    });

    test.afterAll(async () => {
        try {
            if (route) await sweep();
        } finally {
            if (routeDir) fs.rmSync(routeDir, { recursive: true, force: true });
            if (pool) await pool.end();
            pool = null;
            route = null;
            routeDir = null;
            if (spying) {
                spying = false;
                for (const method of SPIED) /** @type {any} */ (console)[method] = realConsole[method];
            }
        }
    });

    test("POST /api/bookings: a public checkout logs the booking number and none of the customer's details, and the answer and the rows are what they were", async () => {
        const { result: response, lines } = await logsOf(() => post(checkout()));
        const answer = await response.json();
        if (answer.booking_id) made.add(answer.booking_id);

        // The answer and the rows: what the route did before this ticket, and does after it.
        expect(response.status, 'the checkout is answered').toBe(200);
        expect(answer.success, 'the answer says success').toBe(true);
        expect(Number.isInteger(answer.booking_id), 'the answer holds the booking id').toBe(true);
        expect(answer.booking_number, 'and the booking number').toMatch(/^BK\d+$/);
        expect(answer.message, 'and the message of a booking made where payments are not configured').toBe('Booking confirmed. Payment was not verified: payments are not configured on this server.');
        expect(await bookingOf(answer.booking_id), 'the booking is stored with the customer\'s details as sent').toMatchObject({
            booking_number: answer.booking_number, service_id: 1,
            customer_first_name: CUSTOMER.first_name, customer_last_name: CUSTOMER.last_name, customer_email: CUSTOMER.email, customer_phone: CUSTOMER.phone,
            address_line1: CUSTOMER.address_line1, address_line2: CUSTOMER.address_line2, city: 'Calgary', postal_code: CUSTOMER.postal_code,
            job_description: CUSTOMER.job_description, instructions: CUSTOMER.instructions, job_time_slot: '09:00', status: 'pending', payment_status: 'pending',
        });
        expect(await historyOf(answer.booking_id), 'with the one pending history row').toEqual([PENDING_ROW]);

        // The log: none of the customer's values in any line, and the one line that names the booking.
        expect(leaksIn(lines), 'no value of the customer\'s is in any logged line').toEqual([]);
        expect(lines, 'the checkout logs that a booking was made, with its number, and nothing else').toEqual([['log', `[API Bookings] Creating booking ${answer.booking_number}`]]);
    });

    test("POST /api/bookings: a booking that fails logs the error's code and nothing the driver or the parser said", async () => {
        // (a) The INSERT fails with an error whose message quotes the customer's values: 500, and the line holds its code.
        failNext(/^\s*INSERT INTO bookings\b/, driverError());
        const failed = await logsOf(() => post(checkout()));
        const failure = await failed.result.json();
        expect(failed.result.status, 'a failing INSERT is answered 500').toBe(500);
        expect(failure.success, 'and says it failed').toBe(false);
        expect(Number((await rows('SELECT COUNT(*) AS n FROM bookings WHERE customer_email = ?', [CUSTOMER.email]))[0].n), 'no booking was kept').toBe(0);
        expect(leaksIn(failed.lines), 'no value of the customer\'s is in any line of the failing INSERT').toEqual([]);
        expect(failed.lines.map(([method, text]) => [method, text.replace(/BK\d+/g, 'BK#')]), 'the failing INSERT logs the booking it was making, then the error\'s code').toEqual([
            ['log', '[API Bookings] Creating booking BK#'],
            ['error', 'Error creating booking: ER_E2E_FIXTURE'],
        ]);

        // (b) A body that cannot be parsed: the parser's message quotes what was sent. 500, and the line holds the error's name, it having no code.
        const unparsable = { json: async () => { throw new SyntaxError(`Unexpected token } in JSON at position 71: {"email":"${CUSTOMER.email}","first_name":"${CUSTOMER.first_name}"}`); } };
        const refused = await logsOf(() => route.POST(unparsable));
        expect(refused.result.status, 'a request that cannot be parsed is answered 500').toBe(500);
        expect((await refused.result.json()).success, 'and says it failed').toBe(false);
        expect(Number((await rows('SELECT COUNT(*) AS n FROM bookings WHERE customer_email = ?', [CUSTOMER.email]))[0].n), 'no booking was made').toBe(0);
        expect(leaksIn(refused.lines), 'no value of the customer\'s is in any line of the request that cannot be parsed').toEqual([]);
        expect(refused.lines, 'it logs the error\'s name and nothing it said').toEqual([['error', 'Error creating booking: SyntaxError']]);
    });

    test("PUT /api/bookings: an admin's edit logs the booking id and none of the body, and the answer and the rows are what they were", async () => {
        const booking = await makeBooking();
        const body = {
            status: 'matching', provider_id: providerId, notes: NOTE, job_time_slot: '14:00', commission_percent: 15, payment_status: 'authorized',
            ...customerDetails(),
        };
        const { result: response, lines } = await logsOf(() => edit(booking.booking_id, body));

        // The answer and the rows.
        expect(response.status, 'the edit is answered').toBe(200);
        expect(await response.json(), 'with the one message').toEqual({ success: true, message: 'Booking updated successfully' });
        const row = await bookingOf(booking.booking_id);
        expect(row, 'the booking holds the six fields the edit sent and the customer\'s details as they were').toMatchObject({
            status: 'matching', provider_id: providerId, job_time_slot: '14:00', payment_status: 'authorized',
            customer_first_name: CUSTOMER.first_name, customer_email: CUSTOMER.email, customer_phone: CUSTOMER.phone, job_description: CUSTOMER.job_description,
        });
        expect(Number(row.commission_percent), 'the commission').toBe(15);
        expect(Number(row.provider_amount), 'and the provider\'s amount is the price less the commission').toBeCloseTo(Number(row.service_price) * 0.85, 2);
        expect(await historyOf(booking.booking_id), 'the history holds the status row with the note, and the commission row').toEqual([
            PENDING_ROW,
            { status: 'matching', notes: NOTE },
            { status: 'matching', notes: expect.stringMatching(/^Commission set to 15% \(Admin: \$\d+\.\d\d, Provider: \$\d+\.\d\d\)$/) },
        ]);

        // The log: none of the body's values in any line; the id, then the commission line, which names a percent and an amount.
        expect(leaksIn(lines), 'no value of the body is in any logged line').toEqual([]);
        expect(lines.map(([method, text]) => [method, text.replace(/Provider Amount: \d+(\.\d+)?$/, 'Provider Amount: #')]), 'the edit logs the booking id, then the commission line, and nothing else').toEqual([
            ['log', `[API PUT /api/bookings] ID: ${booking.booking_id}`],
            ['log', '[API PUT] Updating commission: 15%, Provider Amount: #'],
        ]);
    });

    test("PUT /api/bookings: an edit that fails logs the error's code and nothing the driver said", async () => {
        const booking = await makeBooking();
        // No commission in the body: its line would be in the log before the UPDATE.
        const body = { status: 'matching', notes: NOTE, ...customerDetails() };
        failNext(/^\s*UPDATE bookings SET\b/, driverError());
        const { result: response, lines } = await logsOf(() => edit(booking.booking_id, body));

        expect(response.status, 'a failing UPDATE is answered 500').toBe(500);
        expect((await response.json()).success, 'and says it failed').toBe(false);
        expect(await bookingOf(booking.booking_id), 'the booking is as it was').toMatchObject({ status: 'pending', provider_id: null, payment_status: 'pending' });
        expect(await historyOf(booking.booking_id), 'with no history row added').toEqual([PENDING_ROW]);

        expect(leaksIn(lines), 'no value of the body or of the driver\'s message is in any logged line').toEqual([]);
        expect(lines, 'the failing edit logs the booking id, then the code from the inner handler, then the code from the outer one').toEqual([
            ['log', `[API PUT /api/bookings] ID: ${booking.booking_id}`],
            ['error', '[API PUT Inner Error] ER_E2E_FIXTURE'],
            ['error', '[API PUT Outer Error] ER_E2E_FIXTURE'],
        ]);
    });
});
