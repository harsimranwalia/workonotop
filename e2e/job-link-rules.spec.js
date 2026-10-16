// @ts-check
// ENG-015: the rules of the secure job link that need no HTTP and no browser. The server cases of the design's table
// (agents/architect/designs/ENG-015-secure-job-link-and-crew-check-in.md, "Cases and baseline") that run the libraries directly are in this
// file: plain Node over the pure libraries, and the libraries over the dev database with an injected sender (`sendText`) or a stubbed
// `globalThis.fetch`. The route cases, the check-in, retention, the pins and the console-capture case are in the other ENG-015 files.
// Each title starts with the design's id for the case it settles, and the file's name, the describe and the title together are its baseline key:
//   AC10 (hard gate, plain-Node half)  windowState is closed at opens - 1 and open at opens; the zone vectors (Vancouver and Toronto before and
//        after the autumn and spring changes, and British Columbia's clocks from 1 Nov 2026, which follow the runtime's tz data: the backend
//        notebook's as-built correction to the design's 10 Nov vector: the Playwright image's Node 24.13 carries tz 2025b, which has no such rule,
//        and the app container's Node 22 carries tz 2026c, which has it, so that case takes its expected instant from the runtime's own Intl
//        offset and checks the library against it); a label naming no slot opens at 07:00; an unknown cluster is Toronto; SLOT_STARTS matches
//        TIME_SLOTS; a real bookings row (job_date as stored, no cluster) opens at 07:00 Toronto time;
//   AC11 (hard gate, plain-Node half)  haversine vectors for distanceMetres, awayFrom and readLocation: at the address 0 m, 2 km off, the 500 m edge,
//        a booking with no position, string DECIMALs as mysql2 answers them (made up, and read back from a real bookings row); strings, NaN,
//        Infinity, 91 degrees and {0,0} are refused;
//   AC7  requestCode (src/lib/job-link-code.js) with an injected sendText records one send each for 4035550160, 14035550160, +14035550160 and
//        (403) 555-0160, to +14035550160 and never to a +91 number; sendSMS (src/lib/sms.js) with a stubbed fetch and the three Twilio variables
//        sends To +1 and ten digits for a bare ten digits;
//   Condition 2  the normaliseName table (invisible characters stripped, Unicode spaces made plain, 120 characters pass and 121 do not);
//   Condition 4  reserve() x50 in parallel with a cap of 5 grants exactly 5; reserveText caps a number at 8 and a provider at 200 (made-up provider
//        ids, so no real provider's budget is touched), and a full budget grants again once its window is over; 30 parallel asks for one member and
//        link send exactly once; one number across ten links gets at most 8 texts in a day; the per-link ask cap limits the 21st ask and counts
//        numbers that match nobody, blanks and bad numbers (the HTTP 429 is a route case and is not in this file);
//   Condition 5  the canText table, and sendSMS makes no call at all for a number it refuses.
// The database is the dev database the way e2e/provider-crew.spec.js reaches it (mysql2/promise, assertDevTarget before it connects,
// assertNoRealPeople once connected), through a small POOL, because the burst cases need real parallel connections: one connection would line the
// statements up and hide the race they exist to rule out. The cases that use it work in a block of their own: the fictional numbers
// +1 403 555 0160 to 0179 (for crew members and for typed numbers), bookings whose e-mail starts with `e2e-jd-`, and made-up provider ids
// 990160 to 990179 for the budgets (the links handed to requestCode carry one, so provider 1's daily budget is never spent). The describe sweeps
// exactly those rows (and the budget rows of exactly those numbers, links, members and providers) before its first case, after every case and
// after its last. The cases that replace globalThis.fetch, the Twilio variables or a console method restore them in a finally. A failure message
// names the case and the figures, never a code, a token or a cookie: a text is only ever tested as a yes or no.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';

test.use({ trace: 'off' });
// Cases run one at a time in this file (workers is 1 in the config). They are NOT put in serial mode: one failing case must not hide the rest.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VANCOUVER = 'America/Vancouver';
const TORONTO = 'America/Toronto';

// ---- the block of this file --------------------------------------------------------------------------------------------------------------
const EMAIL_PREFIX = 'e2e-jd-';
const BLOCK_FIRST = 160;
const BLOCK_LAST = 179;
/** '+1 403 555 0160' for 160. */
const phoneOf = (last4) => `+1403555${String(last4).padStart(4, '0')}`;
/** A provider id nobody has: the budget of a made-up provider is the only one these cases spend. */
const syntheticProvider = (last4) => 990000 + last4;
const run = Date.now().toString(36);

const secondsOf = (iso) => Date.parse(iso) / 1000;
const localTime = (epoch, zone) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(epoch * 1000));
const localDay = (epoch, zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(epoch * 1000));
const offsetOf = (iso, zone) => new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset', hour: 'numeric' }).formatToParts(new Date(iso)).find((part) => part.type === 'timeZoneName')?.value;

