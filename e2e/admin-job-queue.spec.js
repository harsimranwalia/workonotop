// @ts-check
// ENG-010, the two admin screens: the "Job queue" strip on /admin/jobs and the "Push to marketplace" control on the booking page
// (admin/bookings/[id]). The server half, the queue read and the push route, is e2e/marketplace.spec.js; this file drives the pages
// in a browser signed in as the fixture admin. Each title is the baseline key.
//
// Two kinds of case. The strip's paging and failure states are made by answering its own read (GET /api/bookings?queue=1) from the
// case: no fixture queue is long enough to page, and the read does not fail on demand. The rest run against the real app with probe
// bookings made through the public checkout (an email with no account, so each is a guest booking) and deleted as admin in `finally`.
// The strip's first page is 200 bookings, oldest first and a probe is the newest, so the cases that look for a probe in it assume the
// queue holds fewer than 200, as it does on the fixtures.
//
// The pages compile on their first visit in `next dev`, so each case may take a minute.
import { test, expect } from '@playwright/test';
import { getCredentialHeaders } from './auth/credentials.js';
import { signInAs } from './support/auth.js';
import { providers } from '../database/fixtures/accounts.js';

// The cases send the admin's session as a request header and a trace records request headers: tracing is off, as in e2e/marketplace.spec.js.
test.use({ trace: 'off' });
test.describe.configure({ timeout: 120_000 });

const [PROVIDER1] = providers;

// Claims the booking page must not make: that a commission makes a job live, or visible to or hidden from providers, or open to self-assignment.
const FALSE_CLAIMS = [/\bLive\b/, /visible to providers/i, /hidden from providers/i, /self-assign/i];

// The first page a case opens may compile in `next dev` while the machine is busy: the first assertion on it waits longer than the suite's 10 s.
const COLD = { timeout: 60_000 };

const adminOf = async (baseURL) => (await getCredentialHeaders(baseURL))['admin-cookie'];

// The row as the admin reads it (GET /api/bookings/[id]: b.* and status_history).
async function bookingAsAdmin(request, admin, id) {
    const response = await request.get(`/api/bookings/${id}`, { headers: admin });
    expect(response.status(), `admin reads booking ${id}`).toBe(200);
    return (await response.json()).data;
}

async function updates(request, admin, id, data) {
    const response = await request.put(`/api/bookings?id=${id}`, { headers: admin, data });
    expect(response.status(), `admin updates booking ${id}`).toBe(200);
}

// `count` guest bookings made through the public checkout: pending, no provider, not pushed. `run(probes)` gets each one's id and number;
// the rows are deleted as admin, even when `run` fails.
async function withProbeBookings(request, admin, count, run) {
    const probes = [];
    try {
        for (let n = 0; n < count; n++) {
            const tag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
            const created = await request.post('/api/bookings', {
                data: {
                    service_id: 1, service_name: 'Fixture Standard Clean', service_price: 80, additional_price: 40,
                    first_name: 'E2E', last_name: 'Queue', email: `e2e-queue-${tag}@workontap.test`, phone: '+14035550198',
                    job_date: '2026-02-01', job_time_slot: '09:00', job_description: 'E2E probe booking, deleted by the case.',
                    address_line1: '1 Queue Street', city: 'Calgary', payment_intent_id: `pi_e2e_queue_${tag}`,
                },
            });
            expect(created.status(), 'checkout makes the probe booking').toBe(200);
            const id = (await created.json()).booking_id;
            expect(Number.isInteger(id), 'the probe booking has an id').toBe(true);
            probes.push({ id, number: (await bookingAsAdmin(request, admin, id)).booking_number });
        }
        await run(probes);
    } finally {
        for (const probe of probes) await request.delete(`/api/bookings?id=${probe.id}`, { headers: admin });
    }
}

const stripOf = (page) => page.getByRole('region', { name: 'Job queue' });
// A section of the strip: its heading's parent holds the rows.
const sectionOf = (strip, heading) => strip.getByRole('heading', { level: 3, name: heading }).locator('..');

