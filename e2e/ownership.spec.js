// @ts-check
// ENG-023 (design ENG-004, "Interfaces: Ownership, the rule per kind of data" and "AC6 cross-account tests"; ticket ENG-023):
// the cross-account cases of the customer and provider routes the ticket converts. Each case is titled
// `Ownership <METHOD> <route>: <what>` (the title is the baseline key), and every case's comment names the ownership clause
// it covers and, where the case exists for that clause, the one-line deletion that must turn it red.
//
// What a case does, per row, as far as the dev database lets it:
//   (a) the owner gets their own row: the status and a marker string that is only in the owner's fixture row;
//   (b) another account's row, asked for by id or by a parameter naming the other account, is 403 with the body
//       { success: false, message: 'Forbidden' } and, by absence, none of the other account's fixture strings appears
//       anywhere in the body. The guard's wrong-role 403 has the same body, so every foreign case is sent with the RIGHT
//       role (customer1 for customer2's row, provider1 for provider2's): only the handler's own clause can produce it;
//   (c) where an admin may name anyone, the admin gets the row;
//   (d) a row that does not exist keeps the route's own 404.
// A refused write is followed by a read of the other account's row (as the admin, or as the other account itself), so the
// refusal is shown to have kept the write out and not only to have answered 403. A foreign case first shows the strings are
// served to someone entitled (the admin's read, or the owner's), so an absence means the route held them back.
//
// The two id spaces overlap (customer 1, provider 1 and booking user 1 all exist), and the fixture accounts are the same
// on both sides: customer1 and provider1 are the credentials of getCredentialHeaders; customer 2 and provider 2 are the
// FOREIGN rows, and a case that must act as one of them signs in itself (signedInAs).
//
// Fixture rows: database/fixtures/accounts.js and bookings.js (booking 1 is customer 1's with provider 1, booking 2 customer 2's
// with provider 2, one invoice, payout and review each), database/fixtures/ownership.js (four chat messages, a second payout of
// provider 2). A case that needs a booking open to providers, or one that nobody has reviewed, makes it itself through the public
// checkout (POST /api/bookings, as e2e/defects.spec.js does) and deletes it again as admin in `finally`.
//
// Writes to a fixture row: the PUT cases put a marker in `hear_about` / a settings flag and restore it in `finally`, and the
// push-token case upserts a mobile_auth_users row for customer 1 and provider 1 (device 'e2e-ownership'; nothing reads it back).
// Every chat message a case posts goes on a booking the case made itself (customer 1's, assigned to provider 1), which cascades
// them away when the case deletes it, so no fixture chat grows and no case needs freshly loaded fixtures.
//
// NOT covered here, and why (read from the code and the dev database, not guessed):
//   POST /api/payment/create-intent  the module builds `new Stripe(process.env.STRIPE_SECRET_KEY)` at import and the dev app sets no
//                                    STRIPE_SECRET_KEY, so every request answers a 500 HTML page before the handler runs (the
//                                    before-snapshot of 2026-10-04 01:46: 500 for every credential style). Nothing of the route is
//                                    observable, and the handler takes no booking at all (service_id, service_price, additional_price,
//                                    service_name; the booking is made after the payment), so there is no booking to own: its owner
//                                    is the Stripe customer of caller.id. A skipped case below says so.
//   /api/user/addresses and [id]     the dev database has no `user_addresses` table (SHOW TABLES, 2026-10-04): every address read or
//                                    write that reaches the query answers 500. Only the refusals decided before the query are cases here.
//   POST /api/auth/change-password   every fixture password lacks a character the route's password rule demands, so a request that
//                                    succeeds cannot be undone, and one that wrongly succeeds on another table's row would change a
//                                    fixture login; no case sends a valid new password.
import { test, expect } from '@playwright/test';
import { getCredentialHeaders } from './auth/credentials.js';
import { RESET_RETRIES } from './support/auth.js';
import { users, providers, FIXTURE_LOGINS } from '../database/fixtures/accounts.js';
import { bookings } from '../database/fixtures/bookings.js';
import { ownership } from '../database/fixtures/ownership.js';

// Every request carries a fixture account's session header and a trace records request headers: tracing is off, as in
// e2e/auth-matrix.spec.js. A failure message names the case, the status and the account, never a header.
test.use({ trace: 'off' });

const [CUSTOMER1, CUSTOMER2, ADMIN] = users;
const [PROVIDER1, PROVIDER2] = providers;
const [BOOKING1, BOOKING2] = bookings.tables.bookings;
const [REVIEW1, REVIEW2] = bookings.tables.provider_reviews;
const [CHAT1, CHAT2, CHAT3, CHAT4] = ownership.tables.chat_messages;
const SECOND_PAYOUT_OF_PROVIDER2 = ownership.tables.provider_payouts[0];
const MISSING = 999999999;

// What only customer 2's and provider 2's fixture rows carry: the strings customer1 and provider1 must never be shown.
const BOOKING2_STRINGS = [BOOKING2.booking_number, BOOKING2.customer_email, BOOKING2.customer_phone, BOOKING2.address_line1, BOOKING2.job_description];
const CUSTOMER2_STRINGS = [CUSTOMER2.email, CUSTOMER2.phone, 'Customer Two'];
const PROVIDER2_STRINGS = [PROVIDER2.email, PROVIDER2.phone, PROVIDER2.name];

const FORBIDDEN = { success: false, message: 'Forbidden' };

// The credentials a case sends, as request headers (the seven styles of getCredentialHeaders under short names).
async function credentials(baseURL) {
    const styles = await getCredentialHeaders(baseURL);
    return {
        none: {},
        customer: styles['customer-cookie'],
        provider: styles['provider-cookie'],
        admin: styles['admin-cookie'],
        customerBearer: styles['customer-bearer'],
        providerBearer: styles['provider-bearer'],
        adminBearer: styles['admin-bearer'],
    };
}

// customer1 by cookie and by Bearer (the web and the app), provider1 likewise: the ownership clause must hold for both.
const customerStyles = (as) => [['cookie', as.customer], ['bearer', as.customerBearer]];
const providerStyles = (as) => [['cookie', as.provider], ['bearer', as.providerBearer]];

const COOKIE_OF = { customer2: 'customer_token', provider2: 'provider_token' };
// Signs a FOREIGN fixture account in through its own login route and returns its session cookie as a request header. The
// token is cut out of the storage state and put in a header; it is never printed.
async function signedInAs(playwright, baseURL, who) {
    const login = FIXTURE_LOGINS[who];
    const context = await playwright.request.newContext({ baseURL });
    try {
        const response = await context.post(login.loginRoute, { data: { email: login.email, password: login.password }, maxRetries: RESET_RETRIES, timeout: 60_000 });
        expect(response.status(), `${who} signs in`).toBe(200);
        const held = (await context.storageState()).cookies.find((entry) => entry.name === COOKIE_OF[who]);
        expect(held, `${who}'s ${COOKIE_OF[who]} cookie`).toBeTruthy();
        return { cookie: `${COOKIE_OF[who]}=${held?.value}` };
    } finally {
        await context.dispose();
    }
}

// Absence, by value: none of `strings` appears anywhere in the body text. Only the missing string is named, not the body.
function expectNoneOf(text, strings, who) {
    for (const value of strings) {
        expect(text.includes(String(value)), `${who}: the body holds ${JSON.stringify(value)}`).toBe(false);
    }
}

// Presence, by value: every one of `strings` is in the body text.
function expectAllOf(text, strings, who) {
    for (const value of strings) {
        expect(text.includes(String(value)), `${who}: the body lacks ${JSON.stringify(value)}`).toBe(true);
    }
}

// The route's own refusal for a row that exists and is not the caller's: status 403 and EXACTLY { success: false, message:
// 'Forbidden' } (a 404 "not found" would log the app's user out; a 200 would be the leak), and none of `absent` anywhere.
async function expectForbidden(response, who, absent = []) {
    expect(response.status(), `${who}: status`).toBe(403);
    const text = await response.text();
    let body = null;
    try {
        body = JSON.parse(text);
    } catch {
        body = null;
    }
    expect(body, `${who}: the body is the 403 { success: false, message: 'Forbidden' } and nothing else`).toEqual(FORBIDDEN);
    expectNoneOf(text, absent, who);
}

// A 200 answer with success: true; returns the text and the parsed body.
async function expectOk(response, who) {
    expect(response.status(), `${who}: status`).toBe(200);
    const text = await response.text();
    const body = JSON.parse(text);
    expect(body.success, `${who}: success`).toBe(true);
    return { text, body };
}

// A refusal that is the route's own and not the guard's: status and the exact message.
async function expectAnswer(response, status, message, who) {
    expect(response.status(), `${who}: status`).toBe(status);
    const body = await response.json();
    expect(body.success, `${who}: success`).toBe(false);
    expect(body.message, `${who}: message`).toBe(message);
    return body;
}

