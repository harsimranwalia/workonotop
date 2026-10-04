// @ts-check
// ENG-022 S1: the five password-reset and one-time-code routes pass `token`, `otp` and `email` straight into
// query()/execute() (src/lib/db.js), which formats a non-string bind value into the SQL text rather than binding
// it. The fix refuses with 400 any of those three fields that is present and not a string, before the query runs.
//
// The design flagged this as read, not exercised (ENG-004 design, "Public routes and what stops their abuse",
// S1), and ENG-022's own probe of the pre-fix behaviour on the dev DB could not be completed in this environment.
// These cases are therefore type-validation tests only: they assert the 400 for a non-string value of the field
// (a number, an array, a plain object), and that a well-formed string still reaches the route's own "invalid or
// expired" answer. They do not assert, either way, whether the pre-fix code was exploitable by a particular
// object shape — see the ticket log for how that open question is being carried forward.
import { test, expect } from '@playwright/test';

const NOT_A_STRING = [123, [1, 2], { a: 1 }, true];

test.describe('S1 reset/OTP routes refuse a non-string token, otp or email', () => {
  test('POST /api/auth/reset-password: a non-string token is refused with 400 before the query', async ({ request }) => {
    for (const bad of NOT_A_STRING) {
      const r = await request.post('/api/auth/reset-password', { data: { token: bad, newPassword: 'Abcdefg1!' } });
      expect(r.status(), JSON.stringify(bad)).toBe(400);
    }
    // a well-formed string still reaches the route's own "invalid or expired" check
    const r = await request.post('/api/auth/reset-password', { data: { token: 'not-a-real-token', newPassword: 'Abcdefg1!' } });
    expect(r.status()).toBe(400);
    expect((await r.json()).message).toBe('Invalid or expired reset credentials');
  });

  test('POST /api/auth/reset-password: a non-string email or otp is refused with 400 before the query', async ({ request }) => {
    for (const bad of NOT_A_STRING) {
      const r = await request.post('/api/auth/reset-password', { data: { email: bad, otp: '123456', newPassword: 'Abcdefg1!' } });
      expect(r.status(), `email=${JSON.stringify(bad)}`).toBe(400);
      const r2 = await request.post('/api/auth/reset-password', { data: { email: 's1-nobody@workontap.test', otp: bad, newPassword: 'Abcdefg1!' } });
      expect(r2.status(), `otp=${JSON.stringify(bad)}`).toBe(400);
    }
  });

  test('POST /api/auth/verify-otp: a non-string email or otp is refused with 400', async ({ request }) => {
    for (const bad of NOT_A_STRING) {
      const r = await request.post('/api/auth/verify-otp', { data: { email: bad, otp: '123456' } });
      expect(r.status(), `email=${JSON.stringify(bad)}`).toBe(400);
      const r2 = await request.post('/api/auth/verify-otp', { data: { email: 's1-nobody@workontap.test', otp: bad } });
      expect(r2.status(), `otp=${JSON.stringify(bad)}`).toBe(400);
    }
    const r = await request.post('/api/auth/verify-otp', { data: { email: 's1-nobody@workontap.test', otp: '000000' } });
    expect(r.status()).toBe(400);
    expect((await r.json()).message).toBe('Invalid or expired verification code');
  });

  test('POST /api/provider/reset-password: a non-string token, email or otp is refused with 400 before the query', async ({ request }) => {
    for (const bad of NOT_A_STRING) {
      const r = await request.post('/api/provider/reset-password', { data: { token: bad, password: 'Abcdefg1!' } });
      expect(r.status(), `token=${JSON.stringify(bad)}`).toBe(400);
      const r2 = await request.post('/api/provider/reset-password', { data: { email: bad, otp: '123456', password: 'Abcdefg1!' } });
      expect(r2.status(), `email=${JSON.stringify(bad)}`).toBe(400);
      const r3 = await request.post('/api/provider/reset-password', { data: { email: 's1-nobody@workontap.test', otp: bad, password: 'Abcdefg1!' } });
      expect(r3.status(), `otp=${JSON.stringify(bad)}`).toBe(400);
    }
    const r = await request.post('/api/provider/reset-password', { data: { token: 'not-a-real-token', password: 'Abcdefg1!' } });
    expect(r.status()).toBe(400);
    expect((await r.json()).message).toBe('Invalid or expired reset credentials');
  });

  test('POST /api/provider/verify-otp: a non-string email or otp is refused with 400', async ({ request }) => {
    for (const bad of NOT_A_STRING) {
      const r = await request.post('/api/provider/verify-otp', { data: { email: bad, otp: '123456' } });
      expect(r.status(), `email=${JSON.stringify(bad)}`).toBe(400);
      const r2 = await request.post('/api/provider/verify-otp', { data: { email: 's1-nobody@workontap.test', otp: bad } });
      expect(r2.status(), `otp=${JSON.stringify(bad)}`).toBe(400);
    }
    const r = await request.post('/api/provider/verify-otp', { data: { email: 's1-nobody@workontap.test', otp: '000000' } });
    expect(r.status()).toBe(400);
    expect((await r.json()).message).toBe('Invalid or expired verification code');
  });

  // GET /api/provider/validate-reset-token reads `token` with searchParams.get, which always returns a string or
  // null, so it never receives a non-string value; no change and no case here (confirmed by reading the route).
});
