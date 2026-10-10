// @ts-check
// ENG-025 (design ENG-004, "Interfaces: Ownership" and "Mobile app", group 4; ticket ENG-025): GET /api/bookings/[id]/invoice/download
// answers the booking's own customer and admins. Each case is titled `Invoice download GET /api/bookings/[id]/invoice/download: <what>`
// (the title is the baseline key), and each case's comment names the one-line change that must turn it red.
//
// What the cases check, against the route's file (src/app/api/bookings/[id]/invoice/download/route.js):
//   (a) no login is 401 { success: false, message: 'Unauthorized' }, and a provider is 403 { success: false, message: 'Forbidden' }, before
//       the booking is read (a booking that does not exist is 401 or 403 too, not 404);
//   (b) a customer asking for another customer's booking is 403 with exactly that body and, by absence, none of the other booking's
//       fixture strings anywhere in it. The guard's wrong-role 403 has the same body, so every foreign case is sent with the RIGHT role
//       (a customer for another customer's booking): only the handler's own clause can produce it;
//   (c) the owner and an admin get a PDF: 200, application/pdf, an attachment named after the booking's invoice number, and a body that
//       starts with %PDF-. Whose invoice it is shows in that file name (the fixture invoices are INV-FIXTURE-0001 and -0002);
//   (d) a browser page visit (Accept: text/html) that carries no login is answered 307 to the website's customer login with a return
//       path to the invoice; nothing else is redirected: not a request that does not ask for HTML, not someone who is signed in, not a
//       booking number that is not digits;
//   (e) in a real browser, the login page the redirect names brings the customer back to the invoice and the PDF downloads.
//
// The two id spaces overlap (customer 1, provider 1 and booking 1 all have id 1; customer 2, provider 2 and booking 2 likewise), so a
// clause that compared the wrong column would pass on the two fixture bookings. The case about the owner makes a booking whose id,
// owner and provider differ and asks for it as both customers.
//
// Fixture rows: database/fixtures/accounts.js and bookings.js (booking 1 is customer 1's with provider 1 and invoice INV-FIXTURE-0001,
// booking 2 customer 2's with provider 2 and invoice INV-FIXTURE-0002). The one case that needs another booking makes it through the
// public checkout (POST /api/bookings) and deletes it again as admin in `finally`; nothing else writes.
import { test, expect } from '@playwright/test';
import { getCredentialHeaders } from './auth/credentials.js';
import { RESET_RETRIES } from './support/auth.js';
import { users, FIXTURE_LOGINS } from '../database/fixtures/accounts.js';
import { bookings } from '../database/fixtures/bookings.js';

// Every request carries a fixture account's session header and a trace records request headers: tracing is off, as in
// e2e/auth-matrix.spec.js. A failure message names the case, the status and the account, never a header.
test.use({ trace: 'off' });

const [CUSTOMER1, CUSTOMER2] = users;
const [BOOKING1, BOOKING2] = bookings.tables.bookings;
const [INVOICE1, INVOICE2] = bookings.tables.invoices;
const MISSING = 999999999;

const UNAUTHORIZED = { success: false, message: 'Unauthorized' };
const FORBIDDEN = { success: false, message: 'Forbidden' };

// What only booking 2 and customer 2 carry (the strings customer 1 must never be shown), and booking 1 and customer 1 for the other way.
const strings = (booking, invoice, customer) => [booking.booking_number, invoice.invoice_number, booking.customer_email, booking.customer_phone, booking.address_line1, booking.job_description, customer.email, customer.phone];
const BOOKING1_STRINGS = strings(BOOKING1, INVOICE1, CUSTOMER1);
const BOOKING2_STRINGS = strings(BOOKING2, INVOICE2, CUSTOMER2);

// What a browser sends for a page visit.
const BROWSER = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8' };

const pathOf = (id) => `/api/bookings/${id}/invoice/download`;
const loginFor = (id) => `/login?redirect=${encodeURIComponent(pathOf(id))}`;

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