// The control of an absence case: the admin's read serves the strings, so a caller who is shown none of them was held back.
async function expectServedToAdmin(request, as, path, strings, who) {
    const response = await request.get(path, { headers: as.admin });
    expect(response.status(), `control, ${who}: the admin reads ${path}`).toBe(200);
    expectAllOf(await response.text(), strings, `control, ${who}`);
}

// A booking the case makes itself through the public checkout (POST /api/bookings stays public): pending, unassigned. With
// `headers` the booking belongs to the credential's customer. `run(id)` gets its id; the row is deleted again as admin, even
// when `run` fails. The admin's PUT /api/bookings?id= moves it: { provider_id } assigns it (and the route moves it to
// `matching`), { status } sets the status.
async function withProbeBooking(request, as, run, { headers = {} } = {}) {
    const tag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const body = {
        service_id: 1, service_name: 'Fixture Standard Clean', service_price: 80, additional_price: 40,
        first_name: 'E2E', last_name: 'Probe', email: `e2e-probe-${tag}@workontap.test`, phone: '+14035550199',
        job_date: '2026-02-01', job_time_slot: '09:00', job_description: 'E2E probe booking, deleted by the case.',
        address_line1: '1 Probe Street', city: 'Calgary', payment_intent_id: `pi_e2e_probe_${tag}`,
    };
    const created = await request.post('/api/bookings', { data: body, headers });
    expect(created.status(), 'checkout makes the probe booking').toBe(200);
    const id = (await created.json()).booking_id;
    expect(Number.isInteger(id), 'the probe booking has an id').toBe(true);
    try {
        await run(id);
    } finally {
        await request.delete(`/api/bookings?id=${id}`, { headers: as.admin });
    }
}

const adminUpdates = async (request, as, id, data) => {
    const response = await request.put(`/api/bookings?id=${id}`, { headers: as.admin, data });
    expect(response.status(), `admin updates booking ${id}`).toBe(200);
};

// The row as the admin reads it (GET /api/bookings/[id]).
async function bookingAsAdmin(request, as, id) {
    const response = await request.get(`/api/bookings/${id}`, { headers: as.admin });
    expect(response.status(), `admin reads booking ${id}`).toBe(200);
    return (await response.json()).data;
}

