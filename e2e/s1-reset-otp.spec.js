// @ts-check
// ENG-022 S1: four POST routes (reset-password and verify-otp, each under auth and under provider) refuse with 400
// any `token`, `otp` or `email` they read that is present and is not a string, before any query runs. What a
// non-string value reaches in each of them without that check, read from the code and not run:
//   - /api/auth/reset-password: the raw token, email and otp reach query(), which formats a non-string value into the
//     SQL text instead of binding it (src/lib/db.js:63-68).
//   - /api/auth/verify-otp: no non-string value reaches query(). A non-string email throws at `.trim()`, before the
//     query, so it is a 500; otp is stringified by `.toString()` and bound as a string, so for an unknown email it
//     gets the route's own 400 ("Invalid or expired verification code"). The check turns that 500 into a 400 and
//     stops a JSON-number otp being coerced into a string that could match a stored code.
//   - /api/provider/reset-password: a non-string email throws at `.trim()` (a 500) and otp is stringified (cleanOtp).
//     The raw token is bound by connection.execute(), a prepared statement (as is execute() in db.js:47-51), so it is
//     a typed bind, never SQL text (an array or object goes as a JSON-typed bind). What the database makes of a typed
//     token is not claimed here.
//   - /api/provider/verify-otp: a non-string email throws at `.trim()` (a 500); otp is stringified (cleanOtp).
//   - GET /api/provider/validate-reset-token reads searchParams.get, always a string or null: no check, no case.
//
// The route's own no-match answer is a 400 as well ("Invalid or expired ..."), so a status alone cannot tell the
// check's refusal from a query that ran and found nothing. Every non-string case therefore asserts the status and the
// check's message. What a case catches is the clause of the check it names (token, email or otp, as in its label):
// delete that clause and that case goes red. The non-string values are a number, an array, a plain object and `true`
// (NOT_A_STRING); a well-formed string must still reach the route's own "invalid or expired" answer.
//
// The design flagged S1 as read, not exercised (ENG-004 design, "Public routes and what stops their abuse", S1), and
// ENG-022's own probe of the pre-fix behaviour on the dev DB could not be completed in this environment, so these are
// type-validation tests only. They do not assert, either way, whether the pre-fix code was exploitable by a
// particular object shape; see the ticket log for how that open question is being carried forward.
import { test, expect } from '@playwright/test';

const NOT_A_STRING = [123, [1, 2], { a: 1 }, true];

test.describe('S1 reset/OTP routes refuse a non-string token, otp or email', () => {
  test('POST /api/auth/reset-password: a non-string token is refused with 400 before the query', async ({ request }) => {
    for (const bad of NOT_A_STRING) {
      const r = await request.post('/api/auth/reset-password', { data: { token: bad, newPassword: 'Abcdefg1!' } });
      expect(r.status(), `token=${JSON.stringify(bad)}`).toBe(400);
      expect((await r.json()).message, `token=${JSON.stringify(bad)}`).toBe('Valid token or Email/OTP required');
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
      expect((await r.json()).message, `email=${JSON.stringify(bad)}`).toBe('Valid token or Email/OTP required');
      const r2 = await request.post('/api/auth/reset-password', { data: { email: 's1-nobody@workontap.test', otp: bad, newPassword: 'Abcdefg1!' } });
      expect(r2.status(), `otp=${JSON.stringify(bad)}`).toBe(400);
      expect((await r2.json()).message, `otp=${JSON.stringify(bad)}`).toBe('Valid token or Email/OTP required');
    }
  });

  test('POST /api/auth/verify-otp: a non-string email or otp is refused with 400', async ({ request }) => {
    for (const bad of NOT_A_STRING) {
      const r = await request.post('/api/auth/verify-otp', { data: { email: bad, otp: '123456' } });
      expect(r.status(), `email=${JSON.stringify(bad)}`).toBe(400);
      expect((await r.json()).message, `email=${JSON.stringify(bad)}`).toBe('Email and OTP are required');
      const r2 = await request.post('/api/auth/verify-otp', { data: { email: 's1-nobody@workontap.test', otp: bad } });
      expect(r2.status(), `otp=${JSON.stringify(bad)}`).toBe(400);
      expect((await r2.json()).message, `otp=${JSON.stringify(bad)}`).toBe('Email and OTP are required');
    }
    const r = await request.post('/api/auth/verify-otp', { data: { email: 's1-nobody@workontap.test', otp: '000000' } });
    expect(r.status()).toBe(400);
    expect((await r.json()).message).toBe('Invalid or expired verification code');
  });

  test('POST /api/provider/reset-password: a non-string token, email or otp is refused with 400 before the query', async ({ request }) => {
    for (const bad of NOT_A_STRING) {
      const r = await request.post('/api/provider/reset-password', { data: { token: bad, password: 'Abcdefg1!' } });
      expect(r.status(), `token=${JSON.stringify(bad)}`).toBe(400);
      expect((await r.json()).message, `token=${JSON.stringify(bad)}`).toBe('Valid token or Email/OTP required');
      const r2 = await request.post('/api/provider/reset-password', { data: { email: bad, otp: '123456', password: 'Abcdefg1!' } });
      expect(r2.status(), `email=${JSON.stringify(bad)}`).toBe(400);
      expect((await r2.json()).message, `email=${JSON.stringify(bad)}`).toBe('Valid token or Email/OTP required');
      const r3 = await request.post('/api/provider/reset-password', { data: { email: 's1-nobody@workontap.test', otp: bad, password: 'Abcdefg1!' } });
      expect(r3.status(), `otp=${JSON.stringify(bad)}`).toBe(400);
      expect((await r3.json()).message, `otp=${JSON.stringify(bad)}`).toBe('Valid token or Email/OTP required');
    }
    const r = await request.post('/api/provider/reset-password', { data: { token: 'not-a-real-token', password: 'Abcdefg1!' } });
    expect(r.status()).toBe(400);
    expect((await r.json()).message).toBe('Invalid or expired reset credentials');
  });

  test('POST /api/provider/verify-otp: a non-string email or otp is refused with 400', async ({ request }) => {
    for (const bad of NOT_A_STRING) {
      const r = await request.post('/api/provider/verify-otp', { data: { email: bad, otp: '123456' } });
      expect(r.status(), `email=${JSON.stringify(bad)}`).toBe(400);
      expect((await r.json()).message, `email=${JSON.stringify(bad)}`).toBe('Email and verification code required');
      const r2 = await request.post('/api/provider/verify-otp', { data: { email: 's1-nobody@workontap.test', otp: bad } });
      expect(r2.status(), `otp=${JSON.stringify(bad)}`).toBe(400);
      expect((await r2.json()).message, `otp=${JSON.stringify(bad)}`).toBe('Email and verification code required');
    }
    const r = await request.post('/api/provider/verify-otp', { data: { email: 's1-nobody@workontap.test', otp: '000000' } });
    expect(r.status()).toBe(400);
    expect((await r.json()).message).toBe('Invalid or expired verification code');
  });

  // GET /api/provider/validate-reset-token reads `token` with searchParams.get, which always returns a string or
  // null, so it never receives a non-string value; no change and no case here (confirmed by reading the route).
});
