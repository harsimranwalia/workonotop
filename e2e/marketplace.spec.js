// @ts-check
// ENG-010: the admin job queue, admin-only assignment, the marketplace push, and claims that race. A booking with no provider
// reaches providers only once an admin pushes it (src/lib/marketplace.js, OPEN_ON_MARKETPLACE). Each title is the baseline key.
//
// Every case makes its own probe bookings through the public checkout (an email with no account, so each is a guest booking)
// and deletes them as admin in `finally`; nothing is reset between cases. customer1, provider1 and the admin are the
// credentials of getCredentialHeaders; provider 2 signs in itself (signedInAs). Neither fixture provider has a service area,
// so no location condition hides a job from either list. The list is newest first and paged: it is read with ?limit=50 and
// ?all=true&limit=50, where a probe made a moment ago is on the first page (M3 is the control of every absence).
import { test, expect } from '@playwright/test';
import { getCredentialHeaders } from './auth/credentials.js';
import { RESET_RETRIES } from './support/auth.js';
import { providers, FIXTURE_LOGINS } from '../database/fixtures/accounts.js';
import { bookings } from '../database/fixtures/bookings.js';

// Every request carries a fixture account's session header and a trace records request headers: tracing is off, as in
// e2e/auth-matrix.spec.js. A failure message names the case, the status and the account, never a header.
test.use({ trace: 'off' });

const [PROVIDER1, PROVIDER2] = providers;
const [BOOKING1, BOOKING2] = bookings.tables.bookings;

const FORBIDDEN = { success: false, message: 'Forbidden' };
const UNAUTHORIZED = { success: false, message: 'Unauthorized' };
const NOT_FOUND = { success: false, message: 'Job not found' };
const TAKEN = { success: false, message: 'Job already accepted by another provider' };
const NOT_OFFERED = { success: false, message: 'Job not available' };
const HELD = { success: false, message: 'This job already has a provider. Reload it to see who.' };
const UPDATED = { success: true, message: 'Booking updated successfully' };
const PUSHED_NOTE = 'Pushed to the marketplace';
const LISTS = ['/api/provider/available-jobs?limit=50', '/api/provider/available-jobs?all=true&limit=50'];

// A race case runs ROUNDS rounds, each a fresh probe, one push and two requests sent together.
const ROUNDS = 25;
const RACE_TIMEOUT = 180_000;

// The credentials a case sends, as request headers (the cookie styles of getCredentialHeaders).
async function credentials(baseURL) {
    const styles = await getCredentialHeaders(baseURL);
    return { none: {}, customer: styles['customer-cookie'], provider: styles['provider-cookie'], admin: styles['admin-cookie'] };
}

const COOKIE_OF = { customer1: 'customer_token', customer2: 'customer_token', provider1: 'provider_token', provider2: 'provider_token', admin: 'adminAuth' };
// Signs a fixture account in through its own login route and returns its session cookie as a request header. The token is
// cut out of the storage state and put in a header; it is never printed.
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

// A guest booking made through the public checkout: pending, no provider, not pushed. `run(id)` gets its id; the row is
// deleted again as admin, even when `run` fails.
async function withProbeBooking(request, as, run) {
    const tag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const body = {
        service_id: 1, service_name: 'Fixture Standard Clean', service_price: 80, additional_price: 40,
        first_name: 'E2E', last_name: 'Probe', email: `e2e-probe-${tag}@workontap.test`, phone: '+14035550199',
        job_date: '2026-02-01', job_time_slot: '09:00', job_description: 'E2E probe booking, deleted by the case.',
        address_line1: '1 Probe Street', city: 'Calgary', payment_intent_id: `pi_e2e_probe_${tag}`,
    };
    const created = await request.post('/api/bookings', { data: body });
    expect(created.status(), 'checkout makes the probe booking').toBe(200);
    const id = (await created.json()).booking_id;
    expect(Number.isInteger(id), 'the probe booking has an id').toBe(true);
    try {
        await run(id);
    } finally {
        await request.delete(`/api/bookings?id=${id}`, { headers: as.admin });
    }
}

// The row as the admin reads it (GET /api/bookings/[id]: b.* and status_history, newest first).
async function bookingAsAdmin(request, as, id) {
    const response = await request.get(`/api/bookings/${id}`, { headers: as.admin });
    expect(response.status(), `admin reads booking ${id}`).toBe(200);
    return (await response.json()).data;
}