// =====================================================================================================================================
// Plain Node: when check-in opens, and where the phone is
// =====================================================================================================================================
test.describe('ENG-015 rules: window and location in plain Node', () => {
    test('AC10: windowState is closed at opens - 1 and open at opens, in a Toronto booking and a Vancouver booking', async () => {
        const { windowOpensEpoch, windowState, windowView, CHECKIN_LEAD_MINUTES } = await import('../src/lib/job-window.js');
        expect(CHECKIN_LEAD_MINUTES, 'check-in opens 60 minutes before the earliest booked slot').toBe(60);
        const cases = [
            ['TORONTO_CORE', TORONTO, '2026-10-17T11:00:00Z', /^7:00 AM EDT on Sat, Oct 17$/],
            ['VAN_CORE', VANCOUVER, '2026-10-17T14:00:00Z', /^7:00 AM PDT on Sat, Oct 17$/],
        ];
        for (const [cluster, zone, expectedIso, labelPattern] of cases) {
            const booking = { job_date: '2026-10-17', job_time_slot: 'Oct 17: Morning', cluster, city: null };
            const opens = windowOpensEpoch(booking);
            expect(opens, `${cluster}: a morning job (08:00) opens at 07:00 local`).toBe(secondsOf(expectedIso));
            expect(windowState(opens - 1, opens), `${cluster}: one second before it opens the window is closed`).toEqual({ open: false, opens_epoch: opens });
            expect(windowState(opens, opens), `${cluster}: at the second it opens the window is open`).toEqual({ open: true, opens_epoch: opens });
            expect(windowState(opens + 1, opens).open, `${cluster}: one second after it opens the window is open`).toBe(true);
            expect(windowState(opens - 86400, opens).open, `${cluster}: a day before it opens the window is closed`).toBe(false);

            const view = windowView(booking, opens - 1);
            expect(view.open, `${cluster}: the view at opens - 1 is closed`).toBe(false);
            expect(view.opens_at, `${cluster}: the view carries the instant as an ISO string`).toBe(new Date(opens * 1000).toISOString());
            expect(view.time_zone, `${cluster}: the view names the job's zone`).toBe(zone);
            expect(labelPattern.test(view.opens_label), `${cluster}: the label reads in the job's own zone with its abbreviation (it is '${view.opens_label}')`).toBe(true);
            expect(windowView(booking, opens).open, `${cluster}: the view at opens is open`).toBe(true);
        }

        // A job whose day cannot be read is not one to lock a crew out of: its window is open, with no instant.
        for (const unreadable of ['nope', '2026-02-30', '', null, undefined, 5]) {
            const opens = windowOpensEpoch({ job_date: unreadable, job_time_slot: 'Morning', cluster: 'TORONTO_CORE' });
            expect(opens, `job_date ${JSON.stringify(unreadable)} cannot be read, so there is no opening instant`).toBeNull();
            expect(windowState(0, opens), `job_date ${JSON.stringify(unreadable)}: a window with no instant is open`).toEqual({ open: true, opens_epoch: null });
        }
        // mysql2 may hand back a Date built from the local year, month and day: it reads the same as the text.
        const asText = windowOpensEpoch({ job_date: '2026-10-17', job_time_slot: 'Morning', cluster: 'TORONTO_CORE' });
        const asDate = windowOpensEpoch({ job_date: new Date(2026, 9, 17), job_time_slot: 'Morning', cluster: 'TORONTO_CORE' });
        expect(asDate, 'a Date for 17 October 2026 opens at the same instant as the text 2026-10-17').toBe(asText);
    });

    test("AC10: the zone vectors: 17 Oct, 8 Mar and 10 Nov 2026 in Vancouver and Toronto (British Columbia's clocks from 1 Nov 2026 follow the runtime's tz data)", async () => {
        const { zonedInstant } = await import('../src/lib/job-window.js');
        test.info().annotations.push({ type: 'tz data', description: `node ${process.version}, tz ${process.versions.tz}` });
        const eight = (date, zone) => zonedInstant(date, 8, 0, zone);

        // The design's vectors that hold on any tz data.
        expect(eight('2026-10-17', VANCOUVER), '2026-10-17 08:00 Vancouver (PDT) is 15:00Z').toBe(secondsOf('2026-10-17T15:00:00Z'));
        expect(eight('2026-10-17', TORONTO), '2026-10-17 08:00 Toronto (EDT) is 12:00Z').toBe(secondsOf('2026-10-17T12:00:00Z'));
        expect(eight('2026-03-08', VANCOUVER), '2026-03-08 08:00 Vancouver, the day clocks go forward (PDT), is 15:00Z').toBe(secondsOf('2026-03-08T15:00:00Z'));
        expect(eight('2026-03-08', TORONTO), '2026-03-08 08:00 Toronto, the day clocks go forward (EDT), is 12:00Z').toBe(secondsOf('2026-03-08T12:00:00Z'));
        expect(eight('2026-11-01', TORONTO), '2026-11-01 08:00 Toronto, the day clocks go back (EST), is 13:00Z').toBe(secondsOf('2026-11-01T13:00:00Z'));
        expect(eight('2026-11-10', TORONTO), '2026-11-10 08:00 Toronto (EST) is 13:00Z').toBe(secondsOf('2026-11-10T13:00:00Z'));

        // AS BUILT (backend notebook, fact 1): British Columbia stops changing its clocks on 1 Nov 2026 and stays on -07:00, so 2026-11-10 08:00
        // Vancouver is 15:00Z where the runtime's tz data has that rule (the app container runs tz 2026c, which has it) and the design's 16:00Z
        // (PST) where it does not (the Playwright image's Node 24.13 carries tz 2025b, which does not).
        // job-window.js follows the runtime's data on purpose (that is why it uses Intl), so the pin takes the runtime's own offset for the day,
        // requires it to be one of the two, and then requires the library to agree with the matching instant. The merge request tells the approver
        // to check `node -p process.versions.tz` on production (the release that carries the rule).
        const offset = offsetOf('2026-11-10T12:00:00Z', VANCOUVER);
        const expectedIso = { 'GMT-07:00': '2026-11-10T15:00:00Z', 'GMT-08:00': '2026-11-10T16:00:00Z' }[String(offset)];
        expect(expectedIso, `the runtime puts Vancouver on 2026-11-10 at GMT-07:00 or GMT-08:00 (it says ${offset}; tz data ${process.versions.tz})`).toBeDefined();
        expect(eight('2026-11-10', VANCOUVER), `2026-11-10 08:00 Vancouver is ${expectedIso} on the runtime's tz data (${offset}; tz ${process.versions.tz})`).toBe(secondsOf(String(expectedIso)));
        if (process.versions.tz >= '2026c') {
            expect(expectedIso, `tz data ${process.versions.tz} (2026c or later, the app container's) has British Columbia on permanent -07:00, so the as-built vector is 15:00Z`).toBe('2026-11-10T15:00:00Z');
        }

        // Whatever the tz data says, the instant must read as exactly 08:00 on that day in that zone (the conversion is right across a change of clocks).
        for (const zone of [VANCOUVER, TORONTO]) {
            for (const date of ['2026-03-07', '2026-03-08', '2026-03-09', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-10', '2026-12-25', '2027-03-14']) {
                const instant = eight(date, zone);
                expect(`${localDay(instant, zone)} ${localTime(instant, zone)}`, `${zone} ${date}: the instant reads as 08:00 that day on the wall`).toBe(`${date} 08:00`);
            }
        }
    });

    test('AC10: a label naming no slot opens at 07:00, the earliest named slot of the first day sets the hour, and an unknown cluster is Toronto', async () => {
        const { windowOpensEpoch, zoneFor } = await import('../src/lib/job-window.js');
        const opens = (label, extra = {}) => windowOpensEpoch({ job_date: '2026-10-17', job_time_slot: label, cluster: 'TORONTO_CORE', ...extra });
        const hhmm = (epoch) => localTime(epoch, TORONTO);

        // A label that names no slot (a legacy 09:00, empty, anything else) opens at 07:00: the morning start less the lead.
        for (const label of ['09:00', '', 'Flexible', 'Oct 17: Anytime', null, undefined, 42]) {
            const epoch = opens(label);
            expect(hhmm(epoch), `label ${JSON.stringify(label)} names no slot, so it opens at 07:00`).toBe('07:00');
            expect(epoch, `label ${JSON.stringify(label)} opens at the Morning instant`).toBe(opens('Oct 17: Morning'));
        }
        // Named slots: Morning 08:00, Afternoon 12:00, Evening 16:00, less one hour; the earliest of those named wins; case does not matter.
        expect(hhmm(opens('Oct 17: Morning')), 'Morning opens at 07:00').toBe('07:00');
        expect(hhmm(opens('Oct 17: Afternoon')), 'Afternoon opens at 11:00').toBe('11:00');
        expect(hhmm(opens('Oct 17: Evening')), 'Evening opens at 15:00').toBe('15:00');
        expect(hhmm(opens('Oct 17: Evening & Afternoon')), 'Evening and Afternoon: the earlier, Afternoon, sets the hour (11:00)').toBe('11:00');
        expect(hhmm(opens('Oct 17: Morning & Afternoon & Evening')), 'all three: Morning sets the hour (07:00)').toBe('07:00');
        expect(hhmm(opens('oct 17: AFTERNOON')), 'the slot is found without regard to case').toBe('11:00');
        // The labels are joined by ',', one per day, and the first is job_date's: later days do not move the opening.
        expect(hhmm(opens('Oct 17: Evening, Oct 18: Morning')), 'only the first label counts').toBe('15:00');

        // Zones: a cluster key that starts VAN_ is Vancouver; everything else, an unknown cluster and no cluster included, is Toronto.
        expect(zoneFor({ cluster: 'VAN_CORE' }), 'VAN_CORE is Vancouver').toBe(VANCOUVER);
        expect(zoneFor({ cluster: 'VAN_FRASER', city: 'Toronto' }), 'a known VAN_ cluster wins over the city').toBe(VANCOUVER);
        expect(zoneFor({ cluster: 'TORONTO_CORE' }), 'TORONTO_CORE is Toronto').toBe(TORONTO);
        expect(zoneFor({ cluster: 'GTA_PEEL' }), 'GTA_PEEL is Toronto').toBe(TORONTO);
        for (const unknown of [{ cluster: 'NOPE_9', city: 'Nowhere' }, { cluster: 'UNKNOWN_CLUSTER' }, { cluster: null, city: 'Calgary' }, { cluster: '__proto__' }, { cluster: 'constructor' }, {}, undefined]) {
            expect(zoneFor(unknown), `an unknown cluster ${JSON.stringify(unknown)} is Toronto, the earlier instant`).toBe(TORONTO);
        }
        expect(zoneFor({ cluster: 'bogus', city: 'Vancouver' }), 'an unknown cluster key falls back to the city (Vancouver)').toBe(VANCOUVER);
        expect(zoneFor({ cluster: null, city: 'Surrey' }), 'no cluster falls back to the city (Surrey is VAN_FRASER)').toBe(VANCOUVER);
        expect(zoneFor({ cluster: 'VAN_NOPE', city: 'Toronto' }), 'a VAN_ key that is not a known cluster is not Vancouver').toBe(TORONTO);

        const toronto = windowOpensEpoch({ job_date: '2026-10-17', job_time_slot: 'Morning', cluster: 'NOPE_9', city: 'Nowhere' });
        expect(toronto, 'an unknown cluster opens at the Toronto instant, 11:00Z').toBe(secondsOf('2026-10-17T11:00:00Z'));
        const vancouver = windowOpensEpoch({ job_date: '2026-10-17', job_time_slot: 'Morning', cluster: 'VAN_CORE' });
        expect(vancouver, 'a Vancouver morning job opens at 07:00 PDT, 14:00Z').toBe(secondsOf('2026-10-17T14:00:00Z'));
        expect(toronto, 'the unknown cluster opens EARLIER than Vancouver would (it never locks a crew out)').toBeLessThan(vancouver);
    });

    test('AC10: SLOT_STARTS matches TIME_SLOTS in src/lib/when-and-where.js', async () => {
        const { SLOT_STARTS } = await import('../src/lib/job-window.js');
        // when-and-where.js imports through the @/ alias, which plain Node cannot resolve, so the declaration is read as text.
        const source = fs.readFileSync(path.join(ROOT, 'src/lib/when-and-where.js'), 'utf8');
        const declared = /export const TIME_SLOTS = \[([\s\S]*?)\n\];/.exec(source);
        expect(declared, 'TIME_SLOTS is declared in src/lib/when-and-where.js').not.toBeNull();
        const slots = [...String(declared?.[1]).matchAll(/\{[^}]*\bid:\s*'([a-z]+)'[^}]*\blabel:\s*'([^']+)'[^}]*\btime:\s*'(\d{1,2})(am|pm)\s*-\s*(\d{1,2})(am|pm)'/g)]
            .map((match) => ({ id: match[1], label: match[2], start: (Number(match[3]) % 12) + (match[4] === 'pm' ? 12 : 0) }));
        expect(slots.map((slot) => slot.id), 'TIME_SLOTS holds the three slots, in the order of the day').toEqual(['morning', 'afternoon', 'evening']);
        expect(Object.fromEntries(slots.map((slot) => [slot.id, slot.start])), 'SLOT_STARTS is the hour each TIME_SLOTS entry starts').toEqual(SLOT_STARTS);
        expect(slots.map((slot) => slot.label.toLowerCase()), 'the label job_time_slot carries is the id with a capital, which is what the window looks for').toEqual(slots.map((slot) => slot.id));
        expect(SLOT_STARTS, 'SLOT_STARTS is exactly morning 8, afternoon 12, evening 16').toEqual({ morning: 8, afternoon: 12, evening: 16 });
    });

    test('AC11: haversine vectors: distanceMetres and awayFrom at the address, 2 km off, the 500 m edge, with no position, and with string DECIMALs from mysql2', async () => {
        const { distanceMetres, awayFrom, AWAY_METRES } = await import('../src/lib/job-window.js');
        expect(AWAY_METRES, '"away" is more than 500 m').toBe(500);
        const HOME = { latitude: 51.0447, longitude: -114.0719 };
        const metresPerDegree = (6371008.8 * Math.PI) / 180;
        const north = (metres) => ({ latitude: HOME.latitude + metres / metresPerDegree, longitude: HOME.longitude });
        const east = (metres) => ({ latitude: HOME.latitude, longitude: HOME.longitude + metres / (metresPerDegree * Math.cos((HOME.latitude * Math.PI) / 180)) });
        // mysql2 answers a DECIMAL column as a string.
        const job = { latitude: '51.04470000', longitude: '-114.07190000' };

        expect(distanceMetres(HOME, HOME), 'the same point is 0 m').toBe(0);
        expect(distanceMetres(HOME, north(1000)), '1 km north is 1000 m').toBe(1000);
        expect(distanceMetres(HOME, north(2000)), '2 km north is 2000 m').toBe(2000);
        expect(Math.abs(distanceMetres(HOME, east(2000)) - 2000), '2 km east is 2000 m, give or take a metre').toBeLessThanOrEqual(2);
        expect(distanceMetres(north(2000), HOME), 'the distance is the same in the other direction').toBe(2000);
        // One degree of latitude on the library's sphere, and a known pair of cities (Calgary to Edmonton is about 280 km).
        expect(distanceMetres({ latitude: 0, longitude: 10 }, { latitude: 1, longitude: 10 }), 'one degree of latitude is 111,195 m').toBe(111195);
        const calgaryToEdmonton = distanceMetres({ latitude: 51.0447, longitude: -114.0719 }, { latitude: 53.5461, longitude: -113.4938 });
        expect(calgaryToEdmonton, `Calgary to Edmonton is about 280 km (it is ${calgaryToEdmonton} m)`).toBeGreaterThan(275000);
        expect(calgaryToEdmonton, `Calgary to Edmonton is about 280 km (it is ${calgaryToEdmonton} m)`).toBeLessThan(285000);

        expect(awayFrom(job, HOME), 'at the address: 0 m and not away').toEqual({ distance_m: 0, away: 0 });
        expect(awayFrom(job, north(2000)), '2 km off: 2000 m and away').toEqual({ distance_m: 2000, away: 1 });
        expect(awayFrom(job, north(499)), '499 m: not away').toEqual({ distance_m: 499, away: 0 });
        expect(awayFrom(job, north(500)), 'exactly 500 m is not MORE than 500 m: not away').toEqual({ distance_m: 500, away: 0 });
        expect(awayFrom(job, north(501)), '501 m: away').toEqual({ distance_m: 501, away: 1 });
        expect(awayFrom({ latitude: 51.0447, longitude: -114.0719 }, north(2000)), 'a job position given as numbers works the same').toEqual({ distance_m: 2000, away: 1 });

        // No position to compare: null and null, never "at the address".
        const none = { distance_m: null, away: null };
        for (const empty of [
            { latitude: null, longitude: null }, { latitude: undefined, longitude: undefined }, { latitude: '', longitude: '' }, {},
            { latitude: 'abc', longitude: '1' }, { latitude: '51.0447', longitude: null }, { latitude: NaN, longitude: NaN },
            { latitude: '91.0', longitude: '0' }, { latitude: '0', longitude: '181' }, null, undefined,
        ]) {
            expect(awayFrom(empty, HOME), `a booking with position ${JSON.stringify(empty)} has nothing to compare`).toEqual(none);
        }
    });

    test('AC11: readLocation takes a finite fix and refuses strings, NaN, Infinity, 91 degrees and {0,0}', async () => {
        const { readLocation } = await import('../src/lib/job-window.js');
        const fix = { latitude: 51.0447, longitude: -114.0719 };

        expect(readLocation({ ...fix, accuracy: 25.4 }), 'a fix with an accuracy is read, the accuracy in whole metres').toEqual({ ok: true, latitude: 51.0447, longitude: -114.0719, accuracy_m: 25 });
        expect(readLocation(fix), 'an absent accuracy is allowed and is null').toEqual({ ok: true, latitude: 51.0447, longitude: -114.0719, accuracy_m: null });
        expect(readLocation({ latitude: 51.123456789, longitude: -114.123456789 }), 'the columns hold eight decimals').toMatchObject({ ok: true, latitude: 51.12345679, longitude: -114.12345679 });
        for (const edge of [{ latitude: 90, longitude: 180 }, { latitude: -90, longitude: -180 }, { latitude: 0, longitude: 5 }, { latitude: 5, longitude: 0 }, { ...fix, accuracy: 0 }, { ...fix, accuracy: 100000 }]) {
            expect(readLocation(edge).ok, `the edge ${JSON.stringify(edge)} is a fix`).toBe(true);
        }

        const refused = [
            ['strings', { latitude: '51.0447', longitude: '-114.0719' }],
            ['a string latitude', { latitude: '51.0447', longitude: -114.0719 }],
            ['a string longitude', { latitude: 51.0447, longitude: '-114.0719' }],
            ['NaN', { latitude: NaN, longitude: NaN }],
            ['NaN latitude', { latitude: NaN, longitude: -114.0719 }],
            ['Infinity', { latitude: Infinity, longitude: -114.0719 }],
            ['-Infinity', { latitude: 51.0447, longitude: -Infinity }],
            ['91 degrees of latitude', { latitude: 91, longitude: -114.0719 }],
            ['-91 degrees of latitude', { latitude: -91, longitude: -114.0719 }],
            ['181 degrees of longitude', { latitude: 51.0447, longitude: 181 }],
            ['-181 degrees of longitude', { latitude: 51.0447, longitude: -181 }],
            ['{0,0}', { latitude: 0, longitude: 0 }],
            ['{0,0} with an accuracy', { latitude: 0, longitude: 0, accuracy: 5 }],
            ['no longitude', { latitude: 51.0447 }],
            ['no latitude', { longitude: -114.0719 }],
            ['an empty object', {}],
            ['null', null],
            ['undefined', undefined],
            ['an array', [51.0447, -114.0719]],
            ['a number', 5],
            ['a string', '51.0447,-114.0719'],
            ['a negative accuracy', { ...fix, accuracy: -1 }],
            ['an accuracy over 100000', { ...fix, accuracy: 100001 }],
            ['a string accuracy', { ...fix, accuracy: '25' }],
            ['a NaN accuracy', { ...fix, accuracy: NaN }],
            ['an Infinity accuracy', { ...fix, accuracy: Infinity }],
        ];
        for (const [what, value] of refused) {
            expect(readLocation(/** @type {any} */ (value)), `${what} is refused`).toEqual({ ok: false });
        }
    });
});

