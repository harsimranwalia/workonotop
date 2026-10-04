// @ts-check
// ENG-022 (design ENG-004, "Interfaces"; ticket ENG-022): the role checks of the admin, shared admin-only and catalogue
// routes. One named case per converted `roles` row of the 85 the ticket owns, plus the cases a row's split or ownership
// needs, so the baseline shows each. The two cron routes and the five reset/OTP routes are not here (e2e/cron-secret.spec.js
// and e2e/s1-reset-otp.spec.js); the two catalogue reads that stay public are in the second describe below.
//
// Per row (the 75 rows of ADMIN_BEFORE; `PUT /api/provider` has its own cases): the row's matrix probe is sent as the matrix
// sends it (e2e/auth/route-matrix.js: an id no row has, an empty body or none). No credential is 401
// { success: false, message: 'Unauthorized' }; customer1's cookie, provider1's cookie and customer1's OWN token copied into an
// adminAuth cookie (a real signature, the wrong role) are each 403 { success: false, message: 'Forbidden' }; the admin's
// cookie gets the status and the top-level keys the route answered before the change. Style: e2e/defects.spec.js, D2.
//
// Nothing here writes to a fixture row except the provider cases, which put a marker in provider1's `bio` and put it back
// (in `finally`); every other write is the matrix's probe on an id no row has. The credentials are the fixture accounts'.
import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { getCredentialHeaders } from './auth/credentials.js';
import { matrix } from './auth/route-matrix.js';
import { users, providers } from '../database/fixtures/accounts.js';

// Every request carries a fixture account's session header and a trace records request headers: tracing is off, as in
// e2e/auth-matrix.spec.js. A failure message names the case, the status and the account, never a header.
test.use({ trace: 'off' });

const [CUSTOMER1, , ADMIN] = users;
const [PROVIDER1, PROVIDER2] = providers;