// What every refused write must leave as it was.
const standing = (row) => ({ provider_id: row.provider_id, status: row.status, marketplace_pushed_at: row.marketplace_pushed_at });
const WAITING = { provider_id: null, status: 'pending', marketplace_pushed_at: null };

// The status_history rows that match every field of `match`.
const history = (row, match) => row.status_history.filter((entry) => Object.entries(match).every(([field, value]) => entry[field] === value));

const push = (request, as, id) => request.post(`/api/admin/bookings/${id}/push`, { headers: as.admin });

// A first push: 200 with the push time, and not answered `already`.
async function pushes(request, as, id) {
    const response = await push(request, as, id);
    expect(response.status(), `admin pushes booking ${id}`).toBe(200);
    const body = await response.json();
    expect([body.success, body.already, body.message], `booking ${id}: the first push`).toEqual([true, undefined, 'Job pushed to the marketplace.']);
    expect(body.marketplace_pushed_at, `booking ${id}: the push answers its time`).toBeTruthy();
    return body;
}

async function assigns(request, as, id, data) {
    const response = await request.put(`/api/bookings?id=${id}`, { headers: as.admin, data });
    expect(response.status(), `admin updates booking ${id}`).toBe(200);
    expect(await response.json(), `admin updates booking ${id}: body`).toEqual(UPDATED);
}

// The booking's queue_state in the admin job queue, or undefined when the queue does not hold it.
async function queueStateIn(request, as, id) {
    const response = await request.get('/api/bookings?queue=1', { headers: as.admin });
    expect(response.status(), 'admin reads the job queue').toBe(200);
    const body = await response.json();
    expect(body.success, 'the job queue: success').toBe(true);
    return body.data.find((row) => row.id === id)?.queue_state;
}

// Whether each of the two list reads (LISTS) holds the booking.
async function listedIn(request, headers, id, who) {
    const held = [];
    for (const path of LISTS) {
        const response = await request.get(path, { headers });
        expect(response.status(), `${who} reads ${path}`).toBe(200);
        const body = await response.json();
        expect(body.success, `${who} reads ${path}: success`).toBe(true);
        held.push(body.data.some((job) => job.id === id));
    }
    return held;
}

const claimByBody = (context, headers, id) => context.post('/api/provider/available-jobs', { headers, data: { booking_id: id } });
const claimById = (context, headers, id) => context.post(`/api/provider/available-jobs/${id}`, { headers, data: {} });

// The exact answer of a refusal: status and the whole body.
async function expectBody(response, status, body, who) {
    expect(response.status(), `${who}: status`).toBe(status);
    expect(await response.json().catch(() => null), `${who}: body`).toEqual(body);
}

async function expectClaimed(response, who) {
    expect(response.status(), `${who}: status`).toBe(200);
    expect((await response.json()).success, `${who}: success`).toBe(true);
}

// A claim's success as the races compare it (the success message names the service), and a refusal whole.
const answerOf = (answer) => (answer.status === 200 ? { status: 200, success: answer.body?.success } : { status: answer.status, body: answer.body });
const CLAIMED = { status: 200, success: true };
const byNumber = (a, b) => a - b;

// The booking is the provider's, confirmed and off the marketplace, with exactly one confirmed history row, the provider's.
function expectClaimedBy(row, providerId, label) {
    expect(standing(row), `${label}: provider ${providerId}'s, confirmed, off the marketplace`).toEqual({ provider_id: providerId, status: 'confirmed', marketplace_pushed_at: null });
    expect(history(row, { status: 'confirmed' }).map((entry) => entry.notes), `${label}: exactly one confirmed history row, provider ${providerId}'s`).toEqual([`Accepted by provider #${providerId}`]);
}