// =====================================================================================================================================
// Plain Node: names, numbers and the one way a text is sent
// =====================================================================================================================================
const TWILIO_NAMES = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'];

// Runs `body(calls, lines)` with fetch stubbed (every call is recorded and answered 201), the three Twilio variables set to made-up values, and
// the console captured into `lines`; puts all of it back, whatever happens.
async function withStubbedTwilio(body) {
    const savedFetch = globalThis.fetch;
    const savedEnv = Object.fromEntries(TWILIO_NAMES.map((name) => [name, process.env[name]]));
    const savedConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error };
    /** @type {{ url: string, init: any }[]} */
    const calls = [];
    /** @type {string[]} */
    const lines = [];
    try {
        globalThis.fetch = /** @type {any} */ (async (url, init) => {
            calls.push({ url: String(url), init });
            return { ok: true, status: 201, json: async () => ({}) };
        });
        process.env.TWILIO_ACCOUNT_SID = 'ACrulesfixture0000';
        process.env.TWILIO_AUTH_TOKEN = 'rules-fixture-secret';
        process.env.TWILIO_PHONE_NUMBER = '+15005550006';
        const capture = (...args) => { lines.push(args.map(String).join(' ')); };
        console.log = capture;
        console.info = capture;
        console.warn = capture;
        console.error = capture;
        await body(calls, lines);
    } finally {
        globalThis.fetch = savedFetch;
        for (const name of TWILIO_NAMES) {
            if (savedEnv[name] === undefined) delete process.env[name];
            else process.env[name] = savedEnv[name];
        }
        console.log = savedConsole.log;
        console.info = savedConsole.info;
        console.warn = savedConsole.warn;
        console.error = savedConsole.error;
    }
}