// The request as the route sees it, with no redirect followed, so a 307 is seen as a 307.
const ask = (request, id, headers = {}) => request.get(pathOf(id), { headers, maxRedirects: 0 });

// Signs customer 2 in through their own login route and returns the session cookie as a request header. The token is cut out of the
// storage state and put in a header; it is never printed.
async function customer2Headers(playwright, baseURL) {
    const login = FIXTURE_LOGINS.customer2;
    const context = await playwright.request.newContext({ baseURL });
    try {
        const response = await context.post(login.loginRoute, { data: { email: login.email, password: login.password }, maxRetries: RESET_RETRIES, timeout: 60_000 });
        expect(response.status(), 'customer 2 signs in').toBe(200);
        const held = (await context.storageState()).cookies.find((entry) => entry.name === 'customer_token');
        expect(held, "customer 2's customer_token cookie").toBeTruthy();
        return { cookie: `customer_token=${held?.value}` };
    } finally {
        await context.dispose();
    }
}

// A JSON refusal and nothing more: the status, EXACTLY the body, no attachment, and none of `absent` anywhere in the text.
async function expectRefusal(response, status, body, who, absent = []) {
    expect(response.status(), `${who}: status`).toBe(status);
    expect(response.headers()['content-type'] ?? '', `${who}: a JSON refusal, not a document`).toContain('application/json');
    expect(response.headers()['content-disposition'], `${who}: no attachment`).toBeUndefined();
    expect(response.headers()['location'], `${who}: no redirect`).toBeUndefined();
    const text = await response.text();
    expect(JSON.parse(text), `${who}: exactly the refusal and nothing else`).toEqual(body);
    for (const value of absent) {
        expect(text.includes(String(value)), `${who}: the body holds ${JSON.stringify(value)}`).toBe(false);
    }
}

// The PDF: 200, application/pdf, an attachment named for `invoiceNumber`, and bytes that start like a PDF.
async function expectInvoice(response, who, invoiceNumber) {
    expect(response.status(), `${who}: status`).toBe(200);
    expect(response.headers()['content-type'], `${who}: content type`).toBe('application/pdf');
    expect(response.headers()['content-disposition'], `${who}: the attachment's name`).toBe(`attachment; filename="Invoice-${invoiceNumber}.pdf"`);
    const bytes = await response.body();
    expect(bytes.subarray(0, 5).toString('latin1'), `${who}: the body starts like a PDF`).toBe('%PDF-');
    expect(bytes.length, `${who}: the PDF has pages`).toBeGreaterThan(1000);
}

// The control of an absence case: the admin is served the invoice of the booking, so a caller who is refused it was held back by the route.
async function expectServedToAdmin(request, as, booking, invoice, who) {
    await expectInvoice(await ask(request, booking.id, as.admin), `control, ${who}: the admin asks for booking ${booking.id}`, invoice.invoice_number);
}