// The race contexts: one signed-in request context per side, made once per case, each on its own connections. Each is shown
// to reach the handler as the account it stands for before and after the rounds, so a side that lost every round could not
// do so because it was someone else (the guard's 403 has the same body as the by-id claim's).
async function withRaceContexts(playwright, baseURL, sides, run) {
    const contexts = await Promise.all(sides.map(({ headers }) => playwright.request.newContext({ baseURL, extraHTTPHeaders: headers })));
    const identify = async (when) => {
        for (const [index, { who, own }] of sides.entries()) {
            const response = await contexts[index].get(own ? `/api/provider/available-jobs/${own.id}` : `/api/bookings/${BOOKING1.id}`);
            expect(response.status(), `${who}'s context ${when}: status`).toBe(200);
            const body = await response.json();
            expect(own ? [body.data.id, body.is_my_job] : [body.data.id], `${who}'s context ${when}: it reads as ${who}`).toEqual(own ? [own.id, true] : [BOOKING1.id]);
        }
    };
    try {
        await identify('before the rounds');
        await run(contexts);
        await identify('after the rounds');
    } finally {
        await Promise.all(contexts.map((context) => context.dispose()));
    }
}

// ROUNDS rounds: a fresh probe, the admin's push, then `sides` (one request per context for the booking id) sent together with
// Promise.all, and `judge(answers, row, label)` on the two answers ({ status, body }, in `sides` order) and the read-back.
// No race request is retried: a resend would be a second claim.
async function raceRounds(request, as, sides, judge) {
    for (let round = 1; round <= ROUNDS; round += 1) {
        await withProbeBooking(request, as, async (id) => {
            await pushes(request, as, id);
            const responses = await Promise.all(sides.map((send) => send(id)));
            const answers = await Promise.all(responses.map(async (response) => ({ status: response.status(), body: await response.json().catch(() => null) })));
            judge(answers, await bookingAsAdmin(request, as, id), `round ${round}, booking ${id}`);
        });
    }
}

// Two providers race one claim route: exactly one 200, the loser gets `lost` whole, and the booking is the winner's.
function judgeClaims(lost) {
    const ids = [PROVIDER1.id, PROVIDER2.id];
    return (answers, row, label) => {
        expect(answers.map((answer) => answer.status).sort(byNumber), `${label}: the two claims' statuses`).toEqual([200, lost.status].sort(byNumber));
        const winner = answers.findIndex((answer) => answer.status === 200);
        expect(answers.map(answerOf), `${label}: the winner succeeds and the loser gets the route's refusal`).toEqual(answers.map((_, side) => (side === winner ? CLAIMED : lost)));
        expectClaimedBy(row, ids[winner], label);
    };
}

// The five admin writes on a booking: assign, unassign, reassign, restart and push.
const adminWrites = (request, id, assignTo, from) => [
    ['PUT /api/bookings assign', (headers) => request.put(`/api/bookings?id=${id}`, { headers, data: { provider_id: assignTo, status: 'matching' } })],
    ['PUT /api/bookings unassign', (headers) => request.put(`/api/bookings?id=${id}`, { headers, data: { provider_id: null, status: 'pending' } })],
    ['POST /api/bookings/[id]/reassign', (headers) => request.post(`/api/bookings/${id}/reassign`, { headers, data: { new_provider_id: assignTo, old_provider_id: from } })],
    ['POST /api/bookings/[id]/restart', (headers) => request.post(`/api/bookings/${id}/restart`, { headers, data: {} })],
    ['POST /api/admin/bookings/[id]/push', (headers) => request.post(`/api/admin/bookings/${id}/push`, { headers })],
];

// Every admin write, sent with `headers` to a waiting probe and to one assigned to provider 1, answers `status` with `body`
// whole, and the booking is read back after each one: an assign and an unassign that both went through would cancel out.
async function expectWritesRefused(request, as, { headers, status, body, assignTo, who }) {
    await withProbeBooking(request, as, async (waiting) => {
        await withProbeBooking(request, as, async (assigned) => {
            await assigns(request, as, assigned, { provider_id: PROVIDER1.id, status: 'matching' });
            for (const [id, from, label] of [[waiting, null, 'waiting'], [assigned, PROVIDER1.id, 'assigned to provider 1']]) {
                const before = await bookingAsAdmin(request, as, id);
                for (const [write, send] of adminWrites(request, id, assignTo, from)) {
                    await expectBody(await send(headers), status, body, `${who}: ${write} on the ${label} booking`);
                    const after = await bookingAsAdmin(request, as, id);
                    expect(standing(after), `${who}: the ${label} booking after ${write}`).toEqual(standing(before));
                    expect(after.status_history.length, `${who}: the ${label} booking's history after ${write}`).toBe(before.status_history.length);
                }
            }
        });
    });
}