const bodyOf = (call) => new URLSearchParams(String(call.init?.body ?? ''));

test.describe('ENG-015 rules: names, numbers and the SMS sender in plain Node', () => {
    test('AC7: sendSMS with a stubbed fetch and the three Twilio variables sends To +14035550164 for a bare ten digits, and to no +91 number', async () => {
        const { sendSMS } = await import('../src/lib/sms.js');
        const stored = phoneOf(164);
        await withStubbedTwilio(async (calls, lines) => {
            const typedForms = ['4035550164', '14035550164', '+14035550164', '(403) 555-0164', ' 403.555.0164 ', '+1 (403) 555-0164'];
            for (const typed of typedForms) {
                const before = calls.length;
                const answer = await sendSMS(typed, 'rules fixture body');
                expect(answer, `${typed}: sendSMS answers true when Twilio accepts`).toBe(true);
                expect(calls.length - before, `${typed}: exactly one call to Twilio`).toBe(1);
                const params = bodyOf(calls[calls.length - 1]);
                expect(params.get('To'), `${typed}: To is the +1 number, never a +91 one`).toBe(stored);
                expect(params.get('From'), `${typed}: From is the configured Twilio number`).toBe('+15005550006');
                expect(params.get('Body'), `${typed}: the body goes as given`).toBe('rules fixture body');
            }
            expect(calls.every((call) => call.url === 'https://api.twilio.com/2010-04-01/Accounts/ACrulesfixture0000/Messages.json'), 'every call goes to the account\'s Messages endpoint').toBe(true);
            expect(calls.every((call) => call.init?.method === 'POST'), 'every call is a POST').toBe(true);
            expect(calls.every((call) => String(call.init?.headers?.Authorization).startsWith('Basic ')), 'every call carries Basic credentials').toBe(true);
            expect(calls.some((call) => bodyOf(call).get('To')?.startsWith('+91')), 'no call is addressed to a +91 number').toBe(false);
            expect(lines.every((line) => line === 'SMS sent'), `the only log line is the fixed "SMS sent" (it logged ${JSON.stringify(lines.filter((line) => line !== 'SMS sent'))})`).toBe(true);
        });
    });

    test('Condition 2: the normaliseName table: invisible characters are stripped, Unicode spaces become plain, runs collapse, and 120 characters pass while 121 do not', async () => {
        const { normaliseName, NAME_MAX } = await import('../src/lib/booking-crew.js');
        const EMPTY = "Enter the cleaner's name.";
        expect(NAME_MAX, 'a name has at most 120 characters').toBe(120);

        /** @type {[string, string, string][]} */
        const accepted = [
            ['Sam​', 'Sam', 'a trailing zero-width space is stripped'],
            ['‮evil', 'evil', 'a leading right-to-left override is stripped'],
            ['Sam‎', 'Sam', 'a left-to-right mark is stripped'],
            ['﻿Sam', 'Sam', 'a byte order mark is stripped'],
            ['Sa­m', 'Sam', 'a soft hyphen is stripped'],
            ['⁦Sam⁩', 'Sam', 'direction isolates are stripped'],
            ['Sam​ ​Jones', 'Sam Jones', 'a zero-width space beside a space leaves the one space'],
            ['A B', 'A B', 'a plain space stays'],
            ['A B', 'A B', 'a no-break space becomes a plain space'],
            ['A B', 'A B', 'an em space becomes a plain space'],
            ['A　B', 'A B', 'an ideographic space becomes a plain space'],
            ['A B', 'A B', 'a narrow no-break space becomes a plain space'],
            ['A   B', 'A B', 'a run of spaces collapses to one'],
            ['A    B', 'A B', 'a run of mixed spaces collapses to one'],
            ['  Sam  ', 'Sam', 'the ends are trimmed (ENG-014 still passes)'],
            [' Sam　', 'Sam', 'the ends are trimmed whatever kind of space they are'],
            ['José', 'José', 'a name with an accent is unchanged'],
            ['José', 'José', 'a name with a combining accent is unchanged'],
            ['Zoë-Anne O’Brien', 'Zoë-Anne O’Brien', 'hyphens and apostrophes are unchanged'],
            ['a'.repeat(120), 'a'.repeat(120), '120 characters pass'],
            ['\u{1F600}'.repeat(120), '\u{1F600}'.repeat(120), '120 characters pass when each is two UTF-16 units'],
            [`${'a'.repeat(120)}​​`, 'a'.repeat(120), '120 characters plus invisible ones pass (the invisible ones are not counted)'],
        ];
        for (const [input, expected, why] of accepted) {
            const result = normaliseName(input);
            expect(result.ok, `${why}: it is accepted`).toBe(true);
            expect(result.name, `${why}: the name is stored as this`).toBe(expected);
        }

        /** @type {[any, string, string][]} */
        const refused = [
            ['ㅤ', EMPTY, 'a Hangul filler alone is empty'],
            ['⠀', EMPTY, 'a blank Braille pattern alone is empty'],
            ['ㅤ⠀ ​', EMPTY, 'only invisible characters is empty'],
            ['​​', EMPTY, 'zero-width spaces alone are empty'],
            ['   　', EMPTY, 'only spaces is empty'],
            ['', EMPTY, 'an empty string is empty'],
            [undefined, EMPTY, 'no name is empty'],
            [null, EMPTY, 'null is empty'],
            [42, EMPTY, 'a number is not a name'],
            ['a'.repeat(121), `A name can have at most ${NAME_MAX} characters.`, '121 characters are refused'],
            ['\u{1F600}'.repeat(121), `A name can have at most ${NAME_MAX} characters.`, '121 characters are refused when each is two UTF-16 units'],
            [`${'a'.repeat(121)}​`, `A name can have at most ${NAME_MAX} characters.`, '121 characters plus an invisible one are refused'],
            ['Sam\nJones', 'A name cannot have line breaks or other control characters.', 'a line break is refused'],
            ['Sam\tJones', 'A name cannot have line breaks or other control characters.', 'a tab is refused'],
            ['Sam\u0007', 'A name cannot have line breaks or other control characters.', 'a bell is refused'],
            ['Sam Jones', 'A name cannot have line breaks or other control characters.', 'a line separator is refused'],
        ];
        for (const [input, message, why] of refused) {
            const result = normaliseName(input);
            expect(result.ok, `${why}: it is refused`).toBe(false);
            expect(result.message, `${why}: the message says why`).toBe(message);
        }
    });

    test('Condition 5: the canText table: Canadian numbers are accepted; toll, premium, Caribbean, US and foreign numbers are refused', async () => {
        const { canText, CANADIAN_AREA_CODES } = await import('../src/lib/phone.js');
        const accepted = ['+14035550123', '+16045550123', '+14165550123', '+15145550123', '+18675550123'];
        const refused = ['+19005550100', '+19765550100', '+18095550100', '+18765550100', '+12125550100', '+442071838750', '+919876543210'];
        for (const number of accepted) expect(canText(number), `${number} is a Canadian number and may be texted`).toBe(true);
        for (const number of refused) expect(canText(number), `${number} is not a Canadian number and may not be texted`).toBe(false);

        // The design's whole list is in (the allow-list may have more: the backend checked it against the assignments), and these are out.
        const designList = [
            '368', '403', '587', '780', '825', '236', '250', '257', '604', '672', '778', '204', '431', '584', '428', '506', '709', '879', '782', '902',
            '226', '249', '289', '343', '365', '382', '416', '437', '519', '548', '613', '647', '683', '705', '742', '753', '807', '905', '942',
            '263', '354', '367', '418', '438', '450', '468', '514', '579', '581', '819', '873', '306', '474', '639', '867',
        ];
        expect(designList.length, 'the design lists 55 area codes').toBe(55);
        for (const code of designList) expect(canText(`+1${code}5550100`), `area code ${code} is on the design's list, so it may be texted`).toBe(true);
        const outside = ['212', '310', '415', '646', '900', '976', '809', '829', '876', '242', '246', '441', '758', '787', '671', '340', '800', '833', '844', '855', '866', '877', '888', '911'];
        for (const code of outside) expect(canText(`+1${code}5550100`), `area code ${code} is not Canadian, so it may not be texted`).toBe(false);

        // Only a string in the one form is texted: no guessing a country, no spaces, no extra digits, no non-strings.
        for (const odd of ['4035550123', '14035550123', '+1 403 555 0123', '(403) 555-0123', '+1403555012', '+140355501234', '+11035550123', '+14031550123', '+1403555012x', '', '+1', null, undefined, 4035550123, {}, ['+14035550123']]) {
            expect(canText(/** @type {any} */ (odd)), `${JSON.stringify(odd)} is not an E.164 Canadian number, so canText says no`).toBe(false);
        }
        // The list cannot be changed once it is made: a new overlay fails closed until someone adds a line to the file.
        expect(Object.isFrozen(CANADIAN_AREA_CODES), 'the allow-list is frozen').toBe(true);
        expect(() => CANADIAN_AREA_CODES.add('900'), 'add() on the allow-list throws').toThrow();
        expect(() => CANADIAN_AREA_CODES.delete('403'), 'delete() on the allow-list throws').toThrow();
        expect(() => CANADIAN_AREA_CODES.clear(), 'clear() on the allow-list throws').toThrow();
        expect(CANADIAN_AREA_CODES.has('900') || !CANADIAN_AREA_CODES.has('403'), 'the failed changes changed nothing').toBe(false);
    });

    test('Condition 5: sendSMS with a stubbed fetch makes NO call for any number canText refuses, and a fixed log line says why', async () => {
        const { sendSMS } = await import('../src/lib/sms.js');
        await withStubbedTwilio(async (calls, lines) => {
            // The table's refused numbers as they are, and typed the ways a person would type them (the old helper sent a bare ten digits to India).
            const refusedNumbers = [
                '+19005550100', '+19765550100', '+18095550100', '+18765550100', '+12125550100', '+442071838750', '+919876543210',
                '9005550100', '19765550100', '(809) 555-0100', '876-555-0100', '212 555 0100', '9876543210', '+1 900 555 0100',
            ];
            for (const number of refusedNumbers) {
                const answer = await sendSMS(number, 'rules fixture body');
                expect(answer, `${number}: sendSMS answers false`).toBe(false);
            }
            // Not numbers at all: refused before anything else.
            for (const notANumber of ['call me', '', '   ', '12345', '+0123456789', undefined, null, 5]) {
                const answer = await sendSMS(/** @type {any} */ (notANumber), 'rules fixture body');
                expect(answer, `${JSON.stringify(notANumber)}: sendSMS answers false`).toBe(false);
            }
            expect(calls.length, 'not one call to Twilio for any refused number (fetch was never reached)').toBe(0);
            const fixed = new Set(['SMS not sent: destination_not_allowed', 'SMS not sent: bad_number']);
            expect(lines.length, 'every refusal logs one line').toBe(refusedNumbers.length + 8);
            expect(lines.every((line) => fixed.has(line)), `the only log lines are the two fixed refusals (it logged ${JSON.stringify([...new Set(lines.filter((line) => !fixed.has(line)))])})`).toBe(true);
            expect(lines.some((line) => /\d{4}/.test(line)), 'no log line holds any part of a number').toBe(false);
            expect(lines.slice(0, refusedNumbers.length).every((line) => line === 'SMS not sent: destination_not_allowed'), 'a real number that is not Canadian is destination_not_allowed').toBe(true);

            // The stub is live: a Canadian number goes through it, so "no call" above is not an artefact.
            for (const number of ['+14035550123', '+16045550123', '+14165550123', '+15145550123', '+18675550123']) {
                const before = calls.length;
                expect(await sendSMS(number, 'rules fixture body'), `${number}: a Canadian number is sent`).toBe(true);
                expect(calls.length - before, `${number}: one call`).toBe(1);
                expect(bodyOf(calls[calls.length - 1]).get('To'), `${number}: To is the number`).toBe(number);
            }
        });
    });
});

