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
// Writes to a fixture row: the PUT cases put a marker in `hear_about` / a settings flag and restore it in `finally`; the chat
// POST case adds a message to booking 1 (no route deletes one); POST /api/chat/mark-read marks booking 1's messages read and no
// route marks one unread, and the push-token case upserts a mobile_auth_users row. So the first window after a run needs the
// fixtures reloaded (npm run db:fixtures), as the department's run recipe does before every window; the cases that read the chat
// are ahead of the mark-read case in the file for that reason.
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
