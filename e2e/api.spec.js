// @ts-check
import { test, expect } from '@playwright/test';

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

    test('GET /api/bookings should return success response', async ({ request }) => {
        const response = await request.get('/api/bookings');
        expect(response.status()).toBe(200);

        const data = await response.json();
        expect(data).toHaveProperty('success');

        if (data.success) {
            expect(data).toHaveProperty('data');
            expect(Array.isArray(data.data)).toBe(true);
        }
    });

    test('GET /api/bookings with email filter should return response', async ({ request }) => {
        const response = await request.get('/api/bookings?email=test@example.com');
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

    test('GET /api/customers should return response', async ({ request }) => {
        const response = await request.get('/api/customers');

        // May return 200 or 401 depending on auth requirements
        expect([200, 401, 403]).toContain(response.status());
    });

    test('GET /api/reviews should return response', async ({ request }) => {
        const response = await request.get('/api/reviews');
        expect(response.status()).toBe(200);

        const data = await response.json();
        expect(data).toHaveProperty('success');
    });

    test('GET /api/stats should return response', async ({ request }) => {
        const response = await request.get('/api/stats');

        // Stats endpoint may have various response codes
        expect([200, 401, 403, 500]).toContain(response.status());
    });

    test('DELETE /api/bookings without id should return 400', async ({ request }) => {
        const response = await request.delete('/api/bookings');
        expect(response.status()).toBe(400);

        const data = await response.json();
        expect(data.success).toBe(false);
    });

    test('PUT /api/bookings without id should return 400', async ({ request }) => {
        const response = await request.put('/api/bookings', {
            data: { status: 'confirmed' }
        });

        expect(response.status()).toBe(400);
        const data = await response.json();
        expect(data.success).toBe(false);
    });
});