// =====================================================================================================================================
// Library over the dev database: code asks and send budgets
// =====================================================================================================================================
const DB = { host: '127.0.0.1', port: 3307, user: 'root', password: 'root123', database: 'workontap_db' };

/** @type {import('mysql2/promise').Pool | null} */
let pool = null;

// The one pool of this worker, opened on first use, after the guard has checked the target and the rows in it. A pool (not one connection) so that
// a burst of parallel statements really runs in parallel.
async function db() {
    if (pool) return pool;
    assertDevTarget(DB);
    const opened = mysql.createPool({ ...DB, waitForConnections: true, connectionLimit: 10, queueLimit: 0 });
    try {
        await assertNoRealPeople(/** @type {any} */ (opened));
    } catch (error) {
        await opened.end();
        throw error;
    }
    pool = opened;
    return pool;
}

// The shape src/lib/db.js's `execute` has: the rows for a SELECT, the result header (affectedRows, insertId) for a write. Every statement of this
// file is prepared, with a ? for every value.
async function execute(sql, params = []) {
    const [result] = await (await db()).execute(sql, params);
    return /** @type {any} */ (result);
}

const marks = (list) => list.map(() => '?').join(', ');
const countOf = async (sql, params = []) => Number((await execute(sql, params))[0].n);

// Scopes of the budget rows these cases make from keys that are not a number of the block (made-up number keys); the sweep deletes them too.
const trackedScopes = new Set();

// Deletes every row this file's cases made: the rows that hang off the bookings with the e-mail prefix and the crew members with a number of the
// block, those bookings and members, and the budget rows of the block's numbers, of the made-up providers, of those links and members, and of the
// tracked made-up keys. Nothing else, so the other ENG-015 files' rows are never touched.
async function sweep() {
    const { budgetScope } = await import('../src/lib/sms-budget.js');
    const bookingIds = (await execute('SELECT id FROM bookings WHERE customer_email LIKE ?', [`${EMAIL_PREFIX}%`])).map((row) => row.id);
    const memberIds = (await execute('SELECT id FROM provider_crew_members WHERE phone BETWEEN ? AND ?', [phoneOf(BLOCK_FIRST), phoneOf(BLOCK_LAST)])).map((row) => row.id);

    const scopes = new Set(trackedScopes);
    for (let last4 = BLOCK_FIRST; last4 <= BLOCK_LAST; last4++) {
        scopes.add(budgetScope('number', phoneOf(last4)));
        scopes.add(budgetScope('provider', syntheticProvider(last4)));
    }
    if (bookingIds.length > 0) {
        const linkIds = (await execute(`SELECT id FROM job_links WHERE booking_id IN (${marks(bookingIds)})`, bookingIds)).map((row) => row.id);
        for (const linkId of linkIds) {
            scopes.add(budgetScope('ask', linkId));
            scopes.add(budgetScope('verify', linkId));
            for (const memberId of memberIds) scopes.add(budgetScope('cooldown', linkId, memberId));
        }
        if (linkIds.length > 0) {
            await execute(`DELETE FROM job_link_events WHERE link_id IN (${marks(linkIds)})`, linkIds);
            await execute(`DELETE FROM job_link_codes WHERE link_id IN (${marks(linkIds)})`, linkIds);
        }
        await execute(`DELETE FROM job_links WHERE booking_id IN (${marks(bookingIds)})`, bookingIds);
        await execute(`DELETE FROM booking_crew WHERE booking_id IN (${marks(bookingIds)})`, bookingIds);
    }
    if (memberIds.length > 0) {
        await execute(`DELETE FROM crew_number_checks WHERE crew_member_id IN (${marks(memberIds)})`, memberIds);
        await execute(`DELETE FROM booking_crew WHERE crew_member_id IN (${marks(memberIds)})`, memberIds);
    }
    if (bookingIds.length > 0) await execute(`DELETE FROM bookings WHERE id IN (${marks(bookingIds)})`, bookingIds);
    if (memberIds.length > 0) await execute(`DELETE FROM provider_crew_members WHERE id IN (${marks(memberIds)})`, memberIds);

    const list = [...scopes];
    for (let from = 0; from < list.length; from += 100) {
        const chunk = list.slice(from, from + 100);
        await execute(`DELETE FROM sms_budget WHERE scope IN (${marks(chunk)})`, chunk);
    }
    trackedScopes.clear();
}