// ---------------------------------------------------------------------------------------------------------------------
// GET and PUT /api/customers/[id]. Clause: customers/[id]/route.js, the path id must equal caller.id (compared as strings)
// unless the caller is an admin (GET only), checked before any query; the PUT's UPDATE binds caller.id.
// ---------------------------------------------------------------------------------------------------------------------
test.describe('Ownership: customers/[id]', () => {
    // Red if `String(caller.id) !== String(id) && caller.role !== 'admin'` loses its first operand (customer1 would read anyone,
    // case "customer1 asking for customer 2") or its second (the admin case below would see 403).
    test("Ownership GET /api/customers/[id]: customer1 reads their own profile, by cookie and by Bearer, and none of customer 2's", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        for (const [style, headers] of customerStyles(as)) {
            const who = `customer1 by ${style}`;
            const { text, body } = await expectOk(await request.get(`/api/customers/${CUSTOMER1.id}`, { headers }), who);
            expect(body.data.email, `${who}: the profile is customer 1's`).toBe(CUSTOMER1.email);
            expect(body.data.id, `${who}: the id`).toBe(CUSTOMER1.id);
            expectNoneOf(text, CUSTOMER2_STRINGS, who);
        }
    });

    test("Ownership GET /api/customers/[id]: customer1 asking for customer 2 is 403 and shows none of customer 2's fields", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        await expectServedToAdmin(request, as, `/api/customers/${CUSTOMER2.id}`, [CUSTOMER2.email, CUSTOMER2.phone, 'Customer Two'], 'customer 2');
        for (const [style, headers] of customerStyles(as)) {
            const who = `customer1 by ${style} asks for customer 2`;
            await expectForbidden(await request.get(`/api/customers/${CUSTOMER2.id}`, { headers }), who, CUSTOMER2_STRINGS);
        }
    });

    test('Ownership GET /api/customers/[id]: the admin reads any customer, and a missing id is 404 for the admin and 403 for customer1', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        for (const [style, headers] of [['cookie', as.admin], ['bearer', as.adminBearer]]) {
            const who = `admin by ${style}`;
            const { body } = await expectOk(await request.get(`/api/customers/${CUSTOMER2.id}`, { headers }), who);
            expect(body.data.email, `${who}: customer 2's profile`).toBe(CUSTOMER2.email);
            await expectAnswer(await request.get(`/api/customers/${MISSING}`, { headers }), 404, 'Customer not found', `${who}, missing id`);
        }
        // Ticket rule 71 item 3: the allowed customer asking for an id no row has is refused by the handler's own clause (403), not 404.
        await expectForbidden(await request.get(`/api/customers/${MISSING}`, { headers: as.customer }), 'customer1, missing id');
    });

    // Red if the PUT's `String(caller.id) !== String(id)` check is deleted: customer 2's `hear_about` would carry the marker.
    test("Ownership PUT /api/customers/[id]: customer1 writing customer 2's profile is 403 and customer 2's row is unchanged", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const marker = `e2e-ownership-foreign-${Date.now()}`;
        const data = { first_name: CUSTOMER2.first_name, last_name: CUSTOMER2.last_name, phone: CUSTOMER2.phone, hear_about: marker, receive_offers: 0 };
        for (const [style, headers] of customerStyles(as)) {
            const who = `customer1 by ${style} writes customer 2`;
            await expectForbidden(await request.put(`/api/customers/${CUSTOMER2.id}`, { headers, data }), who, [marker]);
            const read = await request.get(`/api/customers/${CUSTOMER2.id}`, { headers: as.admin });
            expect(read.status(), 'admin reads customer 2').toBe(200);
            const row = (await read.json()).data;
            expect(row.hear_about, `after ${who}: customer 2's hear_about`).toBeNull();
            expect(row.first_name, `after ${who}: customer 2's first_name`).toBe(CUSTOMER2.first_name);
        }
    });

    // Red if the UPDATE's `WHERE id = ?` stops binding caller.id (the marker would land elsewhere or nowhere).
    test('Ownership PUT /api/customers/[id]: customer1 writes their own profile (a marker in hear_about, read back, then restored)', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const marker = `e2e-ownership-own-${Date.now()}`;
        const own = { first_name: CUSTOMER1.first_name, last_name: CUSTOMER1.last_name, phone: CUSTOMER1.phone, receive_offers: 0 };
        try {
            const { body } = await expectOk(await request.put(`/api/customers/${CUSTOMER1.id}`, { headers: as.customer, data: { ...own, hear_about: marker } }), 'customer1 writes customer 1');
            expect(body.data.id, 'the row written is customer 1').toBe(CUSTOMER1.id);
            const read = await request.get(`/api/customers/${CUSTOMER1.id}`, { headers: as.customerBearer });
            expect((await read.json()).data.hear_about, "customer 1's hear_about now").toBe(marker);
            const other = await request.get(`/api/customers/${CUSTOMER2.id}`, { headers: as.admin });
            expect((await other.json()).data.hear_about, "customer 2's hear_about is not customer 1's marker").not.toBe(marker);
        } finally {
            await request.put(`/api/customers/${CUSTOMER1.id}`, { headers: as.customer, data: { ...own, hear_about: '' } });
        }
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// GET and POST /api/provider/available-jobs/[id]: the design's IDOR (it read ANY booking by id, including the customer's
// address). Clause: available-jobs/[id]/route.js GET, `WHERE b.id = ? AND (b.provider_id = ? OR (b.provider_id IS NULL AND
// b.status IN ('pending','matching')))` bound to [id, caller.id]; a booking that exists and does not match is 403, one that
// does not exist keeps 404 'Job not found'. POST: the same test on the locked row, 403 before the route's own 409s.
// ---------------------------------------------------------------------------------------------------------------------
test.describe('Ownership: provider/available-jobs/[id]', () => {
    // Red if the WHERE loses `b.provider_id = ?` and the params lose caller.id (the old `WHERE b.id = ?`): provider1 is shown booking 2.
    test("Ownership GET /api/provider/available-jobs/[id]: provider1 asking for provider 2's booking is 403 and shows none of its address, description or customer", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        await expectServedToAdmin(request, as, `/api/bookings/${BOOKING2.id}`, BOOKING2_STRINGS, 'booking 2');
        for (const [style, headers] of providerStyles(as)) {
            await expectForbidden(await request.get(`/api/provider/available-jobs/${BOOKING2.id}`, { headers }), `provider1 by ${style} asks for booking 2`, [...BOOKING2_STRINGS, ...CUSTOMER2_STRINGS]);
        }
    });

    test('Ownership GET /api/provider/available-jobs/[id]: provider1 gets their own booking (200, is_my_job) and a missing booking keeps its 404', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        for (const [style, headers] of providerStyles(as)) {
            const who = `provider1 by ${style}`;
            const { text, body } = await expectOk(await request.get(`/api/provider/available-jobs/${BOOKING1.id}`, { headers }), who);
            expect(body.data.booking_number, `${who}: booking 1`).toBe(BOOKING1.booking_number);
            expect(body.is_my_job, `${who}: is_my_job`).toBe(true);
            expectNoneOf(text, BOOKING2_STRINGS, who);
            await expectAnswer(await request.get(`/api/provider/available-jobs/${MISSING}`, { headers }), 404, 'Job not found', `${who}, missing booking`);
        }
    });

    // The three states of a booking nobody has accepted. Red when: the `IS NULL AND status IN (...)` branch is deleted (case 1, the
    // open booking is 403); `b.status IN ('pending','matching')` is dropped (case 2, a cancelled unassigned booking would answer 200);
    // `b.provider_id IS NULL AND` is dropped (case 3, a booking assigned to provider 2 and `matching` would answer 200).
    test('Ownership GET /api/provider/available-jobs/[id]: an unassigned pending booking answers 200, a cancelled unassigned one and one assigned to provider 2 answer 403', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        await withProbeBooking(request, as, async (id) => {
            const open = await expectOk(await request.get(`/api/provider/available-jobs/${id}`, { headers: as.provider }), 'provider1, open booking');
            expect(open.body.data.id, 'the open booking is the one asked for').toBe(id);
            expect(open.body.is_my_job, 'an open booking is not yet provider 1\'s').toBe(false);
            await adminUpdates(request, as, id, { status: 'cancelled' });
            await expectForbidden(await request.get(`/api/provider/available-jobs/${id}`, { headers: as.provider }), 'provider1, cancelled unassigned booking');
        });
        await withProbeBooking(request, as, async (id) => {
            await adminUpdates(request, as, id, { provider_id: PROVIDER2.id });
            const row = await bookingAsAdmin(request, as, id);
            expect(row.provider_id, 'the probe booking is provider 2\'s').toBe(PROVIDER2.id);
            expect(['pending', 'matching'], 'and is still in a status the open clause lists').toContain(row.status);
            await expectForbidden(await request.get(`/api/provider/available-jobs/${id}`, { headers: as.provider }), "provider1, booking assigned to provider 2");
        });
    });

    // Red if the ownership test on the locked row is deleted: provider1's accept of booking 2 would answer the old 409.
    test("Ownership POST /api/provider/available-jobs/[id]: provider1 accepting provider 2's booking is 403 and booking 2 stays provider 2's", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        for (const [style, headers] of providerStyles(as)) {
            const who = `provider1 by ${style} accepts booking 2`;
            await expectForbidden(await request.post(`/api/provider/available-jobs/${BOOKING2.id}`, { headers, data: {} }), who, BOOKING2_STRINGS);
            const row = await bookingAsAdmin(request, as, BOOKING2.id);
            expect(row.provider_id, `after ${who}: booking 2's provider`).toBe(PROVIDER2.id);
            expect(row.status, `after ${who}: booking 2's status`).toBe(BOOKING2.status);
        }
    });

    test('Ownership POST /api/provider/available-jobs/[id]: provider1 accepts an open booking and it becomes provider 1\'s; a missing booking keeps its 404', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        await withProbeBooking(request, as, async (id) => {
            await expectOk(await request.post(`/api/provider/available-jobs/${id}`, { headers: as.provider, data: {} }), 'provider1 accepts the open booking');
            const row = await bookingAsAdmin(request, as, id);
            expect(row.provider_id, 'the accepted booking is provider 1\'s').toBe(PROVIDER1.id);
        });
        await expectAnswer(await request.post(`/api/provider/available-jobs/${MISSING}`, { headers: as.provider, data: {} }), 404, 'Job not found', 'provider1, missing booking');
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// POST /api/reviews: the security gate's F3. Clauses, reviews/route.js POST: a body customer_id that is not caller.id is 403;
// the booking must have user_id = caller.id (403 for one that exists and is not the caller's, 404 for one that does not exist);
// a provider_id that is not the booking's provider is 403; the row is written with caller.id and the booking's provider.
// Booking 1 already has its review (one per booking), so the refusals are told from the route's own 400 'Review already
// exists' by the status and the message: that 400 is what a deleted clause would answer on booking 1.
// ---------------------------------------------------------------------------------------------------------------------
test.describe('Ownership: POST /api/reviews', () => {
    // Red if the `user_id` comparison after the booking lookup is deleted: booking 2 is completed and already reviewed, so the answer
    // becomes the route's own 400 'Review already exists' instead of this 403 (and on a booking with no review the row would be written).
    test("Ownership POST /api/reviews: customer1 reviewing customer 2's booking is 403 and no review is added to it", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const marker = `e2e-ownership-review-${Date.now()}`;
        for (const [style, headers] of customerStyles(as)) {
            const who = `customer1 by ${style} reviews booking 2`;
            const data = { booking_id: BOOKING2.id, provider_id: PROVIDER2.id, customer_id: CUSTOMER1.id, rating: 5, review: marker };
            await expectForbidden(await request.post('/api/reviews', { headers, data }), who, [marker, ...BOOKING2_STRINGS]);
        }
        const read = await request.get(`/api/reviews?booking_id=${BOOKING2.id}`, { headers: as.admin });
        const text = await read.text();
        expect(read.status(), 'admin reads the reviews of booking 2').toBe(200);
        expectAllOf(text, [REVIEW2.review], 'control');
        expectNoneOf(text, [marker], 'booking 2\'s reviews');
    });

    // Red if the `customer_id` clause is deleted (booking 1 is customer 1's, so only the body's customer_id names another account).
    test("Ownership POST /api/reviews: a body naming customer 2 as customer_id, or provider 2 as provider_id, on customer 1's own booking is 403", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const bodies = [
            ['customer_id naming customer 2', { booking_id: BOOKING1.id, provider_id: PROVIDER1.id, customer_id: CUSTOMER2.id, rating: 5 }],
            ['provider_id naming provider 2', { booking_id: BOOKING1.id, provider_id: PROVIDER2.id, customer_id: CUSTOMER1.id, rating: 5 }],
        ];
        for (const [name, data] of bodies) {
            for (const [style, headers] of customerStyles(as)) {
                await expectForbidden(await request.post('/api/reviews', { headers, data }), `customer1 by ${style}, ${name}`);
            }
        }
    });

    test("Ownership POST /api/reviews: a review for customer 1's own completed booking is stored with customer 1 and the booking's provider, whatever the body names, and a missing booking keeps its 404", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        await withProbeBooking(request, as, async (id) => {
            await adminUpdates(request, as, id, { status: 'completed', provider_id: PROVIDER1.id });
            const marker = `e2e-ownership-own-review-${Date.now()}`;
            const written = await expectOk(await request.post('/api/reviews', { headers: as.customer, data: { booking_id: id, provider_id: PROVIDER1.id, customer_id: CUSTOMER1.id, rating: 4, review: marker } }), 'customer1 reviews their own booking');
            const reviewId = written.body.review_id;
            try {
                const read = await request.get(`/api/reviews?booking_id=${id}`, { headers: as.admin });
                const rows = (await read.json()).data;
                expect(rows.length, 'one review is stored for the booking').toBe(1);
                expect(rows[0].review, 'the stored text').toBe(marker);
                expect(rows[0].customer_id, 'the stored customer_id is the caller\'s').toBe(CUSTOMER1.id);
                expect(rows[0].provider_id, 'the stored provider_id is the booking\'s own provider').toBe(PROVIDER1.id);
            } finally {
                await request.delete(`/api/reviews?id=${reviewId}`, { headers: as.admin });
            }
        }, { headers: as.customer });
        const missing = await request.post('/api/reviews', { headers: as.customer, data: { booking_id: MISSING, provider_id: PROVIDER1.id, customer_id: CUSTOMER1.id, rating: 4 } });
        await expectAnswer(missing, 404, 'Booking not found', 'customer1, missing booking');
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// Customer booking routes. Clauses (each route file): booking-details, approve and cancel find the booking and answer 403 when
// it exists and bookings.user_id is not caller.id (404 'Booking not found' when it does not exist); invoices lists
// b.user_id = caller.id and answers 403 for a user_id or an email naming anyone else; customer/reviews GET and POST answer 403 for
// a customer_id that is not caller.id, a booking that is not the caller's and (POST) a provider_id that is not the booking's.
// ---------------------------------------------------------------------------------------------------------------------
test.describe('Ownership: customer booking routes', () => {
    // Red if the 403 branch after the owner-filtered query is deleted: the foreign booking answers the 404 (the old answer).
    test("Ownership GET /api/customer/booking-details: customer1 reads booking 1, booking 2 is 403 and shows none of its fields, a missing booking is 404", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        await expectServedToAdmin(request, as, `/api/bookings/${BOOKING2.id}`, BOOKING2_STRINGS, 'booking 2');
        for (const [style, headers] of customerStyles(as)) {
            const who = `customer1 by ${style}`;
            const own = await expectOk(await request.get(`/api/customer/booking-details?bookingId=${BOOKING1.id}`, { headers }), who);
            expect(own.body.data[0].booking_number, `${who}: booking 1`).toBe(BOOKING1.booking_number);
            expectNoneOf(own.text, BOOKING2_STRINGS, who);
            await expectForbidden(await request.get(`/api/customer/booking-details?bookingId=${BOOKING2.id}`, { headers }), `${who} asks for booking 2`, BOOKING2_STRINGS);
            await expectAnswer(await request.get(`/api/customer/booking-details?bookingId=${MISSING}`, { headers }), 404, 'Booking not found', `${who}, missing booking`);
        }
    });

    // Booking 1 is `completed`, so the owner's approve reaches the route's own status check and stops there (a 400 that names the
    // status), writing nothing. Red if the ownership 403 is deleted: the foreign request would answer that 400 about booking 2's status.
    test("Ownership POST /api/customer/bookings/[id]/approve: customer1 on booking 1 reaches the status check, on booking 2 is 403 and booking 2 is unchanged, a missing booking is 404", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const before = await bookingAsAdmin(request, as, BOOKING2.id);
        for (const [style, headers] of customerStyles(as)) {
            const who = `customer1 by ${style}`;
            await expectAnswer(await request.post(`/api/customer/bookings/${BOOKING1.id}/approve`, { headers, data: { action: 'approve' } }), 400, "Booking status is 'completed', expected 'awaiting_approval'", `${who} approves booking 1`);
            await expectForbidden(await request.post(`/api/customer/bookings/${BOOKING2.id}/approve`, { headers, data: { action: 'approve' } }), `${who} approves booking 2`, ['expected', ...BOOKING2_STRINGS]);
            await expectForbidden(await request.post(`/api/customer/bookings/${BOOKING2.id}/approve`, { headers, data: { action: 'dispute', dispute_reason: 'e2e ownership probe' } }), `${who} disputes booking 2`);
            await expectAnswer(await request.post(`/api/customer/bookings/${MISSING}/approve`, { headers, data: { action: 'approve' } }), 404, 'Booking not found', `${who}, missing booking`);
        }
        const after = await bookingAsAdmin(request, as, BOOKING2.id);
        expect(after.status, "booking 2's status after the refused approve and dispute").toBe(before.status);
        expect(after.updated_at, "booking 2's updated_at after the refused approve and dispute").toBe(before.updated_at);
    });

    // customer1 cancels a booking they own (200, cancelled); customer 2, signed in as themselves, is refused on customer 1's pending
    // booking and it stays pending. Red if the `String(booking.user_id) !== String(customerId)` comparison is deleted.
    test("Ownership POST /api/customer/bookings/[id]/cancel: customer1 cancels their own pending booking, customer 2 cannot cancel it, and customer1 cannot cancel booking 2", async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const customer2 = await signedInAs(playwright, baseURL, 'customer2');
        await withProbeBooking(request, as, async (id) => {
            await expectForbidden(await request.post(`/api/customer/bookings/${id}/cancel`, { headers: customer2, data: {} }), "customer 2 cancels customer 1's booking");
            expect((await bookingAsAdmin(request, as, id)).status, 'after the refused cancel').toBe('pending');
            await expectOk(await request.post(`/api/customer/bookings/${id}/cancel`, { headers: as.customerBearer, data: {} }), 'customer1 cancels their own booking');
            expect((await bookingAsAdmin(request, as, id)).status, 'after the owner cancels').toBe('cancelled');
        }, { headers: as.customer });
        await expectAnswer(await request.post(`/api/customer/bookings/${BOOKING1.id}/cancel`, { headers: as.customer, data: {} }), 400, 'Booking cannot be cancelled. Current status: completed', 'customer1 cancels completed booking 1');
        await expectForbidden(await request.post(`/api/customer/bookings/${BOOKING2.id}/cancel`, { headers: as.customer, data: {} }), 'customer1 cancels booking 2', BOOKING2_STRINGS);
        await expectForbidden(await request.post(`/api/customer/bookings/${BOOKING2.id}/cancel`, { headers: as.customerBearer, data: {} }), 'customer1 by Bearer cancels booking 2', BOOKING2_STRINGS);
        expect((await bookingAsAdmin(request, as, BOOKING2.id)).status, "booking 2's status after the refused cancels").toBe(BOOKING2.status);
        await expectAnswer(await request.post(`/api/customer/bookings/${MISSING}/cancel`, { headers: as.customer, data: {} }), 404, 'Booking not found', 'customer1, missing booking');
    });

    // Red if the SQL loses `AND b.user_id = ?` (the old `i.user_id = ? OR b.customer_email = ?` took both parameters as the account).
    test("Ownership GET /api/customer/invoices: customer1 lists their own invoice and not customer 2's; ?user_id=, ?email= and both naming customer 2 are 403", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const INVOICE1 = bookings.tables.invoices[0].invoice_number;
        const INVOICE2 = bookings.tables.invoices[1].invoice_number;
        await expectServedToAdmin(request, as, '/api/admin/invoices', [INVOICE2], 'invoice 2');
        const own = [`/api/customer/invoices`, `/api/customer/invoices?user_id=${CUSTOMER1.id}`, `/api/customer/invoices?email=${encodeURIComponent(CUSTOMER1.email)}`];
        for (const [style, headers] of customerStyles(as)) {
            for (const path of own) {
                const who = `customer1 by ${style} ${path}`;
                const { text } = await expectOk(await request.get(path, { headers }), who);
                expectAllOf(text, [INVOICE1], who);
                expectNoneOf(text, [INVOICE2, ...BOOKING2_STRINGS], who);
            }
            for (const query of [`user_id=${CUSTOMER2.id}`, `email=${encodeURIComponent(CUSTOMER2.email)}`, `user_id=${CUSTOMER1.id}&email=${encodeURIComponent(CUSTOMER2.email)}`, `user_id=${CUSTOMER2.id}&email=${encodeURIComponent(CUSTOMER1.email)}`]) {
                await expectForbidden(await request.get(`/api/customer/invoices?${query}`, { headers }), `customer1 by ${style} ?${query}`, [INVOICE2, ...BOOKING2_STRINGS, ...CUSTOMER2_STRINGS]);
            }
        }
    });

    test("Ownership GET /api/customer/reviews: customer1 reads the state of their own booking's review, and a customer_id or a booking that is not theirs is 403", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        for (const [style, headers] of customerStyles(as)) {
            const who = `customer1 by ${style}`;
            const own = await expectOk(await request.get(`/api/customer/reviews?booking_id=${BOOKING1.id}&customer_id=${CUSTOMER1.id}`, { headers }), who);
            expect(own.body.data.has_reviewed, `${who}: booking 1 has its review`).toBe(true);
            expect(own.body.data.existing_review.review, `${who}: customer 1's review text`).toBe(REVIEW1.review);
            expectNoneOf(own.text, [REVIEW2.review], who);
            for (const query of [`booking_id=${BOOKING2.id}&customer_id=${CUSTOMER2.id}`, `booking_id=${BOOKING2.id}&customer_id=${CUSTOMER1.id}`, `booking_id=${BOOKING1.id}&customer_id=${CUSTOMER2.id}`]) {
                await expectForbidden(await request.get(`/api/customer/reviews?${query}`, { headers }), `${who} ?${query}`, [REVIEW2.review, ...CUSTOMER2_STRINGS]);
            }
            await expectAnswer(await request.get(`/api/customer/reviews?booking_id=${MISSING}&customer_id=${CUSTOMER1.id}`, { headers }), 404, 'Booking not found', `${who}, missing booking`);
        }
    });

    // Booking 1 is paid and already reviewed, so the owner's POST reaches the route's own 400 about the existing review, which is how
    // an allowed request is told from the refusals. Red if any of the three 403 clauses is deleted: that clause's request would answer
    // the same 400 (booking 2 is paid and reviewed too).
    test("Ownership POST /api/customer/reviews: customer1 on booking 1 reaches the review check; booking 2, a customer_id naming customer 2 and a provider_id naming provider 2 are 403 and add no review", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const marker = `e2e-ownership-customer-review-${Date.now()}`;
        const sent = (booking, provider, customer) => ({ booking_id: booking, provider_id: provider, customer_id: customer, rating: 5, review: marker });
        for (const [style, headers] of customerStyles(as)) {
            const who = `customer1 by ${style}`;
            await expectAnswer(await request.post('/api/customer/reviews', { headers, data: sent(BOOKING1.id, PROVIDER1.id, CUSTOMER1.id) }), 400, 'You have already reviewed this provider', `${who} reviews booking 1`);
            await expectForbidden(await request.post('/api/customer/reviews', { headers, data: sent(BOOKING2.id, PROVIDER2.id, CUSTOMER1.id) }), `${who} reviews booking 2`, [marker]);
            await expectForbidden(await request.post('/api/customer/reviews', { headers, data: sent(BOOKING1.id, PROVIDER1.id, CUSTOMER2.id) }), `${who}, customer_id naming customer 2`, [marker]);
            await expectForbidden(await request.post('/api/customer/reviews', { headers, data: sent(BOOKING1.id, PROVIDER2.id, CUSTOMER1.id) }), `${who}, provider_id naming provider 2`, [marker]);
        }
        for (const id of [BOOKING1.id, BOOKING2.id]) {
            const read = await request.get(`/api/reviews?booking_id=${id}`, { headers: as.admin });
            expectNoneOf(await read.text(), [marker], `the reviews of booking ${id}`);
        }
    });

    // POST /api/payment/create-intent is a row of the ticket, but nothing of it is observable here: see the header.
    test.skip('Ownership POST /api/payment/create-intent: not observable in the dev app (no STRIPE_SECRET_KEY: the module throws at import, every request is a 500 page) and the handler takes no booking', () => {});
});

