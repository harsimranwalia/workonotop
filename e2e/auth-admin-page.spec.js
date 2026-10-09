// @ts-check
// The /admin page guard (src/middleware.js): a page under /admin, other than /admin/login, needs an adminAuth cookie whose signed
// payload says role admin. Anything else is sent to /admin/login with a 307, and a cookie that was there is cleared. Before
// ENG-020 any validly signed token passed (a customer's or a provider's token copied into the adminAuth cookie reached the
// page), and no case pinned the refusal: reverting the two lines in the middleware changed none of the 735 outcomes (the
// code review's finding B4). e2e/admin.spec.js pins the admin's own path and the no-cookie redirects; this file pins the
// cookie cases, one request each, GET /admin with redirects switched off:
//
//   1. no cookie                                         307 to /admin/login
//   2. the fixture customer's token in adminAuth         307 to /admin/login and a set-cookie that clears adminAuth
//   3. the fixture provider's token in adminAuth         the same
//   4. a garbage value in adminAuth                      the same (refused before ENG-020 as well)
//   5. the fixture admin's own cookie                    200
//
// The tokens are the web logins' own cookies, from getCredentialHeaders (e2e/auth/credentials.js, signed in once per run by the
// global setup); the value is taken and sent under the name adminAuth. No token is printed, logged, annotated or put in a
// message: a failure names statuses and header names. Tracing is off for the reason auth-matrix.spec.js gives (a trace
// records request headers, and these carry session cookies of the fixture accounts).
//
// The first request for /admin compiles the page in `next dev`, so each case may take a minute.
import { test, expect } from '@playwright/test';
import { getCredentialHeaders } from './auth/credentials.js';

test.use({ trace: 'off' });

const REQUEST_MS = 100_000;

/** The value of a `name=value` cookie header, so it can be sent under another name. */
const valueOf = (cookieHeader) => cookieHeader.slice(cookieHeader.indexOf('=') + 1);

/**
 * GET /admin with the given Cookie header (or none) and no redirect followed. Returns what the cases assert on: the status, the
 * Location header, the NAMES of the Set-Cookie headers, and whether one of them clears adminAuth.
 * @param {import('@playwright/test').PlaywrightWorkerArgs['playwright']} playwright
 * @param {string | undefined} baseURL
 * @param {string | null} cookie
 */
async function getAdminPage(playwright, baseURL, cookie) {
    const context = await playwright.request.newContext({ baseURL, extraHTTPHeaders: cookie ? { cookie } : {} });
    try {
        const response = await context.get('/admin', { maxRedirects: 0, timeout: REQUEST_MS });
        const setCookies = response.headersArray().filter((header) => header.name.toLowerCase() === 'set-cookie').map((header) => header.value);
        return {
            status: response.status(),
            location: response.headers()['location'] ?? '',
            setCookieNames: setCookies.map((value) => value.slice(0, Math.max(value.indexOf('='), 0))),
            clearsAdminAuth: setCookies.some((value) => /^adminAuth=\s*;/.test(value) && /;\s*max-age=0\b/i.test(value)),
        };
    } finally {
        await context.dispose();
    }
}

test.describe('Admin page guard', () => {
    // The first /admin request compiles the page.
    test.describe.configure({ timeout: 120_000 });

    /** A refusal: 307 to the login page, and (when a cookie was sent) the adminAuth cookie cleared. */
    const expectRefused = (page, clearsCookie) => {
        expect(page.status, 'the status of GET /admin').toBe(307);
        expect(page.location, 'the Location header').toMatch(/\/admin\/login$/);
        if (clearsCookie) {
            expect(page.clearsAdminAuth, `a Set-Cookie header that clears adminAuth (Set-Cookie names sent: ${page.setCookieNames.join(', ') || 'none'})`).toBe(true);
        }
    };

    test('GET /admin with no cookie is a 307 to /admin/login', async ({ playwright, baseURL }) => {
        expectRefused(await getAdminPage(playwright, baseURL, null), false);
    });

    test("GET /admin with the customer's token in adminAuth is a 307 to /admin/login and clears the cookie", async ({ playwright, baseURL }) => {
        const headers = await getCredentialHeaders(String(baseURL), playwright);
        expectRefused(await getAdminPage(playwright, baseURL, `adminAuth=${valueOf(headers['customer-cookie'].cookie)}`), true);
    });

    test("GET /admin with the provider's token in adminAuth is a 307 to /admin/login and clears the cookie", async ({ playwright, baseURL }) => {
        const headers = await getCredentialHeaders(String(baseURL), playwright);
        expectRefused(await getAdminPage(playwright, baseURL, `adminAuth=${valueOf(headers['provider-cookie'].cookie)}`), true);
    });

    test('GET /admin with a garbage adminAuth value is a 307 to /admin/login and clears the cookie', async ({ playwright, baseURL }) => {
        expectRefused(await getAdminPage(playwright, baseURL, 'adminAuth=not.a.token'), true);
    });

    test("GET /admin with the admin's own cookie is a 200", async ({ playwright, baseURL }) => {
        const headers = await getCredentialHeaders(String(baseURL), playwright);
        const page = await getAdminPage(playwright, baseURL, headers['admin-cookie'].cookie);
        expect(page.status, 'the status of GET /admin').toBe(200);
    });
});