let sequence = 0;

// A confirmed job of provider 1 (the member must be on the same provider's job for the crew to count), made by direct insert: these cases call
// the libraries, not the checkout. The e-mail prefix is what the sweep finds it by.
async function makeBooking() {
    sequence += 1;
    const header = await execute(
        `INSERT INTO bookings (booking_number, service_id, service_name, service_price, customer_first_name, customer_last_name, customer_email, customer_phone,
           job_date, job_time_slot, job_description, address_line1, city, status, payment_status, provider_id)
         VALUES (?, 1, 'Probe service', 100.00, 'E2E', 'Probe', ?, ?, '2026-12-01', 'Morning', 'ENG-015 rules probe', '1 Probe Street', 'Calgary', 'confirmed', 'pending', 1)`,
        [`E2EJD${run}${sequence}`, `${EMAIL_PREFIX}${run}-${sequence}@example.invalid`, phoneOf(BLOCK_LAST)]
    );
    return Number(header.insertId);
}

async function makeMember(name, phone) {
    const header = await execute('INSERT INTO provider_crew_members (provider_id, name, phone) VALUES (1, ?, ?)', [name, phone]);
    return Number(header.insertId);
}

const putOnJob = (bookingId, memberId) => execute('INSERT INTO booking_crew (booking_id, crew_member_id) VALUES (?, ?)', [bookingId, memberId]);

// The provider's check of the number, as askNumberCheck/confirmNumberCheck leave it: a used row for the member and the member's current number.
const markChecked = (memberId, phone) =>
    execute('INSERT INTO crew_number_checks (crew_member_id, phone, code_hash, expires_at, used_at) VALUES (?, ?, ?, NOW(), NOW())', [
        memberId, phone, createHash('sha256').update(`rules:${run}:${memberId}`).digest('hex'),
    ]);

// What findJobLink answers, at least: the link's row and the provider whose budget it spends (made up here).
async function makeLink(bookingId, providerId) {
    const { newLinkToken } = await import('../src/lib/link-token.js');
    const header = await execute('INSERT INTO job_links (booking_id, token) VALUES (?, ?)', [bookingId, newLinkToken()]);
    return { id: Number(header.insertId), booking_id: bookingId, generation: 1, provider_id: providerId };
}

// A sender that only records: the texts a real one would send, as [to, text] pairs.
function recorder() {
    /** @type {{ to: string, text: string }[]} */
    const sent = [];
    const sendText = async (to, text) => {
        sent.push({ to, text });
        return true;
    };
    return { sent, sendText };
}

