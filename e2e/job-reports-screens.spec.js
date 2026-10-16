// @ts-check
// ENG-017: the screens of the on-site reports, in a browser. The "Screens" row of the design's "Cases and baseline" table
// (agents/architect/designs/ENG-017-on-site-reports-and-added-item-approval.md): the Reports card of /job/{token} and the office's queue on /admin/jobs
// with the add-items dialog. The routes' own cases are in e2e/job-reports.spec.js; these cases drive the screens against answers a case scripts with
// page.route, so they read and write no row, make no job and touch no Stripe: the charge route is intercepted in every case that reaches it, and a case
// reads what the screen sent from the request it caught. The admin is the one real thing, since the page is behind the sign-in.
// A photo is a 1 x 1 PNG, which the browser decodes and the page draws into a JPEG before it sends.
import { test, expect } from '@playwright/test';
import { signInAs } from './support/auth.js';

// The admin signs in through the route, so no stored session is wanted, and a trace records request headers.
test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

const FIRST_VISIT_MS = 45_000;
const ADMIN_FIRST_VISIT_MS = 120_000;
const TOKEN = 'eng017-screens-token';
const PHOTO_URL = '/uploads/job-photos/0123456789abcdef0123456789abcdef.png';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const TYPES = ['Customer did not answer', 'Job details are incorrect', 'Unhygienic conditions', 'Add more items', 'Unable to complete the job'];

const TIMER = {
  state: 'running',
  can: { start: false, pause: true, resume: false },
  per_member: [{ id: 1, name: 'Dana', worked_seconds: 600, checked_in_at: '2026-10-16T15:00:00.000Z', checked_out_at: null }],
  quote_minutes: 120,
  crew_here: 1,
  used_seconds: 600,
  clock_seconds: 6600,
  over_seconds: null,
  over_quote_at: null,
  blocked: null,
};

// A report as the cleaner's page lists it.
const sentReport = (over = {}) => ({
  id: 501,
  type: 'unhygienic',
  label: 'Unhygienic conditions',
  note: 'Mould on the bathroom ceiling.',
  photo: PHOTO_URL,
  by: { kind: 'cleaner', name: 'Dana' },
  at: '2026-10-16T15:05:00.000Z',
  seen: false,
  ...over,
});

const jobAnswer = (reports, can = true) => ({
  access: 'cleaner',
  you: { kind: 'cleaner', name: 'Dana' },
  job: {
    service_name: 'Standard clean',
    address: { line1: '1 Main St', line2: '', city: 'Calgary', postal_code: 'T2P 1A1' },
    details: { description: 'Two bedrooms', instructions: '', timing_note: '', parking: true, elevator: false, pets: false, worker_count: 1 },
    days: ['Fri, Oct 16'],
  },
  crew: [{ id: 1, name: 'Dana', number_state: 'checked', checked_in: can, checked_in_at: can ? '2026-10-16T15:00:00.000Z' : null, checked_out_at: null }],
  window: { open: true, opens_label: '' },
  timer: TIMER,
  photos: [],
  photo_can: { before: false, after: false },
  reports,
  report_can: can,
});