const QUEUE_READ = /\/api\/bookings\?queue=1/;
const queueRow = (id, state, over = {}) => ({
    id, booking_number: `BK-MOCK-${id}`, service_name: 'Mock Clean', job_date: '2026-10-14', city: 'Calgary', provider_name: null, queue_state: state, ...over,
});
// The answers a mocked read can give: a page of the queue, a refusal from the server, and a request that never arrives.
const page_ = (rows, { total = rows.length, offset = 0 } = {}) => (route) => route.fulfill({ json: { success: true, data: rows, total, limit: 200, offset } });
const refused = (route) => route.fulfill({ status: 500, json: { success: false, message: 'Failed to fetch bookings' } });
const dropped = (route) => route.abort('connectionfailed');

// Answers the strip's reads and returns the offsets it asked for, in order: `answerFor(offset)` picks the answer to a read at that offset.
// React's strict mode, on in `next dev`, runs the page's mount effect twice, so the first read arrives twice: an answer follows from the
// offset and from what the case has done so far, never from how many reads came before.
async function answerQueueWith(page, answerFor) {
    const offsets = [];
    await page.route(QUEUE_READ, (route) => {
        const offset = new URL(route.request().url()).searchParams.get('offset');
        offsets.push(offset);
        return answerFor(offset)(route);
    });
    return offsets;
}

