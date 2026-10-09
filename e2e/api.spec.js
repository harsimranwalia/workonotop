// @ts-check
import { test, expect } from '@playwright/test';
import { getCredentialHeaders } from './auth/credentials.js';

// The admin twins send a fixture session cookie, and a Playwright trace records the request headers of the API contexts it
// traces (the config keeps one per failed case). Tracing is off, as in e2e/auth-matrix.spec.js, so no trace holds a token.
test.use({ trace: 'off' });

// The fixture admin's adminAuth cookie, as request headers (e2e/auth/credentials.js, style 'admin-cookie').
const adminHeaders = async (baseURL) => (await getCredentialHeaders(baseURL))['admin-cookie'];

// ENG-021 (design ENG-004, "Existing cases that change"): five cases here asserted the open behaviour of routes that now
// need a login, or the order of their checks (validation before the guard). Each is rewritten to assert the refusal a
// request with no credential gets, and is joined by a twin that signs in as the fixture admin and keeps the old assertion.
// The refusal is 401 { success: false, message: 'Unauthorized' } (src/lib/api-auth.js).
const expectUnauthorized = async (response) => {
    expect(response.status()).toBe(401);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.message).toBe('Unauthorized');
    return data;
};

test.describe('API Routes', () => {

    test('GET /api/services should return success response', async ({ request }) => {
        const response = await request.get('/api/services');
        expect(response.status()).toBe(200);

        const data = await response.json();
        expect(data).toHaveProperty('success');
        expect(data.success).toBe(true);
        expect(data).toHaveProperty('data');
        expect(Array.isArray(data.data)).toBe(true);
    });

    test('GET /api/categories should return success response', async ({ request }) => {
        const response = await request.get('/api/categories');
        expect(response.status()).toBe(200);

        const data = await response.json();
        expect(data).toHaveProperty('success');
        expect(data.success).toBe(true);
        expect(data).toHaveProperty('data');
        expect(Array.isArray(data.data)).toBe(true);
    });

    // Was 'GET /api/bookings should return success response' (200 with no credential). The title said success, so it changed.
    test('GET /api/bookings without a credential should return 401', async ({ request }) => {
        const data = await expectUnauthorized(await request.get('/api/bookings'));
        expect(data).not.toHaveProperty('data');
    });

    // The old assertion, with the admin credential.
    test('GET /api/bookings as admin should return success response', async ({ request, baseURL }) => {
        const response = await request.get('/api/bookings', { headers: await adminHeaders(baseURL) });
        expect(response.status()).toBe(200);

        const data = await response.json();
        expect(data).toHaveProperty('success');

        if (data.success) {
            expect(data).toHaveProperty('data');
            expect(Array.isArray(data.data)).toBe(true);
        }
    });

    // Title kept: it still tells the truth (the answer is a response, now a refusal).
    test('GET /api/bookings with email filter should return response', async ({ request }) => {
        const data = await expectUnauthorized(await request.get('/api/bookings?email=test@example.com'));
        expect(data).not.toHaveProperty('data');
    });

    // The old assertion, with the admin credential.
    test('GET /api/bookings with email filter as admin should return response', async ({ request, baseURL }) => {
        const response = await request.get('/api/bookings?email=test@example.com', { headers: await adminHeaders(baseURL) });
        expect(response.status()).toBe(200);

        const data = await response.json();
        expect(data).toHaveProperty('success');
    });

    test('POST /api/bookings with missing fields should return 400', async ({ request }) => {
        const response = await request.post('/api/bookings', {
            data: {
                // Missing all required fields
                service_id: null,
                email: '',
            }
        });

        expect(response.status()).toBe(400);
        const data = await response.json();
        expect(data.success).toBe(false);
        expect(data).toHaveProperty('message');
    });

    test('POST /api/bookings with partial data should return 400', async ({ request }) => {
        const response = await request.post('/api/bookings', {
            data: {
                service_id: 1,
                first_name: 'Test',
                // Missing: last_name, email, job_date, job_time_slot, address_line1
            }
        });

        expect(response.status()).toBe(400);
        const data = await response.json();
        expect(data.success).toBe(false);
    });

    test('GET /api/services?homepage=true should return only homepage services', async ({ request }) => {
        // The route filters on `homepage=true` (src/app/api/services/route.js:15, :78); `is_homepage` is not a
        // parameter it reads, so the old query got every service back.
        const response = await request.get('/api/services?homepage=true');
        expect(response.status()).toBe(200);

        const data = await response.json();
        expect(data.success).toBe(true);

        // At least one row, so an empty catalogue cannot pass.
        expect(data.data.length).toBeGreaterThan(0);

        // All returned services should have is_homepage = 1
        for (const service of data.data) {
            expect(service.is_homepage).toBe(1);
        }

        // The fixture catalogue has one active service that is not on the homepage; it must be filtered out.
        expect(data.data.map((service) => service.name)).not.toContain('Fixture Furniture Assembly');
    });

    // ENG-022: the customer list is admin only. Title kept: it still tells the truth (the answer is a response, now a refusal).
    // The old assertion accepted 200, 401 or 403 and was true of the open route; it now asserts the refusal, and the admin twin
    // below asserts the answer.
    test('GET /api/customers should return response', async ({ request }) => {
        const data = await expectUnauthorized(await request.get('/api/customers'));
        expect(data).not.toHaveProperty('data');
    });

    test('GET /api/customers as admin should return response', async ({ request, baseURL }) => {
        const response = await request.get('/api/customers', { headers: await adminHeaders(baseURL) });
        expect(response.status()).toBe(200);

        const data = await response.json();
        expect(data.success).toBe(true);
        expect(Array.isArray(data.data)).toBe(true);
    });

    // Title kept: it still tells the truth (the answer is a response, now a refusal).
    test('GET /api/reviews should return response', async ({ request }) => {
        const data = await expectUnauthorized(await request.get('/api/reviews'));
        expect(data).not.toHaveProperty('data');
    });

    // The old assertion, with the admin credential.
    test('GET /api/reviews as admin should return response', async ({ request, baseURL }) => {
        const response = await request.get('/api/reviews', { headers: await adminHeaders(baseURL) });
        expect(response.status()).toBe(200);

        const data = await response.json();
        expect(data).toHaveProperty('success');
    });

    // ENG-022: the platform statistics are admin only. Title kept, same reason as GET /api/customers above.
    test('GET /api/stats should return response', async ({ request }) => {
        const data = await expectUnauthorized(await request.get('/api/stats'));
        expect(data).not.toHaveProperty('data');
    });

    test('GET /api/stats as admin should return response', async ({ request, baseURL }) => {
        const response = await request.get('/api/stats', { headers: await adminHeaders(baseURL) });
        expect(response.status()).toBe(200);

        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data).toHaveProperty('data');
    });

    // Was 'DELETE /api/bookings without id should return 400'. The guard now runs before the validation, so with no
    // credential the answer is 401, and the old title would lie.
    test('DELETE /api/bookings without id and without a credential should return 401', async ({ request }) => {
        await expectUnauthorized(await request.delete('/api/bookings'));
    });

    // The old assertion, with the admin credential: signed in, the validation answers 400 as before.
    test('DELETE /api/bookings without id as admin should return 400', async ({ request, baseURL }) => {
        const response = await request.delete('/api/bookings', { headers: await adminHeaders(baseURL) });
        expect(response.status()).toBe(400);

        const data = await response.json();
        expect(data.success).toBe(false);
    });

    // Was 'PUT /api/bookings without id should return 400'. Same reason as the DELETE case above.
    test('PUT /api/bookings without id and without a credential should return 401', async ({ request }) => {
        await expectUnauthorized(await request.put('/api/bookings', {
            data: { status: 'confirmed' }
        }));
    });

    // The old assertion, with the admin credential: signed in, the validation answers 400 as before.
    test('PUT /api/bookings without id as admin should return 400', async ({ request, baseURL }) => {
        const response = await request.put('/api/bookings', {
            headers: await adminHeaders(baseURL),
            data: { status: 'confirmed' }
        });

        expect(response.status()).toBe(400);
        const data = await response.json();
        expect(data.success).toBe(false);
    });
});