// ---------------------------------------------------------------------------------------------------------------------
// Chat. Clause (chat/route.js, chat/mark-read, chat/unread): the caller must be a participant of the booking, matched BY ROLE:
// a customer on bookings.user_id, a provider on bookings.provider_id, an admin on any (customer 1 and provider 1 share the id 1,
// so a comparison that ignores the role lets provider 1 into customer 1's booking); a booking that exists and is not the
// caller's is 403. GET keeps its existing answer for a booking that does not exist (200, no messages, status 'unknown'), POST its
// 404. mark-read and unread also refuse a userType that is not the caller's role, and unread a user_id or provider_id naming
// another account. The fixture chat (database/fixtures/ownership.js): booking 1 holds chat 1 and 2, booking 2 chat 3 and 4.
// ---------------------------------------------------------------------------------------------------------------------
test.describe('Ownership: chat', () => {
    const BOOKING1_CHAT = [CHAT1.message, CHAT2.message];
    const BOOKING2_CHAT = [CHAT3.message, CHAT4.message];
    const chatOf = async (request, headers, id) => (await (await request.get(`/api/chat?bookingId=${id}`, { headers })).json()).messages;
    const everyone = (as) => [...customerStyles(as).map(([s, h]) => [`customer1 by ${s}`, h]), ...providerStyles(as).map(([s, h]) => [`provider1 by ${s}`, h])];

    test("Ownership GET /api/chat: the customer and the provider of booking 1 read its messages and none of booking 2's; a missing booking keeps its empty answer", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        for (const [who, headers] of everyone(as)) {
            const { text, body } = await expectOk(await request.get(`/api/chat?bookingId=${BOOKING1.id}`, { headers }), who);
            expectAllOf(text, BOOKING1_CHAT, who);
            expectNoneOf(text, [...BOOKING2_CHAT, ...CUSTOMER2_STRINGS, ...PROVIDER2_STRINGS], who);
            expect(body.bookingStatus, `${who}: booking 1's status`).toBe(BOOKING1.status);
            const missing = await expectOk(await request.get(`/api/chat?bookingId=${MISSING}`, { headers }), `${who}, missing booking`);
            expect(missing.body.messages, `${who}: no messages for a booking that does not exist`).toEqual([]);
            expect(missing.body.bookingStatus, `${who}: status of a booking that does not exist`).toBe('unknown');
        }
    });

    // Red if the `isParticipant` refusal is deleted from GET: the non-participant reads booking 2's two messages.
    test("Ownership GET /api/chat: a non-participant asking for booking 2 is 403 and sees none of its messages, and the admin reads it", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        for (const [style, headers] of [['cookie', as.admin], ['bearer', as.adminBearer]]) {
            const { text } = await expectOk(await request.get(`/api/chat?bookingId=${BOOKING2.id}`, { headers }), `admin by ${style}`);
            expectAllOf(text, BOOKING2_CHAT, `admin by ${style}`);
        }
        for (const [who, headers] of everyone(as)) {
            await expectForbidden(await request.get(`/api/chat?bookingId=${BOOKING2.id}`, { headers }), `${who} asks for booking 2`, [...BOOKING2_CHAT, ...CUSTOMER2_STRINGS, ...PROVIDER2_STRINGS]);
        }
    });

    // customer1 owns this booking (user_id 1) and provider 2 is its provider; provider1's id is also 1 and provider1 is not a participant.
    // Red if the participant test compares caller.id with either column whatever the role.
    test("Ownership GET /api/chat: the role decides the column, so provider1 (id 1) is refused on a booking whose customer is user 1 and whose provider is provider 2", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        await withProbeBooking(request, as, async (id) => {
            await adminUpdates(request, as, id, { provider_id: PROVIDER2.id });
            const row = await bookingAsAdmin(request, as, id);
            expect([row.user_id, row.provider_id], 'the probe booking is customer 1\'s with provider 2').toEqual([CUSTOMER1.id, PROVIDER2.id]);
            await expectOk(await request.get(`/api/chat?bookingId=${id}`, { headers: as.customer }), 'customer1 (the owner)');
            await expectForbidden(await request.get(`/api/chat?bookingId=${id}`, { headers: as.provider }), 'provider1 (same id, not the provider)');
            await expectForbidden(await request.get(`/api/chat?bookingId=${id}`, { headers: as.providerBearer }), 'provider1 by Bearer');
        }, { headers: as.customer });
    });

    // Red if the participant refusal is deleted from POST: the message would be stored on booking 2 and the admin read would show it.
    test("Ownership POST /api/chat: a non-participant posting to booking 2 is 403 and no message is added; a missing booking keeps its 404", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const marker = `e2e-ownership-chat-foreign-${Date.now()}`;
        for (const [who, headers] of everyone(as)) {
            await expectForbidden(await request.post('/api/chat', { headers, data: { bookingId: BOOKING2.id, message: marker } }), `${who} posts to booking 2`, [marker]);
            await expectAnswer(await request.post('/api/chat', { headers, data: { bookingId: MISSING, message: marker } }), 404, 'Booking not found', `${who}, missing booking`);
        }
        const read = await request.get(`/api/chat?bookingId=${BOOKING2.id}`, { headers: as.admin });
        const text = await read.text();
        expectAllOf(text, BOOKING2_CHAT, 'control, booking 2');
        expectNoneOf(text, [marker], "booking 2's messages");
    });

    // The case makes its own booking (customer 1's, assigned to provider 1), so the messages it posts go with it (chat_messages.booking_id
    // cascades) and no fixture chat grows. Red if the sender is taken from the body: a customer who names senderType 'provider' would be
    // stored as the provider.
    test("Ownership POST /api/chat: the stored sender is the caller whatever the body names (customer1 and provider1 on their booking)", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const marker = `e2e-ownership-chat-sender-${Date.now()}`;
        const cases = [
            ['customer1', as.customer, 'provider', 'customer'],
            ['provider1', as.providerBearer, 'customer', 'provider'],
        ];
        await withProbeBooking(request, as, async (id) => {
            await adminUpdates(request, as, id, { provider_id: PROVIDER1.id });
            for (const [who, headers, named, expected] of cases) {
                const text = `${marker}-${who}`;
                await expectOk(await request.post('/api/chat', { headers, data: { bookingId: id, message: text, senderType: named, senderId: 2, sender_type: named, sender_id: 2 } }), `${who} posts`);
                const stored = (await chatOf(request, as.admin, id)).find((m) => m.message === text);
                expect(stored, `${who}: the posted message is stored`).toBeTruthy();
                expect(stored.sender_type, `${who}: stored sender_type (the body named '${named}')`).toBe(expected);
                expect(stored.sender_id, `${who}: stored sender_id (the body named 2)`).toBe(1);
            }
        }, { headers: as.customer });
    });

    test("Ownership GET /api/chat/unread: booking 1's two participants get a count, booking 2, the other side's type and another account's id are 403, the admin may name any", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const unread = (id, type, extra = '') => `/api/chat/unread?bookingId=${id}&userType=${type}${extra}`;
        for (const [who, headers] of everyone(as)) {
            const role = who.startsWith('customer') ? 'customer' : 'provider';
            const other = role === 'customer' ? 'provider' : 'customer';
            const own = await expectOk(await request.get(unread(BOOKING1.id, role), { headers }), `${who} counts booking 1`);
            expect(typeof own.body.unreadCount, `${who}: unreadCount`).toBe('number');
            await expectForbidden(await request.get(unread(BOOKING2.id, role), { headers }), `${who} counts booking 2`);
            await expectForbidden(await request.get(unread(BOOKING1.id, other), { headers }), `${who} counts booking 1 as ${other}`);
            await expectForbidden(await request.get(unread(BOOKING1.id, role, `&${role === 'customer' ? 'user_id' : 'provider_id'}=2`), { headers }), `${who} counts booking 1 naming account 2`);
        }
        for (const [style, headers] of [['cookie', as.admin], ['bearer', as.adminBearer]]) {
            const counted = await expectOk(await request.get(unread(BOOKING2.id, 'customer', `&user_id=${CUSTOMER2.id}`), { headers }), `admin by ${style} counts booking 2 for customer 2`);
            expect(typeof counted.body.unreadCount, `admin by ${style}: unreadCount`).toBe('number');
        }
    });

    // The case makes its own booking (customer 1's, assigned to provider 1) with one message from each side, so what it marks is its own and
    // goes with the booking; booking 2's fixture messages are only compared before and after (whatever their state when the case starts).
    // Red if the `userType !== caller.role` refusal is deleted (the customer would mark their own message read) or the participant
    // refusal is (customer 2 would mark the provider's message read).
    test("Ownership POST /api/chat/mark-read: booking 2, the other side's userType and a non-participant are 403 and change nothing; the customer of a booking marks the provider's message read and not their own", async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const customer2 = await signedInAs(playwright, baseURL, 'customer2');
        const flags = async (id) => Object.fromEntries((await chatOf(request, as.admin, id)).map((m) => [m.message, m.is_read]));
        const booking2Before = await flags(BOOKING2.id);
        for (const [who, headers] of everyone(as)) {
            const role = who.startsWith('customer') ? 'customer' : 'provider';
            await expectForbidden(await request.post('/api/chat/mark-read', { headers, data: { bookingId: BOOKING2.id, userType: role } }), `${who} marks booking 2`);
        }
        expect(await flags(BOOKING2.id), "booking 2's messages after the refused requests").toEqual(booking2Before);
        await withProbeBooking(request, as, async (id) => {
            await adminUpdates(request, as, id, { provider_id: PROVIDER1.id });
            const fromCustomer = `e2e-ownership-mark-customer-${Date.now()}`;
            const fromProvider = `e2e-ownership-mark-provider-${Date.now()}`;
            await expectOk(await request.post('/api/chat', { headers: as.customer, data: { bookingId: id, message: fromCustomer } }), 'customer1 posts');
            await expectOk(await request.post('/api/chat', { headers: as.provider, data: { bookingId: id, message: fromProvider } }), 'provider1 posts');
            expect(await flags(id), 'both messages start unread').toEqual({ [fromCustomer]: 0, [fromProvider]: 0 });
            await expectForbidden(await request.post('/api/chat/mark-read', { headers: as.customer, data: { bookingId: id, userType: 'provider' } }), "customer1 marks as the provider's side");
            await expectForbidden(await request.post('/api/chat/mark-read', { headers: as.providerBearer, data: { bookingId: id, userType: 'customer' } }), "provider1 marks as the customer's side");
            await expectForbidden(await request.post('/api/chat/mark-read', { headers: customer2, data: { bookingId: id, userType: 'customer' } }), 'customer 2 (a non-participant) marks the booking');
            expect(await flags(id), 'both messages are still unread after the refused requests').toEqual({ [fromCustomer]: 0, [fromProvider]: 0 });
            await expectOk(await request.post('/api/chat/mark-read', { headers: as.customer, data: { bookingId: id, userType: 'customer' } }), 'customer1 marks the booking');
            expect(await flags(id), "customer 1 marked the provider's message read and left their own").toEqual({ [fromCustomer]: 0, [fromProvider]: 1 });
        }, { headers: as.customer });
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// POST /api/mobile/push-token. Clause: the body's userId must equal caller.id and a named userType must equal caller.role, else 403
// (the row written is the caller's, in the column of the caller's role). customer 1 and provider 1 share the id 1, so the type
// check is what keeps provider1 from registering a token on customer 1's row and the reverse.
// ---------------------------------------------------------------------------------------------------------------------
test.describe('Ownership: mobile/push-token', () => {
    const tokenBody = (userId, userType) => ({ userId, ...(userType ? { userType } : {}), pushToken: `e2e-ownership-token-${Date.now()}`, platform: 'android', deviceId: 'e2e-ownership' });

    test('Ownership POST /api/mobile/push-token: a caller registers a token for their own id and role', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const cases = [['customer1 by cookie', as.customer, CUSTOMER1.id, 'customer'], ['customer1 by Bearer', as.customerBearer, CUSTOMER1.id, undefined], ['provider1 by cookie', as.provider, PROVIDER1.id, 'provider'], ['provider1 by Bearer', as.providerBearer, PROVIDER1.id, 'provider']];
        for (const [who, headers, userId, userType] of cases) {
            const { body } = await expectOk(await request.post('/api/mobile/push-token', { headers, data: tokenBody(userId, userType) }), who);
            expect(body.message, `${who}: message`).toBe('FCM / Push token saved successfully');
        }
    });

    // Red if the userId comparison is deleted (a token would be stored for account 2), or the userType comparison is (provider1 naming
    // customer 1's id and type, or customer1 naming provider 1's, would be stored on the other id space's row).
    test("Ownership POST /api/mobile/push-token: a userId naming another account, or the other id space's type, is 403", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const refused = [
            ['customer1 naming customer 2', as.customer, tokenBody(CUSTOMER2.id, 'customer')],
            ['customer1 naming account 2 with no type', as.customerBearer, tokenBody(CUSTOMER2.id)],
            ['provider1 naming provider 2', as.provider, tokenBody(PROVIDER2.id, 'provider')],
            ['provider1 naming provider 2 by Bearer', as.providerBearer, tokenBody(PROVIDER2.id, 'provider')],
            ['customer1 naming its own id as a provider', as.customer, tokenBody(CUSTOMER1.id, 'provider')],
            ['provider1 naming its own id as a customer', as.provider, tokenBody(PROVIDER1.id, 'customer')],
        ];
        for (const [who, headers, data] of refused) {
            await expectForbidden(await request.post('/api/mobile/push-token', { headers, data }), who, [data.pushToken]);
        }
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// Customer account: auth/me, user/settings, user/addresses. Clause: the row is caller.id's in the table of caller.role (a
// customer's in `users`, a provider's in `service_providers`; customer 1 and provider 1 are both id 1, so a lookup by id alone, or
// users-first, answers the wrong person); a user_id or provider_id naming anyone else is 403.
// ---------------------------------------------------------------------------------------------------------------------
test.describe('Ownership: customer account', () => {
    // Red if /api/auth/me looks the id up in `users` whatever the role: provider1 would be shown customer 1's profile.
    test('Ownership GET /api/auth/me: each caller gets their own profile from the table of their role (customer 1 and provider 1 share the id 1), the admin the admin', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const profile = async (headers, who) => (await expectOk(await request.get('/api/auth/me', { headers }), who));
        for (const [style, headers] of customerStyles(as)) {
            const who = `customer1 by ${style}`;
            const { text, body } = await profile(headers, who);
            expect(body.user.email, `${who}: email`).toBe(CUSTOMER1.email);
            expect(body.user.role, `${who}: role`).toBe('customer');
            expectNoneOf(text, [PROVIDER1.email, PROVIDER1.phone, PROVIDER1.name], who);
        }
        for (const [style, headers] of providerStyles(as)) {
            const who = `provider1 by ${style}`;
            const { text, body } = await profile(headers, who);
            expect(body.user.email, `${who}: email`).toBe(PROVIDER1.email);
            expect(body.user.name, `${who}: name`).toBe(PROVIDER1.name);
            expectNoneOf(text, [CUSTOMER1.email, CUSTOMER1.phone, 'Customer One'], who);
        }
        for (const [style, headers] of [['cookie', as.admin], ['bearer', as.adminBearer]]) {
            const who = `admin by ${style}`;
            const { body } = await profile(headers, who);
            expect(body.user.email, `${who}: email`).toBe(ADMIN.email);
        }
    });

    // customer1 and provider1 each set dark_mode_enabled on their own row: the other one (same id, other table) and customer 2 stay off.
    // Red if the table is chosen by anything but the caller's role, or the UPDATE's id is not caller.id. The flag is restored in `finally`.
    test("Ownership PUT /api/user/settings: a caller changes only their own row, in the table of their role, and a body user_id or provider_id naming anyone else is 403", async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const customer2 = await signedInAs(playwright, baseURL, 'customer2');
        const dark = async (headers, who) => (await expectOk(await request.get('/api/user/settings', { headers }), who)).body.data.dark_mode_enabled;
        const set = (headers, value) => request.put('/api/user/settings', { headers, data: { dark_mode_enabled: value } });
        expect([await dark(as.customer, 'customer1'), await dark(as.provider, 'provider1'), await dark(customer2, 'customer 2')], 'every dark_mode_enabled starts off').toEqual([false, false, false]);
        try {
            await expectOk(await set(as.customerBearer, true), 'customer1 sets it');
            expect([await dark(as.customer, 'customer1'), await dark(as.provider, 'provider1'), await dark(customer2, 'customer 2')], "only customer 1's row is on (provider 1 has the same id, another table)").toEqual([true, false, false]);
            await expectOk(await set(as.customer, false), 'customer1 clears it');
            await expectOk(await set(as.providerBearer, true), 'provider1 sets it');
            expect([await dark(as.customer, 'customer1'), await dark(as.provider, 'provider1'), await dark(customer2, 'customer 2')], "only provider 1's row is on (customer 1 has the same id)").toEqual([false, true, false]);
            await expectOk(await set(as.provider, false), 'provider1 clears it');
            // naming another account is refused and writes nothing
            for (const [who, headers, data] of [
                ['customer1, user_id 2', as.customer, { user_id: CUSTOMER2.id, dark_mode_enabled: true }],
                ['customer1 by Bearer, user_id 2', as.customerBearer, { user_id: CUSTOMER2.id, dark_mode_enabled: true }],
                ['provider1, provider_id 2', as.provider, { provider_id: PROVIDER2.id, dark_mode_enabled: true }],
            ]) {
                await expectForbidden(await request.put('/api/user/settings', { headers, data }), who);
            }
            expect(await dark(customer2, 'customer 2'), "customer 2's flag after the refused requests").toBe(false);
        } finally {
            await set(as.customer, false);
            await set(as.provider, false);
        }
    });

    test('Ownership GET /api/user/settings: a caller reads their own row; a user_id or provider_id naming another account is 403', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        for (const [style, headers] of customerStyles(as)) {
            await expectOk(await request.get(`/api/user/settings?user_id=${CUSTOMER1.id}`, { headers }), `customer1 by ${style}, own user_id`);
            await expectForbidden(await request.get(`/api/user/settings?user_id=${CUSTOMER2.id}`, { headers }), `customer1 by ${style}, user_id 2`);
        }
        for (const [style, headers] of providerStyles(as)) {
            await expectOk(await request.get(`/api/user/settings?provider_id=${PROVIDER1.id}`, { headers }), `provider1 by ${style}, own provider_id`);
            await expectForbidden(await request.get(`/api/user/settings?provider_id=${PROVIDER2.id}`, { headers }), `provider1 by ${style}, provider_id 2`);
        }
    });

    // The refusals the address routes decide BEFORE they query: the dev database has no user_addresses table, so a request that reaches the
    // query answers 500 and the owner's read, the write for oneself and both [id] routes cannot be observed (see the header).
    test("Ownership GET /api/user/addresses and POST /api/user/addresses: a user_id naming another customer is 403 before any query", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const address = { name: 'E2E ownership', address_line1: '1 Probe Street', city: 'Calgary' };
        for (const [style, headers] of customerStyles(as)) {
            await expectForbidden(await request.get(`/api/user/addresses?user_id=${CUSTOMER2.id}`, { headers }), `GET by ${style}, user_id 2`);
            await expectForbidden(await request.post('/api/user/addresses', { headers, data: { ...address, user_id: CUSTOMER2.id } }), `POST by ${style}, user_id 2`);
        }
    });

    test.skip('Ownership GET /api/user/addresses: the owner reads their addresses (not observable: the dev database has no user_addresses table, the query answers 500)', () => {});
    test.skip('Ownership DELETE /api/user/addresses/[id] and PUT /api/user/addresses/[id]: another customer\'s address is 403 (not observable: no user_addresses table, no address row to ask for)', () => {});
});