// What the fixture admin's cookie got from each row's matrix probe BEFORE any ENG-022 conversion: the backend seat's
// before-snapshot of 2026-10-03 21:56 to 21:58 (every probe sent once as the fixture admin, on the dev app, while the routes
// were still as ENG-021 left them). Data, copied: this spec does not read the snapshot file. [method, route, status, the
// answer's top-level keys sorted and joined with a comma]; keys only, never values. 75 rows: the 58 admin rows of the
// ticket's tasks A and B and the 17 shared rows of task C (customers, provider GET and DELETE, categories, services,
// service-locations, reviews DELETE, stats, test/push); the 18th shared roles row, PUT /api/provider, is below.
// Two rows answered 500 before (GET /api/admin/service-areas/[id], PUT /api/admin/testimonials/[id]) and are pinned at 500:
// the change must not touch what the admin gets, the dev database lacks what those two handlers read.
const ADMIN_BEFORE = [
    ['GET', '/api/admin/blogs', 200, 'data,success'],
    ['POST', '/api/admin/blogs', 400, 'message,success'],
    ['GET', '/api/admin/blogs/[id]', 404, 'message,success'],
    ['PUT', '/api/admin/blogs/[id]', 400, 'message,success'],
    ['DELETE', '/api/admin/blogs/[id]', 200, 'message,success'],
    ['PUT', '/api/admin/bookings/[id]/override', 400, 'message,success'],
    ['GET', '/api/admin/cities', 200, 'data,page,success,total,totalPages'],
    ['POST', '/api/admin/cities', 400, 'message,success'],
    ['GET', '/api/admin/cities/[id]', 404, 'message,success'],
    ['PUT', '/api/admin/cities/[id]', 400, 'message,success'],
    ['DELETE', '/api/admin/cities/[id]', 200, 'message,success'],
    ['GET', '/api/admin/deletion-requests', 200, 'data,pagination,success'],
    ['PATCH', '/api/admin/deletion-requests', 400, 'message,success'],
    ['GET', '/api/admin/disputes', 200, 'data,success'],
    ['PATCH', '/api/admin/disputes', 400, 'message,success'],
    ['GET', '/api/admin/disputes/[id]', 404, 'message,success'],
    ['GET', '/api/admin/districts', 200, 'data,page,success,total,totalPages'],
    ['POST', '/api/admin/districts', 400, 'message,success'],
    ['GET', '/api/admin/districts/[id]', 404, 'message,success'],
    ['PUT', '/api/admin/districts/[id]', 400, 'message,success'],
    ['DELETE', '/api/admin/districts/[id]', 200, 'message,success'],
    ['GET', '/api/admin/me', 200, 'success,user'],
    ['GET', '/api/admin/notifications', 200, 'data,success'],
    ['PUT', '/api/admin/notifications', 200, 'success'],
    ['PUT', '/api/admin/providers/approve', 400, 'message,success'],
    ['GET', '/api/admin/seo', 200, 'data,success'],
    ['POST', '/api/admin/seo', 400, 'message,success'],
    ['DELETE', '/api/admin/seo/[id]', 200, 'message,success'],
    ['GET', '/api/admin/seo/[id]', 404, 'message,success'],
    ['PUT', '/api/admin/seo/[id]', 400, 'message,success'],
    ['GET', '/api/admin/service-areas', 200, 'data,page,success,total,totalPages'],
    ['POST', '/api/admin/service-areas', 400, 'message,success'],
    ['PUT', '/api/admin/service-areas', 400, 'message,success'],
    ['DELETE', '/api/admin/service-areas/[id]', 200, 'message,success'],
    ['GET', '/api/admin/service-areas/[id]', 500, 'message,success'],
    ['PUT', '/api/admin/service-areas/[id]', 400, 'message,success'],
    ['GET', '/api/admin/service-locations', 200, 'data,pagination,stats,success'],
    ['POST', '/api/admin/service-locations', 400, 'message,success'],
    ['DELETE', '/api/admin/service-locations/[id]', 404, 'message,success'],
    ['GET', '/api/admin/service-locations/[id]', 404, 'message,success'],
    ['PATCH', '/api/admin/service-locations/[id]', 200, 'is_active,message,success'],
    ['PUT', '/api/admin/service-locations/[id]', 404, 'message,success'],
    ['GET', '/api/admin/settings', 200, 'settings,success'],
    ['POST', '/api/admin/settings', 400, 'message,success'],
    ['GET', '/api/admin/skills', 200, 'data,page,success,total,totalPages'],
    ['POST', '/api/admin/skills', 400, 'message,success'],
    ['DELETE', '/api/admin/skills/[id]', 200, 'message,success'],
    ['GET', '/api/admin/skills/[id]', 404, 'message,success'],
    ['PUT', '/api/admin/skills/[id]', 400, 'message,success'],
    ['GET', '/api/admin/states', 200, 'data,page,success,total,totalPages'],
    ['POST', '/api/admin/states', 400, 'message,success'],
    ['DELETE', '/api/admin/states/[id]', 200, 'message,success'],
    ['GET', '/api/admin/states/[id]', 404, 'message,success'],
    ['PUT', '/api/admin/states/[id]', 400, 'message,success'],
    ['GET', '/api/admin/testimonials', 200, 'data,success'],
    ['POST', '/api/admin/testimonials', 400, 'error,success'],
    ['DELETE', '/api/admin/testimonials/[id]', 200, 'success'],
    ['PUT', '/api/admin/testimonials/[id]', 500, 'error,success'],
    ['DELETE', '/api/categories', 400, 'message,success'],
    ['POST', '/api/categories', 400, 'message,success'],
    ['PUT', '/api/categories', 400, 'message,success'],
    ['DELETE', '/api/customers', 400, 'message,success'],
    ['GET', '/api/customers', 200, 'data,success,total'],
    ['POST', '/api/customers', 400, 'message,success'],
    ['PUT', '/api/customers', 400, 'message,success'],
    ['DELETE', '/api/provider', 400, 'message,success'],
    ['GET', '/api/provider', 200, 'data,success,total'],
    ['DELETE', '/api/reviews', 400, 'message,success'],
    ['DELETE', '/api/service-locations', 400, 'message,success'],
    ['POST', '/api/service-locations', 400, 'message,success'],
    ['DELETE', '/api/services', 400, 'message,success'],
    ['POST', '/api/services', 400, 'message,success'],
    ['PUT', '/api/services', 400, 'message,success'],
    ['GET', '/api/stats', 200, 'data,success'],
    ['POST', '/api/test/push', 400, 'message,success'],
];