test.describe('Invoice download: GET /api/bookings/[id]/invoice/download', () => {
    // Red if the guard call and its refusal are deleted (the PDF would be served), or if the booking is read before the guard (the missing
    // booking would be 404).
    test('Invoice download GET /api/bookings/[id]/invoice/download: a request with no login is 401 and shows nothing of the booking, whichever booking it names', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        await expectServedToAdmin(request, as, BOOKING1, INVOICE1, 'booking 1');
        for (const id of [BOOKING1.id, BOOKING2.id, MISSING]) {
            await expectRefusal(await ask(request, id), 401, UNAUTHORIZED, `no login asks for booking ${id}`, [...BOOKING1_STRINGS, ...BOOKING2_STRINGS]);
        }
        // A request that asks for JSON says so with an Accept header; it is not a page visit either.
        await expectRefusal(await ask(request, BOOKING1.id, { accept: 'application/json' }), 401, UNAUTHORIZED, 'no login, Accept: application/json');
    });

    // Red if a provider's role is allowed (the roles list gains 'provider'): the provider assigned to booking 1 would be served its invoice.
    test('Invoice download GET /api/bookings/[id]/invoice/download: a provider is 403 by cookie and by Bearer, even for the booking they are assigned to', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        for (const [style, headers] of [['cookie', as.provider], ['bearer', as.providerBearer]]) {
            for (const id of [BOOKING1.id, BOOKING2.id, MISSING]) {
                await expectRefusal(await ask(request, id, headers), 403, FORBIDDEN, `provider1 by ${style} asks for booking ${id}`, [...BOOKING1_STRINGS, ...BOOKING2_STRINGS]);
            }
        }
    });

    // Red if the handler's ownership clause is deleted or reads another column (customer 1 would be served customer 2's invoice), or if the owner is read
    // from a parameter of the request.
    test("Invoice download GET /api/bookings/[id]/invoice/download: customer1 asking for customer 2's booking is 403 and shows none of its data, and customer 2 asking for customer 1's likewise", async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const customer2 = await customer2Headers(playwright, baseURL);
        await expectServedToAdmin(request, as, BOOKING2, INVOICE2, 'booking 2');
        for (const [style, headers] of [['cookie', as.customer], ['bearer', as.customerBearer]]) {
            await expectRefusal(await ask(request, BOOKING2.id, headers), 403, FORBIDDEN, `customer1 by ${style} asks for booking 2`, BOOKING2_STRINGS);
            // A browser page visit by a signed-in customer is refused the same way, not sent to a login.
            await expectRefusal(await ask(request, BOOKING2.id, { ...headers, ...BROWSER }), 403, FORBIDDEN, `customer1 by ${style} visits booking 2 in a browser`, BOOKING2_STRINGS);
        }
        await expectRefusal(await ask(request, BOOKING1.id, customer2), 403, FORBIDDEN, 'customer2 asks for booking 1', BOOKING1_STRINGS);
        // Who is asking is the session and nothing in the request: a parameter that names the booking's owner changes no answer.
        const naming = `?user_id=${BOOKING1.user_id}&customer_id=${BOOKING1.user_id}&email=${encodeURIComponent(BOOKING1.customer_email)}`;
        await expectRefusal(await request.get(pathOf(BOOKING1.id) + naming, { headers: customer2, maxRedirects: 0 }), 403, FORBIDDEN, 'customer2 asks for booking 1 and names customer 1 as the owner', BOOKING1_STRINGS);
        await expectRefusal(await request.get(pathOf(BOOKING1.id) + naming, { maxRedirects: 0 }), 401, UNAUTHORIZED, 'no login asks for booking 1 and names customer 1 as the owner', BOOKING1_STRINGS);
    });

    // Red if a customer is refused their own booking (the clause compares the wrong column or id) or the PDF is built from another booking's row.
    test('Invoice download GET /api/bookings/[id]/invoice/download: a customer gets the invoice of their own booking, by cookie and by Bearer', async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        for (const [style, headers] of [['cookie', as.customer], ['bearer', as.customerBearer]]) {
            await expectInvoice(await ask(request, BOOKING1.id, headers), `customer1 by ${style} asks for booking 1`, INVOICE1.invoice_number);
        }
        // A browser page visit by the signed-in owner is the download itself.
        await expectInvoice(await ask(request, BOOKING1.id, { ...as.customer, ...BROWSER }), 'customer1 visits booking 1 in a browser', INVOICE1.invoice_number);
        await expectInvoice(await ask(request, BOOKING2.id, await customer2Headers(playwright, baseURL)), 'customer2 asks for booking 2', INVOICE2.invoice_number);
    });

    // Red if the admin is left out of the roles (the admin would be 403), or if the ownership clause binds the admin too.
    test("Invoice download GET /api/bookings/[id]/invoice/download: the admin gets any booking's invoice, by cookie and by Bearer, and a booking that does not exist is 404", async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        for (const [style, headers] of [['cookie', as.admin], ['bearer', as.adminBearer]]) {
            await expectInvoice(await ask(request, BOOKING1.id, headers), `admin by ${style} asks for booking 1`, INVOICE1.invoice_number);
            await expectInvoice(await ask(request, BOOKING2.id, headers), `admin by ${style} asks for booking 2`, INVOICE2.invoice_number);
            await expectRefusal(await ask(request, MISSING, headers), 404, { success: false, message: 'Booking not found' }, `admin by ${style} asks for a booking that does not exist`);
        }
        // The route's own 404 for a customer too: the booking is not theirs to be refused.
        await expectRefusal(await ask(request, MISSING, as.customer), 404, { success: false, message: 'Booking not found' }, 'customer1 asks for a booking that does not exist');
    });

    // Red if the ownership clause compares the booking's id or its provider_id rather than user_id: the booking below is customer 1's, its
    // id is neither 1 nor 2, and its provider is provider 2, whose id is customer 2's. Customer 1 would be refused a booking they made, or
    // customer 2 (id 2 = provider_id 2) would be served it.
    test("Invoice download GET /api/bookings/[id]/invoice/download: the owner is the booking's user_id, not its id or its provider's id", async ({ request, baseURL, playwright }) => {
        const as = await credentials(baseURL);
        const customer2 = await customer2Headers(playwright, baseURL);
        const tag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
        const checkout = {
            service_id: 1, service_name: 'Fixture Standard Clean', service_price: 80, additional_price: 40,
            first_name: 'E2E', last_name: 'Probe', email: `e2e-invoice-${tag}@workontap.test`, phone: '+14035550198',
            job_date: '2026-02-01', job_time_slot: '09:00', job_description: 'E2E invoice download booking, deleted by the case.',
            address_line1: '1 Probe Street', city: 'Calgary', payment_intent_id: `pi_e2e_invoice_${tag}`,
        };
        const created = await request.post('/api/bookings', { data: checkout, headers: as.customer });
        expect(created.status(), 'checkout makes the booking as customer 1').toBe(200);
        const id = (await created.json()).booking_id;
        expect(Number.isInteger(id), 'the booking has an id').toBe(true);
        try {
            const assigned = await request.put(`/api/bookings?id=${id}`, { headers: as.admin, data: { provider_id: 2 } });
            expect(assigned.status(), 'admin assigns provider 2').toBe(200);
            const read = await request.get(`/api/bookings/${id}`, { headers: as.admin });
            expect(read.status(), 'admin reads the booking').toBe(200);
            const row = (await read.json()).data;
            expect([row.user_id, row.provider_id], "the booking is customer 1's with provider 2").toEqual([CUSTOMER1.id, 2]);
            expect([1, 2].includes(row.id), "the booking's id is neither customer's id").toBe(false);

            const pdf = async (response, who) => {
                expect(response.status(), `${who}: status`).toBe(200);
                expect(response.headers()['content-type'], `${who}: content type`).toBe('application/pdf');
                expect((await response.body()).subarray(0, 5).toString('latin1'), `${who}: the body starts like a PDF`).toBe('%PDF-');
            };
            await pdf(await ask(request, id, as.customer), 'customer1 by cookie asks for their own booking');
            await pdf(await ask(request, id, as.customerBearer), 'customer1 by Bearer asks for their own booking');
            await pdf(await ask(request, id, as.admin), 'admin asks for it');
            await expectRefusal(await ask(request, id, customer2), 403, FORBIDDEN, "customer2, whose id is the booking's provider's, asks for it", [checkout.email, checkout.phone, checkout.address_line1, checkout.job_description]);
        } finally {
            await request.delete(`/api/bookings?id=${id}`, { headers: as.admin });
        }
    });

    // Red if the redirect is dropped (a browser would see the 401 document), if its Location does not carry the return path, or if the
    // return path is not encoded.
    test('Invoice download GET /api/bookings/[id]/invoice/download: a browser page visit with no login is sent to the customer login with a return path to the invoice', async ({ request }) => {
        for (const id of [BOOKING1.id, BOOKING2.id, MISSING]) {
            const who = `a browser visit with no login asks for booking ${id}`;
            const response = await ask(request, id, BROWSER);
            expect(response.status(), `${who}: status`).toBe(307);
            expect(response.headers()['location'], `${who}: where it is sent`).toBe(loginFor(id));
            expect(response.headers()['cache-control'], `${who}: not kept by a cache`).toContain('no-store');
            expect(response.headers()['content-disposition'], `${who}: no attachment`).toBeUndefined();
            expect((await response.body()).length, `${who}: an empty body`).toBe(0);
        }
        expect(loginFor(BOOKING1.id), 'the return path is the invoice, encoded').toBe('/login?redirect=%2Fapi%2Fbookings%2F1%2Finvoice%2Fdownload');
    });

    // Red if the redirect also answers a signed-in refusal (the 403 cases would be 307), if it ignores the Accept header (every refused request
    // would be 307), or if the return path is built from a booking number that is not digits (the odd numbers below would be 307).
    test('Invoice download GET /api/bookings/[id]/invoice/download: a browser page visit is redirected only for a booking number of digits, and only when nobody is signed in', async ({ request, baseURL }) => {
        const as = await credentials(baseURL);
        for (const id of ['abc', '1x', '1.5', '-1', '1234567890123456789', '00000000000000000001']) {
            await expectRefusal(await ask(request, id, BROWSER), 401, UNAUTHORIZED, `a browser visit with no login asks for booking number ${JSON.stringify(id)}`);
        }
        await expectRefusal(await ask(request, BOOKING1.id, { ...as.provider, ...BROWSER }), 403, FORBIDDEN, 'a browser visit by provider1');
        await expectRefusal(await ask(request, BOOKING1.id, { ...as.providerBearer, ...BROWSER }), 403, FORBIDDEN, 'a browser visit by provider1, Bearer');
        // A caller that does not ask for a page gets the refusal, and so does one that asks for a type that only looks like HTML.
        await expectRefusal(await ask(request, BOOKING1.id, { accept: '*/*' }), 401, UNAUTHORIZED, 'no login, Accept: */*');
        await expectRefusal(await ask(request, BOOKING1.id, { accept: 'application/xhtml+xml' }), 401, UNAUTHORIZED, 'no login, Accept: application/xhtml+xml');
    });

    // The probe the ticket asks for, in a real browser: the redirect names the customer login with ?redirect=, the login page signs customer 1
    // in and returns to that path, and the invoice downloads. Red if the login page stops honouring ?redirect=, or the Location names a path
    // the page does not return to.
    test('Invoice download GET /api/bookings/[id]/invoice/download: a customer who signs in on the login page it names is returned to the invoice and the PDF downloads', async ({ page }) => {
        await page.goto(pathOf(BOOKING1.id), { waitUntil: 'domcontentloaded' });
        const url = new URL(page.url());
        expect(url.pathname, 'the visit with no login ends on the customer login').toBe('/login');
        expect(url.searchParams.get('redirect'), 'the login page is told where to return').toBe(pathOf(BOOKING1.id));

        // The form is submitted by the page's own handler, which React attaches when the page hydrates; a click before that is the browser's
        // own GET submit of the form and signs nobody in. React puts its props on a DOM node when it attaches to it.
        await page.waitForFunction(() => {
            const form = document.querySelector('form');
            return !!form && Object.keys(form).some((key) => key.startsWith('__reactProps'));
        }, null, { timeout: 30_000 });
        await page.locator('input[type="email"]').fill(FIXTURE_LOGINS.customer1.email);
        await page.locator('input[type="password"]').fill(FIXTURE_LOGINS.customer1.password);
        const downloading = page.waitForEvent('download', { timeout: 30_000 });
        await page.locator('button[type="submit"]').click();
        const download = await downloading;
        expect(download.suggestedFilename(), 'the file the browser saves').toBe(`Invoice-${INVOICE1.invoice_number}.pdf`);
    });
});