// ---------------------------------------------------------------------------------------------------------------------
// Provider routes. Clause: the provider id is auth.caller.id in every query (never a token field or a parameter); a provider_id
// naming another provider is 403 on payouts and ratings; jobs/[id], jobs/photos and jobs/time-tracking filter by owner in their
// own query, so another provider's booking answers each route's existing 404 (the design's named exception), and so does a
// booking that does not exist. A control first shows the strings are served to the provider who owns them (provider 2's own read).
// ---------------------------------------------------------------------------------------------------------------------
test.describe('Ownership: provider routes', () => {
    // jobs/[id]: the caller's own job, or an open one (unassigned, pending or matching), else the route's existing 404 'Job not found'.
    // Red if `b.provider_id = ?` is dropped (case 1: booking 2 would be served) or `AND b.status IN (...)` / `b.provider_id IS NULL` is
    // (cases 2 and 3: the cancelled and the provider-2 probe bookings would be served).
    test("Ownership GET /api/provider/jobs/[id]: provider1 gets their own job and an open one; another provider's booking, a cancelled unassigned one and a missing one keep the 404", async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const provider2 = await signedInAs(playwright, baseURL, 'provider2');
        const control = await expectOk(await request.get(`/api/provider/jobs/${BOOKING2.id}`, { headers: provider2 }), 'control: provider 2 reads booking 2');
        expectAllOf(control.text, [BOOKING2.booking_number, BOOKING2.address_line1], 'control: provider 2');
        for (const [style, headers] of providerStyles(as)) {
            const who = `provider1 by ${style}`;
            const own = await expectOk(await request.get(`/api/provider/jobs/${BOOKING1.id}`, { headers }), who);
            expect(own.body.data.booking_number, `${who}: booking 1`).toBe(BOOKING1.booking_number);
            expectNoneOf(own.text, BOOKING2_STRINGS, who);
            const foreign = await request.get(`/api/provider/jobs/${BOOKING2.id}`, { headers });
            await expectAnswer(foreign, 404, 'Job not found', `${who} asks for booking 2`);
            expectNoneOf(JSON.stringify(await foreign.json().catch(() => ({}))), BOOKING2_STRINGS, `${who} asks for booking 2`);
            await expectAnswer(await request.get(`/api/provider/jobs/${MISSING}`, { headers }), 404, 'Job not found', `${who}, missing booking`);
        }
        await withProbeBooking(request, as, async (id) => {
            const open = await expectOk(await request.get(`/api/provider/jobs/${id}`, { headers: as.provider }), 'provider1, open booking');
            expect(open.body.data.id, 'the open booking is the one asked for').toBe(id);
            await adminUpdates(request, as, id, { status: 'cancelled' });
            await expectAnswer(await request.get(`/api/provider/jobs/${id}`, { headers: as.provider }), 404, 'Job not found', 'provider1, cancelled unassigned booking');
        });
        await withProbeBooking(request, as, async (id) => {
            await adminUpdates(request, as, id, { provider_id: PROVIDER2.id });
            await expectAnswer(await request.get(`/api/provider/jobs/${id}`, { headers: as.provider }), 404, 'Job not found', 'provider1, booking assigned to provider 2');
        });
    });

    // The three lists: provider1 gets their own rows and none of provider 2's, which provider 2's own read does hold.
    test("Ownership GET /api/provider/jobs, GET /api/provider/bookings and GET /api/provider/available-jobs: provider1's lists hold booking 1 and none of booking 2", async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const provider2 = await signedInAs(playwright, baseURL, 'provider2');
        const lists = [
            ['/api/provider/jobs', [BOOKING1.booking_number, BOOKING1.address_line1], [BOOKING2.booking_number, BOOKING2.address_line1, BOOKING2.job_description, 'Customer Two'], [BOOKING2.booking_number, BOOKING2.address_line1]],
            ['/api/provider/bookings', ['Customer One'], ['Customer Two'], ['Customer Two']],
            ['/api/provider/available-jobs', [], [...BOOKING2_STRINGS, 'Customer Two'], []],
        ];
        for (const [path, ownHas, ownLacks, provider2Has] of lists) {
            expectAllOf((await expectOk(await request.get(path, { headers: provider2 }), `control: provider 2 ${path}`)).text, provider2Has, `control: provider 2 ${path}`);
            for (const [style, headers] of providerStyles(as)) {
                const who = `provider1 by ${style} ${path}`;
                const { text } = await expectOk(await request.get(path, { headers }), who);
                expectAllOf(text, ownHas, who);
                expectNoneOf(text, ownLacks, who);
            }
        }
    });

    // POST claims an open job. A booking another provider has is not claimable (the route's own 409 and nothing changes), an open one
    // becomes provider 1's. Red if the claim stops reading the provider from the caller (the id in the UPDATE).
    test("Ownership POST /api/provider/available-jobs: provider1 claims an open booking and it becomes theirs; booking 2 stays provider 2's; a missing booking keeps its 404", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        await expectAnswer(await request.post('/api/provider/available-jobs', { headers: as.provider, data: { booking_id: BOOKING2.id } }), 409, 'Job already accepted by another provider', 'provider1 claims booking 2');
        const booking2 = await bookingAsAdmin(request, as, BOOKING2.id);
        expect([booking2.provider_id, booking2.status], "booking 2 after the refused claim").toEqual([PROVIDER2.id, BOOKING2.status]);
        await expectAnswer(await request.post('/api/provider/available-jobs', { headers: as.providerBearer, data: { booking_id: MISSING } }), 404, 'Job not found', 'provider1, missing booking');
        await withProbeBooking(request, as, async (id) => {
            await expectOk(await request.post('/api/provider/available-jobs', { headers: as.provider, data: { booking_id: id } }), 'provider1 claims the open booking');
            expect((await bookingAsAdmin(request, as, id)).provider_id, 'the claimed booking is provider 1\'s').toBe(PROVIDER1.id);
        });
    });

    // Red if any of the three queries stops binding caller.id, or the `provider_id` refusal is deleted. The second payout of provider 2
    // (database/fixtures/ownership.js, 23.45) is the string only provider 2's answer holds: payouts 1 and 2 are both 64.00.
    test("Ownership GET /api/provider/payouts: provider1 gets their own earnings and payouts and not provider 2's 23.45, and a provider_id naming provider 2 is 403", async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const provider2 = await signedInAs(playwright, baseURL, 'provider2');
        const amount = String(SECOND_PAYOUT_OF_PROVIDER2.amount);
        expectAllOf((await expectOk(await request.get('/api/provider/payouts', { headers: provider2 }), 'control: provider 2')).text, [amount], 'control: provider 2 holds the second payout');
        for (const [style, headers] of providerStyles(as)) {
            for (const path of ['/api/provider/payouts', `/api/provider/payouts?provider_id=${PROVIDER1.id}`, '/api/provider/payouts?provider_id=']) {
                const who = `provider1 by ${style} ${path}`;
                const { text, body } = await expectOk(await request.get(path, { headers }), who);
                expectNoneOf(text, [amount], who);
                expect(body.data.balances.total_earnings, `${who}: provider 1's earnings, one 64.00 payout`).toBe(64);
            }
            await expectForbidden(await request.get(`/api/provider/payouts?provider_id=${PROVIDER2.id}`, { headers }), `provider1 by ${style} ?provider_id=2`, [amount]);
        }
    });

    test("Ownership GET /api/provider/ratings: provider1 gets their own review and not provider 2's, and a provider_id naming provider 2 is 403", async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const provider2 = await signedInAs(playwright, baseURL, 'provider2');
        expectAllOf((await expectOk(await request.get('/api/provider/ratings', { headers: provider2 }), 'control: provider 2')).text, [REVIEW2.review], 'control: provider 2 holds review 2');
        for (const [style, headers] of providerStyles(as)) {
            for (const path of ['/api/provider/ratings', `/api/provider/ratings?provider_id=${PROVIDER1.id}`]) {
                const who = `provider1 by ${style} ${path}`;
                const { text } = await expectOk(await request.get(path, { headers }), who);
                expectAllOf(text, [REVIEW1.review], who);
                expectNoneOf(text, [REVIEW2.review, 'Customer Two'], who);
            }
            await expectForbidden(await request.get(`/api/provider/ratings?provider_id=${PROVIDER2.id}`, { headers }), `provider1 by ${style} ?provider_id=2`, [REVIEW2.review]);
        }
    });

    test("Ownership GET /api/provider/dashboard-stats: provider1's recent jobs hold booking 1 and not booking 2", async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const provider2 = await signedInAs(playwright, baseURL, 'provider2');
        const ids = (body) => body.stats.recentJobs.map((job) => job.id);
        expect(ids((await expectOk(await request.get('/api/provider/dashboard-stats', { headers: provider2 }), 'control: provider 2')).body), 'control: provider 2 sees booking 2').toContain(BOOKING2.id);
        for (const [style, headers] of providerStyles(as)) {
            const who = `provider1 by ${style}`;
            const { body } = await expectOk(await request.get('/api/provider/dashboard-stats', { headers }), who);
            expect(ids(body), `${who}: recent jobs`).toContain(BOOKING1.id);
            expect(ids(body), `${who}: recent jobs`).not.toContain(BOOKING2.id);
            expect(body.stats.averageRating, `${who}: provider 1's average rating, not provider 2's`).toBe(REVIEW1.rating);
        }
    });

    // me, profile, status, availability and onboarding/documents read the provider row of caller.id. provider1 shares the id 1 with
    // customer 1, so a lookup in `users`, or a token id that is not the provider's, would answer with customer 1.
    test("Ownership GET /api/provider/me, /profile, /onboarding/documents: provider1 gets provider 1's row, not provider 2's and not customer 1's (same id)", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        for (const path of ['/api/provider/me', '/api/provider/profile', '/api/provider/onboarding/documents']) {
            for (const [style, headers] of providerStyles(as)) {
                const who = `provider1 by ${style} ${path}`;
                const { text } = await expectOk(await request.get(path, { headers }), who);
                expectAllOf(text, [PROVIDER1.name, ...(path === '/api/provider/profile' ? [] : [PROVIDER1.email])], who);
                expectNoneOf(text, [...PROVIDER2_STRINGS, CUSTOMER1.email, CUSTOMER1.phone, 'Customer One'], who);
            }
        }
        for (const [style, headers] of providerStyles(as)) {
            expect((await expectOk(await request.get('/api/provider/status', { headers }), `provider1 by ${style} status`)).body.status, 'status').toBe(PROVIDER1.status);
            expect((await expectOk(await request.get('/api/provider/availability', { headers }), `provider1 by ${style} availability`)).body.is_available, 'is_available').toBe(true);
        }
    });

    // Photos and the timer address a booking by the query or the body; both filter by owner in their own query, so booking 2 answers the
    // route's 404 (the same text as a booking that does not exist) and a write to booking 2 is not made. Red if `provider_id = ?` is dropped
    // from the booking lookup: the refused POSTs would reach booking 2.
    test("Ownership GET and POST /api/provider/jobs/photos and /jobs/time-tracking: provider1 reaches booking 1, booking 2 and a missing booking keep the 404 and booking 2 is unchanged", async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const provider2 = await signedInAs(playwright, baseURL, 'provider2');
        const photoUrl = `/uploads/e2e-ownership-${Date.now()}.png`;
        const before = await bookingAsAdmin(request, as, BOOKING2.id);
        expect((await expectOk(await request.get(`/api/provider/jobs/photos?booking_id=${BOOKING2.id}`, { headers: provider2 }), 'control: provider 2 reads the photos of booking 2')).body.data, 'control: the photos answer has before and after').toHaveProperty('before');
        for (const [style, headers] of providerStyles(as)) {
            const who = `provider1 by ${style}`;
            await expectOk(await request.get(`/api/provider/jobs/photos?booking_id=${BOOKING1.id}`, { headers }), `${who} photos of booking 1`);
            await expectOk(await request.get(`/api/provider/jobs/time-tracking?booking_id=${BOOKING1.id}`, { headers }), `${who} timer of booking 1`);
            await expectAnswer(await request.get(`/api/provider/jobs/photos?booking_id=${BOOKING2.id}`, { headers }), 404, 'Booking not found or not assigned to you', `${who} photos of booking 2`);
            await expectAnswer(await request.get(`/api/provider/jobs/photos?booking_id=${MISSING}`, { headers }), 404, 'Booking not found or not assigned to you', `${who} photos of a missing booking`);
            await expectAnswer(await request.get(`/api/provider/jobs/time-tracking?booking_id=${BOOKING2.id}`, { headers }), 404, 'Booking not found', `${who} timer of booking 2`);
            await expectAnswer(await request.post('/api/provider/jobs/photos', { headers, data: { booking_id: BOOKING2.id, photo_url: photoUrl, photo_type: 'before' } }), 404, 'Booking not found or not assigned to you', `${who} posts a photo to booking 2`);
            await expectAnswer(await request.post('/api/provider/jobs/time-tracking', { headers, data: { booking_id: BOOKING2.id, action: 'start' } }), 404, 'Booking not found or not assigned to you', `${who} starts the timer of booking 2`);
        }
        const listed = await request.get(`/api/provider/jobs/photos?booking_id=${BOOKING2.id}`, { headers: provider2 });
        expectNoneOf(await listed.text(), [photoUrl], "booking 2's photos as provider 2 reads them");
        const after = await bookingAsAdmin(request, as, BOOKING2.id);
        for (const column of ['status', 'job_timer_status', 'start_time', 'end_time', 'updated_at', 'before_photos_uploaded']) {
            expect(after[column], `booking 2's ${column} after the refused photo and timer requests`).toEqual(before[column]);
        }
        // The owner's own start on completed booking 1 reaches the route's state check and stops there, writing nothing.
        await expectAnswer(await request.post('/api/provider/jobs/time-tracking', { headers: as.provider, data: { booking_id: BOOKING1.id, action: 'start' } }), 400, 'Job must be confirmed to start', 'provider1 starts the timer of completed booking 1');
    });
});