// The credentials a case sends, as request headers. customerTokenAsAdmin is customer 1's own token in the adminAuth cookie.
// The token is cut out of the header and put back into another; it is never printed.
async function credentials(baseURL) {
    const styles = await getCredentialHeaders(baseURL);
    const customerToken = styles['customer-cookie'].cookie.slice('customer_token='.length);
    return {
        none: {},
        customer: styles['customer-cookie'],
        provider: styles['provider-cookie'],
        admin: styles['admin-cookie'],
        customerTokenAsAdmin: { cookie: `adminAuth=${customerToken}` },
        customerBearer: styles['customer-bearer'],
        providerBearer: styles['provider-bearer'],
        adminBearer: styles['admin-bearer'],
    };
}

// The refusal the guard sends (src/lib/api-auth.js). Checks the status first, so a route that answers something else says so
// in one line.
async function expectRefusal(response, status, who) {
    expect(response.status(), `${who}: status`).toBe(status);
    const body = await response.json();
    expect(body.success, `${who}: success`).toBe(false);
    expect(body.message, `${who}: message`).toBe(status === 401 ? 'Unauthorized' : 'Forbidden');
    return body;
}

// ---------------------------------------------------------------------------------------------------------------------
// One case per row
// ---------------------------------------------------------------------------------------------------------------------
test.describe('Role check by row', () => {
    for (const [method, route, status, keys] of ADMIN_BEFORE) {
        test(`Role check ${method} ${route}: 401 with no credential, 403 for customer1, provider1 and a customer token in adminAuth, admin as before`, async ({ request, baseURL }) => {
            const row = matrix.find((entry) => entry.method === method && entry.route === route);
            expect(row, `the route matrix has a row for ${method} ${route}`).toBeTruthy();
            expect(row.kind, 'the row is a roles row').toBe('roles');
            expect(row.roles, 'the row allows the admin alone').toEqual(['admin']);
            const as = await credentials(baseURL);
            const url = row.probe.path + (row.probe.query || '');
            const send = (headers) => request.fetch(url, { method, headers, data: row.probe.body, maxRedirects: 0 });

            await expectRefusal(await send(as.none), 401, 'no credential');
            await expectRefusal(await send(as.customer), 403, 'customer1 cookie');
            await expectRefusal(await send(as.provider), 403, 'provider1 cookie');
            await expectRefusal(await send(as.customerTokenAsAdmin), 403, "customer1's token in the adminAuth cookie");

            const admin = await send(as.admin);
            expect(admin.status(), 'admin cookie: status as before').toBe(status);
            const body = await admin.json();
            expect(Object.keys(body).sort().join(','), 'admin cookie: top-level keys as before').toBe(keys);
        });
    }
});

