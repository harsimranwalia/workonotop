// @ts-check
// ENG-021 (design ENG-004, "The four defects" and "AC6 cross-account tests"): one named case per defect leg, so the
// baseline shows each. Every case is written to FAIL on the code before this branch (the routes were open) and to PASS
// on it; the cases that say "admin ... as before" and the control reads are guards that hold on both.
//
//   D1  bookings: list, change, delete        D3  a customer's bookings by email or user_id
//   D2  admin finance data (15 route rows)    D6  uploads
//   AC6 customer1 asks for customer2's booking and gets 403 and none of its fields
//
// Credentials come from getCredentialHeaders (e2e/auth/credentials.js): the fixture accounts' own cookies. Nothing here
// writes to a fixture row. A write is only ever sent to a row the case created (a guest booking made through the
// public POST /api/bookings, deleted again as admin in `finally`), or to an id no row has (the route matrix's probes).
// Expected answers: 401 { success: false, message: 'Unauthorized' } with no credential, 403 { success: false, message:
// 'Forbidden' } for a signed-in caller the route does not allow (src/lib/api-auth.js).
import { test, expect } from '@playwright/test';
import { mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { getCredentialHeaders } from './auth/credentials.js';
import { matrix } from './auth/route-matrix.js';
import { users, providers } from '../database/fixtures/accounts.js';
import { bookings } from '../database/fixtures/bookings.js';

// Every request carries a fixture account's session header, and a Playwright trace records the request headers of the API
// contexts it traces (the config keeps one per failed case). Tracing is off, as in e2e/auth-matrix.spec.js: no trace holds
// a token. A failure message names the case, the status and the account, never a header.
test.use({ trace: 'off' });

const [CUSTOMER1, CUSTOMER2] = users;
const [PROVIDER1, PROVIDER2] = providers;
const [BOOKING1, BOOKING2] = bookings.tables.bookings;

// Strings that belong to customer 2's fixture booking and to no other fixture row: what customer 1 must never be shown.
const CUSTOMER2_STRINGS = [BOOKING2.booking_number, BOOKING2.customer_email, BOOKING2.customer_phone, BOOKING2.address_line1, BOOKING2.job_description];

// The credentials a case sends, as request headers. customerTokenAsAdmin is customer 1's own token in the adminAuth cookie:
// a real signature, the wrong role for that cookie. The token is cut out of the header and put back into another; it is
// never printed.
async function credentials(baseURL) {
    const styles = await getCredentialHeaders(baseURL);
    const customerToken = styles['customer-cookie'].cookie.slice('customer_token='.length);
    return {
        none: {},
        customer: styles['customer-cookie'],
        provider: styles['provider-cookie'],
        admin: styles['admin-cookie'],
        customerTokenAsAdmin: { cookie: `adminAuth=${customerToken}` },
    };
}

// The refusal the guard sends. Checks the status first, so a route that answers something else says so in one line.
async function expectRefusal(response, status, who) {
    expect(response.status(), `${who}: status`).toBe(status);
    const body = await response.json();
    expect(body.success, `${who}: success`).toBe(false);
    expect(body.message, `${who}: message`).toBe(status === 401 ? 'Unauthorized' : 'Forbidden');
    return body;
}

// Absence, by value: none of `strings` appears anywhere in the body text. Only the missing string is named, not the body.
function expectNoneOf(text, strings, who) {
    for (const value of strings) {
        expect(text.includes(String(value)), `${who}: the body holds ${JSON.stringify(value)}`).toBe(false);
    }
}

// A booking the case makes itself through the public guest checkout (POST /api/bookings stays public), so a write probe
// never touches a fixture row. `run(id)` gets its id; the row is deleted again as admin, even when `run` fails.
async function withProbeBooking(request, as, run) {
    const tag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const created = await request.post('/api/bookings', {
        data: {
            service_id: 1, service_name: 'Fixture Standard Clean', service_price: 80, additional_price: 40,
            first_name: 'E2E', last_name: 'Probe', email: `e2e-probe-${tag}@workontap.test`, phone: '+14035550199',
            job_date: '2026-02-01', job_time_slot: '09:00', job_description: 'E2E probe booking, deleted by the case.',
            address_line1: '1 Probe Street', city: 'Calgary', payment_intent_id: `pi_e2e_probe_${tag}`,
        },
    });
    expect(created.status(), 'guest checkout makes the probe booking').toBe(200);
    const id = (await created.json()).booking_id;
    expect(Number.isInteger(id), 'the probe booking has an id').toBe(true);
    try {
        await run(id);
    } finally {
        await request.delete(`/api/bookings?id=${id}`, { headers: as.admin });
    }
}

// The row as an admin reads it (GET /api/bookings/[id]); null when there is no such row.
async function rowAsAdmin(request, as, id) {
    const response = await request.get(`/api/bookings/${id}`, { headers: as.admin });
    if (response.status() === 404) return null;
    expect(response.status(), `admin reads booking ${id}`).toBe(200);
    return (await response.json()).data;
}

const UNTOUCHED = { status: 'pending', payment_status: 'authorized', provider_id: null };
function expectUntouched(row, who) {
    expect(row, `${who}: the probe booking is still there`).not.toBeNull();
    for (const [column, value] of Object.entries(UNTOUCHED)) {
        expect(row[column], `${who}: bookings.${column} is unchanged`).toBe(value);
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// D1: bookings list, change, delete (/api/bookings; /api/bookings/[id], /reassign, /restart are admin-only the same way)
// ---------------------------------------------------------------------------------------------------------------------
test.describe('D1 bookings', () => {
    test('D1 anonymous GET /api/bookings is 401 and returns no booking', async ({ request }) => {
        const response = await request.get('/api/bookings');
        const body = await expectRefusal(response, 401, 'no credential');
        expect(body, 'no data key').not.toHaveProperty('data');
        expectNoneOf(JSON.stringify(body), ['booking_number', 'customer_email', BOOKING1.booking_number, BOOKING2.booking_number, BOOKING1.customer_email, BOOKING2.customer_email], 'no credential');
    });

    test('D1 anonymous PUT /api/bookings?id= is 401 and the booking is unchanged', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        await withProbeBooking(request, as, async (id) => {
            const response = await request.put(`/api/bookings?id=${id}`, {
                data: { status: 'cancelled', payment_status: 'refunded', provider_id: PROVIDER2.id },
            });
            await expectRefusal(response, 401, 'no credential');
            expectUntouched(await rowAsAdmin(request, as, id), 'after the anonymous PUT');
        });
    });

    test('D1 anonymous DELETE /api/bookings?id= is 401 and the booking is still there', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        await withProbeBooking(request, as, async (id) => {
            const response = await request.delete(`/api/bookings?id=${id}`);
            await expectRefusal(response, 401, 'no credential');
            expectUntouched(await rowAsAdmin(request, as, id), 'after the anonymous DELETE');
        });
    });

    test('D1 customer1 and provider1 get 403 on GET, PUT and DELETE /api/bookings and the booking is unchanged', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        await withProbeBooking(request, as, async (id) => {
            for (const who of ['customer', 'provider']) {
                const headers = as[who];
                await expectRefusal(await request.get('/api/bookings', { headers }), 403, `${who} GET`);
                await expectRefusal(await request.put(`/api/bookings?id=${id}`, {
                    headers,
                    data: { status: 'cancelled', payment_status: 'refunded', provider_id: PROVIDER2.id },
                }), 403, `${who} PUT`);
                await expectRefusal(await request.delete(`/api/bookings?id=${id}`, { headers }), 403, `${who} DELETE`);
                expectUntouched(await rowAsAdmin(request, as, id), `after ${who}'s PUT and DELETE`);
            }
        });
    });

    // As before: an admin still lists the bookings (today's behaviour kept), and now there are two to list.
    test('D1 admin GET /api/bookings is 200 and lists both fixture bookings', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const response = await request.get('/api/bookings', { headers: as.admin });
        expect(response.status(), 'admin: status').toBe(200);
        const body = await response.json();
        expect(body.success, 'admin: success').toBe(true);
        const numbers = body.data.map((row) => row.booking_number);
        expect(numbers, 'admin sees customer 1\'s fixture booking').toContain(BOOKING1.booking_number);
        expect(numbers, 'admin sees customer 2\'s fixture booking').toContain(BOOKING2.booking_number);
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// D2: admin finance data. The 15 rows of the eleven route files, each probed as the route matrix probes it (e2e/auth/
// route-matrix.js: an id no row has, an empty body or none), so every write is stopped before it changes anything.
// Per row: no credential 401; customer1's cookie 403; provider1's cookie 403; customer1's OWN token copied into an
// adminAuth cookie 403 (a real signature, the wrong role: the copied-cookie escalation a local verifyAdmin let through);
// admin the status and the top-level keys the route answered before the change (the EM's snapshot of 2026-10-03 16:53,
// taken anonymously while the routes were open: keys only, never values), or, for a write, anything but 401 and 403.
// ---------------------------------------------------------------------------------------------------------------------
const D2_ROWS = [
    ['GET', '/api/admin/earnings', { status: 200, keys: ['data', 'success'] }],
    ['GET', '/api/admin/invoices', { status: 200, keys: ['data', 'success'] }],
    ['PATCH', '/api/admin/invoices'],
    ['GET', '/api/admin/invoices/[id]/preview', { status: 404, html: true }],
    ['GET', '/api/admin/invoices/[id]/preview/download', { status: 404, keys: ['message', 'success'] }],
    ['POST', '/api/admin/invoices/generate'],
    ['GET', '/api/admin/logs', { status: 200, keys: ['data', 'pagination', 'success'] }],
    ['GET', '/api/admin/payouts', { status: 200, keys: ['data', 'success'] }],
    ['GET', '/api/admin/provider-jobs', { status: 400, keys: ['message', 'success'] }],
    ['GET', '/api/admin/providers', { status: 200, keys: ['data', 'success'] }],
    ['PUT', '/api/admin/providers'],
    ['PUT', '/api/admin/providers/[providerId]'],
    ['DELETE', '/api/admin/providers/[providerId]'],
    ['GET', '/api/admin/providers/[providerId]/documents', { status: 404, keys: ['message', 'success'] }],
    ['POST', '/api/admin/providers/[providerId]/documents'],
];

test.describe('D2 admin finance data', () => {
    for (const [method, route, expected] of D2_ROWS) {
        test(`D2 ${method} ${route} is admin only`, async ({ request, baseURL }) => {
            const row = matrix.find((entry) => entry.method === method && entry.route === route);
            expect(row, `the route matrix has a row for ${method} ${route}`).toBeTruthy();
            expect(row.roles, 'the row allows the admin alone').toEqual(['admin']);
            const as = await credentials(baseURL);
            const url = row.probe.path + (row.probe.query || '');
            const send = (headers) => request.fetch(url, { method, headers, data: row.probe.body, maxRedirects: 0 });

            await expectRefusal(await send(as.none), 401, 'no credential');
            await expectRefusal(await send(as.customer), 403, 'customer1 cookie');
            await expectRefusal(await send(as.provider), 403, 'provider1 cookie');
            await expectRefusal(await send(as.customerTokenAsAdmin), 403, "customer1's token in the adminAuth cookie");

            const admin = await send(as.admin);
            if (!expected) {
                expect([401, 403], 'admin: a write is not refused').not.toContain(admin.status());
                return;
            }
            expect(admin.status(), 'admin: status as before').toBe(expected.status);
            if (expected.html) {
                expect(admin.headers()['content-type'] || '', 'admin: content type as before').toContain('text/html');
            } else {
                expect(Object.keys(await admin.json()).sort(), 'admin: top-level keys as before').toEqual(expected.keys);
            }
        });
    }
});

// ---------------------------------------------------------------------------------------------------------------------
// D3: a customer's bookings by email or user_id. GET /api/bookings?email= is admin-only with the rest of that route;
// /api/customer/bookings is for a customer (the caller, never a parameter) or an admin; a parameter naming anyone else is 403.
// ---------------------------------------------------------------------------------------------------------------------
test.describe('D3 customer lookup', () => {
    const CUSTOMER1_STRINGS = [BOOKING1.booking_number, BOOKING1.customer_email, BOOKING1.customer_phone, BOOKING1.address_line1];

    test('D3 anonymous GET /api/bookings?email= is 401 and returns no booking data', async ({ request }) => {
        const response = await request.get(`/api/bookings?email=${encodeURIComponent(CUSTOMER1.email)}`);
        const body = await expectRefusal(response, 401, 'no credential');
        expect(body, 'no data key').not.toHaveProperty('data');
        expectNoneOf(JSON.stringify(body), CUSTOMER1_STRINGS, 'no credential');
    });

    test('D3 anonymous GET /api/customer/bookings with ?email= or ?user_id= is 401', async ({ request }) => {
        const asked = { email: encodeURIComponent(CUSTOMER1.email), user_id: String(CUSTOMER1.id) };
        for (const [name, value] of Object.entries(asked)) {
            const response = await request.get(`/api/customer/bookings?${name}=${value}`);
            const body = await expectRefusal(response, 401, `no credential, ?${name}=`);
            expect(body, `?${name}=: no data key`).not.toHaveProperty('data');
            expectNoneOf(JSON.stringify(body), CUSTOMER1_STRINGS, `no credential, ?${name}=`);
        }
    });

    test("D3 customer1 GET /api/customer/bookings is 200 with customer1's booking and not customer2's", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const response = await request.get('/api/customer/bookings', { headers: as.customer });
        expect(response.status(), 'customer1: status').toBe(200);
        const text = await response.text();
        const body = JSON.parse(text);
        expect(body.success, 'customer1: success').toBe(true);
        const numbers = body.data.map((row) => row.booking_number);
        expect(numbers, "customer1's own booking is listed").toContain(BOOKING1.booking_number);
        expect(numbers, "customer2's booking is not listed").not.toContain(BOOKING2.booking_number);
        expectNoneOf(text, CUSTOMER2_STRINGS, 'customer1 list');
    });

    test("D3 customer1 GET /api/customer/bookings?user_id= or ?email= naming customer2 is 403", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const asked = { user_id: String(CUSTOMER2.id), email: encodeURIComponent(CUSTOMER2.email) };
        for (const [name, value] of Object.entries(asked)) {
            const response = await request.get(`/api/customer/bookings?${name}=${value}`, { headers: as.customer });
            const body = await expectRefusal(response, 403, `customer1, ?${name}=customer2`);
            expectNoneOf(JSON.stringify(body), CUSTOMER2_STRINGS, `customer1, ?${name}=customer2`);
        }
    });

    // The design's case is the bare booking_id (today that answers 400, because no user_id or email came with it); the two
    // forms that name customer2 are the same lookup with the account named, which today hands customer2's booking over.
    test("D3 customer1 POST /api/customer/bookings with customer2's booking_id is 403", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const bodies = [
            { booking_id: BOOKING2.id },
            { booking_id: BOOKING2.id, user_id: CUSTOMER2.id },
            { booking_id: BOOKING2.id, email: CUSTOMER2.email },
        ];
        for (const data of bodies) {
            const who = `customer1, POST ${Object.keys(data).join('+')}`;
            const response = await request.post('/api/customer/bookings', { headers: as.customer, data });
            const body = await expectRefusal(response, 403, who);
            expectNoneOf(JSON.stringify(body), CUSTOMER2_STRINGS, who);
        }
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// D6: uploads. POST /api/upload needs a customer, a provider or an admin; DELETE needs an admin; the guard runs before
// request.formData(), so a refused upload is not buffered and writes nothing. The runner mounts the worktree that the app
// serves, so the case reads public/uploads itself (creating it first if it is absent). Files a case makes are deleted again
// as admin, even when the case fails.
// ---------------------------------------------------------------------------------------------------------------------
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads');

function uploadedFileCount() {
    mkdirSync(UPLOADS_DIR, { recursive: true });
    return readdirSync(UPLOADS_DIR).length;
}

const uploadPng = (request, headers) =>
    request.post('/api/upload', { headers, multipart: { file: { name: 'e2e-defect-probe.png', mimeType: 'image/png', buffer: PNG } } });

// The body of a response as an object, or {} when it is not JSON, so a cleanup never throws over the case's own failure.
async function bodyOf(response) {
    return response.json().catch(() => ({}));
}

async function removeUploads(request, as, urls) {
    for (const url of urls) await request.delete(`/api/upload?url=${encodeURIComponent(url)}`, { headers: as.admin });
}

test.describe('D6 uploads', () => {
    test('D6 anonymous POST /api/upload is 401, returns no url and writes no file', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const before = uploadedFileCount();
        const made = [];
        try {
            const response = await uploadPng(request, as.none);
            const body = await bodyOf(response);
            if (body.url) made.push(body.url);
            expect(response.status(), 'no credential: status').toBe(401);
            expect(body.success, 'no credential: success').toBe(false);
            expect(body, 'no credential: no url').not.toHaveProperty('url');
            expect(uploadedFileCount(), 'public/uploads: file count after the refused upload').toBe(before);
        } finally {
            await removeUploads(request, as, made);
        }
    });

    test('D6 anonymous DELETE /api/upload?url= is 401 and the file still serves', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const made = [];
        try {
            const uploaded = await uploadPng(request, as.admin);
            expect(uploaded.status(), 'admin uploads the file the case deletes').toBe(200);
            const { url } = await uploaded.json();
            expect(typeof url, 'admin: the upload answers a url').toBe('string');
            made.push(url);

            const response = await request.delete(`/api/upload?url=${encodeURIComponent(url)}`);
            await expectRefusal(response, 401, 'no credential');
            const served = await request.get(url);
            expect(served.status(), 'the file still serves after the anonymous DELETE').toBe(200);
        } finally {
            await removeUploads(request, as, made);
        }
    });

    test('D6 customer1, provider1 and admin can each upload a PNG: 200 with a url that serves', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const made = [];
        try {
            for (const who of ['customer', 'provider', 'admin']) {
                const response = await uploadPng(request, as[who]);
                const body = await bodyOf(response);
                if (body.url) made.push(body.url);
                expect(response.status(), `${who}: status`).toBe(200);
                expect(body.success, `${who}: success`).toBe(true);
                expect(typeof body.url, `${who}: url`).toBe('string');
                const served = await request.get(body.url);
                expect(served.status(), `${who}: the uploaded file serves`).toBe(200);
                expect(served.headers()['content-type'] || '', `${who}: the file serves as an image`).toContain('image/');
            }
        } finally {
            await removeUploads(request, as, made);
        }
    });
});