test.describe('ENG-015 rules: send budgets and code asks over the dev database', () => {
    test.beforeAll(async () => {
        await sweep();
    });
    test.afterEach(async () => {
        await sweep();
    });
    test.afterAll(async () => {
        try {
            await sweep();
        } finally {
            if (pool) {
                await pool.end();
                pool = null;
            }
        }
    });

    test('AC7: requestCode with an injected sendText records one send each for 4035550160, 14035550160, +14035550160 and (403) 555-0160, to +14035550160 and never a +91 number', async () => {
        test.setTimeout(120_000);
        const { requestCode, CODE_MESSAGES } = await import('../src/lib/job-link-code.js');
        const { budgetScope } = await import('../src/lib/sms-budget.js');
        const number = phoneOf(160);
        const bookingId = await makeBooking();
        const memberId = await makeMember(`E2E Rules ${run} AC7`, number);
        await putOnJob(bookingId, memberId);
        await markChecked(memberId, number);
        const link = await makeLink(bookingId, syntheticProvider(160));
        const { sent, sendText } = recorder();

        for (const typed of ['4035550160', '14035550160', '+14035550160', '(403) 555-0160']) {
            // One ask a minute for a member on a link is a rule of its own (Condition 4); each form here is a new minute.
            await execute('DELETE FROM sms_budget WHERE scope = ?', [budgetScope('cooldown', link.id, memberId)]);
            const before = sent.length;
            const answer = await requestCode({ execute, sendText, link, rawPhone: typed });
            expect(answer, `${typed}: the answer is the one answer every ask gets`).toEqual({ status: 'requested' });
            expect(sent.length - before, `${typed}: exactly one text is sent`).toBe(1);
            expect(sent[sent.length - 1].to, `${typed}: the text goes to the stored +1 number`).toBe(number);
        }
        expect(sent.length, 'four asks, four texts, no more').toBe(4);
        expect(sent.every((text) => text.to === number), 'every text went to +14035550160').toBe(true);
        expect(sent.some((text) => text.to.startsWith('+91')), 'no text went to a +91 number').toBe(false);
        expect(sent.every((text) => /^WorkOnTap: \d{6} is your code to open your job\. Do not share it\./.test(text.text)), 'every text is the sign-in code text').toBe(true);
        expect(sent.every((text) => text.text.length < 160 && /^[\x20-\x7e]+$/.test(text.text)), 'every text is plain ASCII under 160 characters').toBe(true);
        expect(await countOf('SELECT COUNT(*) AS n FROM job_link_codes WHERE link_id = ? AND crew_member_id = ? AND used_at IS NULL AND expires_at > NOW()', [link.id, memberId]), 'each ask retires the code before it: one live code').toBe(1);
        expect(await countOf("SELECT COUNT(*) AS n FROM job_link_events WHERE link_id = ? AND kind = 'code_asked' AND detail = 'sent'", [link.id]), 'four sent events, one per ask').toBe(4);

        // A number typed that is on no crew: the same answer, no text, a no_match event.
        const before = sent.length;
        const stranger = await requestCode({ execute, sendText, link, rawPhone: '(403) 555-0179' });
        expect(stranger, 'a number that is on no crew gets the same answer').toEqual({ status: 'requested' });
        expect(sent.length, 'and no text goes out').toBe(before);
        expect(await countOf("SELECT COUNT(*) AS n FROM job_link_events WHERE link_id = ? AND kind = 'code_asked' AND detail = 'no_match'", [link.id]), 'the event record says no_match').toBe(1);
        // A blank or a non-number is the library's own answer to a visitor, with its own wording, and sends nothing.
        for (const blank of ['', '   ', undefined, null]) {
            const answer = await requestCode({ execute, sendText, link, rawPhone: /** @type {any} */ (blank) });
            expect(answer, `${JSON.stringify(blank)}: a blank number is invalid with its own wording`).toEqual({ status: 'invalid', message: CODE_MESSAGES.blank });
        }
        expect(sent.length, 'invalid asks send nothing').toBe(before);
    });

    test('Condition 4: reserve() x50 in parallel with a cap of 5 grants exactly 5', async () => {
        test.setTimeout(120_000);
        const { reserve, budgetScope } = await import('../src/lib/sms-budget.js');
        const scope = budgetScope('e2e-jd', run, 'burst');
        trackedScopes.add(scope);
        const burst = await Promise.all(Array.from({ length: 50 }, () => reserve(execute, scope, 5, 3600)));
        expect(burst.filter(Boolean).length, '50 parallel reserves with a cap of 5 grant exactly 5').toBe(5);
        expect(burst.filter((granted) => granted === false).length, 'and refuse the other 45').toBe(45);
        const [row] = await execute('SELECT used FROM sms_budget WHERE scope = ?', [scope]);
        expect(row.used, 'the counter stops at the cap').toBe(5);

        // The race of the first ask: many reserves for a scope that has no row yet, cap 1, on fresh scopes each time.
        let exactlyOne = 0;
        for (let round = 0; round < 10; round++) {
            const fresh = budgetScope('e2e-jd', run, 'fresh', round);
            trackedScopes.add(fresh);
            const results = await Promise.all(Array.from({ length: 30 }, () => reserve(execute, fresh, 1, 3600)));
            if (results.filter(Boolean).length === 1) exactlyOne += 1;
        }
        expect(exactlyOne, '10 fresh scopes x 30 parallel reserves with a cap of 1: exactly 1 granted each time').toBe(10);
    });

    test('Condition 4: reserveText caps a number at 8 and a provider at 200 a day (made-up provider ids, so no real budget is touched)', async () => {
        test.setTimeout(120_000);
        const { reserveText, budgetScope, TEXTS_PER_NUMBER_DAY, TEXTS_PER_PROVIDER_DAY } = await import('../src/lib/sms-budget.js');
        expect(TEXTS_PER_NUMBER_DAY, 'a number gets 8 texts in 24 hours').toBe(8);
        expect(TEXTS_PER_PROVIDER_DAY, 'a provider gets 200 texts in 24 hours').toBe(200);

        // One number, a burst of 20: 8 granted, 12 number_cap, and the refused ones spend none of the provider's budget.
        const provider = syntheticProvider(163);
        const number = phoneOf(163);
        const burst = await Promise.all(Array.from({ length: 20 }, () => reserveText(execute, number, provider)));
        expect(burst.filter((answer) => answer === null).length, '20 parallel texts to one number: 8 are granted').toBe(8);
        expect(burst.filter((answer) => answer === 'number_cap').length, 'and the other 12 are number_cap').toBe(12);
        const [providerRow] = await execute('SELECT used FROM sms_budget WHERE scope = ?', [budgetScope('provider', provider)]);
        expect(providerRow.used, 'the refused texts did not spend the provider\'s budget (8 used)').toBe(8);
        const [numberRow] = await execute('SELECT used FROM sms_budget WHERE scope = ?', [budgetScope('number', number)]);
        expect(numberRow.used, 'the number\'s counter stops at 8').toBe(8);

        // One provider, 205 different numbers: 200 granted, 5 provider_cap. The numbers are made-up keys, not phone numbers.
        const busy = syntheticProvider(164);
        const keys = Array.from({ length: 205 }, (_, index) => `e2e-jd-${run}-n${index}`);
        for (const key of keys) trackedScopes.add(budgetScope('number', key));
        const answers = [];
        for (let from = 0; from < keys.length; from += 25) {
            answers.push(...(await Promise.all(keys.slice(from, from + 25).map((key) => reserveText(execute, key, busy)))));
        }
        expect(answers.filter((answer) => answer === null).length, '205 numbers for one provider: 200 are granted').toBe(200);
        expect(answers.filter((answer) => answer === 'provider_cap').length, 'and 5 are provider_cap').toBe(5);
        const [busyRow] = await execute('SELECT used FROM sms_budget WHERE scope = ?', [budgetScope('provider', busy)]);
        expect(busyRow.used, 'the provider\'s counter stops at 200').toBe(200);
    });

    test('Condition 4: a full budget grants again once its window is over, the new window starts at 1, and a refusal does not spend the provider\'s budget', async () => {
        test.setTimeout(120_000);
        const { reserve, reserveText, budgetScope, TEXTS_PER_NUMBER_DAY, DAY_SECONDS } = await import('../src/lib/sms-budget.js');
        expect(DAY_SECONDS, 'the daily window is 86,400 seconds').toBe(86400);

        // A small budget: a cap of 2 an hour. The window is moved back in SQL instead of waiting for it.
        const scope = budgetScope('e2e-jd', run, 'window');
        trackedScopes.add(scope);
        expect([await reserve(execute, scope, 2, 3600), await reserve(execute, scope, 2, 3600)], 'the first two reserves in a window are granted').toEqual([true, true]);
        expect([await reserve(execute, scope, 2, 3600), await reserve(execute, scope, 2, 3600)], 'the third and fourth are over the cap of 2').toEqual([false, false]);
        await execute('UPDATE sms_budget SET window_started_at = NOW() - INTERVAL 59 MINUTE WHERE scope = ?', [scope]);
        expect(await reserve(execute, scope, 2, 3600), 'a window that began 59 minutes ago is still the window: still full').toBe(false);
        await execute('UPDATE sms_budget SET window_started_at = NOW() - INTERVAL 61 MINUTE WHERE scope = ?', [scope]);
        expect(await reserve(execute, scope, 2, 3600), 'a window that began 61 minutes ago is over: the next reserve is granted').toBe(true);
        const [fresh] = await execute('SELECT used FROM sms_budget WHERE scope = ?', [scope]);
        expect(fresh.used, 'and the new window starts with a count of 1, not of the old window\'s 3').toBe(1);
        expect([await reserve(execute, scope, 2, 3600), await reserve(execute, scope, 2, 3600)], 'the new window has one place left and then is full').toEqual([true, false]);

        // A number's day: 8 texts, the 9th is number_cap and takes nothing from the provider, 23 hours later it is still full, 25 hours later it is not.
        const number = phoneOf(166);
        const provider = syntheticProvider(166);
        const numberScope = budgetScope('number', number);
        const providerScope = budgetScope('provider', provider);
        for (let text = 1; text <= TEXTS_PER_NUMBER_DAY; text++) {
            expect(await reserveText(execute, number, provider), `text ${text} of ${TEXTS_PER_NUMBER_DAY} to the number is granted`).toBeNull();
        }
        expect(await reserveText(execute, number, provider), 'the 9th text to the number is number_cap').toBe('number_cap');
        const [providerBefore] = await execute('SELECT used FROM sms_budget WHERE scope = ?', [providerScope]);
        expect(providerBefore.used, 'the refused text spent nothing of the provider\'s budget (8)').toBe(8);
        await execute('UPDATE sms_budget SET window_started_at = NOW() - INTERVAL 23 HOUR WHERE scope = ?', [numberScope]);
        expect(await reserveText(execute, number, provider), '23 hours into the day the number is still at its cap').toBe('number_cap');
        await execute('UPDATE sms_budget SET window_started_at = NOW() - INTERVAL 25 HOUR WHERE scope = ?', [numberScope]);
        expect(await reserveText(execute, number, provider), '25 hours on, the number\'s day is over and a text is granted').toBeNull();
        const [numberAfter] = await execute('SELECT used FROM sms_budget WHERE scope = ?', [numberScope]);
        expect(numberAfter.used, 'the number\'s new day starts at 1').toBe(1);
        const [providerAfter] = await execute('SELECT used FROM sms_budget WHERE scope = ?', [providerScope]);
        expect(providerAfter.used, 'and the provider has spent 9 in all').toBe(9);
    });

    test('Condition 4: 30 parallel code asks for one member and link send exactly once', async () => {
        test.setTimeout(120_000);
        const { requestCode, ASKS_PER_LINK } = await import('../src/lib/job-link-code.js');
        const { budgetScope } = await import('../src/lib/sms-budget.js');
        const number = phoneOf(161);
        const bookingId = await makeBooking();
        const memberId = await makeMember(`E2E Rules ${run} burst`, number);
        await putOnJob(bookingId, memberId);
        await markChecked(memberId, number);
        const link = await makeLink(bookingId, syntheticProvider(161));
        const { sent, sendText } = recorder();

        const answers = await Promise.all(Array.from({ length: 30 }, () => requestCode({ execute, sendText, link, rawPhone: number })));
        expect(sent.length, '30 parallel asks for one member on one link send exactly one text').toBe(1);
        expect(sent[0].to, 'the one text goes to the member\'s number').toBe(number);
        const requested = answers.filter((answer) => answer.status === 'requested').length;
        const limited = answers.filter((answer) => answer.status === 'limited').length;
        expect(requested + limited, 'every ask is answered with requested or limited').toBe(30);
        expect(requested, `the per-link ask cap lets ${ASKS_PER_LINK} of the 30 through to be answered`).toBe(ASKS_PER_LINK);
        expect(limited, 'and answers the rest limited').toBe(30 - ASKS_PER_LINK);

        expect(await countOf('SELECT COUNT(*) AS n FROM job_link_codes WHERE link_id = ? AND crew_member_id = ?', [link.id, memberId]), 'one code row was made, not 30').toBe(1);
        const events = await execute('SELECT kind, detail, COUNT(*) AS n FROM job_link_events WHERE link_id = ? GROUP BY kind, detail', [link.id]);
        const byKind = Object.fromEntries(events.map((row) => [`${row.kind}/${row.detail}`, Number(row.n)]));
        expect(byKind['code_asked/sent'], 'one sent event').toBe(1);
        expect(byKind['code_suppressed/cooldown'], 'the other answered asks were held by the one-a-minute rule').toBe(ASKS_PER_LINK - 1);
        const [numberRow] = await execute('SELECT used FROM sms_budget WHERE scope = ?', [budgetScope('number', number)]);
        expect(numberRow.used, 'only the text that went spent the number\'s daily budget').toBe(1);
    });

    test('Condition 4: one number across ten links gets at most 8 texts in a day', async () => {
        test.setTimeout(120_000);
        const { requestCode } = await import('../src/lib/job-link-code.js');
        const { budgetScope, TEXTS_PER_NUMBER_DAY } = await import('../src/lib/sms-budget.js');
        const number = phoneOf(162);
        const memberId = await makeMember(`E2E Rules ${run} ten links`, number);
        await markChecked(memberId, number);
        const links = [];
        for (let index = 0; index < 10; index++) {
            const bookingId = await makeBooking();
            await putOnJob(bookingId, memberId);
            links.push(await makeLink(bookingId, syntheticProvider(162)));
        }
        const { sent, sendText } = recorder();

        const answers = await Promise.all(links.map((link) => requestCode({ execute, sendText, link, rawPhone: number })));
        expect(answers.every((answer) => answer.status === 'requested'), 'all ten asks get the one answer').toBe(true);
        expect(sent.length, 'a number is texted at most 8 times in a day, however many links ask').toBeLessThanOrEqual(TEXTS_PER_NUMBER_DAY);
        expect(sent.length, 'ten asks on ten links (a different link each, so no cooldown applies) send exactly the 8 allowed').toBe(TEXTS_PER_NUMBER_DAY);
        expect(sent.every((text) => text.to === number), 'every text went to the one number').toBe(true);
        const [numberRow] = await execute('SELECT used FROM sms_budget WHERE scope = ?', [budgetScope('number', number)]);
        expect(numberRow.used, 'the number\'s counter says 8').toBe(8);
        expect(await countOf(`SELECT COUNT(*) AS n FROM job_link_events WHERE detail = 'number_cap' AND link_id IN (${marks(links)})`, links.map((link) => link.id)), 'the two asks over the cap are recorded as number_cap').toBe(2);
        expect(await countOf(`SELECT COUNT(*) AS n FROM job_link_codes WHERE link_id IN (${marks(links)})`, links.map((link) => link.id)), 'and made no code: 8 codes for 8 texts').toBe(8);

        // The provider's budget was the made-up one; a later ask on a fresh link finds the number still at its cap.
        const bookingId = await makeBooking();
        await putOnJob(bookingId, memberId);
        const later = await makeLink(bookingId, syntheticProvider(162));
        const answer = await requestCode({ execute, sendText, link: later, rawPhone: number });
        expect(answer, 'a later ask gets the same answer').toEqual({ status: 'requested' });
        expect(sent.length, 'and still no ninth text').toBe(TEXTS_PER_NUMBER_DAY);
    });

    test('Condition 4: the per-link ask cap limits the 21st ask, counts numbers that match nobody, blanks and bad numbers as asks, and is a count of its own for each link', async () => {
        test.setTimeout(120_000);
        const { requestCode, ASKS_PER_LINK } = await import('../src/lib/job-link-code.js');
        const number = phoneOf(165);
        const bookingId = await makeBooking();
        const memberId = await makeMember(`E2E Rules ${run} ask cap`, number);
        await putOnJob(bookingId, memberId);
        await markChecked(memberId, number);
        const link = await makeLink(bookingId, syntheticProvider(165));
        const { sent, sendText } = recorder();
        expect(ASKS_PER_LINK, 'a link allows 20 asks an hour').toBe(20);

        // 20 asks that send nothing: numbers on no crew, blanks and bad numbers, in turn. Every one counts, and none is limited yet.
        const nothing = ['(403) 555-0179', '', '12345', '(403) 555-0178', '   ', '(403) 555-0177'];
        for (let ask = 1; ask <= ASKS_PER_LINK; ask++) {
            const answer = await requestCode({ execute, sendText, link, rawPhone: nothing[(ask - 1) % nothing.length] });
            expect(answer.status, `ask ${ask} of ${ASKS_PER_LINK} is answered and not limited`).not.toBe('limited');
        }
        expect(sent.length, 'none of those 20 asks sent anything').toBe(0);

        // The 21st is limited, even with the member's own number, and sends nothing; so are the ones after it.
        for (const ask of [21, 22]) {
            const answer = await requestCode({ execute, sendText, link, rawPhone: number });
            expect(answer, `ask ${ask} on the link is limited, although its number is a checked member's`).toEqual({ status: 'limited' });
        }
        expect(sent.length, 'a limited ask sends nothing').toBe(0);

        // Another link of the same member has a count of its own.
        const otherBooking = await makeBooking();
        await putOnJob(otherBooking, memberId);
        const otherLink = await makeLink(otherBooking, syntheticProvider(165));
        const answer = await requestCode({ execute, sendText, link: otherLink, rawPhone: number });
        expect(answer, 'the same member asking on another link is not limited by this link\'s count').toEqual({ status: 'requested' });
        expect(sent.length, 'and the one text goes').toBe(1);
        expect(sent[0].to, 'to the member\'s number').toBe(number);
    });

    test('AC11: a booking\'s DECIMAL position comes back from mysql2 as strings and awayFrom reads them; a booking with no position gives null and null', async () => {
        test.setTimeout(120_000);
        const { awayFrom } = await import('../src/lib/job-window.js');
        const metresPerDegree = (6371008.8 * Math.PI) / 180;
        const placedId = await makeBooking();
        await execute('UPDATE bookings SET latitude = ?, longitude = ? WHERE id = ?', ['51.04470000', '-114.07190000', placedId]);
        const bareId = await makeBooking();
        await execute('UPDATE bookings SET latitude = NULL, longitude = NULL WHERE id = ?', [bareId]);

        const [placed] = await execute('SELECT latitude, longitude FROM bookings WHERE id = ?', [placedId]);
        expect(typeof placed.latitude, 'mysql2 answers a DECIMAL latitude as a string').toBe('string');
        expect(typeof placed.longitude, 'mysql2 answers a DECIMAL longitude as a string').toBe('string');
        expect(awayFrom(placed, { latitude: 51.0447, longitude: -114.0719 }), 'the stored position, read as strings: at the address is 0 m and not away').toEqual({ distance_m: 0, away: 0 });
        expect(awayFrom(placed, { latitude: 51.0447 + 2000 / metresPerDegree, longitude: -114.0719 }), '2 km north of the stored position is 2000 m and away').toEqual({ distance_m: 2000, away: 1 });
        expect(awayFrom(placed, { latitude: 51.0447 + 499 / metresPerDegree, longitude: -114.0719 }), '499 m from the stored position is not away').toEqual({ distance_m: 499, away: 0 });

        const [bare] = await execute('SELECT latitude, longitude FROM bookings WHERE id = ?', [bareId]);
        expect(bare, 'a booking with no position reads back as null and null').toEqual({ latitude: null, longitude: null });
        expect(awayFrom(bare, { latitude: 51.0447, longitude: -114.0719 }), 'and has nothing to compare: null and null, never "at the address"').toEqual({ distance_m: null, away: null });
    });

    test('AC10: a real bookings row (job_date as stored, no cluster, city Calgary) opens at 07:00 Toronto time, and the window view reads it', async () => {
        test.setTimeout(120_000);
        const { windowOpensEpoch, windowView } = await import('../src/lib/job-window.js');
        const bookingId = await makeBooking();
        const [row] = await execute('SELECT job_date, job_time_slot, cluster, city FROM bookings WHERE id = ?', [bookingId]);
        const opens = windowOpensEpoch(row);
        expect(opens, 'the row for 2026-12-01 Morning with no cluster: the unknown cluster is Toronto, so it opens at 07:00 EST, 12:00Z').toBe(secondsOf('2026-12-01T12:00:00Z'));
        expect(windowView(row, opens - 1).open, 'a second before it opens the view is closed').toBe(false);
        expect(windowView(row, opens).open, 'at the second it opens the view is open').toBe(true);
        expect(windowView(row, opens).time_zone, 'the view names Toronto\'s zone').toBe(TORONTO);
        expect(windowView(row, opens).opens_label, 'the label is in Toronto time').toBe('7:00 AM EST on Tue, Dec 1');
    });
});