// ---------------------------------------------------------------------------------------------------------------------
// PUT /api/provider: two branches in one handler (matrix row roles ['admin', 'provider'], owner `caller.id`).
//   ?id=<x>   the admin's branches (a status change, or a full edit of any provider): admin only.
//   no id     the provider's own profile; the row updated is the caller's id, never a query or body value.
// A customer is 403 on both; a provider naming any provider with ?id= is 403; an admin on the no-id branch is 403.
// ---------------------------------------------------------------------------------------------------------------------
test.describe('Role check PUT /api/provider', () => {
    const MARKER = 'role-check-marker';
    // The profile fields the no-id branch requires (name, email, phone), with provider1's own fixture values, so the only
    // thing a call changes is what the case adds.
    const profile = (extra = {}) => ({ name: PROVIDER1.name, email: PROVIDER1.email, phone: PROVIDER1.phone, ...extra });
    const list = async (request, as) => {
        const response = await request.get('/api/provider', { headers: as.admin });
        expect(response.status(), 'admin lists the providers').toBe(200);
        return (await response.json()).data;
    };
    const rowOf = (rows, id) => rows.find((provider) => provider.id === id);
    // Puts provider1's profile back to the fixture's (bio NULL). Sent with provider1's Bearer, which both the old and the new
    // code accept on the no-id branch, so the cleanup works whichever half of the change the app serves.
    const restore = async (request, as) => {
        const response = await request.put('/api/provider', { headers: as.providerBearer, data: profile() });
        expect(response.status(), 'cleanup: provider1 profile restored').toBe(200);
    };

    test('Role check PUT /api/provider: 401 with no credential, 403 for customer1 by cookie and by Bearer and for a customer token in adminAuth, and nothing is written', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const before = await list(request, as);
        const provider1Before = JSON.stringify(rowOf(before, PROVIDER1.id));
        try {
            // The body would change provider1's bio if the route let the caller through: customer1's Bearer carries id 1,
            // and so does provider1's row (the old handler updated `decoded.id` of any role's Bearer).
            const data = profile({ bio: MARKER });
            const put = (headers, url = '/api/provider') => request.put(url, { headers, data });
            await expectRefusal(await put(as.none), 401, 'no credential');
            await expectRefusal(await put(as.customer), 403, 'customer1 cookie');
            await expectRefusal(await put(as.customerBearer), 403, 'customer1 Bearer');
            await expectRefusal(await put(as.customerTokenAsAdmin), 403, "customer1's token in the adminAuth cookie");
            await expectRefusal(await put(as.none, '/api/provider?id=999999999'), 401, 'no credential, ?id=');
            await expectRefusal(await put(as.customer, '/api/provider?id=999999999'), 403, 'customer1 cookie, ?id=');
            await expectRefusal(await put(as.customerBearer, '/api/provider?id=999999999'), 403, 'customer1 Bearer, ?id=');
            const after = await list(request, as);
            expect(JSON.stringify(rowOf(after, PROVIDER1.id)), "provider1's row is as it was").toBe(provider1Before);
        } finally {
            await restore(request, as);
        }
    });

    test("Role check PUT /api/provider (no id): provider1 updates provider1's row and no other, by cookie and by Bearer, whatever id the body names", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const before = await list(request, as);
        const provider2Before = JSON.stringify(rowOf(before, PROVIDER2.id));
        try {
            for (const [who, headers] of [['provider1 cookie', as.provider], ['provider1 Bearer', as.providerBearer]]) {
                const marker = `${MARKER}-${who.endsWith('cookie') ? 'cookie' : 'bearer'}`;
                const response = await request.put('/api/provider', {
                    headers,
                    data: profile({ bio: marker, id: PROVIDER2.id, provider_id: PROVIDER2.id, providerId: PROVIDER2.id }),
                });
                expect(response.status(), `${who}: status`).toBe(200);
                const body = await response.json();
                expect(body.success, `${who}: success`).toBe(true);
                expect(body.data.id, `${who}: the row updated is provider1's`).toBe(PROVIDER1.id);
                expect(body.data.bio, `${who}: the new bio is stored`).toBe(marker);
                const after = await list(request, as);
                expect(rowOf(after, PROVIDER1.id).bio, `${who}: provider1's bio as the admin lists it`).toBe(marker);
                expect(JSON.stringify(rowOf(after, PROVIDER2.id)), `${who}: provider2's row is untouched`).toBe(provider2Before);
            }
        } finally {
            await restore(request, as);
        }
    });

    test("Role check PUT /api/provider (?id=): provider1 naming their own row or another provider's is 403, by cookie and by Bearer", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        // A status-only body with the status the row already has: on a route that let the call through it would change nothing
        // but updated_at, so the case is safe on the old code too.
        const data = { status: PROVIDER2.status };
        for (const [who, headers] of [['provider1 cookie', as.provider], ['provider1 Bearer', as.providerBearer]]) {
            for (const id of [PROVIDER1.id, PROVIDER2.id, 999999999]) {
                const response = await request.put(`/api/provider?id=${id}`, { headers, data });
                await expectRefusal(response, 403, `${who}, ?id=${id === 999999999 ? '<missing>' : id === PROVIDER1.id ? 'their own' : "provider2's"}`);
            }
        }
    });

    test("Role check PUT /api/provider (?id=): an admin naming a provider that does not exist reaches the handler's validation (400), not a refusal", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        for (const [who, headers] of [['admin cookie', as.admin], ['admin Bearer', as.adminBearer]]) {
            const response = await request.put('/api/provider?id=999999999', { headers, data: {} });
            expect([401, 403], `${who}: not refused`).not.toContain(response.status());
            expect(response.status(), `${who}: the handler's own validation`).toBe(400);
        }
    });

    test('Role check PUT /api/provider (no id): an admin is 403, there is no provider profile to update', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        for (const [who, headers] of [['admin cookie', as.admin], ['admin Bearer', as.adminBearer]]) {
            const response = await request.put('/api/provider', { headers, data: profile({ bio: MARKER }) });
            await expectRefusal(response, 403, who);
        }
        const rows = await list(request, as);
        expect(rowOf(rows, PROVIDER1.id).bio, "provider1's bio was not written by the admin's refused call").not.toBe(MARKER);
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// /api/admin/notifications: the signed-in admin's own rows. The fixtures hold no notification row, so absence cannot be shown
// by a row that is not the admin's; what is asserted is the contract on whatever the table holds: every row listed belongs to
// the admin (user_id the admin's, user_type 'admin'), a query naming someone else changes nothing, and the Bearer and the
// cookie are the same admin. The PUT is sent with an id no notification has.
// ---------------------------------------------------------------------------------------------------------------------
test.describe('Role check /api/admin/notifications', () => {
    const OTHER = `user_id=${CUSTOMER1.id}&user_type=customer`;

    test("Role check GET /api/admin/notifications: only the signed-in admin's own rows, by cookie and by Bearer, and no query names another owner", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const idsOf = (body) => body.data.map((row) => row.id);
        let plain = null;
        for (const [who, headers] of [['admin cookie', as.admin], ['admin Bearer', as.adminBearer]]) {
            const response = await request.get('/api/admin/notifications', { headers });
            expect(response.status(), `${who}: status`).toBe(200);
            const body = await response.json();
            expect(body.success, `${who}: success`).toBe(true);
            expect(Array.isArray(body.data), `${who}: data is a list`).toBe(true);
            for (const row of body.data) {
                expect(Number(row.user_id), `${who}: row ${row.id} belongs to the admin`).toBe(ADMIN.id);
                expect(row.user_type, `${who}: row ${row.id} is an admin notification`).toBe('admin');
            }
            if (plain === null) plain = idsOf(body);
            expect(idsOf(body), `${who}: the same rows as the other credential`).toEqual(plain);
        }
        const named = await request.get(`/api/admin/notifications?${OTHER}`, { headers: as.admin });
        expect(named.status(), 'a query naming another owner: status').toBe(200);
        expect(idsOf(await named.json()), 'a query naming another owner changes nothing').toEqual(plain);
        for (const [who, headers] of [['customer1 cookie', as.customer], ['provider1 cookie', as.provider], ['customer1 Bearer', as.customerBearer], ['provider1 Bearer', as.providerBearer]]) {
            const body = await expectRefusal(await request.get(`/api/admin/notifications?${OTHER}`, { headers }), 403, who);
            expect(body, `${who}: no data key`).not.toHaveProperty('data');
        }
    });

    test('Role check PUT /api/admin/notifications: an admin marking an id no notification has gets { success: true }, any other caller is refused and a body naming another owner is ignored', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const data = { id: 999999999, user_id: CUSTOMER1.id, user_type: 'customer' };
        for (const [who, headers] of [['admin cookie', as.admin], ['admin Bearer', as.adminBearer]]) {
            const response = await request.put('/api/admin/notifications', { headers, data });
            expect(response.status(), `${who}: status`).toBe(200);
            expect(await response.json(), `${who}: body`).toEqual({ success: true });
        }
        await expectRefusal(await request.put('/api/admin/notifications', { data }), 401, 'no credential');
        for (const [who, headers] of [['customer1 cookie', as.customer], ['provider1 cookie', as.provider], ['customer1 Bearer', as.customerBearer], ['provider1 Bearer', as.providerBearer]]) {
            await expectRefusal(await request.put('/api/admin/notifications', { headers, data }), 403, who);
        }
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// The catalogue reads that stay public (ticket ENG-022, task C; matrix rows GET /api/services and GET /api/service-locations,
// kind `public`): the landing pages and the booking flow read them with no login. The flags that drop the is_active filter
// (`?admin=true` on services; `?admin=true` and `?includeInactive=true` on service-locations) are honoured for an admin and
// ignored for everyone else: no refusal, and exactly the answer the request without the flag gets. The fixtures hold no
// inactive service and no service location at all, so each case makes one inactive row as the admin (the public POST
// routes' admin-only twins: POST /api/services then PUT it off; POST /api/service-locations with is_active false) and
// deletes it again in `finally`, even when an assertion fails.
// ---------------------------------------------------------------------------------------------------------------------
test.describe('Role check catalogue reads', () => {
    const stamp = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

    // Reads `url` with `headers`: the status and the whole answer as text (so "exactly the answer without the flag" is a string
    // comparison), plus the ids it lists.
    const read = async (request, url, headers) => {
        const response = await request.get(url, { headers });
        const text = await response.text();
        let ids = [];
        try {
            ids = (JSON.parse(text).data || []).map((row) => row.id);
        } catch {
            // not JSON: the status assertion names it
        }
        return { status: response.status(), text, ids };
    };

    // Everything but the admin: the flagged answer is the unflagged one, and the inactive row is not in it.
    const expectFlagIgnored = async (request, as, path, flag, inactiveId) => {
        for (const [who, headers] of [['no credential', as.none], ['customer1', as.customer], ['provider1', as.provider]]) {
            const plain = await read(request, path, headers);
            const flagged = await read(request, `${path}?${flag}`, headers);
            expect(plain.status, `${who}: ${path} status`).toBe(200);
            expect(flagged.status, `${who}: ?${flag} status is the unflagged status`).toBe(200);
            expect(flagged.ids.length, `${who}: ?${flag} lists as many rows as the unflagged read`).toBe(plain.ids.length);
            expect(flagged.ids, `${who}: ?${flag} lists the unflagged rows`).toEqual(plain.ids);
            expect(flagged.ids, `${who}: ?${flag} does not list the inactive row`).not.toContain(inactiveId);
            expect(flagged.text, `${who}: ?${flag} answers exactly what the request without the flag answers`).toBe(plain.text);
        }
    };

    test('Role check GET /api/services?admin=true: no credential, customer1 and provider1 get the answer they get without the flag, the admin also gets the inactive service', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        let id = null;
        try {
            const created = await request.post('/api/services', {
                headers: as.admin,
                data: { category_id: 1, name: 'Role Check Inactive Service', slug: `role-check-inactive-${stamp()}`, base_price: 1 },
            });
            expect(created.status(), 'admin creates a service').toBe(200);
            id = (await created.json()).id;
            expect(id, 'the new service has an id').toBeTruthy();
            const off = await request.put('/api/services', { headers: as.admin, data: { id, is_active: false } });
            expect(off.status(), 'admin switches the service off').toBe(200);

            await expectFlagIgnored(request, as, '/api/services', 'admin=true', id);
            for (const [who, headers] of [['admin cookie', as.admin], ['admin Bearer', as.adminBearer]]) {
                expect((await read(request, '/api/services', headers)).ids, `${who}: without the flag the inactive service is not listed`).not.toContain(id);
                const flagged = await read(request, '/api/services?admin=true', headers);
                expect(flagged.status, `${who}: ?admin=true status`).toBe(200);
                expect(flagged.ids, `${who}: ?admin=true lists the inactive service`).toContain(id);
            }
        } finally {
            if (id) {
                const gone = await request.delete(`/api/services?id=${id}`, { headers: as.admin });
                expect(gone.status(), 'cleanup: the inactive service is deleted').toBe(200);
            }
        }
    });

    for (const flag of ['admin=true', 'includeInactive=true']) {
        test(`Role check GET /api/service-locations?${flag}: no credential, customer1 and provider1 get the answer they get without the flag, the admin also gets the inactive location`, async ({ request, baseURL }) => {
            const as = await credentials(baseURL);
            let id = null;
            try {
                const created = await request.post('/api/service-locations', {
                    headers: as.admin,
                    data: { service_id: 1, location_name: 'Role Check Town', location_slug: `role-check-${stamp()}`, is_active: false },
                });
                expect(created.status(), 'admin creates a service location').toBe(200);
                id = (await created.json()).id;
                expect(id, 'the new service location has an id').toBeTruthy();

                await expectFlagIgnored(request, as, '/api/service-locations', flag, id);
                for (const [who, headers] of [['admin cookie', as.admin], ['admin Bearer', as.adminBearer]]) {
                    expect((await read(request, '/api/service-locations', headers)).ids, `${who}: without the flag the inactive location is not listed`).not.toContain(id);
                    const flagged = await read(request, `/api/service-locations?${flag}`, headers);
                    expect(flagged.status, `${who}: ?${flag} status`).toBe(200);
                    expect(flagged.ids, `${who}: ?${flag} lists the inactive location`).toContain(id);
                }
            } finally {
                if (id) {
                    const gone = await request.delete(`/api/service-locations?id=${id}`, { headers: as.admin });
                    expect(gone.status(), 'cleanup: the inactive service location is deleted').toBe(200);
                }
            }
        });
    }
});

// ---------------------------------------------------------------------------------------------------------------------
// Ownership and forged tokens: the shapes of QA's ENG-021 probes (Q1 to Q5: a caller may act only on what is theirs, naming
// someone else is refused, an admin may name anyone) applied to this ticket's rows that have an ownership dimension, and one
// forged-token case per family. The ownership legs of PUT /api/provider (provider1 updates only their own row; naming any
// provider is 403) and of /api/admin/notifications are above; here are the admin's side of PUT /api/provider and GET
// /api/admin/me. The forged tokens are built with node:crypto (HS256), never printed, and need no dependency.
// ---------------------------------------------------------------------------------------------------------------------
const base64url = (value) => Buffer.from(value).toString('base64url');
const claimsOf = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
const signHS256 = (claims, secret) => {
    const signingInput = `${base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${base64url(JSON.stringify(claims))}`;
    return `${signingInput}.${crypto.createHmac('sha256', secret).update(signingInput).digest('base64url')}`;
};

test.describe('Role check ownership', () => {
    test('Role check PUT /api/provider (?id=): an admin may name any provider and the change lands on the row named and on no other', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const marker = 'role-check-admin-marker';
        const list = async () => {
            const response = await request.get('/api/provider', { headers: as.admin });
            expect(response.status(), 'admin lists the providers').toBe(200);
            return (await response.json()).data;
        };
        const edit = (headers, bio) => request.put(`/api/provider?id=${PROVIDER2.id}`, {
            headers,
            data: { name: PROVIDER2.name, email: PROVIDER2.email, phone: PROVIDER2.phone, ...(bio ? { bio } : {}) },
        });
        const before = await list();
        const provider1Before = JSON.stringify(before.find((row) => row.id === PROVIDER1.id));
        try {
            for (const [who, headers] of [['admin cookie', as.admin], ['admin Bearer', as.adminBearer]]) {
                const response = await edit(headers, `${marker}-${who.split(' ')[1]}`);
                expect(response.status(), `${who}: naming provider2`).toBe(200);
                const after = await list();
                expect(after.find((row) => row.id === PROVIDER2.id).bio, `${who}: provider2's bio is the new one`).toBe(`${marker}-${who.split(' ')[1]}`);
                expect(JSON.stringify(after.find((row) => row.id === PROVIDER1.id)), `${who}: provider1's row is untouched`).toBe(provider1Before);
            }
        } finally {
            const restored = await edit(as.admin);
            expect(restored.status(), "cleanup: provider2's profile restored").toBe(200);
        }
    });

    test('Role check GET /api/admin/me: returns the signed-in admin and no other, by cookie and by Bearer; every other caller is 403 with no user', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        for (const [who, headers] of [['admin cookie', as.admin], ['admin Bearer', as.adminBearer]]) {
            const response = await request.get('/api/admin/me', { headers });
            expect(response.status(), `${who}: status`).toBe(200);
            const body = await response.json();
            expect(body.success, `${who}: success`).toBe(true);
            expect(body.user.id, `${who}: the admin's id`).toBe(ADMIN.id);
            expect(body.user.email, `${who}: the admin's email`).toBe(ADMIN.email);
            expect(body.user.role, `${who}: role`).toBe('admin');
        }
        for (const [who, headers] of [['customer1 cookie', as.customer], ['provider1 cookie', as.provider], ['customer1 Bearer', as.customerBearer], ['provider1 Bearer', as.providerBearer], ["customer1's token in adminAuth", as.customerTokenAsAdmin]]) {
            const body = await expectRefusal(await request.get('/api/admin/me', { headers }), 403, who);
            expect(body, `${who}: no user key`).not.toHaveProperty('user');
        }
    });
});

