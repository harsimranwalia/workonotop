// e2e/notice-visit-numbers.spec.js
//
// ENG-018, security gate round 1, rider R1 (not a re-gate condition; found by the security seat's numlen.mjs): src/lib/notice-templates.js held a booking number to
// 20 characters (NUMBER_MAX), counted as 'BK', thirteen digits of time and up to three of a random number (18). The visits of a series after the first
// are numbered `${bookingNumber}-${k}` (src/app/api/bookings/route.js), which makes visits 10 to 12 21 characters whenever the random part has three digits
// (about nine times in ten), and templateFor threw bad_notice_value for them: the notice of a visit ended 'error' and nobody was told. NUMBER_MAX is now 24, and
// the comment counts the suffix.
//
// V1  every kind that carries a booking number renders for each of the MAX_VISITS visit numbers of a series whose number has a three-digit random part and
//     thirteen digits of time, with the largest of the other values a text can hold; each text is printable ASCII of at most 160 characters and names the
//     visit's own number. card_link carries only the first visit's number (an admin's booking on a customer's behalf is never a series), so it is rendered
//     for that one.
// V2  a number longer than the longest a visit can have is still refused (bad_notice_value) and never cut.
//
// No database and no app: templateFor is a pure function.
import { test, expect } from '@playwright/test';
import { templateFor, NOTICE_KINDS, SMS_BODY_MAX } from '../src/lib/notice-templates.js';
import { MAX_VISITS } from '../src/lib/visit-series.js';

test.use({ trace: 'off' });

// 'BK', thirteen digits of Date.now() (until the year 2286) and the three-digit end of Math.floor(Math.random() * 1000): 18 characters.
const BOOKING_NUMBER = `BK${'1760'.padEnd(13, '7')}999`;
const visitNumbers = Array.from({ length: MAX_VISITS }, (_, i) => (i === 0 ? BOOKING_NUMBER : `${BOOKING_NUMBER}-${i + 1}`));
const ORIGIN = `https://${'a'.repeat(23)}`;
const TOKEN = 'T'.repeat(43);

// The largest the other values a number-carrying text holds can be (hours up to 999, professionals up to 999, a price under 100,000).
const LARGEST = { service: 'Deep clean', name: 'Rhea', date: 'Mon, Oct 17', slot: 'Morning', price: 99_999.99, hours: 999, workers: 999, visits: MAX_VISITS, label: 'Damage or breakage' };
const URLS = { card_link: `${ORIGIN}/card/${TOKEN}`, job_link: `${ORIGIN}/job/${TOKEN}` };

// Every way a kind is rendered with a number: job_claimed and job_finished each have two voices.
const RENDERINGS = [
    ...NOTICE_KINDS.filter((kind) => !['quote_requested', 'job_claimed', 'job_finished'].includes(kind)).map((kind) => ({ name: kind, kind, values: {} })),
    { name: 'job_claimed (customer)', kind: 'job_claimed', values: { audience: 'customer' } },
    { name: 'job_claimed (provider)', kind: 'job_claimed', values: { audience: 'provider', url: `${ORIGIN}/provider/jobs` } },
    { name: 'job_finished (guest)', kind: 'job_finished', values: { guest: true } },
    { name: 'job_finished (account)', kind: 'job_finished', values: { guest: false } },
];

test.describe('ENG-018 R1: the notices of every visit of a series render', () => {
    test('V1: each kind that carries a booking number renders for each visit number of a 12-visit series, to at most 160 printable ASCII characters that name the visit', () => {
        expect(MAX_VISITS, 'the longest series, which the cases below cover').toBe(12);
        expect(visitNumbers.map((n) => n.length), 'the visit numbers are 18 characters, then 20 (-2 to -9), then 21 (-10 to -12)').toEqual([18, 20, 20, 20, 20, 20, 20, 20, 20, 21, 21, 21]);
        const rendered = [];
        for (const { name, kind, values } of RENDERINGS) {
            // card_link is only ever given the first visit's number; every other kind is given any visit's.
            const numbers = kind === 'card_link' ? visitNumbers.slice(0, 1) : visitNumbers;
            for (const n of numbers) {
                const made = templateFor(kind, { ...LARGEST, url: URLS[kind], ...values, n });
                expect(made.sms, `${name} for ${n}: a text of printable ASCII within one segment`).toMatch(/^[\x20-\x7E]{1,160}$/);
                expect(made.sms.length, `${name} for ${n}`).toBeLessThanOrEqual(SMS_BODY_MAX);
                expect(made.sms, `${name} for ${n}: the text names the visit`).toContain(`#${n}`);
                rendered.push(`${name} ${n}`);
            }
        }
        expect(rendered.length, 'the kinds that carry a number, for each visit (card_link for the first only)').toBe((RENDERINGS.length - 1) * MAX_VISITS + 1);
    });

    test('V2: a number longer than 24 characters is refused and never cut', () => {
        const tooLong = `${BOOKING_NUMBER}-${'9'.repeat(7)}`;
        expect(tooLong.length, 'the case\'s number').toBe(26);
        expect(() => templateFor('job_assigned', { n: tooLong, service: 'Deep clean' })).toThrow(expect.objectContaining({ code: 'bad_notice_value' }));
    });
});
