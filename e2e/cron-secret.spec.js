// @ts-check
// ENG-022, Task D.3: the two cron routes (GET /api/cron/auto-release, GET /api/cron/notifications) are decided by
// requireCronSecret in src/lib/api-auth.js and by nothing else. Two halves per route, both in plain Node (no browser,
// no app request, no database, and so nothing here can run either job):
//   source  the route file calls the guard first, imported from '@/lib/api-auth', and the three old branches are gone
//           from it: the development skip (auto-release, route.js:14 at 1d67c30), the `Bearer undefined` acceptance
//           (auto-release, :15) and the skip-when-CRON_SECRET-is-unset branch (notifications, :14);
//   guard   requireCronSecret answers the way those routes now depend on, for a request to that route's own URL:
//           CRON_SECRET unset -> 401 for every request, `Bearer undefined` and `?secret=undefined` included; set ->
//           no secret and a wrong secret are 401, the right secret passes as a Bearer and as ?secret=.
// The guard-level rules are also in e2e/auth-guard.spec.js ("Auth guard - cron secret"); the cases here put each
// route's name in the title so a route that stops using the guard shows up under its own key.
//
// api-auth.js imports jwt.js (reads JWT_SECRET when first imported) and mobile-auth.js -> db.js (makes a pool when first
// imported, unless global.mysqlPool is set). requireCronSecret needs neither, so beforeAll gives the pool a stub and the
// secret a value before the dynamic import, as e2e/auth-guard.spec.js does, and afterAll puts both back.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ROUTES = [
    { route: '/api/cron/auto-release', file: 'src/app/api/cron/auto-release/route.js' },
    { route: '/api/cron/notifications', file: 'src/app/api/cron/notifications/route.js' },
];

const globals = /** @type {any} */ (globalThis);
/** @type {typeof import('../src/lib/api-auth.js')} */
let guard;
let savedJwtSecret;
let savedPool;

test.beforeAll(async () => {
    savedJwtSecret = process.env.JWT_SECRET;
    savedPool = globals.mysqlPool;
    process.env.JWT_SECRET = 'eng022-cron-spec-secret, not a real one';
    globals.mysqlPool = {
        async getConnection() {
            throw new Error('cron-secret spec stub: the cron guard never asks the database');
        },
    };
    guard = await import('../src/lib/api-auth.js');
});

test.afterAll(() => {
    if (savedJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = savedJwtSecret;
    if (savedPool === undefined) delete globals.mysqlPool;
    else globals.mysqlPool = savedPool;
});

/** The file's code with // line comments and block comments taken out, so a call that exists only in a comment does not count. */
function code(file) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** Runs fn with CRON_SECRET set to `value` (undefined = the variable is absent), the guard's error log captured, and everything put back. */
function withCronSecret(value, fn) {
    const before = process.env.CRON_SECRET;
    const original = console.error;
    const lines = [];
    console.error = (...args) => lines.push(args.join(' '));
    if (value === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = value;
    try {
        return { result: fn(), lines };
    } finally {
        console.error = original;
        if (before === undefined) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = before;
    }
}

const asBearer = (token) => ({ authorization: `Bearer ${token}` });

async function expectUnauthorized(result) {
    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(401);
    expect(await result.response.json()).toEqual({ success: false, message: 'Unauthorized' });
}

for (const { route, file } of ROUTES) {
    const at = (headers = {}, query = '') => new Request(`http://localhost${route}${query}`, { headers });

    test.describe(`Cron ${route}`, () => {
        test(`Cron ${route}: GET calls requireCronSecret first, imported from @/lib/api-auth`, () => {
            const source = code(file);
            expect(source, 'the guard is imported from the shared module').toMatch(/import\s*\{\s*requireCronSecret\s*\}\s*from\s*['"]@\/lib\/api-auth['"]/);
            expect(source, 'the first statements of GET are the guard call and its refusal').toMatch(
                /export\s+async\s+function\s+GET\s*\(\s*request\s*\)\s*\{\s*const\s+secret\s*=\s*requireCronSecret\(\s*request\s*\)\s*;?\s*if\s*\(\s*!secret\.ok\s*\)\s*return\s+secret\.response\s*;?/,
            );
        });

        test(`Cron ${route}: the old checks are gone (development skip, Bearer undefined, skip when CRON_SECRET is unset)`, () => {
            const source = code(file);
            expect(source, 'no development-mode skip').not.toMatch(/NODE_ENV/);
            expect(source, 'no comparison with process.env.CRON_SECRET in the route (a Bearer undefined matches an unset variable)').not.toMatch(/process\.env\.CRON_SECRET/);
            expect(source, 'the route no longer reads the secret itself').not.toMatch(/searchParams\.get\(\s*['"]secret['"]\s*\)/);
            expect(source, 'the route no longer reads the Authorization header itself').not.toMatch(/headers\.get\(\s*['"]authorization['"]\s*\)/i);
        });

        test(`Cron ${route}: with CRON_SECRET unset every request is 401, Bearer undefined and ?secret=undefined included`, async () => {
            const probes = [at(), at(asBearer('undefined')), at(asBearer('')), at({}, '?secret=undefined'), at({}, '?secret='), at(asBearer('anything'))];
            for (const probe of probes) {
                const { result, lines } = withCronSecret(undefined, () => guard.requireCronSecret(probe));
                await expectUnauthorized(result);
                expect(lines.some((line) => line.includes('CRON_SECRET is not set'))).toBe(true);
            }
            // An empty variable is unset too.
            await expectUnauthorized(withCronSecret('', () => guard.requireCronSecret(at(asBearer('')))).result);
        });

        test(`Cron ${route}: with CRON_SECRET set, no secret and a wrong secret are 401`, async () => {
            const secret = 'cron-spec-secret';
            const probes = [at(), at(asBearer('wrong')), at(asBearer('')), at(asBearer('undefined')), at({}, '?secret=wrong'), at({}, '?secret=undefined'), at({}, '?secret='), at(asBearer(`${secret}x`)), at({ authorization: `Basic ${secret}` })];
            for (const probe of probes) {
                await expectUnauthorized(withCronSecret(secret, () => guard.requireCronSecret(probe)).result);
            }
        });

        test(`Cron ${route}: with CRON_SECRET set, the right secret passes as a Bearer and as ?secret=`, () => {
            const secret = 'cron-spec-secret';
            expect(withCronSecret(secret, () => guard.requireCronSecret(at(asBearer(secret)))).result).toEqual({ ok: true });
            expect(withCronSecret(secret, () => guard.requireCronSecret(at({}, `?secret=${secret}`))).result).toEqual({ ok: true });
        });
    });
}