/** The fields of a multipart body a case caught, by name (the text parts only). */
function fieldsOf(request) {
  const body = request.postData() || '';
  const found = {};
  for (const match of body.matchAll(/name="([a-z_]+)"(?:; filename="[^"]*")?\r\n(?:[^\r\n]+\r\n)*\r\n([^\r\n]*)\r\n/g)) found[match[1]] = match[2];
  return found;
}

/**
 * Scripts the job link: `state.reports` is what the page lists, `state.can` whether a report may be sent, and `onSend(request, state)` answers a report.
 * @param {import('@playwright/test').Page} page
 */
async function scriptJob(page, state, onSend) {
  await page.route((url) => url.pathname === `/api/job/${TOKEN}`, (route) =>
    route.fulfill({ status: 200, json: { success: true, data: jobAnswer(state.reports, state.can) } }));
  await page.route(`**/api/job/${TOKEN}/timer`, (route) => route.fulfill({ status: 200, json: { success: true, data: { timer: TIMER } } }));
  await page.route(`**/api/job/${TOKEN}/reports`, (route) => onSend(route, state));
  await page.route('**/uploads/job-photos/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
}

/** An answer to a send that kept the report. */
function kept(state, request) {
  const fields = fieldsOf(request);
  const label = TYPES.find((one, index) => ['no_answer', 'details_wrong', 'unhygienic', 'add_items', 'cannot_complete'][index] === fields.type) || 'Report';
  state.reports = [sentReport({ id: 600 + state.reports.length, type: fields.type, label, note: fields.note }), ...state.reports];
  return { status: 200, json: { success: true, data: { report: state.reports[0], reports: state.reports } } };
}

async function fillAndPhoto(page, choice, note) {
  await page.getByRole('button', { name: choice, exact: true }).click();
  await page.getByLabel(choice === 'Add more items' ? 'What needs to be added, and where?' : 'What did you find?').fill(note);
  await page.locator('input[data-report-photo]').setInputFiles({ name: 'room.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByAltText('The photo for this report')).toBeVisible();
}

test.describe('Reports: the job link', () => {
  test('five buttons in the contract order and words, each at least 44 px tall', async ({ page }) => {
    await scriptJob(page, { reports: [], can: true }, (route) => route.abort());
    await page.goto(`/job/${TOKEN}`, { timeout: FIRST_VISIT_MS });
    const card = page.locator('section', { has: page.getByRole('heading', { name: 'Reports', exact: true }) });
    const buttons = card.getByRole('group').getByRole('button');
    await expect(buttons).toHaveText(TYPES);
    for (const button of await buttons.all()) {
      expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await expect(button).not.toHaveAttribute('aria-disabled', 'true');
    }
  });

  test('a cleaner who is not checked in sees the buttons off and the reason as text', async ({ page }) => {
    await scriptJob(page, { reports: [], can: false }, (route) => route.abort());
    await page.goto(`/job/${TOKEN}`, { timeout: FIRST_VISIT_MS });
    await expect(page.getByText('Check in first, then send a report.')).toBeVisible();
    for (const type of TYPES) await expect(page.getByRole('button', { name: type, exact: true })).toHaveAttribute('aria-disabled', 'true');
    // The button is aria-disabled, which Playwright treats as not enabled, so the press is forced: what is checked is that it opens nothing.
    await page.getByRole('button', { name: TYPES[0], exact: true }).click({ force: true });
    await expect(page.getByLabel('What did you find?')).toHaveCount(0);
  });

  test('Add more items needs a note and a photo, then sends and the list says Sent', async ({ page }) => {
    const state = { reports: [], can: true };
    const caught = [];
    await scriptJob(page, state, (route) => {
      caught.push(fieldsOf(route.request()));
      return route.fulfill(kept(state, route.request()));
    });
    await page.goto(`/job/${TOKEN}`, { timeout: FIRST_VISIT_MS });
    await page.getByRole('button', { name: 'Add more items', exact: true }).click();
    const send = page.getByRole('button', { name: 'Send the report' });
    await expect(page.getByLabel('What needs to be added, and where?')).toBeFocused();
    await expect(send).toHaveAttribute('aria-disabled', 'true');
    await page.getByLabel('What needs to be added, and where?').fill('The oven, inside, and two windows.');
    await expect(send).toHaveAttribute('aria-disabled', 'true');
    await page.locator('input[data-report-photo]').setInputFiles({ name: 'oven.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByAltText('The photo for this report')).toBeVisible();
    await expect(send).not.toHaveAttribute('aria-disabled', 'true');
    await send.click();
    await expect(page.getByText('Report sent. The office has it.')).toBeVisible();
    const list = page.locator('li', { hasText: 'Add more items' }).filter({ hasText: 'Sent' });
    await expect(list).toHaveCount(1);
    expect(caught).toHaveLength(1);
    expect(caught[0]).toMatchObject({ type: 'add_items', note: 'The oven, inside, and two windows.' });
    expect(caught[0].client_token).toMatch(/^[A-Za-z0-9_-]{16,}$/);
  });

  test('a 500 is sent again with the same client_token and the list holds one report', async ({ page }) => {
    const state = { reports: [], can: true };
    const caught = [];
    await scriptJob(page, state, (route) => {
      caught.push(fieldsOf(route.request()));
      return caught.length === 1 ? route.fulfill({ status: 500, json: { success: false } }) : route.fulfill(kept(state, route.request()));
    });
    await page.goto(`/job/${TOKEN}`, { timeout: FIRST_VISIT_MS });
    await fillAndPhoto(page, 'Unhygienic conditions', 'Mould on the bathroom ceiling.');
    await page.getByRole('button', { name: 'Send the report' }).click();
    await expect(page.getByRole('alert').filter({ hasText: "Couldn't send" })).toHaveText("Couldn't send that report. Try again.");
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('Report sent. The office has it.')).toBeVisible();
    expect(caught).toHaveLength(2);
    expect(caught[0].client_token, 'the first send carries a token').toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(caught[1].client_token, 'and the send again carries the same one').toBe(caught[0].client_token);
    await expect(page.locator('li', { hasText: 'Unhygienic conditions' }).filter({ hasText: 'Sent' })).toHaveCount(1);
  });

  test('a 409 shows the server sentence and offers no retry', async ({ page }) => {
    const state = { reports: [], can: true };
    await scriptJob(page, state, (route) => {
      state.can = false;
      return route.fulfill({ status: 409, json: { success: false, message: 'This job is not under way.' } });
    });
    await page.goto(`/job/${TOKEN}`, { timeout: FIRST_VISIT_MS });
    await fillAndPhoto(page, 'Customer did not answer', 'Rang twice, nobody came.');
    await page.getByRole('button', { name: 'Send the report' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'not under way' })).toHaveText('This job is not under way.');
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  });

  test('with the location off the line says so and the send works', async ({ page }) => {
    await page.addInitScript(() => {
      const denied = { state: 'denied', addEventListener() {}, removeEventListener() {} };
      Object.defineProperty(navigator, 'permissions', { value: { query: () => Promise.resolve(denied) }, configurable: true });
      Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: (_ok, fail) => fail({ code: 1 }) }, configurable: true });
    });
    const state = { reports: [], can: true };
    const caught = [];
    await scriptJob(page, state, (route) => {
      caught.push(fieldsOf(route.request()));
      return route.fulfill(kept(state, route.request()));
    });
    await page.goto(`/job/${TOKEN}`, { timeout: FIRST_VISIT_MS });
    await fillAndPhoto(page, 'Job details are incorrect', 'It is a three bedroom, not two.');
    await expect(page.getByText('Your location is off, so this report will not say where you were.')).toBeVisible();
    await page.getByRole('button', { name: 'Send the report' }).click();
    await expect(page.getByText('Report sent. The office has it.')).toBeVisible();
    expect(caught[0]).not.toHaveProperty('latitude');
  });
});

// ---- the office's queue ----

const CATALOGUE = [
  { code: 'fridge', label: 'Inside the fridge', amount: 25, minutes: 15, quote_from: 6 },
  { code: 'oven', label: 'Inside the oven', amount: 40, minutes: 30, quote_from: 3 },
  { code: 'window', label: 'A window', amount: 10, minutes: 5, quote_from: null },
  { code: 'tape', label: 'Sticker removal', amount: 0.25, minutes: 1, quote_from: null },
];

const deskReport = (over = {}) => ({
  id: 501,
  type: 'unhygienic',
  label: 'Unhygienic conditions',
  status: 'open',
  note: 'Mould on the bathroom ceiling.',
  photo: PHOTO_URL,
  at: '2026-10-16T15:05:00.000Z',
  by: { kind: 'cleaner', name: 'Dana' },
  away: 0,
  distance_m: 12,
  booking: { id: 9001, number: 'WOT-9001', service: 'Standard clean', date: '2026-10-16', slot: '09:00-12:00', customer: 'Sam Customer' },
  decision: null,
  added_items: null,
  ...over,
});

const itemsReport = (over = {}) => deskReport({ id: 502, type: 'add_items', label: 'Add more items', note: 'The oven, inside, and two windows.', ...over });

const paidItems = (cents = 6000) => ({
  lines: [{ code: 'oven', label: 'Inside the oven', quantity: 1, amount: 40 }, { code: 'window', label: 'A window', quantity: 2, amount: 10 }],
  cents,
  charge: 'paid',
  reason: null,
  provider_share_cents: 4800,
});

/** What the desk says: `state.reports` is what a read of the queue returns, `state.opened` counts them, and `onDecide(route, state, body)` answers a decision. */
async function scriptDesk(page, state, onDecide) {
  await page.route((url) => url.pathname.startsWith('/api/admin/reports'), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/admin/reports') {
      state.reads = (state.reads || 0) + 1;
      const shown = state.reports.filter((one) => url.searchParams.get('status') === 'all' || one.status === 'open' || (one.status === 'approved' && one.added_items?.charge !== 'paid'));
      const open = state.reports.filter((one) => one.status === 'open' || (one.status === 'approved' && one.added_items?.charge !== 'paid')).length;
      return route.fulfill({ status: 200, json: { success: true, data: { reports: shown, open_count: open, next_before: null } } });
    }
    const id = Number(url.pathname.split('/').pop());
    const report = state.reports.find((one) => one.id === id);
    if (request.method() === 'GET') return route.fulfill({ status: 200, json: { success: true, data: { report, catalogue: CATALOGUE } } });
    return onDecide(route, state, request.postDataJSON(), report);
  });
  await page.route('**/uploads/job-photos/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
}

// The first visit of a cold dev server compiles the page and what it reads, so the wait for the page and for its first read of the queue is as long as the other specs' first admin visit.
async function openDesk(page, state) {
  await signInAs(page, 'admin');
  await page.goto('/admin/jobs', { timeout: ADMIN_FIRST_VISIT_MS });
  await expect(page.getByRole('heading', { name: 'Job Requests', exact: true }).first()).toBeVisible({ timeout: ADMIN_FIRST_VISIT_MS });
  await expect.poll(() => state.reads || 0, { timeout: ADMIN_FIRST_VISIT_MS }).toBeGreaterThan(0);
}

const section = (page) => page.getByTestId('on-site-reports');
const cardOf = (page, id) => page.locator(`[data-report-id="${id}"]`);

test.describe('Reports: the office queue', () => {
  // The shared timeout covers the sign-in and the first visit of a page a cold dev server has not compiled yet.
  test.beforeEach(() => {
    test.setTimeout(240_000);
  });

  test('with nothing waiting the section is not there', async ({ page }) => {
    const state = { reports: [] };
    await scriptDesk(page, state, (route) => route.abort());
    await openDesk(page, state);
    await expect(section(page)).toHaveCount(0);
  });

  test('a report arrives with the next poll', async ({ page }) => {
    const state = { reports: [] };
    await scriptDesk(page, state, (route) => route.abort());
    await page.clock.install();
    await openDesk(page, state);
    await expect(section(page)).toHaveCount(0);
    state.reports = [deskReport()];
    await page.clock.runFor(31_000);
    await expect(section(page).getByRole('heading', { name: 'On-site reports' })).toBeVisible();
    await expect(section(page)).toContainText('1 waiting');
    await expect(cardOf(page, 501)).toContainText('#WOT-9001 · Standard clean · 2026-10-16, 09:00-12:00');
    await expect(cardOf(page, 501)).toContainText('At the address');
  });

  test('Mark as handled sends the note and the card then reads who handled it', async ({ page }) => {
    const state = { reports: [deskReport()] };
    const caught = [];
    await scriptDesk(page, state, (route, held, body, report) => {
      caught.push(body);
      Object.assign(report, { status: 'handled', decision: { by: 'Harry', at: '2026-10-16T16:00:00.000Z', note: 'Called the customer.' } });
      return route.fulfill({ status: 200, json: { success: true, data: { report } } });
    });
    await openDesk(page, state);
    const card = cardOf(page, 501);
    await card.getByLabel('Note for the record (optional)').fill('Called the customer.');
    await card.getByRole('button', { name: 'Mark as handled' }).click();
    await expect(card).toContainText('Handled by Harry');
    await expect(card).toContainText('Called the customer.');
    expect(caught).toEqual([{ action: 'handle', note: 'Called the customer.' }]);
    await expect(card.getByRole('heading', { name: 'Unhygienic conditions' })).toBeFocused();
  });

  test('the dialog: steppers, the total, the $0.50 floor, the quote limit and the share line', async ({ page }) => {
    const state = { reports: [itemsReport()] };
    await scriptDesk(page, state, (route) => route.abort());
    await openDesk(page, state);
    await cardOf(page, 502).getByRole('button', { name: 'Review the items' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add more items' });
    await expect(dialog.getByText('Inside the oven — $40.00 each')).toBeVisible();
    await expect(dialog.getByText('Total $0.00')).toBeVisible();
    const charge = dialog.getByRole('button', { name: /^Charge / });
    await expect(charge).toHaveAttribute('aria-disabled', 'true');
    await expect(dialog.getByText('Choose at least one item to charge.')).toBeVisible();

    await dialog.getByRole('button', { name: 'One more Sticker removal' }).click();
    await expect(dialog.getByText('Total $0.25')).toBeVisible();
    await expect(charge).toHaveAttribute('aria-disabled', 'true');
    await expect(dialog.getByText('The total must be at least $0.50 to be charged.')).toBeVisible();
    await dialog.getByRole('button', { name: 'One more Sticker removal' }).click();
    await expect(dialog.getByText('Total $0.50')).toBeVisible();
    await expect(charge).not.toHaveAttribute('aria-disabled', 'true');
    await expect(charge).toHaveText('Charge $0.50 to the card on file');

    const more = dialog.getByRole('button', { name: 'One more Inside the oven' });
    await more.click();
    await more.click();
    await expect(more).toHaveAttribute('aria-disabled', 'true');
    await expect(dialog.getByText('Needs a quote — not chargeable here')).toBeVisible();
    await expect(dialog.getByText('Total $80.50')).toBeVisible();
    await expect(dialog.getByText('The provider is not paid for these items by this action.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(cardOf(page, 502).getByRole('button', { name: 'Review the items' })).toBeFocused();
  });

  test('a charge that goes through shows the amount on the card and sends the total it showed', async ({ page }) => {
    const state = { reports: [itemsReport()] };
    const caught = [];
    await scriptDesk(page, state, (route, held, body, report) => {
      caught.push(body);
      Object.assign(report, { status: 'approved', decision: { by: 'Harry', at: '2026-10-16T16:00:00.000Z', note: '' }, added_items: paidItems() });
      return route.fulfill({ status: 200, json: { success: true, data: { report } } });
    });
    await openDesk(page, state);
    await cardOf(page, 502).getByRole('button', { name: 'Review the items' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add more items' });
    await dialog.getByRole('button', { name: 'One more Inside the oven' }).click();
    await dialog.getByRole('button', { name: 'One more A window' }).click();
    await dialog.getByRole('button', { name: 'One more A window' }).click();
    await dialog.getByRole('button', { name: 'Charge $60.00 to the card on file' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(cardOf(page, 502)).toContainText('Charged $60.00. Approved by Harry');
    expect(caught).toEqual([{ action: 'approve', extras: [{ code: 'oven', quantity: 1 }, { code: 'window', quantity: 2 }], expected_cents: 6000 }]);
  });

  test('a declined card reads the reason on the card and Try the charge again continues it', async ({ page }) => {
    const state = { reports: [itemsReport()] };
    const caught = [];
    await scriptDesk(page, state, (route, held, body, report) => {
      caught.push(body);
      if (body.action === 'approve') {
        Object.assign(report, { status: 'approved', decision: { by: 'Harry', at: '2026-10-16T16:00:00.000Z', note: '' }, added_items: { ...paidItems(), charge: 'failed', reason: 'declined' } });
        return route.fulfill({ status: 402, json: { success: false, message: 'The card was declined.', report } });
      }
      Object.assign(report, { added_items: paidItems() });
      return route.fulfill({ status: 200, json: { success: true, data: { report } } });
    });
    await openDesk(page, state);
    await cardOf(page, 502).getByRole('button', { name: 'Review the items' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add more items' });
    await dialog.getByRole('button', { name: 'One more Inside the oven' }).click();
    await dialog.getByRole('button', { name: /^Charge / }).click();
    const card = cardOf(page, 502);
    await expect(card).toContainText('The card was declined. Nothing was charged.');
    await expect(card.getByRole('button', { name: 'Decline' })).toBeVisible();
    await card.getByRole('button', { name: 'Try the charge again' }).click();
    await expect(card).toContainText('Charged $60.00');
    expect(caught.map((one) => one.action)).toEqual(['approve', 'retry']);
  });

  test('a changed price shows the new total and the next charge sends it', async ({ page }) => {
    const state = { reports: [itemsReport()] };
    const caught = [];
    await scriptDesk(page, state, (route, held, body, report) => {
      caught.push(body);
      if (caught.length === 1) return route.fulfill({ status: 409, json: { success: false, message: 'The price changed.', cents: 5500 } });
      Object.assign(report, { status: 'approved', decision: { by: 'Harry', at: '2026-10-16T16:00:00.000Z', note: '' }, added_items: paidItems(5500) });
      return route.fulfill({ status: 200, json: { success: true, data: { report } } });
    });
    await openDesk(page, state);
    await cardOf(page, 502).getByRole('button', { name: 'Review the items' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add more items' });
    await dialog.getByRole('button', { name: 'One more Inside the oven' }).click();
    await dialog.getByRole('button', { name: 'Charge $40.00 to the card on file' }).click();
    await expect(dialog.getByText('The price list changed since you opened this. The total is now $55.00. Check it, then charge.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Charge $55.00 to the card on file' }).click();
    await expect(dialog).toHaveCount(0);
    expect(caught.map((one) => one.expected_cents)).toEqual([4000, 5500]);
  });

  test('at 360 px wide nothing scrolls sideways, with a card and with the dialog open', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    const state = { reports: [deskReport(), itemsReport()] };
    await scriptDesk(page, state, (route) => route.abort());
    await openDesk(page, state);
    await expect(cardOf(page, 502)).toBeVisible();
    // The page around the section has its own width; what is measured is every box the section and the dialog draw.
    const wide = () => page.evaluate(() => {
      const limit = document.documentElement.clientWidth + 1;
      const boxes = document.querySelectorAll('[data-testid="on-site-reports"], [data-testid="on-site-reports"] *, dialog, dialog *');
      return Array.from(boxes).some((box) => box.getBoundingClientRect().right > limit);
    });
    expect(await wide()).toBe(false);
    await cardOf(page, 502).getByRole('button', { name: 'Review the items' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add more items' });
    await expect(dialog.getByText('Total $0.00')).toBeVisible();
    expect(await wide()).toBe(false);
    const box = await dialog.boundingBox();
    expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 999) <= 360).toBe(true);
  });

  test('the keyboard reaches a card in reading order and the dialog keeps the focus inside', async ({ page }) => {
    const state = { reports: [itemsReport()] };
    await scriptDesk(page, state, (route) => route.abort());
    await openDesk(page, state);
    const card = cardOf(page, 502);
    await card.getByRole('link', { name: /#WOT-9001/ }).focus();
    await page.keyboard.press('Tab');
    await expect(card.getByRole('link', { name: /Photo sent with the report/ })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(card.getByRole('button', { name: 'Review the items' })).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Add more items' });
    await expect(dialog.getByRole('heading', { name: 'Add more items' })).toBeFocused();
    for (let step = 0; step < 5; step += 1) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('dialog') !== null)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Review the items' })).toBeFocused();
  });
});