// A token signed with a wrong secret, and a real token whose payload was changed after signing, are no session at all: 401, never
// 403 (a wrong role is 403, a forged one is not a role) and never 200. In the adminAuth cookie and as a Bearer, on one admin
// catalogue row, one shared row and the identity route.
test.describe('Role check forged tokens', () => {
    for (const [method, route, key] of [['GET', '/api/admin/blogs', 'data'], ['GET', '/api/stats', 'data'], ['GET', '/api/admin/me', 'user']]) {
        test(`Role check forged tokens ${method} ${route}: a wrong-secret token and a tampered payload are 401 in the adminAuth cookie and as a Bearer`, async ({ request, baseURL }) => {
            const row = matrix.find((entry) => entry.method === method && entry.route === route);
            expect(row, `the route matrix has a row for ${method} ${route}`).toBeTruthy();
            const styles = await getCredentialHeaders(baseURL);
            const adminToken = styles['admin-cookie'].cookie.slice('adminAuth='.length);
            const customerToken = styles['customer-cookie'].cookie.slice('customer_token='.length);
            const [head, , signature] = adminToken.split('.');
            const [customerHead, , customerSignature] = customerToken.split('.');
            const adminClaims = claimsOf(adminToken);
            const customerClaims = claimsOf(customerToken);
            const forged = {
                'wrong-secret token with the admin claims': signHS256(adminClaims, `not-the-app-secret-${Math.random()}`),
                'admin token with a changed id': `${head}.${base64url(JSON.stringify({ ...adminClaims, id: CUSTOMER1.id }))}.${signature}`,
                "customer1's token with its claims changed to admin": `${customerHead}.${base64url(JSON.stringify({ ...customerClaims, role: 'admin', type: 'admin' }))}.${customerSignature}`,
            };
            for (const [what, token] of Object.entries(forged)) {
                for (const [carrier, headers] of [['adminAuth cookie', { cookie: `adminAuth=${token}` }], ['Bearer', { authorization: `Bearer ${token}` }]]) {
                    const response = await request.fetch(row.probe.path + (row.probe.query || ''), { method, headers, data: row.probe.body, maxRedirects: 0 });
                    const body = await expectRefusal(response, 401, `${what} as ${carrier}`);
                    expect(body, `${what} as ${carrier}: no ${key} key`).not.toHaveProperty(key);
                }
            }
        });
    }
});
