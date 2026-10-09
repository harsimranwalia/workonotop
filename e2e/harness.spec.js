// @ts-check
// Proves the harness itself: each fixture role can sign in through its own route, and a path that needs a
// credential the environment lacks is reported as "verified by what the code attempts", never as a pass.
import { test, expect } from '@playwright/test';
import { FIXTURE_LOGINS } from '../database/fixtures/accounts.js';
import { catalog } from '../database/fixtures/catalog.js';
import { signInAs, RESET_RETRIES } from './support/auth.js';
import { credentialGap } from './support/credentials.js';

test.describe('Fixture sign-in', () => {

    test('customer signs in and /api/auth/me returns the fixture customer', async ({ page }) => {
        await signInAs(page, 'customer1');

        const response = await page.request.get('/api/auth/me');
        expect(response.status()).toBe(200);
        const { user } = await response.json();
        expect(user.role).toBe('customer');
        expect(user.email).toBe(FIXTURE_LOGINS.customer1.email);
    });

    test('provider signs in, /api/provider/me returns the fixture provider and /provider/dashboard does not bounce', async ({ page }) => {
        await signInAs(page, 'provider1');

        const response = await page.request.get('/api/provider/me');
        expect(response.status()).toBe(200);
        const { provider } = await response.json();
        expect(provider.email).toBe(FIXTURE_LOGINS.provider1.email);

        await page.goto('/provider/dashboard');
        // The layout checks the session in the browser after the page loads and redirects to the login
        // page if it fails, so wait for the signed-in sidebar before judging where the page ended up.
        await expect(page.locator('aside').getByText(provider.email).first()).toBeVisible();
        await expect(page).toHaveURL(/\/provider\/dashboard/);
    });

    test('admin signs in, /api/admin/me returns role admin and /admin is not redirected to the login page', async ({ page }) => {
        await signInAs(page, 'admin');

        const response = await page.request.get('/api/admin/me');
        expect(response.status()).toBe(200);
        const { user } = await response.json();
        expect(user.role).toBe('admin');
        expect(user.email).toBe(FIXTURE_LOGINS.admin.email);

        // src/middleware.js verifies the adminAuth cookie before this page is served, and the layout then
        // asks /api/admin/me; its <main> exists only once both have accepted the session.
        await page.goto('/admin');
        await expect(page.locator('main')).toBeVisible();
        await expect(page).not.toHaveURL(/\/admin\/login/);
    });

    test('signInAs refuses an account that is not a fixture, naming the ones that are', async ({ page }) => {
        await expect(signInAs(page, 'nobody')).rejects.toThrow(/unknown fixture account 'nobody'; use one of customer1, customer2, provider1, provider2, admin/);
    });
});

test.describe('Credential gaps', () => {

    // A stand-in for the part of testInfo that credentialGap writes to.
    const testInfo = () => ({ annotations: [] });

    // credentialGap reads E2E_APP_ENV_NAMES from the environment, so each case sets it and puts it back.
    async function withAppEnvNames(names, body) {
        const before = process.env.E2E_APP_ENV_NAMES;
        if (names === undefined) delete process.env.E2E_APP_ENV_NAMES;
        else process.env.E2E_APP_ENV_NAMES = names;
        try {
            await body();
        } finally {
            if (before === undefined) delete process.env.E2E_APP_ENV_NAMES;
            else process.env.E2E_APP_ENV_NAMES = before;
        }
    }

    test('counts every credential as missing when the app environment is not known', async () => {
        await withAppEnvNames(undefined, () => {
            const info = testInfo();
            expect(credentialGap(info, 'stripe')).toEqual(['STRIPE_SECRET_KEY']);
            expect(info.annotations).toEqual([{ type: 'verified-by-attempt', description: 'missing: STRIPE_SECRET_KEY' }]);
        });
    });

    test('reports no gap, and no annotation, when the app has the credential', async () => {
        await withAppEnvNames('PATH,STRIPE_SECRET_KEY', () => {
            const info = testInfo();
            expect(credentialGap(info, 'stripe')).toEqual([]);
            expect(info.annotations).toEqual([]);
        });
    });

    test('names only the Twilio credentials that are missing', async () => {
        await withAppEnvNames('TWILIO_ACCOUNT_SID', () => {
            expect(credentialGap(testInfo(), 'sms')).toEqual(['TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER']);
        });
    });

    test('accepts either name of an email pair, as src/lib/email.js does', async () => {
        await withAppEnvNames('EMAIL_USER,SMTP_PASS', () => {
            expect(credentialGap(testInfo(), 'email')).toEqual([]);
        });
        await withAppEnvNames('SMTP_USER', () => {
            expect(credentialGap(testInfo(), 'email')).toEqual(['SMTP_PASS|EMAIL_PASS']);
        });
    });

    test('refuses a family it does not know', () => {
        expect(() => credentialGap(testInfo(), 'sms-typo')).toThrow(/unknown family 'sms-typo'/);
    });
});

test.describe('Payment path - Stripe', () => {

    test('POST /api/payment/create-intent as a customer creates an intent, or reports what the code attempts without a Stripe key', async ({ page }, info) => {
        await signInAs(page, 'customer1');
        const missing = credentialGap(info, 'stripe');

        const service = catalog.tables.services[0];
        const response = await page.request.post('/api/payment/create-intent', {
            data: {
                service_id: service.id,
                service_price: service.base_price,
                additional_price: service.additional_price,
                service_name: service.name,
            },
            // One full run saw this POST end in "socket hang up" with no line about it in app.log, so it never
            // reached the route. Only such a reset is sent again; the 500 asserted below is not retried.
            maxRetries: RESET_RETRIES,
        });

        if (missing.length === 0) {
            expect(response.status()).toBe(200);
            const body = await response.json();
            expect(body.success).toBe(true);
            expect(body.client_secret).toBeTruthy();
        } else {
            // Without a key the route builds no Stripe client (create-intent/route.js:12 is null), passes the guard,
            // the ownership check and the users read, and throws 'STRIPE_SECRET_KEY is not set' (:45) into its own
            // catch, which answers the JSON 500 'Failed to initialize payment' (:103, measured 2026-10-04) and logs the
            // error, which the test command keeps in test-results/app.log. Before ENG-023 the route module itself threw
            // while it loaded (stripe refuses to be constructed with no key) and the answer was a 500 page; the status
            // is the same. The customer is signed in and the database is up, as the sign-in above needed both, so a 500
            // here is what the code does when it reaches for Stripe.
            expect(response.status()).toBe(500);
        }
    });
});
