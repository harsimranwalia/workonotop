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
// push-token cases upsert a mobile_auth_users row for customer 1, provider 1 and the admin (device 'e2e-ownership'; no case reads it back).
// Every chat message a case posts goes on a booking the case made itself (customer 1's or customer 2's, assigned to provider 1 or 2), which cascades
// them away when the case deletes it, so no fixture chat grows and no case needs freshly loaded fixtures.
//
// NOT covered here, and why (read from the code and the dev database, not guessed):
//   POST /api/payment/create-intent  the route takes NO booking (it reads service_id and takes the catalog's price of that service as the
//                                    amount; the booking is made after the payment), so the ticket's "the booking named in the body must be the
//                                    caller's own" has no booking to name: the route's ownership is the caller's own users row (the Stripe
//                                    customer), and builder A made a body user_id or booking_id naming another account a 403. Before that
//                                    commit the module built `new Stripe(process.env.STRIPE_SECRET_KEY)` at import and the dev app sets no key,
//                                    so every request answered a 500 page and nothing was observable. The case below names no service, so the
//                                    catalog read answers 400 before any Stripe call, whatever the clause does.
//   /api/user/addresses and [id]     the dev database has no `user_addresses` table (SHOW TABLES, 2026-10-04): every address read or
//                                    write that reaches the query answers 500. Only the refusals decided before the query are cases here.
//   POST /api/auth/change-password   every fixture password lacks a character the route's new-password rule demands (:17), so a change
//                                    that succeeds cannot be undone and no case lets one succeed. The table choice (:27-30; customer 1 and
//                                    provider 1 are both id 1) is shown by two refusals: a new password that passes the rule and the OTHER
//                                    role's fixture password as oldPassword is answered 401 'Incorrect current password' by the route's own
//                                    check (:45), and the logins still open. The UPDATE at :52 is reached by no case.
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

    // Each customer writes their own profile, a marker in hear_about that is read back and then restored: customer 1 (id 1) and customer 2
    // (id 2). Customer 1 alone cannot tell the binds `caller.id` from a literal 1 (they are the same number), so customer 2's write is the one
    // that does. Red if the UPDATE's `WHERE id = ?` binds a literal 1: the write carries customer 2's phone, which row 2 already holds, so the
    // UNIQUE index on users.phone (database/schema.js:35) refuses it, the route answers 500 (the catch at customers/[id]/route.js:311-313) and the
    // case is red at "customer 2 writes customer 2" (the recorded run names that label and does not print the status); a literal 2 from customer 1's
    // leg is refused the same way. The read-backs of hear_about that follow the write (row 2 must hold customer 2's marker, row 1 must be what it
    // was) would catch a write whose values do not collide; they have not been seen red for this bind. Red too if the SELECT that echoes the row
    // back binds a literal 1 (customer 2's answer would be row 1: its id is 1, not 2).
    // A write to another customer's path id is refused before either query: that is the case above.
    test('Ownership PUT /api/customers/[id]: customer1 writes their own profile (a marker in hear_about, read back, then restored)', async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const customer2 = await signedInAs(playwright, baseURL, 'customer2');
        const profileAsAdmin = async (id) => {
            const read = await request.get(`/api/customers/${id}`, { headers: as.admin });
            expect(read.status(), `admin reads customer ${id}`).toBe(200);
            return (await read.json()).data;
        };
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
        // Customer 2 as the second writer. Both rows are read as the admin first, so "unchanged" after the write is the value read here and not a
        // guess; customer 2's hear_about must start empty, because the restore below puts it back to empty.
        const marker2 = `e2e-ownership-own-two-${Date.now()}`;
        const own2 = { first_name: CUSTOMER2.first_name, last_name: CUSTOMER2.last_name, phone: CUSTOMER2.phone, receive_offers: 0 };
        const before1 = await profileAsAdmin(CUSTOMER1.id);
        const before2 = await profileAsAdmin(CUSTOMER2.id);
        expect(before2.hear_about, "customer 2's hear_about starts empty (the restore below sets it back to that)").toBeNull();
        try {
            const { body } = await expectOk(await request.put(`/api/customers/${CUSTOMER2.id}`, { headers: customer2, data: { ...own2, hear_about: marker2 } }), 'customer 2 writes customer 2');
            expect(body.data.id, "the row customer 2's write answers with is customer 2's (id 2), not customer 1's").toBe(CUSTOMER2.id);
            expect((await profileAsAdmin(CUSTOMER2.id)).hear_about, "customer 2's stored hear_about is customer 2's marker").toBe(marker2);
            expect((await profileAsAdmin(CUSTOMER1.id)).hear_about, "customer 1's stored hear_about is what it was, not customer 2's marker").toBe(before1.hear_about);
        } finally {
            await request.put(`/api/customers/${CUSTOMER2.id}`, { headers: customer2, data: { ...own2, hear_about: '' } });
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

    // The accept's UPDATE stores the provider from the caller (`SET provider_id=? ... WHERE id=?`, bound to [caller.id, id]). Provider 1's id is 1, which is also
    // what a literal 1 in that bind would store, so provider 1's accept cannot tell the caller from the literal: each provider accepts an open probe booking
    // of their own and the stored provider is read back as the admin. Red if the bind is a literal 1 (provider 2's accept stores provider 1: the provider-2
    // assertion fails on 1, not 2) or a literal 2 (provider 1's accept stores provider 2: the provider-1 assertion fails on 2, not 1). A missing booking keeps its 404.
    test('Ownership POST /api/provider/available-jobs/[id]: provider1 accepts an open booking and it becomes provider 1\'s; a missing booking keeps its 404', async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const provider2 = await signedInAs(playwright, baseURL, 'provider2');
        await withProbeBooking(request, as, async (id) => {
            await expectOk(await request.post(`/api/provider/available-jobs/${id}`, { headers: as.provider, data: {} }), 'provider1 accepts the open booking');
            const row = await bookingAsAdmin(request, as, id);
            expect(row.provider_id, 'the accepted booking is provider 1\'s').toBe(PROVIDER1.id);
        });
        await withProbeBooking(request, as, async (id) => {
            await expectOk(await request.post(`/api/provider/available-jobs/${id}`, { headers: provider2, data: {} }), 'provider2 accepts the open booking');
            const row = await bookingAsAdmin(request, as, id);
            expect(row.provider_id, 'the booking provider 2 accepted is stored with provider 2\'s id (2), not provider 1\'s (1)').toBe(PROVIDER2.id);
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

    // The row is written with caller.id and the booking's own provider (the INSERT's `booking.provider_id, caller.id`), and the id spaces
    // overlap: customer 1 and provider 1 are both id 1, so their leg alone cannot tell caller.id from a literal 1. Customer 2's leg can (their
    // own completed booking, assigned to provider 2, a body naming customer 2 and provider 2): the stored customer_id must be 2 and the stored
    // provider_id 2. Red if the INSERT binds a literal 1 where it binds caller.id (customer 2's review would be stored with customer 1) or
    // where it binds booking.provider_id (it would be stored with provider 1). A body that names other ids is not tried here: the two cases
    // above answer those with a 403 before the INSERT. The review of each leg is deleted in `finally`.
    test("Ownership POST /api/reviews: a review for the caller's own completed booking is stored with the caller and the booking's provider, and a missing booking keeps its 404", async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const customer2 = await signedInAs(playwright, baseURL, 'customer2');
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
        // Customer 2 as the second author: their own probe booking, completed and assigned to provider 2 by the admin.
        await withProbeBooking(request, as, async (id) => {
            await adminUpdates(request, as, id, { status: 'completed', provider_id: PROVIDER2.id });
            const marker = `e2e-ownership-own-review-two-${Date.now()}`;
            const written = await expectOk(await request.post('/api/reviews', { headers: customer2, data: { booking_id: id, provider_id: PROVIDER2.id, customer_id: CUSTOMER2.id, rating: 4, review: marker } }), 'customer 2 reviews their own booking');
            const reviewId = written.body.review_id;
            try {
                const read = await request.get(`/api/reviews?booking_id=${id}`, { headers: as.admin });
                expect(read.status(), "admin reads the reviews of customer 2's booking").toBe(200);
                const rows = (await read.json()).data;
                expect(rows.length, "one review is stored for customer 2's booking").toBe(1);
                expect(rows[0].review, "the stored text is customer 2's").toBe(marker);
                expect(rows[0].customer_id, "the stored customer_id is the caller's 2, not customer 1's").toBe(CUSTOMER2.id);
                expect(rows[0].provider_id, "the stored provider_id is the booking's own provider 2, not provider 1's").toBe(PROVIDER2.id);
            } finally {
                await request.delete(`/api/reviews?id=${reviewId}`, { headers: as.admin });
            }
        }, { headers: customer2 });
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

    // The route reads no booking of its own; its ownership is the caller's users row. A body naming another account (user_id) or another account's
    // booking (booking_id) is 403 before any Stripe call; the owner's request reaches the route's own validation (400 'This service is not available for booking').
    // No request here names a service, so none can reach the Stripe code. Red if either refusal is deleted: the request would answer that 400.
    test("Ownership POST /api/payment/create-intent: a body naming customer 2 as user_id or customer 2's booking as booking_id is 403, the owner reaches the route's own validation", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        for (const [style, headers] of customerStyles(as)) {
            for (const data of [{ user_id: CUSTOMER2.id }, { booking_id: BOOKING2.id }, { user_id: CUSTOMER2.id, booking_id: BOOKING2.id }]) {
                const who = `customer1 by ${style} naming ${Object.keys(data).join('+')}`;
                await expectForbidden(await request.post('/api/payment/create-intent', { headers, data }), who, BOOKING2_STRINGS);
            }
            for (const data of [{}, { user_id: CUSTOMER1.id }, { booking_id: BOOKING1.id }]) {
                const who = `customer1 by ${style} naming ${Object.keys(data).join('+') || 'nothing'}`;
                await expectAnswer(await request.post('/api/payment/create-intent', { headers, data }), 400, 'This service is not available for booking', who);
            }
        }
    });
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

    // The collision booking: customer 1's (user_id 1), assigned to provider 2 (provider_id 2). Two accounts that are NOT its participants carry
    // the other column's number as their own id: provider1 (id 1 = the booking's user_id) and customer 2 (id 2 = the booking's provider_id).
    // An actor is [label, credential, role]: the role is the one it asks in (the userType of unread and mark-read), always its own, so the
    // guard's role check and those userType clauses let it through and only the participant test can refuse it. The owner and the booking's
    // provider are the controls: the 200s that show a 403 is not a malformed request. Customer 2 and provider 2 are not credentials of
    // getCredentialHeaders: they sign in themselves, and customer 2's header is returned for a case that needs it again.
    async function collisionActors(as, playwright, baseURL) {
        const customer2 = await signedInAs(playwright, baseURL, 'customer2');
        const provider2 = await signedInAs(playwright, baseURL, 'provider2');
        return {
            customer2,
            controls: [['customer1 (the owner)', as.customer, 'customer'], ["provider 2 (the booking's provider)", provider2, 'provider']],
            refused: [
                ["provider1 by cookie (id 1 is the booking's user_id)", as.provider, 'provider'],
                ['provider1 by Bearer', as.providerBearer, 'provider'],
                ["customer 2 (id 2 is the booking's provider_id)", customer2, 'customer'],
            ],
        };
    }
    const withCollisionBooking = (request, as, run) => withProbeBooking(request, as, async (id) => {
        await adminUpdates(request, as, id, { provider_id: PROVIDER2.id });
        const row = await bookingAsAdmin(request, as, id);
        expect([row.user_id, row.provider_id], "the probe booking is customer 1's with provider 2").toEqual([CUSTOMER1.id, PROVIDER2.id]);
        await run(id);
    }, { headers: as.customer });

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

    // The collision booking (see collisionActors): customer1 owns it (user_id 1) and provider 2 is its provider (provider_id 2). provider1 (id 1)
    // and customer 2 (id 2) are not participants and both ask in their own role, so only the participant test can refuse them. Red if the customer
    // arm of that test stops testing the role (provider1 would read the thread, by cookie and by Bearer) or the provider arm does (customer 2
    // would); the owner and provider 2 are the controls (200). This is the GET of chat/route.js, whose copy of the test the POST shares: the
    // unread and mark-read routes have their own copies, held by their cases below.
    test("Ownership GET /api/chat: the role decides the column, so provider1 (id 1) is refused on a booking whose customer is user 1 and whose provider is provider 2", async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const customer2 = await signedInAs(playwright, baseURL, 'customer2');
        const provider2 = await signedInAs(playwright, baseURL, 'provider2');
        await withProbeBooking(request, as, async (id) => {
            await adminUpdates(request, as, id, { provider_id: PROVIDER2.id });
            const row = await bookingAsAdmin(request, as, id);
            expect([row.user_id, row.provider_id], 'the probe booking is customer 1\'s with provider 2').toEqual([CUSTOMER1.id, PROVIDER2.id]);
            await expectOk(await request.get(`/api/chat?bookingId=${id}`, { headers: as.customer }), 'customer1 (the owner)');
            await expectOk(await request.get(`/api/chat?bookingId=${id}`, { headers: provider2 }), "provider 2 (the booking's provider)");
            await expectForbidden(await request.get(`/api/chat?bookingId=${id}`, { headers: as.provider }), 'provider1 (same id, not the provider)');
            await expectForbidden(await request.get(`/api/chat?bookingId=${id}`, { headers: as.providerBearer }), 'provider1 by Bearer');
            await expectForbidden(await request.get(`/api/chat?bookingId=${id}`, { headers: customer2 }), "customer 2 (same id as the booking's provider, not the provider)");
        }, { headers: as.customer });
    });

    // Red if the participant refusal is deleted from POST: the message would be stored on booking 2 and the admin read would show it.
    // The collision booking (see collisionActors) is the same clause with the two id spaces crossed: provider1 (id 1 = the booking's user_id) and
    // customer 2 (id 2 = the booking's provider_id) post in their own role and are refused with nothing stored. Red if the customer arm of the
    // participant test stops testing the role (provider1's message would be stored) or the provider arm does (customer 2's would be). The owner
    // and provider 2 post as the controls (200), and the thread, read as the admin, is exactly their two messages before and after the refusals.
    test("Ownership POST /api/chat: a non-participant posting to booking 2 is 403 and no message is added; a missing booking keeps its 404", async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const { controls, refused } = await collisionActors(as, playwright, baseURL);
        const marker = `e2e-ownership-chat-foreign-${Date.now()}`;
        for (const [who, headers] of everyone(as)) {
            await expectForbidden(await request.post('/api/chat', { headers, data: { bookingId: BOOKING2.id, message: marker } }), `${who} posts to booking 2`, [marker]);
            await expectAnswer(await request.post('/api/chat', { headers, data: { bookingId: MISSING, message: marker } }), 404, 'Booking not found', `${who}, missing booking`);
        }
        const read = await request.get(`/api/chat?bookingId=${BOOKING2.id}`, { headers: as.admin });
        const text = await read.text();
        expectAllOf(text, BOOKING2_CHAT, 'control, booking 2');
        expectNoneOf(text, [marker], "booking 2's messages");
        await withCollisionBooking(request, as, async (id) => {
            const thread = async () => (await chatOf(request, as.admin, id)).map((m) => m.message).sort();
            for (const [who, headers, role] of controls) {
                await expectOk(await request.post('/api/chat', { headers, data: { bookingId: id, message: `${marker}-${role}` } }), `${who} posts`);
            }
            const posted = [`${marker}-customer`, `${marker}-provider`];
            expect(await thread(), "the collision booking's thread is the owner's and the provider's message").toEqual(posted);
            for (const [who, headers] of refused) {
                await expectForbidden(await request.post('/api/chat', { headers, data: { bookingId: id, message: `${marker}-refused` } }), `${who} posts to the collision booking`, [`${marker}-refused`]);
            }
            expect(await thread(), "the collision booking's thread after the refused posts: no message was added").toEqual(posted);
        });
    });

    // The case makes its own bookings, so the messages it posts go with them (chat_messages.booking_id cascades) and no fixture chat grows.
    // Two bookings, one per id: on customer 1's (assigned to provider 1) the callers' id is 1 and on customer 2's (assigned to provider 2) it
    // is 2, and the body names the OTHER id each time. Red if the sender is taken from the body (a customer who names senderType 'provider'
    // would be stored as the provider, and the sender_id the body names would be stored) or the stored sender_id is not caller.id:
    // customer1 and provider1 alone cannot tell a literal 1 from caller.id (both are id 1), customer 2 and provider 2 can (a literal 1
    // would store 1 for them, and the case reads back 2).
    test("Ownership POST /api/chat: the stored sender is the caller whatever the body names (customer1 and provider1 on their booking)", async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const customer2 = await signedInAs(playwright, baseURL, 'customer2');
        const provider2 = await signedInAs(playwright, baseURL, 'provider2');
        const marker = `e2e-ownership-chat-sender-${Date.now()}`;
        // [who, credential, the senderType the body names, the sender_type stored, the sender_id the body names, the sender_id stored]
        const firstBooking = [
            ['customer1', as.customer, 'provider', 'customer', 2, CUSTOMER1.id],
            ['provider1', as.providerBearer, 'customer', 'provider', 2, PROVIDER1.id],
        ];
        const secondBooking = [
            ['customer 2', customer2, 'provider', 'customer', 1, CUSTOMER2.id],
            ['provider 2', provider2, 'customer', 'provider', 1, PROVIDER2.id],
        ];
        const postsAndReadsBack = async (id, cases) => {
            for (const [who, headers, named, expectedType, namedId, expectedId] of cases) {
                const text = `${marker}-${who}`;
                await expectOk(await request.post('/api/chat', { headers, data: { bookingId: id, message: text, senderType: named, senderId: namedId, sender_type: named, sender_id: namedId } }), `${who} posts`);
                const stored = (await chatOf(request, as.admin, id)).find((m) => m.message === text);
                expect(stored, `${who}: the posted message is stored`).toBeTruthy();
                expect(stored.sender_type, `${who}: the stored sender_type is the caller's '${expectedType}' (the body named '${named}')`).toBe(expectedType);
                expect(stored.sender_id, `${who}: the stored sender_id is the caller's ${expectedId} (the body named ${namedId})`).toBe(expectedId);
            }
        };
        await withProbeBooking(request, as, async (id) => {
            await adminUpdates(request, as, id, { provider_id: PROVIDER1.id });
            await postsAndReadsBack(id, firstBooking);
        }, { headers: as.customer });
        await withProbeBooking(request, as, async (id) => {
            await adminUpdates(request, as, id, { provider_id: PROVIDER2.id });
            const row = await bookingAsAdmin(request, as, id);
            expect([row.user_id, row.provider_id], "the second probe booking is customer 2's with provider 2").toEqual([CUSTOMER2.id, PROVIDER2.id]);
            await postsAndReadsBack(id, secondBooking);
        }, { headers: customer2 });
    });

    // The collision booking (see collisionActors) against the unread route's own copy of the participant test: provider1 (id 1 = the booking's
    // user_id) and customer 2 (id 2 = the booking's provider_id) count in their own role and name no account, so the userType clause lets them
    // through and only the participant test can refuse them. Red if the customer arm of that test stops testing the role (provider1 would get a
    // count) or the provider arm does (customer 2 would). The owner and provider 2 are the controls: each posts one message, and each is then
    // answered 200 with a count of 1, the other side's message.
    test("Ownership GET /api/chat/unread: booking 1's two participants get a count, booking 2, the other side's type and another account's id are 403, the admin may name any", async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const { controls, refused } = await collisionActors(as, playwright, baseURL);
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
        const marker = `e2e-ownership-unread-${Date.now()}`;
        await withCollisionBooking(request, as, async (id) => {
            for (const [who, headers, role] of controls) {
                await expectOk(await request.post('/api/chat', { headers, data: { bookingId: id, message: `${marker}-${role}` } }), `${who} posts`);
            }
            for (const [who, headers, role] of controls) {
                const counted = await expectOk(await request.get(unread(id, role), { headers }), `${who} counts the collision booking as ${role}`);
                expect(counted.body.unreadCount, `${who}: the other side's one message is the one unread`).toBe(1);
            }
            for (const [who, headers, role] of refused) {
                await expectForbidden(await request.get(unread(id, role), { headers }), `${who} counts the collision booking as ${role}`);
            }
        });
    });

    // The case makes its own booking (customer 1's, assigned to provider 1) with one message from each side, so what it marks is its own and
    // goes with the booking; booking 2's fixture messages are only compared before and after (whatever their state when the case starts).
    // Red if the `userType !== caller.role` refusal is deleted (the customer would mark their own message read) or the participant
    // refusal is (customer 2 would mark the provider's message read).
    // On a second booking of the case's own, the collision booking (see collisionActors), the mark-read route's own copy of the participant test
    // is held with the id spaces crossed: provider1 (id 1 = the booking's user_id) and customer 2 (id 2 = the booking's provider_id) mark in
    // their own role, so the userType clause lets them through and only the participant test can refuse them; the flags show that nothing moved.
    // Red if the customer arm of that test stops testing the role (provider1 would mark the customer's message read) or the provider arm does
    // (customer 2 would mark the provider's message read). The owner and provider 2 are the controls: each is answered 200 and the flags show
    // what each marked.
    test("Ownership POST /api/chat/mark-read: booking 2, the other side's userType and a non-participant are 403 and change nothing; the customer of a booking marks the provider's message read and not their own", async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const { customer2, controls, refused } = await collisionActors(as, playwright, baseURL);
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
        await withCollisionBooking(request, as, async (id) => {
            const from = Object.fromEntries(controls.map(([, , role]) => [role, `e2e-ownership-mark-collision-${role}-${Date.now()}`]));
            for (const [who, headers, role] of controls) {
                await expectOk(await request.post('/api/chat', { headers, data: { bookingId: id, message: from[role] } }), `${who} posts`);
            }
            const unreadBoth = { [from.customer]: 0, [from.provider]: 0 };
            expect(await flags(id), 'the collision booking: both messages start unread').toEqual(unreadBoth);
            for (const [who, headers, role] of refused) {
                await expectForbidden(await request.post('/api/chat/mark-read', { headers, data: { bookingId: id, userType: role } }), `${who} marks the collision booking as ${role}`);
            }
            expect(await flags(id), 'the collision booking: both messages are still unread after the refused requests').toEqual(unreadBoth);
            // The owner marks as the customer side, which reads the provider's message; provider 2 marks as the provider side, which reads the customer's.
            const afterEach = [{ [from.customer]: 0, [from.provider]: 1 }, { [from.customer]: 1, [from.provider]: 1 }];
            for (const [index, [who, headers, role]] of controls.entries()) {
                await expectOk(await request.post('/api/chat/mark-read', { headers, data: { bookingId: id, userType: role } }), `${who} marks the collision booking as ${role}`);
                expect(await flags(id), `the collision booking: the flags after ${who} marks as ${role}`).toEqual(afterEach[index]);
            }
        });
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// POST /api/mobile/push-token. Clause: the body's userId must equal caller.id and a named userType must equal caller.role, else 403
// (the row written is the caller's, in the column of the caller's role; an admin may also name 'customer', which is what the app
// sends for every role that is not a provider, and what is stored is caller.role: design Amendment 7). The column comes from caller.role
// and a new row's user_type is caller.role, whatever the body names (route.js:29, :54), so the userId and userType comparisons decide
// the status and not the row: a request that contradicts the credential is a 403, where without them it would be a 200 that writes the
// caller's own row. A mobile login that finds that row (the same account on the same device_id) updates it and stores the account's type
// (auth/mobile/login/route.js:138-149), and the refresh route takes its token's role from the account row (auth/mobile/refresh/route.js:40-50):
// e2e/mobile-refresh-role.spec.js reads the row back through a registration, a sign-in and a refresh; what the cases here show is the status,
// the saved message and the refusals.
// ---------------------------------------------------------------------------------------------------------------------
test.describe('Ownership: mobile/push-token', () => {
    const tokenBody = (userId, userType) => ({ userId, ...(userType ? { userType } : {}), pushToken: `e2e-ownership-token-${Date.now()}`, platform: 'android', deviceId: 'e2e-ownership' });

    test('Ownership POST /api/mobile/push-token: a caller registers a token for their own id and role', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const cases = [['customer1 by cookie', as.customer, CUSTOMER1.id, 'customer'], ['customer1 by Bearer', as.customerBearer, CUSTOMER1.id, undefined], ['provider1 by cookie', as.provider, PROVIDER1.id, 'provider'], ['provider1 by Bearer', as.providerBearer, PROVIDER1.id, 'provider'],
            // The admin signed in on the app registers a token like any role, and the app names 'customer' for it: red if admin leaves the row's roles
            // (403 for each) or if the type check refuses what the app sends.
            ['admin by Bearer, naming the type the app sends (customer)', as.adminBearer, ADMIN.id, 'customer'], ['admin by cookie, naming its own type', as.admin, ADMIN.id, 'admin'], ['admin by Bearer, no type', as.adminBearer, ADMIN.id, undefined]];
        for (const [who, headers, userId, userType] of cases) {
            const { body } = await expectOk(await request.post('/api/mobile/push-token', { headers, data: tokenBody(userId, userType) }), who);
            expect(body.message, `${who}: message`).toBe('FCM / Push token saved successfully');
        }
    });

    // Red if the userId comparison is deleted, or the userType comparison is: the request is answered 200 where this case expects 403, and it
    // writes the caller's own row, not another account's (the account and column come from caller.id and caller.role, route.js:29, :34 and :54, and a
    // new row's type is caller.role, :54; the body's userId and userType are never written). Red too if the admin's nameable types widen (an admin
    // naming 'provider', a customer or provider naming 'admin').
    test("Ownership POST /api/mobile/push-token: a userId naming another account, or the other id space's type, is 403", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const refused = [
            ['customer1 naming customer 2', as.customer, tokenBody(CUSTOMER2.id, 'customer')],
            ['customer1 naming account 2 with no type', as.customerBearer, tokenBody(CUSTOMER2.id)],
            ['provider1 naming provider 2', as.provider, tokenBody(PROVIDER2.id, 'provider')],
            ['provider1 naming provider 2 by Bearer', as.providerBearer, tokenBody(PROVIDER2.id, 'provider')],
            ['customer1 naming its own id as a provider', as.customer, tokenBody(CUSTOMER1.id, 'provider')],
            ['provider1 naming its own id as a customer', as.provider, tokenBody(PROVIDER1.id, 'customer')],
            ['customer1 naming the admin\'s id', as.customer, tokenBody(ADMIN.id, 'customer')],
            ['admin naming customer 1\'s id with a type it may name', as.adminBearer, tokenBody(CUSTOMER1.id, 'customer')],
            ['admin naming the provider type on its own id', as.admin, tokenBody(ADMIN.id, 'provider')],
            ['customer1 naming the admin type on its own id', as.customer, tokenBody(CUSTOMER1.id, 'admin')],
            ['provider1 naming the admin type on its own id', as.provider, tokenBody(PROVIDER1.id, 'admin')],
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

    // customer1, provider1 and customer 2 each set dark_mode_enabled on their own row, and the other two stay off (customer 1 and provider 1 are
    // both id 1, in two tables; customer 2 is id 2). Red if the table is not chosen by the caller's role (a `users` lookup for everyone turns
    // customer 1's flag on for provider 1's write; a `service_providers` one turns provider 1's on for customer 1's), or if the UPDATE's id is
    // not caller.id: a literal 2 puts customer 1's and provider 1's flags on row 2, so the reads after their writes miss them; a literal 1 is
    // shown by customer 2's write alone (for the other two caller.id is 1): customer 1's flag turns on and customer 2's stays off, so the three
    // reads give [true, false, false] where [false, false, true] is expected. The flags are cleared again in the body and in `finally`.
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
            await expectOk(await set(customer2, true), 'customer 2 sets it');
            expect([await dark(as.customer, 'customer1'), await dark(as.provider, 'provider1'), await dark(customer2, 'customer 2')], "only customer 2's row is on (customer 1 and provider 1 are the id 1, customer 2 the id 2)").toEqual([false, false, true]);
            await expectOk(await set(customer2, false), 'customer 2 clears it');
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
            await set(customer2, false);
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
    // jobs and bookings are read from the fixture bookings (booking 1 is provider 1's, booking 2 provider 2's). available-jobs cannot be: it lists the
    // caller's own assignments only while they are `pending` or `matching`, and unassigned rows in the open statuses, and both fixture bookings are
    // `completed` and assigned, so a leg built on them holds nothing and passes whatever provider the list is bound to. Its leg, after the loop, uses
    // two probe bookings the admin assigns, one to each provider (the route moves an assigned booking to `matching`): each provider's list must hold
    // the probe assigned to them (a row with its id and booking number) and not the other's. Red if the list's provider is not the caller: a literal 1
    // at `providerId = auth.caller.id` (provider 2's list loses its probe and shows provider 1's), a literal 2 there (provider 1's list loses its probe
    // and shows provider 2's), or the `b.provider_id = ?` arm deleted (neither list holds its own assignment). The jobs and bookings legs are as they were.
    test("Ownership GET /api/provider/jobs, GET /api/provider/bookings and GET /api/provider/available-jobs: provider1's lists hold booking 1 and none of booking 2", async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const provider2 = await signedInAs(playwright, baseURL, 'provider2');
        const lists = [
            ['/api/provider/jobs', [BOOKING1.booking_number, BOOKING1.address_line1], [BOOKING2.booking_number, BOOKING2.address_line1, BOOKING2.job_description, 'Customer Two'], [BOOKING2.booking_number, BOOKING2.address_line1]],
            ['/api/provider/bookings', ['Customer One'], ['Customer Two'], ['Customer Two']],
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

        // available-jobs: a probe booking assigned to each provider. A list holds a probe when `data` has a row with its id and booking number.
        const listPath = '/api/provider/available-jobs';
        await withProbeBooking(request, as, async (idFor1) => {
            await withProbeBooking(request, as, async (idFor2) => {
                await adminUpdates(request, as, idFor1, { provider_id: PROVIDER1.id });
                await adminUpdates(request, as, idFor2, { provider_id: PROVIDER2.id });
                const [probe1, probe2] = [await bookingAsAdmin(request, as, idFor1), await bookingAsAdmin(request, as, idFor2)];
                expect([probe1.provider_id, probe2.provider_id], 'the probe bookings are assigned to provider 1 and to provider 2').toEqual([PROVIDER1.id, PROVIDER2.id]);
                for (const probe of [probe1, probe2]) {
                    expect(typeof probe.booking_number, `probe booking ${probe.id} has a booking number to look for`).toBe('string');
                    expect(['pending', 'matching'], `probe booking ${probe.id} is in a status the list's own-assignment arm lists`).toContain(probe.status);
                }
                // The control: provider 2's list holds the probe assigned to provider 2 and not provider 1's.
                const control = await expectOk(await request.get(listPath, { headers: provider2 }), `control: provider 2 ${listPath}`);
                expect(control.body.data.find((job) => job.id === idFor2)?.booking_number, `control: provider 2's list holds the booking assigned to provider 2 (id ${idFor2})`).toBe(probe2.booking_number);
                expect(control.body.data.map((job) => job.id), `control: provider 2's list holds the booking assigned to provider 1 (id ${idFor1})`).not.toContain(idFor1);
                expectNoneOf(control.text, [probe1.booking_number], `control: provider 2 ${listPath}, the booking assigned to provider 1`);
                // Provider 1, by cookie and by Bearer: the probe assigned to provider 1 and not provider 2's, nor any string of booking 2.
                for (const [style, headers] of providerStyles(as)) {
                    const who = `provider1 by ${style} ${listPath}`;
                    const { text, body } = await expectOk(await request.get(listPath, { headers }), who);
                    expect(body.data.find((job) => job.id === idFor1)?.booking_number, `${who}: the list holds the booking assigned to provider 1 (id ${idFor1})`).toBe(probe1.booking_number);
                    expect(body.data.map((job) => job.id), `${who}: the list holds the booking assigned to provider 2 (id ${idFor2})`).not.toContain(idFor2);
                    expectNoneOf(text, [probe2.booking_number, ...BOOKING2_STRINGS, 'Customer Two'], who);
                }
            });
        });
    });

    // POST claims an open job. A booking another provider has is not claimable (the route's own 409 and nothing changes), an open one
    // becomes the claiming provider's: provider 1 claims one open probe booking and provider 2 another, and the stored provider is read back as
    // the admin. Provider 1's id is also what a literal 1 in the claim's UPDATE (bound to [providerId, booking_id]) would store, so only provider 2's
    // claim tells the caller from the literal. Red if that bind is a literal 1 (the booking provider 2 claimed reads back provider 1: the provider-2
    // assertion fails on 1, not 2) or a literal 2 (the booking provider 1 claimed reads back provider 2: the provider-1 assertion fails on 2, not 1).
    test("Ownership POST /api/provider/available-jobs: provider1 claims an open booking and it becomes theirs; booking 2 stays provider 2's; a missing booking keeps its 404", async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const provider2 = await signedInAs(playwright, baseURL, 'provider2');
        await expectAnswer(await request.post('/api/provider/available-jobs', { headers: as.provider, data: { booking_id: BOOKING2.id } }), 409, 'Job already accepted by another provider', 'provider1 claims booking 2');
        const booking2 = await bookingAsAdmin(request, as, BOOKING2.id);
        expect([booking2.provider_id, booking2.status], "booking 2 after the refused claim").toEqual([PROVIDER2.id, BOOKING2.status]);
        await expectAnswer(await request.post('/api/provider/available-jobs', { headers: as.providerBearer, data: { booking_id: MISSING } }), 404, 'Job not found', 'provider1, missing booking');
        await withProbeBooking(request, as, async (id) => {
            await expectOk(await request.post('/api/provider/available-jobs', { headers: as.provider, data: { booking_id: id } }), 'provider1 claims the open booking');
            expect((await bookingAsAdmin(request, as, id)).provider_id, 'the claimed booking is provider 1\'s').toBe(PROVIDER1.id);
        });
        await withProbeBooking(request, as, async (id) => {
            await expectOk(await request.post('/api/provider/available-jobs', { headers: provider2, data: { booking_id: id } }), 'provider2 claims the open booking');
            expect((await bookingAsAdmin(request, as, id)).provider_id, 'the booking provider 2 claimed is stored with provider 2\'s id (2), not provider 1\'s (1)').toBe(PROVIDER2.id);
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

// ---------------------------------------------------------------------------------------------------------------------
// ENG-023 hop 2 (builder V): POST and PUT /api/provider/availability, PUT /api/provider/profile. Rows with NO foreign parameter:
// the provider id is `caller.id` only (availability/route.js:42 `const providerId = caller.id;`, bound at :49 and :65 in
// `WHERE id = ?`; profile/route.js:267 `const providerId = caller.id`, bound in the two uniqueness checks :277 and :280, in the
// UPDATE at :300 and in the echo SELECT at :323). Neither route reads a `users` row, so the two overlapping id spaces (customer 1
// and provider 1 are both id 1) matter here only as "the literal 1 is provider 1's id". A body that names another account
// (`provider_id`, `providerId`, `id`, `user_id`: the names a handler might read) is sent on purpose and must move nothing.
// Each case: provider 2 writes (provider 2 is the foreign account for the default credential), a READ shows the row that moved is
// provider 2's and provider 1's is what it was before; then provider 1 writes by cookie and by Bearer and provider 2's row is
// what it was; provider 2's and provider 1's rows are put back in `finally`.
// ---------------------------------------------------------------------------------------------------------------------
test.describe('Ownership: provider/availability and provider/profile writes', () => {
    // The flag as GET /api/provider/availability shows it to the provider who asks (availability/route.js:11-19): a boolean.
    const flagOf = async (request, headers, who) => (await expectOk(await request.get('/api/provider/availability', { headers }), who)).body.is_available;
    // Every id-shaped field name a handler might read, all naming `other`.
    const naming = (other) => ({ provider_id: other.id, providerId: other.id, id: other.id, user_id: other.id });
    // One case per verb: POST and PUT both end in handleToggle (availability/route.js:30 and :36 -> :40).
    const availabilityCase = (method) => async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const provider2 = await signedInAs(playwright, baseURL, 'provider2');
        const send = (headers, data) => request[method.toLowerCase()]('/api/provider/availability', { headers, data });
        const before1 = await flagOf(request, as.provider, 'provider1 reads their flag before');
        const before2 = await flagOf(request, provider2, 'provider2 reads their flag before');
        try {
            // Provider 2 flips THEIR flag; the body names provider 1 in every id field.
            const moved = await expectOk(await send(provider2, { is_available: !before2, ...naming(PROVIDER1) }), `provider2 ${method}s their flag`);
            expect(moved.body.is_available, `provider2 ${method}: the answer`).toBe(!before2);
            expect(moved.body.message, `provider2 ${method}: the answer's message`).toBe(`You are now ${before2 ? 'Offline' : 'Online'}`);
            expect(await flagOf(request, provider2, 'provider2 reads their flag after'), "provider 2's flag after provider 2's own write").toBe(!before2);
            for (const [style, headers] of providerStyles(as)) {
                expect(await flagOf(request, headers, `provider1 by ${style} reads their flag`), `provider 1's flag after provider 2's ${method} (read by provider1 by ${style})`).toBe(before1);
            }
            await expectOk(await send(provider2, { is_available: before2 }), 'provider2 puts their flag back');
            expect(await flagOf(request, provider2, 'provider2 reads their flag put back'), "provider 2's flag put back").toBe(before2);
            // Provider 1 flips THEIR flag, by cookie and by Bearer; the body names provider 2 in every id field.
            for (const [style, headers] of providerStyles(as)) {
                const current = await flagOf(request, headers, `provider1 by ${style} reads their flag`);
                const own = await expectOk(await send(headers, { is_available: !current, ...naming(PROVIDER2) }), `provider1 by ${style} ${method}s their flag`);
                expect(own.body.is_available, `provider1 by ${style} ${method}: the answer`).toBe(!current);
                expect(await flagOf(request, headers, `provider1 by ${style} reads their flag after`), `provider 1's flag after provider 1's own ${method} by ${style}`).toBe(!current);
                expect(await flagOf(request, provider2, 'provider2 reads their flag'), `provider 2's flag after provider 1's ${method} by ${style}`).toBe(before2);
            }
        } finally {
            await send(provider2, { is_available: before2 });
            await send(as.provider, { is_available: before1 });
        }
    };

    // Red if availability/route.js:42 `const providerId = caller.id;` becomes `const providerId = 1;` (provider 2's write lands on provider 1's
    // row: provider 2's flag stays, provider 1's moves) or takes the id from the body (`provider_id` ?? caller.id: the same, and provider
    // 1's write naming provider 2 moves provider 2's flag).
    test("Ownership POST /api/provider/availability: provider2's toggle moves provider 2's flag and not provider 1's, and provider1's toggle by cookie and Bearer leaves provider 2's flag alone, whatever ids the body names", availabilityCase('POST'));
    // The same clause through the PUT export (availability/route.js:33-37), which has its own guard lines and shares handleToggle.
    test("Ownership PUT /api/provider/availability: provider2's toggle moves provider 2's flag and not provider 1's, and provider1's toggle by cookie and Bearer leaves provider 2's flag alone, whatever ids the body names", availabilityCase('PUT'));

    // Red if profile/route.js:267 `const providerId = caller.id` becomes `1` or reads the body's id: provider 2's own email is then "in use" by
    // another id (the uniqueness check at :277 finds row 2 with `id != 1`), so provider 2's write answers 400. Red if the UPDATE's last bind (:300)
    // stops being providerId: the write lands on another row and the answer, read by `WHERE id = ?` at :323, lacks the marker. Red if the echo
    // SELECT's bind (:323) stops being providerId: the answer carries provider 1's email.
    test("Ownership PUT /api/provider/profile: provider2 writes provider 2's profile and not provider 1's, and provider1's write by cookie and Bearer leaves provider 2's profile alone, whatever ids the body names", async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const provider2 = await signedInAs(playwright, baseURL, 'provider2');
        const profileOf = async (headers, who) => (await expectOk(await request.get('/api/provider/profile', { headers }), who)).body.data;
        // A PUT body that writes a row back as GET read it. GET turns a NULL service_cities or skills into [] and the PUT stores [] as '[]', so an
        // empty list is left out (NULL stays NULL); an empty text field is null on both sides.
        const bodyOf = (row, over = {}) => ({
            name: row.name, email: row.email, phone: row.phone, specialty: row.specialty, experience_years: row.experience_years,
            bio: row.bio, location: row.location, city: row.city,
            service_cities: row.service_cities.length ? row.service_cities : undefined, skills: row.skills.length ? row.skills : undefined, ...over,
        });
        const OTHERS_OF_2 = [PROVIDER1.email, PROVIDER1.phone, PROVIDER1.name, CUSTOMER1.email, CUSTOMER1.phone, 'Customer One'];
        const OTHERS_OF_1 = [PROVIDER2.email, PROVIDER2.phone, PROVIDER2.name, CUSTOMER2.email, CUSTOMER2.phone, 'Customer Two'];
        const before1 = await profileOf(as.provider, 'provider1 reads their profile before');
        const before2 = await profileOf(provider2, 'provider2 reads their profile before');
        expect(before1.id, 'the control: provider 1 reads provider 1').toBe(PROVIDER1.id);
        expect(before2.id, 'the control: provider 2 reads provider 2').toBe(PROVIDER2.id);
        const marker = `e2e-ownership-profile-${Date.now()}`;
        try {
            // Provider 2 writes THEIR profile (a marker in bio and location); the body names provider 1 in every id field.
            const put2 = await expectOk(await request.put('/api/provider/profile', { headers: provider2, data: { ...bodyOf(before2, { bio: marker, location: marker }), ...naming(PROVIDER1) } }), 'provider2 writes their profile');
            expect(put2.body.data.id, "the answer is provider 2's row").toBe(PROVIDER2.id);
            expect(put2.body.data.email, "the answer carries provider 2's email").toBe(PROVIDER2.email);
            expect(put2.body.data.bio, "the answer carries provider 2's marker").toBe(marker);
            expectNoneOf(put2.text, OTHERS_OF_2, 'provider2 writes their profile');
            const after2 = await profileOf(provider2, 'provider2 reads their profile after');
            expect(after2.bio, "provider 2's bio after their own write").toBe(marker);
            expect(after2.location, "provider 2's location after their own write").toBe(marker);
            for (const [style, headers] of providerStyles(as)) {
                expect(await profileOf(headers, `provider1 by ${style} reads their profile`), `provider 1's whole profile after provider 2's write (read by provider1 by ${style})`).toEqual(before1);
            }
            // Provider 1 writes THEIR profile, by cookie and by Bearer; the body names provider 2 in every id field.
            for (const [style, headers] of providerStyles(as)) {
                const own = `${marker}-p1-${style}`;
                const put1 = await expectOk(await request.put('/api/provider/profile', { headers, data: { ...bodyOf(before1, { bio: own, location: own }), ...naming(PROVIDER2) } }), `provider1 by ${style} writes their profile`);
                expect(put1.body.data.id, `provider1 by ${style}: the answer is provider 1's row`).toBe(PROVIDER1.id);
                expect(put1.body.data.email, `provider1 by ${style}: the answer carries provider 1's email`).toBe(PROVIDER1.email);
                expect(put1.body.data.bio, `provider1 by ${style}: the answer carries provider 1's marker`).toBe(own);
                expectNoneOf(put1.text, OTHERS_OF_1, `provider1 by ${style} writes their profile`);
                expect((await profileOf(headers, `provider1 by ${style} reads their profile after`)).bio, `provider 1's bio after their own write by ${style}`).toBe(own);
                expect(await profileOf(provider2, 'provider2 reads their profile'), `provider 2's whole profile after provider 1's write by ${style}`).toEqual(after2);
            }
        } finally {
            await request.put('/api/provider/profile', { headers: provider2, data: bodyOf(before2) });
            await request.put('/api/provider/profile', { headers: as.provider, data: bodyOf(before1) });
        }
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// POST /api/provider/onboarding/profile, /onboarding/update-step, /onboarding/stripe-complete and POST /api/provider/upload
// (ENG-023 hop 2). None of these routes takes a row to act on: the provider id is auth.caller.id and nothing the request
// carries, so there is no foreign id to send. What a case can show is the other half of the clause: the provider who calls moves
// THEIR OWN row. The cases act as provider 2 (signedInAs; the default credential, provider 1, is then the row that must not move),
// read provider 1's /api/provider/me and /api/provider/onboarding/documents answers before and after and require the text to be
// byte for byte the same, and then do the same the other way round (provider 1 writes, provider 2's row stays). A body that names
// provider 1 (id, provider_id, providerId) is sent with provider 2's writes: the handlers destructure only their own fields
// (profile route.js:11, update-step :11, stripe-complete :18), so those keys are never read.
// Clauses (HEAD): onboarding/profile/route.js:8 and the UPDATE's last bind :39; onboarding/update-step/route.js:8 and :27;
// onboarding/stripe-complete/route.js:11, the fallback lookup :23-26, the UPDATE :93 and the INSERT :107; provider/upload/route.js:116,
// the file name :144, the INSERT :162, the avatar UPDATE :169 and the count :177-179.
// No wrong-table hazard in these handlers: they read and write service_providers and provider_* tables only, so the overlap of
// provider 1 and customer 1 (both id 1) never decides a row, and the cases are provider against provider.
// What a write leaves behind: update-step restores onboarding_step in `finally` (it needs a truthy step), profile is put back with
// PUT /api/provider/profile, uploaded files are unlinked from public/uploads. Rows no public route removes stay until the fixtures
// are reloaded: provider_documents rows (upload), documents_uploaded and avatar_url of provider 2 (upload), the provider_bank_accounts
// row and stripe_account_id of provider 2 (stripe-complete), activity-log rows.
// NOT covered, and why (read from the code and the fixtures):
//   POST /api/provider/onboarding/create-stripe-account  after the provider lookup (route.js:29-32) every path except the 404 at
//        :34-39 calls Stripe (:51 or :73); the only stop before Stripe is the body read failing (:17), which comes before providerId
//        is used, and the 404 needs a session for a provider row that does not exist. No request can be shown to stop before Stripe
//        while depending on the owner, so none is sent.
//   POST /api/provider/onboarding/upload-document  both fixture providers have documents_verified = 1 (database/fixtures/accounts.js),
//        so route.js:35-40 answers 403 'Documents already verified, cannot modify' for either of them before any write: the lookup
//        at :30-33 cannot be told from one bound to the other provider, and the success path is unreachable. The only public path
//        that clears the flag (admin reject_all, admin/providers/[providerId]/documents/route.js) says in its own comment that it
//        notifies the provider by email, and resets other flags that cannot be put back.
//   POST onboarding/complete and GET onboarding/stripe-return are not sendable from a provider (ticket rule 71).
// ---------------------------------------------------------------------------------------------------------------------
test.describe('Ownership: provider onboarding writes and provider/upload', () => {
    const tag = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    // The provider row as the provider's own two reads show it, kept as text so "byte for byte" is a string comparison:
    // /me (bio, specialty, city, location, cities, skills, avatar_url, flags) and /onboarding/documents (the documents, the
    // counts, onboarding_step).
    async function rowOf(request, headers, who) {
        const me = await expectOk(await request.get('/api/provider/me', { headers }), `${who} reads /me`);
        const docs = await expectOk(await request.get('/api/provider/onboarding/documents', { headers }), `${who} reads /onboarding/documents`);
        return { me: me.text, docs: docs.text, row: me.body.provider, documents: docs.body.documents, provider: docs.body.provider };
    }

    // update-step needs a truthy step, so a start step of 0 or NULL cannot be put back by it (the fixtures are reloaded after the run).
    async function stepBack(request, headers, original) {
        if (original) await request.post('/api/provider/onboarding/update-step', { headers, data: { step: original } });
    }

    // Puts the fields onboarding/profile wrote back through PUT /api/provider/profile (it writes NULL for what is not sent).
    async function profileBack(request, headers, account, original) {
        const asArray = (value) => {
            if (value === null || value === undefined) return undefined;
            try {
                const parsed = typeof value === 'string' ? JSON.parse(value) : value;
                return Array.isArray(parsed) ? parsed : undefined;
            } catch {
                return undefined;
            }
        };
        await request.put('/api/provider/profile', {
            headers,
            data: {
                name: account.name, email: account.email, phone: account.phone,
                specialty: original.specialty ?? undefined, experience_years: original.experience_years ?? undefined,
                bio: original.bio ?? undefined, location: original.location ?? undefined, city: original.city ?? undefined,
                service_cities: asArray(original.service_cities), skills: asArray(original.skills),
            },
        });
    }

    // The keys a request could use to name provider 1 as the row to write: none of the handlers reads them.
    const NAMING_PROVIDER1 = { id: PROVIDER1.id, provider_id: PROVIDER1.id, providerId: PROVIDER1.id };

    // Red if onboarding/profile/route.js:8 `const providerId = auth.caller.id;` reads the row from the body instead (`request.json()`
    // .id), or the UPDATE's last bind (:39) is a literal 1: provider 2's call would write provider 1's row, so provider 2 would
    // keep its start bio and provider 1's /me would carry provider 2's marker.
    test("Ownership POST /api/provider/onboarding/profile: provider2 writes only provider 2's row (a body naming provider 1 is ignored) and provider1 only provider 1's", async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const p2 = await signedInAs(playwright, baseURL, 'provider2');
        const before1 = await rowOf(request, as.provider, 'provider1');
        const before2 = await rowOf(request, p2, 'provider2');
        const key = tag();
        const mine = (n) => ({ bio: `E2E ownership onboarding bio ${n} ${key}`, specialty: `e2e-specialty-${n}`, experience_years: 40 + n, city: `E2E City ${n}`, location: `E2E Location ${n}`, service_cities: [], skills: [`e2e-skill-${n}`] });
        try {
            const wrote = await expectOk(await request.post('/api/provider/onboarding/profile', { headers: p2, data: { ...mine(2), ...NAMING_PROVIDER1 } }), 'provider2 writes the onboarding profile');
            expect(wrote.body.message, 'provider2 write: message').toBe('Profile updated successfully');
            const after2 = await rowOf(request, p2, 'provider2 after its write');
            expect(after2.row.bio, "provider 2's bio is the marker").toBe(mine(2).bio);
            expect(after2.row.specialty, "provider 2's specialty").toBe('e2e-specialty-2');
            expect(Number(after2.row.experience_years), "provider 2's experience_years").toBe(42);
            expect(after2.row.city, "provider 2's city").toBe('E2E City 2');
            expect(after2.row.location, "provider 2's location").toBe('E2E Location 2');
            expect(after2.me, "provider 2's skills").toContain('e2e-skill-2');
            expect(Number(after2.provider.onboarding_step), "provider 2's onboarding_step (route.js sets 2)").toBe(2);
            const after1 = await rowOf(request, as.provider, 'provider1 after provider 2 wrote');
            expect(after1.me, "provider 1's /me is byte for byte what it was").toBe(before1.me);
            expect(after1.docs, "provider 1's /onboarding/documents is byte for byte what it was").toBe(before1.docs);
            expectNoneOf(after1.me + after1.docs, [mine(2).bio, 'e2e-specialty-2', 'e2e-skill-2'], 'provider1 after provider 2 wrote');

            // The other way round: provider 1 writes, provider 2's row stays what provider 2's own write left.
            await expectOk(await request.post('/api/provider/onboarding/profile', { headers: as.provider, data: mine(1) }), 'provider1 writes the onboarding profile');
            const again1 = await rowOf(request, as.provider, 'provider1 after its write');
            expect(again1.row.bio, "provider 1's bio is the marker").toBe(mine(1).bio);
            expect(again1.row.city, "provider 1's city").toBe('E2E City 1');
            const again2 = await rowOf(request, p2, 'provider2 after provider 1 wrote');
            expect(again2.me, "provider 2's /me is what its own write left").toBe(after2.me);
            expect(again2.docs, "provider 2's /onboarding/documents is what its own write left").toBe(after2.docs);
        } finally {
            await profileBack(request, p2, PROVIDER2, before2.row);
            await profileBack(request, as.provider, PROVIDER1, before1.row);
            await stepBack(request, p2, before2.provider.onboarding_step);
            await stepBack(request, as.provider, before1.provider.onboarding_step);
        }
        // Reached only when every assertion above held: both rows are back to where they started.
        const end1 = await rowOf(request, as.provider, 'provider1 at the end');
        const end2 = await rowOf(request, p2, 'provider2 at the end');
        expect(end1.row, "provider 1's row is back to its start").toEqual(before1.row);
        expect(end2.row, "provider 2's row is back to its start").toEqual(before2.row);
        expect(end1.provider.onboarding_step, "provider 1's step is back").toEqual(before1.provider.onboarding_step);
        expect(end2.provider.onboarding_step, "provider 2's step is back").toEqual(before2.provider.onboarding_step);
    });

    // Red if update-step/route.js:8 `const providerId = auth.caller.id;` takes the row from the body (`id`), or the bind at :27 is a
    // literal 1: provider 2's step would land on provider 1's row (and the echo `step` alone would still look right).
    test("Ownership POST /api/provider/onboarding/update-step: provider2 moves only provider 2's onboarding_step (a body naming provider 1 is ignored) and provider1 only provider 1's", async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const p2 = await signedInAs(playwright, baseURL, 'provider2');
        const before1 = await rowOf(request, as.provider, 'provider1');
        const before2 = await rowOf(request, p2, 'provider2');
        expect([6, 7], 'the probe steps differ from the start steps').not.toContain(Number(before1.provider.onboarding_step));
        expect([6, 7], 'the probe steps differ from the start steps').not.toContain(Number(before2.provider.onboarding_step));
        try {
            const wrote = await expectOk(await request.post('/api/provider/onboarding/update-step', { headers: p2, data: { step: 7, ...NAMING_PROVIDER1 } }), 'provider2 moves its step');
            expect(wrote.body.step, 'provider2: the echo').toBe(7);
            expect(wrote.body.message, 'provider2: message').toBe('Onboarding step updated successfully');
            const after2 = await rowOf(request, p2, 'provider2 after its write');
            expect(Number(after2.provider.onboarding_step), "provider 2's onboarding_step is 7").toBe(7);
            const after1 = await rowOf(request, as.provider, 'provider1 after provider 2 wrote');
            expect(after1.docs, "provider 1's /onboarding/documents is byte for byte what it was").toBe(before1.docs);
            expect(after1.me, "provider 1's /me is byte for byte what it was").toBe(before1.me);
            expect(Number(after1.provider.onboarding_step), "provider 1's onboarding_step is its start value").toBe(Number(before1.provider.onboarding_step));

            // The other way round.
            await expectOk(await request.post('/api/provider/onboarding/update-step', { headers: as.provider, data: { step: 6 } }), 'provider1 moves its step');
            const again1 = await rowOf(request, as.provider, 'provider1 after its write');
            expect(Number(again1.provider.onboarding_step), "provider 1's onboarding_step is 6").toBe(6);
            const again2 = await rowOf(request, p2, 'provider2 after provider 1 wrote');
            expect(again2.docs, "provider 2's row is what its own write left").toBe(after2.docs);
            expect(again2.me, "provider 2's /me is what its own write left").toBe(after2.me);
        } finally {
            await stepBack(request, p2, before2.provider.onboarding_step);
            await stepBack(request, as.provider, before1.provider.onboarding_step);
        }
        const end1 = await rowOf(request, as.provider, 'provider1 at the end');
        const end2 = await rowOf(request, p2, 'provider2 at the end');
        expect(end1.docs, "provider 1's row is back to its start").toBe(before1.docs);
        expect(end2.docs, "provider 2's row is back to its start").toBe(before2.docs);
    });

    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const uploadAs = (request, headers, type) => request.post('/api/provider/upload', { headers, multipart: { file: { name: 'e2e-ownership.png', mimeType: 'image/png', buffer: PNG }, type } });

    // Red if upload/route.js:116 `const providerId = auth.caller.id` is replaced by a literal 1 or a body field: the file name
    // (:144, answered as `url`), the document row (:162), the avatar (:169) and the documents_uploaded count (:177-179) would all be
    // provider 1's. The type is one of the provider_documents.document_type ENUM values (database/schema.sql:132; any other word is
    // 'Data truncated' at the INSERT, after the file is written), never a path: the traversal on `type` is an open proposal, not this
    // case. The files are 70-byte PNGs that land in public/uploads/<id>-<type>-<ms>.png and are unlinked in `finally`: every file of
    // that shape made at or after the case's start, which also removes a file a failed request left behind.
    test("Ownership POST /api/provider/upload: provider2's file name, document rows, count and avatar are provider 2's, provider 1's row is unchanged, and provider1's upload is provider 1's", async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const p2 = await signedInAs(playwright, baseURL, 'provider2');
        const before1 = await rowOf(request, as.provider, 'provider1');
        const before2 = await rowOf(request, p2, 'provider2');
        expect(before2.documents, 'provider 2 starts with no documents (an earlier run of this case leaves rows of provider 2 that no route removes: run `npm run db:fixtures` first)').toEqual([]);
        expect(before2.row.avatar_url, 'provider 2 starts without an avatar (an earlier run of this case leaves rows of provider 2 that no route removes: run `npm run db:fixtures` first)').toBeNull();
        const startedAt = Date.now() - 1000;
        try {
            const first = await expectOk(await uploadAs(request, p2, 'other'), 'provider2 uploads a document');
            expect(first.body.url, "provider 2's file name starts with provider 2's id").toMatch(/^\/uploads\/2-other-\d+\.png$/);
            const photo = await expectOk(await uploadAs(request, p2, 'profile_photo'), 'provider2 uploads a profile photo');
            expect(photo.body.url, "provider 2's photo name starts with provider 2's id").toMatch(/^\/uploads\/2-profile_photo-\d+\.png$/);

            const after2 = await rowOf(request, p2, 'provider2 after its uploads');
            expect(after2.documents.map((d) => [d.provider_id, d.document_type, d.document_url, d.status]).sort(), "provider 2's two document rows").toEqual(
                [[2, 'other', first.body.url, 'pending'], [2, 'profile_photo', photo.body.url, 'pending']].sort());
            expect(Number(after2.provider.documents_uploaded), "provider 2's documents_uploaded is the count of its own rows (fixture: 1)").toBe(2);
            expect(after2.row.avatar_url, "provider 2's avatar is its photo").toBe(photo.body.url);
            const after1 = await rowOf(request, as.provider, 'provider1 after provider 2 uploaded');
            expect(after1.me, "provider 1's /me is byte for byte what it was").toBe(before1.me);
            expect(after1.docs, "provider 1's /onboarding/documents is byte for byte what it was").toBe(before1.docs);

            // The other way round: provider 1's upload is provider 1's, and provider 2's row stays what its own uploads left.
            const theirs = await expectOk(await uploadAs(request, as.provider, 'other'), 'provider1 uploads a document');
            expect(theirs.body.url, "provider 1's file name starts with provider 1's id").toMatch(/^\/uploads\/1-other-\d+\.png$/);
            const again1 = await rowOf(request, as.provider, 'provider1 after its upload');
            expect(again1.documents.map((d) => [d.provider_id, d.document_url]), "provider 1's one document row").toEqual([[1, theirs.body.url]]);
            expect(again1.row.avatar_url, "provider 1's avatar did not move").toEqual(before1.row.avatar_url);
            const again2 = await rowOf(request, p2, 'provider2 after provider 1 uploaded');
            expect(again2.me, "provider 2's /me is what its own uploads left").toBe(after2.me);
            expect(again2.docs, "provider 2's /onboarding/documents is what its own uploads left").toBe(after2.docs);
        } finally {
            const { readdir, unlink } = await import('node:fs/promises');
            const nodePath = await import('node:path');
            const folder = nodePath.join(process.cwd(), 'public', 'uploads');
            for (const name of await readdir(folder)) {
                const made = /^[12]-(other|profile_photo)-(\d+)\.png$/.exec(name);
                if (made && Number(made[2]) >= startedAt) {
                    try {
                        await unlink(nodePath.join(folder, name));
                    } catch (error) {
                        // A file that is already gone is fine; any other failure to remove one is the case's failure, not swallowed.
                        if (error.code !== 'ENOENT') throw error;
                    }
                }
            }
        }
    });

    // stripe-complete reaches Stripe only through `stripe` (route.js:6), which is null while STRIPE_SECRET_KEY is empty; :39-41 throws
    // before :42 `stripe.accounts.retrieve`, and :52-82 falls through to the writes. The `{}` requests stop at :29-35 whatever the key
    // is. So the case sends nothing unless the runner's list of the app's variable NAMES (E2E_APP_ENV_NAMES, never values) is defined
    // and lacks STRIPE_SECRET_KEY.
    // Red if stripe-complete/route.js:11 takes the row from the body, or the fallback lookup's bind (:24) is a literal 1 (provider 2's
    // `{}` would answer 400 and provider 1's would find provider 2's account), or the UPDATE's (:93) or the INSERT's (:107) provider
    // bind is a literal 1 (provider 1's row would carry step 4).
    test("Ownership POST /api/provider/onboarding/stripe-complete: provider2's account id lands on provider 2's row only and the fallback lookup is each caller's own (no request reaches Stripe)", async ({ request, baseURL, playwright }) => {
        const names = process.env.E2E_APP_ENV_NAMES;
        test.skip(names === undefined || names.split(',').map((name) => name.trim()).includes('STRIPE_SECRET_KEY'), 'the app has a Stripe key (or the runner did not list the names): stripe-complete would call Stripe');
        const as = await credentials(baseURL);
        const p2 = await signedInAs(playwright, baseURL, 'provider2');
        const before1 = await rowOf(request, as.provider, 'provider1');
        const before2 = await rowOf(request, p2, 'provider2');
        expect(Number(before1.provider.onboarding_step), 'provider 1 does not start on step 4').not.toBe(4);
        expect(Number(before2.provider.onboarding_step), 'provider 2 does not start on step 4').not.toBe(4);
        try {
            // Nobody has a payout account row yet: the fallback finds nothing and the route stops at :29-35, before Stripe and before any write.
            await expectAnswer(await request.post('/api/provider/onboarding/stripe-complete', { headers: as.provider, data: {} }), 400, 'Stripe account ID missing', 'provider1, no account yet (an earlier run of this case leaves rows of provider 2 that no route removes: run `npm run db:fixtures` first)');
            await expectAnswer(await request.post('/api/provider/onboarding/stripe-complete', { headers: p2, data: {} }), 400, 'Stripe account ID missing', 'provider2, no account yet (an earlier run of this case leaves rows of provider 2 that no route removes: run `npm run db:fixtures` first)');

            // provider 2 links an account id (the body also names provider 1 three ways): only provider 2's row moves.
            const linked = await expectOk(await request.post('/api/provider/onboarding/stripe-complete', { headers: p2, data: { accountId: 'acct_e2e_ownership_probe', ...NAMING_PROVIDER1 } }), 'provider2 links its account');
            expect(linked.body.step, 'provider2 link: step').toBe(4);
            expect(linked.body.isComplete, 'provider2 link: isComplete (no Stripe answer)').toBe(false);
            const after2 = await rowOf(request, p2, 'provider2 after linking');
            expect(Number(after2.provider.onboarding_step), "provider 2's onboarding_step is 4").toBe(4);
            const after1 = await rowOf(request, as.provider, 'provider1 after provider 2 linked');
            expect(after1.me, "provider 1's /me is byte for byte what it was").toBe(before1.me);
            expect(after1.docs, "provider 1's /onboarding/documents is byte for byte what it was").toBe(before1.docs);

            // Now provider 2 has an account row and provider 1 has none: the fallback lookup answers each caller's own.
            await expectAnswer(await request.post('/api/provider/onboarding/stripe-complete', { headers: as.provider, data: {} }), 400, 'Stripe account ID missing', "provider1 does not find provider 2's account");
            const found = await expectOk(await request.post('/api/provider/onboarding/stripe-complete', { headers: p2, data: {} }), "provider2 finds its own account through the fallback");
            expect(found.body.step, 'provider2 fallback: step').toBe(4);
            const end1 = await rowOf(request, as.provider, 'provider1 after the fallbacks');
            expect(end1.docs, "provider 1's row is still what it was").toBe(before1.docs);
        } finally {
            await stepBack(request, p2, before2.provider.onboarding_step);
            await stepBack(request, as.provider, before1.provider.onboarding_step);
        }
    });
});


// ---------------------------------------------------------------------------------------------------------------------
// ENG-023 hop 2 (the seat; builder V's report on this row died with the killed pass): POST /api/auth/change-password. The route takes no
// account from the request: the row is `caller.id` (auth/change-password/route.js:32, :52) in the table of the caller's ROLE (:27-30:
// `users` for a customer, `service_providers` for a provider). Customer 1 and provider 1 are both id 1, and before hop 1 the route looked in
// `users` first by the token's id, so a provider's call acted on the customer with that id.
// A success cannot be put back: every fixture password lacks a character the new-password rule demands (:17, a letter and one of
// !@#$%^&*(),.?":{}|<>), so a second change back to the fixture password is refused and no case lets a change succeed. What a case can
// send is a REFUSAL that only the right table gives: a new password that passes the rule, and an oldPassword that is the OTHER role's
// fixture password. The route's own check (:45) answers 401 'Incorrect current password' when the lookup is in the caller's own table, and
// a lookup in the wrong table would match, hash the new password and change the other account's password (a 200, which this case sees).
// The UPDATE (:52) is reached by no case.
// ---------------------------------------------------------------------------------------------------------------------
test.describe('Ownership: auth/change-password', () => {
    // Passes the rule at :17 (a letter, a special character, 8 or more characters); no request below may be accepted, so it is never set.
    const NEW_PASSWORD = 'e2e-ownership#probe';
    const change = (request, headers, oldPassword) => request.post('/api/auth/change-password', { headers, data: { oldPassword, newPassword: NEW_PASSWORD } });
    // Signs a fixture account in through its own login route in a context of its own (no cookie jar is shared with the requests above).
    const loginStatus = async (playwright, baseURL, who) => {
        const login = FIXTURE_LOGINS[who];
        const context = await playwright.request.newContext({ baseURL });
        try {
            return (await context.post(login.loginRoute, { data: { email: login.email, password: login.password }, maxRetries: RESET_RETRIES, timeout: 60_000 })).status();
        } finally {
            await context.dispose();
        }
    };

    // Red if change-password/route.js:27 `if (caller.role === 'provider') {` becomes `if (false) {` (every caller is looked up in `users`: provider 1's
    // request naming customer 1's password matches customer 1's hash and the answer is 200, customer 1's password changed) or `if (true) {` (every
    // caller is looked up in `service_providers`: customer 1's request naming provider 1's password matches and the answer is 200).
    test("Ownership POST /api/auth/change-password: the lookup is in the caller's own table, so a provider naming customer 1's password and a customer naming provider 1's are both refused 401 and nobody's password changes", async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        expect(CUSTOMER1.id, 'the control: customer 1 and provider 1 share an id, so only the role can tell the two tables apart').toBe(PROVIDER1.id);
        for (const [style, headers] of providerStyles(as)) {
            await expectAnswer(await change(request, headers, CUSTOMER1.password), 401, 'Incorrect current password', `provider1 by ${style} names customer 1's password`);
        }
        for (const [style, headers] of customerStyles(as)) {
            await expectAnswer(await change(request, headers, PROVIDER1.password), 401, 'Incorrect current password', `customer1 by ${style} names provider 1's password`);
        }
        // Nobody's password moved: both fixture logins still open with the fixture password.
        for (const who of ['customer1', 'provider1']) {
            expect(await loginStatus(playwright, baseURL, who), `${who} still signs in with its fixture password`).toBe(200);
        }
    });
});