test.describe('Marketplace', () => {
    // M1. The queue reads bookings, not accounts: a guest booking is in it.
    test('an unassigned booking is in the admin job queue as waiting, a guest booking with no account included', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        await withProbeBooking(request, as, async (id) => {
            const row = await bookingAsAdmin(request, as, id);
            expect(row.user_id, 'the probe is a guest booking (no account)').toBeNull();
            expect(standing(row), 'the probe waits: no provider, not pushed, pending').toEqual(WAITING);
            expect(await queueStateIn(request, as, id), `the queue holds booking ${id} as waiting`).toBe('waiting');
        });
    });

    // M2. Every provider surface refuses an unpushed job, from either provider; M3 is the control.
    test("a booking no admin has pushed is not in providers' available jobs, and both claim routes and both job reads refuse it", async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const provider2 = await signedInAs(playwright, baseURL, 'provider2');
        await withProbeBooking(request, as, async (id) => {
            expect(standing(await bookingAsAdmin(request, as, id)), 'the probe has no provider and no push').toEqual(WAITING);
            for (const [who, headers] of [['provider1', as.provider], ['provider2', provider2]]) {
                expect(await listedIn(request, headers, id, who), `${who}: neither list holds booking ${id}`).toEqual([false, false]);
                await expectBody(await request.get(`/api/provider/available-jobs/${id}`, { headers }), 403, FORBIDDEN, `${who} reads it by id`);
                await expectBody(await request.get(`/api/provider/jobs/${id}`, { headers }), 404, NOT_FOUND, `${who} reads it as a job`);
                await expectBody(await claimByBody(request, headers, id), 409, NOT_OFFERED, `${who} claims it through the body route`);
                await expectBody(await claimById(request, headers, id), 403, FORBIDDEN, `${who} claims it by id`);
            }
            const after = await bookingAsAdmin(request, as, id);
            expect(standing(after), 'after the refusals: no provider, no push, pending').toEqual(WAITING);
            expect(history(after, { status: 'confirmed' }), 'no confirmed history row').toHaveLength(0);
        });
    });

    // M3. The push is what opens the job: the same reads M2 refuses serve it to both providers.
    test('an admin push puts a booking on the marketplace: both providers see it in available jobs and by id, and the queue shows it on the marketplace', async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const provider2 = await signedInAs(playwright, baseURL, 'provider2');
        await withProbeBooking(request, as, async (id) => {
            const pushed = await pushes(request, as, id);
            expect(standing(await bookingAsAdmin(request, as, id)), 'after the push: no provider, still pending, the push time it answered').toEqual({ ...WAITING, marketplace_pushed_at: pushed.marketplace_pushed_at });
            for (const [who, headers] of [['provider1', as.provider], ['provider2', provider2]]) {
                expect(await listedIn(request, headers, id, who), `${who}: both lists hold booking ${id}`).toEqual([true, true]);
                const byId = await request.get(`/api/provider/available-jobs/${id}`, { headers });
                expect(byId.status(), `${who} reads it by id: status`).toBe(200);
                const body = await byId.json();
                expect([body.data.id, body.is_available, body.is_my_job], `${who} reads it by id: the booking, available, not theirs`).toEqual([id, true, false]);
                const job = await request.get(`/api/provider/jobs/${id}`, { headers });
                expect(job.status(), `${who} reads it as a job: status`).toBe(200);
                expect((await job.json()).data.id, `${who} reads it as a job: the booking`).toBe(id);
            }
            expect(await queueStateIn(request, as, id), `the queue holds booking ${id} on the marketplace`).toBe('on_marketplace');
        });
    });

    // M4. The column holds whole seconds, so the second push comes more than a second after the first: a second stamp would show.
    test('pushing a booking twice keeps the first push time and answers already', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        await withProbeBooking(request, as, async (id) => {
            const first = await pushes(request, as, id);
            const pushedAt = (await bookingAsAdmin(request, as, id)).marketplace_pushed_at;
            expect(pushedAt, 'the stored push time is the one the push answered').toBe(first.marketplace_pushed_at);
            await new Promise((resolve) => setTimeout(resolve, 1_100));
            await expectBody(await push(request, as, id), 200, { success: true, already: true, marketplace_pushed_at: pushedAt, message: 'This job is already on the marketplace.' }, 'the second push');
            const row = await bookingAsAdmin(request, as, id);
            expect(standing(row), 'after the second push: the first push time').toEqual({ ...WAITING, marketplace_pushed_at: pushedAt });
            expect(history(row, { notes: PUSHED_NOTE }), 'one "Pushed to the marketplace" history row').toHaveLength(1);
        });
    });

    // M5. Only a job waiting for a provider can be pushed; a refused push writes nothing.
    test('a push is refused for a booking that has a provider and for a cancelled booking, and neither changes', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        const refusals = [
            [{ provider_id: PROVIDER1.id, status: 'matching' }, { provider_id: PROVIDER1.id, status: 'matching', marketplace_pushed_at: null }, 'This job already has a provider.', 'a booking assigned to provider 1'],
            [{ status: 'cancelled' }, { provider_id: null, status: 'cancelled', marketplace_pushed_at: null }, 'Only a job waiting for a provider can be pushed to the marketplace.', 'a cancelled booking'],
        ];
        for (const [update, expected, message, what] of refusals) {
            await withProbeBooking(request, as, async (id) => {
                await assigns(request, as, id, update);
                const before = await bookingAsAdmin(request, as, id);
                expect(standing(before), `${what}: before the push`).toEqual(expected);
                await expectBody(await push(request, as, id), 409, { success: false, message }, `the push of ${what}`);
                const after = await bookingAsAdmin(request, as, id);
                expect(standing(after), `${what}: after the refused push`).toEqual(expected);
                expect(after.status_history, `${what}: the history after the refused push`).toEqual(before.status_history);
            });
        }
    });

    // M6. An assignment is seen by the assigned provider only.
    test('an admin assigns a waiting booking to provider 1: provider 1 sees it, provider 2 does not, and the queue shows it assigned', async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const provider2 = await signedInAs(playwright, baseURL, 'provider2');
        await withProbeBooking(request, as, async (id) => {
            await assigns(request, as, id, { provider_id: PROVIDER1.id, status: 'matching' });
            expect(standing(await bookingAsAdmin(request, as, id)), "the probe is provider 1's, matching, not pushed").toEqual({ provider_id: PROVIDER1.id, status: 'matching', marketplace_pushed_at: null });
            expect(await listedIn(request, as.provider, id, 'provider1'), `provider1: both lists hold booking ${id}`).toEqual([true, true]);
            const own = await request.get(`/api/provider/available-jobs/${id}`, { headers: as.provider });
            expect(own.status(), 'provider1 reads it by id: status').toBe(200);
            const body = await own.json();
            expect([body.data.id, body.is_my_job], "provider1 reads it by id: the booking, provider 1's").toEqual([id, true]);
            expect(await listedIn(request, provider2, id, 'provider2'), `provider2: neither list holds booking ${id}`).toEqual([false, false]);
            await expectBody(await request.get(`/api/provider/available-jobs/${id}`, { headers: provider2 }), 403, FORBIDDEN, 'provider2 reads it by id');
            expect(await queueStateIn(request, as, id), `the queue holds booking ${id} as assigned`).toBe('assigned');
        });
    });

    // M7. The assignment clears the push marker, so the job is off the marketplace for everyone else.
    test('assigning a booking that is on the marketplace takes it off the marketplace', async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const provider2 = await signedInAs(playwright, baseURL, 'provider2');
        await withProbeBooking(request, as, async (id) => {
            await pushes(request, as, id);
            expect(await listedIn(request, provider2, id, 'provider2 after the push'), `control: provider2's lists hold booking ${id} once it is pushed`).toEqual([true, true]);
            await assigns(request, as, id, { provider_id: PROVIDER1.id, status: 'matching' });
            expect(await listedIn(request, provider2, id, 'provider2 after the assignment'), `provider2: neither list holds booking ${id}`).toEqual([false, false]);
            await expectBody(await claimByBody(request, provider2, id), 409, TAKEN, 'provider2 claims it through the body route');
            expect(standing(await bookingAsAdmin(request, as, id)), "provider 1's, matching, the push marker cleared").toEqual({ provider_id: PROVIDER1.id, status: 'matching', marketplace_pushed_at: null });
        });
    });

    // M8. A claimed job keeps its provider: the admin's PUT reads the row FOR UPDATE and refuses a different provider.
    test('an admin assignment to a different provider is a 409 while another provider holds the booking, and the provider stays the same', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        await withProbeBooking(request, as, async (id) => {
            await pushes(request, as, id);
            await expectClaimed(await claimByBody(request, as.provider, id), 'provider1 claims it');
            const before = await bookingAsAdmin(request, as, id);
            expectClaimedBy(before, PROVIDER1.id, 'after the claim');
            await expectBody(await request.put(`/api/bookings?id=${id}`, { headers: as.admin, data: { provider_id: PROVIDER2.id } }), 409, HELD, 'admin assigns provider 2');
            const after = await bookingAsAdmin(request, as, id);
            expect(standing(after), 'after the refused assignment').toEqual(standing(before));
            expect(after.status_history, 'the history after the refused assignment').toEqual(before.status_history);
        });
    });

    // M9. An unassigned job waits for the admin again; it does not go back on the marketplace by itself.
    test('unassigning a booking returns it to the queue as waiting, off the marketplace', async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const provider2 = await signedInAs(playwright, baseURL, 'provider2');
        await withProbeBooking(request, as, async (id) => {
            await pushes(request, as, id);
            await assigns(request, as, id, { provider_id: PROVIDER1.id, status: 'matching' });
            await assigns(request, as, id, { provider_id: null, status: 'pending' });
            expect(standing(await bookingAsAdmin(request, as, id)), 'no provider, pending, the push marker cleared').toEqual(WAITING);
            expect(await queueStateIn(request, as, id), `the queue holds booking ${id} as waiting`).toBe('waiting');
            for (const [who, headers] of [['provider1', as.provider], ['provider2', provider2]]) {
                expect(await listedIn(request, headers, id, who), `${who}: neither list holds booking ${id}`).toEqual([false, false]);
            }
        });
    });

    // M10. The body route's claim reads the row FOR UPDATE: the second claim sees the first one's provider and is told it is taken.
    test('two providers claiming one pushed booking at once through POST /api/provider/available-jobs: exactly one succeeds, the other gets 409, and the booking has one provider', async ({ request, baseURL, playwright }) => {
        test.setTimeout(RACE_TIMEOUT);
        const as = await credentials(baseURL);
        const provider2 = await signedInAs(playwright, baseURL, 'provider2');
        const sides = [{ who: 'provider1', headers: as.provider, own: BOOKING1 }, { who: 'provider2', headers: provider2, own: BOOKING2 }];
        await withRaceContexts(playwright, baseURL, sides, async ([one, two]) => {
            await raceRounds(request, as, [(id) => claimByBody(one, {}, id), (id) => claimByBody(two, {}, id)], judgeClaims({ status: 409, body: TAKEN }));
        });
    });

    // M11. The by-id claim answers another provider's job with 403 (ENG-004), so its loser gets the 403, not a 409.
    test('two providers claiming one pushed booking at once through POST /api/provider/available-jobs/[id]: exactly one succeeds, the other gets 403, and the booking has one provider', async ({ request, baseURL, playwright }) => {
        test.setTimeout(RACE_TIMEOUT);
        const as = await credentials(baseURL);
        const provider2 = await signedInAs(playwright, baseURL, 'provider2');
        const sides = [{ who: 'provider1', headers: as.provider, own: BOOKING1 }, { who: 'provider2', headers: provider2, own: BOOKING2 }];
        await withRaceContexts(playwright, baseURL, sides, async ([one, two]) => {
            await raceRounds(request, as, [(id) => claimById(one, {}, id), (id) => claimById(two, {}, id)], judgeClaims({ status: 403, body: FORBIDDEN }));
        });
    });

    // M12. The admin's PUT and a provider's claim both lock the row: whichever is second sees the first one's provider.
    test('an admin assignment and a provider claim on one pushed booking at once: exactly one succeeds and the booking has one provider', async ({ request, baseURL, playwright }) => {
        test.setTimeout(RACE_TIMEOUT);
        const as = await credentials(baseURL);
        const sides = [{ who: 'admin', headers: as.admin, own: null }, { who: 'provider1', headers: as.provider, own: BOOKING1 }];
        // What the booking holds for either winner: the assignment's provider 2 (the PUT names no status, so `matching`, with
        // one 'Status updated' history row), or provider 1's claim (confirmed, its one confirmed row, nothing from the PUT).
        const outcomes = {
            admin: { assign: { status: 200, success: true }, claim: { status: 409, body: TAKEN }, booking: { provider_id: PROVIDER2.id, status: 'matching', marketplace_pushed_at: null }, confirmed: [], assignment: 1 },
            provider: { assign: { status: 409, body: HELD }, claim: CLAIMED, booking: { provider_id: PROVIDER1.id, status: 'confirmed', marketplace_pushed_at: null }, confirmed: [`Accepted by provider #${PROVIDER1.id}`], assignment: 0 },
        };
        await withRaceContexts(playwright, baseURL, sides, async ([admin, provider1]) => {
            const send = [(id) => admin.put(`/api/bookings?id=${id}`, { data: { provider_id: PROVIDER2.id } }), (id) => claimByBody(provider1, {}, id)];
            await raceRounds(request, as, send, ([assign, claim], row, label) => {
                expect([assign.status, claim.status].sort(byNumber), `${label}: the assignment's and the claim's statuses`).toEqual([200, 409]);
                const seen = {
                    assign: answerOf(assign),
                    claim: answerOf(claim),
                    booking: standing(row),
                    confirmed: history(row, { status: 'confirmed' }).map((entry) => entry.notes),
                    assignment: history(row, { status: 'matching', notes: 'Status updated' }).length,
                };
                expect(seen, `${label}: one side succeeds, the other is refused, and the booking is the winner's`).toEqual(assign.status === 200 ? outcomes.admin : outcomes.provider);
            });
        });
    });

    // M13. A claimed job is not offered again: provider 2 is told it is taken (403 by id), provider 1 that it is not available.
    test('a claimed booking refuses a second claim from either provider on both claim routes, and keeps its provider and its one confirmed history row', async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const provider2 = await signedInAs(playwright, baseURL, 'provider2');
        await withProbeBooking(request, as, async (id) => {
            await pushes(request, as, id);
            await expectClaimed(await claimByBody(request, as.provider, id), 'provider1 claims it');
            const before = await bookingAsAdmin(request, as, id);
            expectClaimedBy(before, PROVIDER1.id, 'after the claim');
            await expectBody(await claimByBody(request, provider2, id), 409, TAKEN, 'provider2 claims it through the body route');
            await expectBody(await claimById(request, provider2, id), 403, FORBIDDEN, 'provider2 claims it by id');
            await expectBody(await claimByBody(request, as.provider, id), 409, NOT_OFFERED, 'provider1 claims it again through the body route');
            await expectBody(await claimById(request, as.provider, id), 409, { success: false, message: 'Already accepted by another provider' }, 'provider1 claims it again by id');
            const after = await bookingAsAdmin(request, as, id);
            expect(standing(after), 'after the second claims').toEqual(standing(before));
            expect(after.status_history, 'the history after the second claims: one confirmed row').toEqual(before.status_history);
        });
    });

    // M14. Every admin write is behind the guard: no credential is 401 before anything is read.
    test('with no login, assigning, reassigning, unassigning and pushing a booking answer 401, and its provider, status and push time are unchanged', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        await expectWritesRefused(request, as, { headers: as.none, status: 401, body: UNAUTHORIZED, assignTo: PROVIDER2.id, who: 'no login' });
    });

    // M15.
    test('a customer gets 403 assigning, reassigning, unassigning and pushing a booking, and its provider, status and push time are unchanged', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        await expectWritesRefused(request, as, { headers: as.customer, status: 403, body: FORBIDDEN, assignTo: PROVIDER2.id, who: 'customer1' });
    });

    // M16. A provider cannot take a job by assigning it to themselves.
    test('a provider gets 403 assigning a booking to themselves, reassigning, unassigning and pushing it, and its provider, status and push time are unchanged', async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const provider2 = await signedInAs(playwright, baseURL, 'provider2');
        await expectWritesRefused(request, as, { headers: provider2, status: 403, body: FORBIDDEN, assignTo: PROVIDER2.id, who: 'provider2' });
    });
});