test.describe('Admin job queue', () => {
    // The strip is the one place an admin sees every booking waiting for a provider, guest bookings included.
    test('the strip lists a waiting booking, one on the marketplace and an assigned one in their own sections, each with a link to its booking', async ({ page, request, baseURL }) => {
        const admin = await adminOf(baseURL);
        await withProbeBookings(request, admin, 3, async ([waiting, pushed, assigned]) => {
            const pushing = await request.post(`/api/admin/bookings/${pushed.id}/push`, { headers: admin });
            expect(pushing.status(), 'the push of the second probe').toBe(200);
            await updates(request, admin, assigned.id, { provider_id: PROVIDER1.id, status: 'matching' });

            await signInAs(page, 'admin');
            await page.goto('/admin/jobs');
            const strip = stripOf(page);
            for (const [probe, heading, elsewhere] of [
                [waiting, 'Waiting for a provider', ['On the marketplace', 'Assigned, not yet accepted']],
                [pushed, 'On the marketplace', ['Waiting for a provider', 'Assigned, not yet accepted']],
                [assigned, 'Assigned, not yet accepted', ['Waiting for a provider', 'On the marketplace']],
            ]) {
                const link = sectionOf(strip, heading).getByRole('link', { name: new RegExp(probe.number) });
                await expect(link, `${probe.number} is under "${heading}"`).toBeVisible(COLD);
                await expect(link, `${probe.number} links to its booking page`).toHaveAttribute('href', `/admin/bookings/${probe.id}`);
                await expect(link, `${probe.number} shows its service and city`).toContainText(/Fixture Standard Clean\s*\S.*Calgary/);
                for (const other of elsewhere) {
                    await expect(sectionOf(strip, other).getByRole('link', { name: new RegExp(probe.number) }), `${probe.number} is not under "${other}"`).toHaveCount(0);
                }
            }
            await expect(sectionOf(strip, 'Assigned, not yet accepted').getByRole('link', { name: new RegExp(assigned.number) }), 'an assigned row names its provider').toContainText(`Assigned to ${PROVIDER1.name}`);
        });
    });

    test('the strip says nothing is waiting for a provider when the whole queue is empty', async ({ page }) => {
        await signInAs(page, 'admin');
        await answerQueueWith(page, () => page_([]));
        await page.goto('/admin/jobs');
        const strip = stripOf(page);
        await expect(strip.getByText('Nothing is waiting for a provider.')).toBeVisible();
        for (const heading of ['Waiting for a provider', 'On the marketplace', 'Assigned, not yet accepted']) {
            await expect(sectionOf(strip, heading).getByRole('link'), `"${heading}" holds no row`).toHaveCount(0);
        }
    });

    test('the strip says it is loading, then shows an error with a way to try again, whether the request is lost or refused, and the rows once it can be read', async ({ page }) => {
        await signInAs(page, 'admin');
        let release = () => {};
        const held = new Promise((resolve) => { release = resolve; });
        // What the read does from now on: waits and is then lost, is refused by the server, or is answered.
        let reads = 'lost';
        const offsets = await answerQueueWith(page, () => {
            if (reads === 'lost') return async (route) => { await held; return dropped(route); };
            return reads === 'refused' ? refused : page_([queueRow(1, 'waiting')]);
        });
        await page.goto('/admin/jobs');
        const strip = stripOf(page);
        const failure = strip.getByText('Couldn’t load the job queue.');
        const retry = strip.getByRole('button', { name: 'Try again' });
        await expect(strip.getByText('Loading the job queue…'), 'while the first read is out').toBeVisible();
        release();
        await expect(failure, 'after a request that was lost').toBeVisible();

        reads = 'refused';
        const refusal = page.waitForResponse((response) => QUEUE_READ.test(response.url()));
        await retry.click();
        expect((await refusal).status(), 'the retry was refused').toBe(500);
        await expect(failure, 'after a refusal').toBeVisible();

        reads = 'answered';
        await retry.click();
        await expect(sectionOf(strip, 'Waiting for a provider').getByRole('link', { name: /BK-MOCK-1/ }), 'once the queue can be read').toBeVisible();
        await expect(failure).toHaveCount(0);
        expect([...new Set(offsets)], 'every read, a retry too, starts at offset 0').toEqual(['0']);
    });

    test('the strip says how many of the queue it holds, does not claim that nothing is waiting while a page is unread, and loads the next page at the offset it reached', async ({ page }) => {
        await signInAs(page, 'admin');
        // Three bookings, read two at a time; the first read of the second page is refused.
        let refuseNext = true;
        const offsets = await answerQueueWith(page, (offset) => {
            if (offset === '0') {
                return page_([queueRow(1, 'assigned', { provider_name: 'Mock Provider' }), queueRow(2, 'assigned', { provider_name: 'Mock Provider' })], { total: 3 });
            }
            if (refuseNext) {
                refuseNext = false;
                return refused;
            }
            return page_([queueRow(3, 'waiting')], { total: 3, offset: 2 });
        });
        await page.goto('/admin/jobs');
        const strip = stripOf(page);
        const more = strip.getByRole('button', { name: 'Load more' });
        await expect(strip.getByText('Showing 2 of 3 in the queue.')).toBeVisible();
        // No waiting row is held, but a page is unread: "Nothing is waiting" would be a guess.
        await expect(strip.getByText('Nothing is waiting for a provider.')).toHaveCount(0);

        await more.click();
        await expect(strip.getByText('Couldn’t load more of the queue.'), 'a page that fails keeps the rows held').toBeVisible();
        await expect(sectionOf(strip, 'Assigned, not yet accepted').getByRole('link'), 'the two rows held stay').toHaveCount(2);
        await more.click();
        await expect(sectionOf(strip, 'Waiting for a provider').getByRole('link', { name: /BK-MOCK-3/ })).toBeVisible();
        await expect(strip.getByText(/Showing \d+ of \d+/), 'the whole queue is held').toHaveCount(0);
        await expect(more).toHaveCount(0);
        await expect(sectionOf(strip, 'Assigned, not yet accepted').getByRole('link'), 'the first page is still there').toHaveCount(2);
        expect(offsets.filter((offset) => offset !== '0'), 'the page that failed is asked again at the same offset').toEqual(['2', '2']);
    });

    // Offset paging over a live queue skips a row when one ahead of the offset leaves it.
    test('the strip reads again from offset 0 when the total of the queue moved between pages, so no row is skipped', async ({ page }) => {
        await signInAs(page, 'admin');
        // Three bookings, read two at a time; by the time the second page is read the first booking has left the queue, so the page at
        // offset 2 is empty and the queue, read from 0, is two bookings.
        let moved = false;
        const offsets = await answerQueueWith(page, (offset) => {
            if (offset === '2') {
                moved = true;
                return page_([], { total: 2, offset: 2 });
            }
            return moved
                ? page_([queueRow(2, 'waiting'), queueRow(3, 'waiting')], { total: 2 })
                : page_([queueRow(1, 'waiting'), queueRow(2, 'waiting')], { total: 3 });
        });
        await page.goto('/admin/jobs');
        const strip = stripOf(page);
        await expect(strip.getByText('Showing 2 of 3 in the queue.')).toBeVisible();

        await strip.getByRole('button', { name: 'Load more' }).click();
        const waiting = sectionOf(strip, 'Waiting for a provider');
        await expect(waiting.getByRole('link', { name: /BK-MOCK-3/ }), 'the row the offset would have skipped').toBeVisible();
        await expect(waiting.getByRole('link', { name: /BK-MOCK-2/ })).toBeVisible();
        await expect(waiting.getByRole('link', { name: /BK-MOCK-1/ }), 'the row that left the queue is gone').toHaveCount(0);
        await expect(waiting.getByRole('link'), 'each row once').toHaveCount(2);
        await expect(strip.getByText(/Showing \d+ of \d+/)).toHaveCount(0);
        expect(offsets.slice(offsets.indexOf('2')), 'the next page, then the queue again from offset 0').toEqual(['2', '0']);
    });

    test('the strip shows a booking once when the next page repeats one it already holds', async ({ page }) => {
        await signInAs(page, 'admin');
        // The total has not moved, so the strip does not read again from 0: a booking joined the queue ahead of the offset while another
        // left it behind, and the second page starts with a row the first page held.
        await answerQueueWith(page, (offset) => (offset === '0'
            ? page_([queueRow(1, 'waiting'), queueRow(2, 'waiting')], { total: 3 })
            : page_([queueRow(2, 'waiting'), queueRow(3, 'waiting')], { total: 3, offset: 2 })));
        await page.goto('/admin/jobs');
        const strip = stripOf(page);
        await strip.getByRole('button', { name: 'Load more' }).click();
        const waiting = sectionOf(strip, 'Waiting for a provider');
        await expect(waiting.getByRole('link', { name: /BK-MOCK-3/ })).toBeVisible();
        await expect(waiting.getByRole('link', { name: /BK-MOCK-2/ }), 'the repeated booking is listed once').toHaveCount(1);
        await expect(waiting.getByRole('link'), 'the three bookings of the queue').toHaveCount(3);
    });

    test.describe('in a browser west of Greenwich', () => {
        test.use({ timezoneId: 'America/Toronto' });

        // A date-only string reads as UTC midnight; formatted in the viewer's own zone it would show the day before here.
        test('the strip shows a booking date as it is stored, not the day before', async ({ page }) => {
            await signInAs(page, 'admin');
            await answerQueueWith(page, () => page_([
                queueRow(1, 'waiting', { job_date: '2026-10-14' }),
                queueRow(2, 'waiting', { job_date: '2026-10-15, 2026-10-16' }),
            ]));
            await page.goto('/admin/jobs');
            const waiting = sectionOf(stripOf(page), 'Waiting for a provider');
            await expect(waiting.getByRole('link', { name: /BK-MOCK-1/ })).toContainText('14 Oct');
            await expect(waiting.getByRole('link', { name: /BK-MOCK-2/ })).toContainText('15 Oct, 16 Oct');
        });
    });

    // The push is the admin's deliberate act; the page shows what the server answered.
    test('Push to marketplace puts a waiting booking on the marketplace: the server\'s message, the time under a disabled button, and the queue holds it on the marketplace', async ({ page, request, baseURL }) => {
        const admin = await adminOf(baseURL);
        await withProbeBookings(request, admin, 1, async ([probe]) => {
            await signInAs(page, 'admin');
            await page.goto(`/admin/bookings/${probe.id}`);
            const push = page.getByRole('button', { name: 'Push to marketplace' });
            await expect(push).toBeEnabled(COLD);
            await expect(page.getByText(/On the marketplace since/)).toHaveCount(0);

            // From the keyboard, as a button should be.
            await push.focus();
            await page.keyboard.press('Enter');
            await expect(page.getByText('Job pushed to the marketplace.'), "the server's message is the toast").toBeVisible();
            await expect(page.getByText(/^On the marketplace since \S/)).toBeVisible();
            await expect(push).toBeDisabled();
            await expect(push, 'the time is the button\'s description').toHaveAccessibleDescription(/^On the marketplace since /);

            const queue = await request.get('/api/bookings?queue=1', { headers: admin });
            expect(queue.status(), 'admin reads the job queue').toBe(200);
            expect((await queue.json()).data.find((row) => row.id === probe.id)?.queue_state, 'the queue holds the booking on the marketplace').toBe('on_marketplace');

            await page.reload();
            await expect(page.getByText(/^On the marketplace since \S/), 'a reload reads it from the stored time').toBeVisible();
            await expect(page.getByRole('button', { name: 'Push to marketplace' })).toBeDisabled();
        });
    });

    test('Push to marketplace shows the server\'s refusal when the booking got a provider after the page opened, and the booking is not pushed', async ({ page, request, baseURL }) => {
        const admin = await adminOf(baseURL);
        await withProbeBookings(request, admin, 1, async ([probe]) => {
            await signInAs(page, 'admin');
            await page.goto(`/admin/bookings/${probe.id}`);
            const push = page.getByRole('button', { name: 'Push to marketplace' });
            await expect(push).toBeEnabled(COLD);

            await updates(request, admin, probe.id, { provider_id: PROVIDER1.id, status: 'matching' });
            await push.click();
            await expect(page.getByText('This job already has a provider.'), "the server's 409 message is the toast").toBeVisible();
            await expect(page.getByText(/On the marketplace since/)).toHaveCount(0);

            const row = await bookingAsAdmin(request, admin, probe.id);
            expect([row.provider_id, row.marketplace_pushed_at], 'the refused push changed nothing').toEqual([PROVIDER1.id, null]);
        });
    });

    test('the booking page offers the push only to a booking waiting for a provider, and says nothing of a commission making a job live or visible to providers', async ({ page, request, baseURL }) => {
        const admin = await adminOf(baseURL);
        await withProbeBookings(request, admin, 3, async ([waiting, assigned, cancelled]) => {
            // With a commission set on the waiting booking, the page shows no Live badge and no claim that the commission publishes the job.
            await updates(request, admin, waiting.id, { commission_percent: 20 });
            await updates(request, admin, assigned.id, { provider_id: PROVIDER1.id, status: 'matching' });
            await updates(request, admin, cancelled.id, { status: 'cancelled' });

            await signInAs(page, 'admin');
            for (const [probe, pushable] of [[waiting, true], [assigned, false], [cancelled, false]]) {
                await page.goto(`/admin/bookings/${probe.id}`);
                await expect(page.getByRole('heading', { name: 'Provider Assignment' })).toBeVisible(COLD);
                await expect(page.getByRole('button', { name: 'Push to marketplace' }), `booking ${probe.number}: the push button`).toHaveCount(pushable ? 1 : 0);
                const text = await page.locator('body').innerText();
                for (const claim of FALSE_CLAIMS) {
                    expect(text, `booking ${probe.number}: the page does not say ${claim}`).not.toMatch(claim);
                }
            }
            await page.goto(`/admin/bookings/${waiting.id}`);
            await expect(page.getByText('Assign a provider, or push this job to the marketplace so providers can claim it.')).toBeVisible();
        });
    });
});
