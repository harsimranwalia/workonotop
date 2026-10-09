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
// The guard-level rules are also in e2e/auth-guard.spec.js ("Auth guard - cron secret"); the per-route cases put each
// route's name in the title so a route that stops using the guard shows up under its own key. The one case after them,
// "Cron source reader", belongs to no route: it runs stripComments, which the source half reads the route files
// through, on constructed text.
//
// api-auth.js imports jwt.js (reads JWT_SECRET when it signs or checks a token) and mobile-auth.js -> db.js (makes a pool
// when first imported, unless global.mysqlPool is set). requireCronSecret needs neither, so beforeAll gives the pool a
// stub and the secret a value before the dynamic import, as e2e/auth-guard.spec.js does, and afterAll puts both back.
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

/**
 * The text with its comments taken out and nothing else changed, so a call that exists only in a comment does not count.
 * One pass over the characters, so it can tell a `//` that starts a comment from a `//` inside a string, whatever comes
 * before it (a quote, a colon, a backtick, a parenthesis, a semicolon, a space):
 *   - a `//` comment is removed up to its line break (LF or CR), which stays;
 *   - a block comment is replaced by one space plus the line feeds it held, so the number of lines does not change;
 *   - a '...' string, a "..." string and a `...` template are copied whole, up to the closing quote, a backslash
 *     escaping the character after it; a comment marker inside one is text, so 'http://x' and '@/lib/api-auth' survive;
 *   - every other character is copied as it is.
 * Limits: regex literals are not tracked (a quote or a // inside one is misread), `${ }` is not tracked (a backtick
 * inside one ends the template early and a comment inside one is kept), and a string with no closing quote runs to the
 * end of the text. Neither cron route has a regex literal, or a backtick or a comment inside a `${ }` (checked when this
 * was written), so none of these limits applies to them.
 * @param {string} text
 * @returns {string}
 */
function stripComments(text) {
    let out = '';
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (text.startsWith('//', i)) {
            while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
        } else if (text.startsWith('/*', i)) {
            const close = text.indexOf('*/', i + 2);
            const end = close === -1 ? text.length : close + 2;
            out += ' ' + text.slice(i, end).replace(/[^\n]/g, '');
            i = end;
        } else if (ch === "'" || ch === '"' || ch === '`') {
            let j = i + 1;
            while (j < text.length && text[j] !== ch) j += text[j] === '\\' ? 2 : 1;
            out += text.slice(i, j + 1);
            i = j + 1;
        } else {
            out += ch;
            i++;
        }
    }
    return out;
}

/** The route file's code: its text with the comments taken out by stripComments. */
function code(file) {
    return stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));
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

test('Cron source reader: stripComments takes out every comment, whatever comes before it, and keeps every string whole', () => {
    // Each of these carries the guard call in a comment and nowhere else: the call must be gone and the rest must be as it was.
    const commented = [
        ['a // comment right after a closing quote', "const why = ''// const secret = requireCronSecret(request)", "const why = ''"],
        ['a // comment right after a colon', 'const a = { k:// const secret = requireCronSecret(request)\n 1 }', 'const a = { k:\n 1 }'],
        ['a // comment right after a closing backtick', 'const t = ``// const secret = requireCronSecret(request)', 'const t = ``'],
        ['a // comment right after a closing parenthesis', 'run()// const secret = requireCronSecret(request)', 'run()'],
        ['a // comment right after a semicolon', 'run();// const secret = requireCronSecret(request)', 'run();'],
        ['a // comment after a space, code on the next line', 'run() // const secret = requireCronSecret(request)\nnext()', 'run() \nnext()'],
        ['a // comment ended by a carriage return', 'run();// const secret = requireCronSecret(request)\r\nnext()', 'run();\r\nnext()'],
        ['a whole-line // comment', '// const secret = requireCronSecret(request)\nrun()', '\nrun()'],
        ['a block comment between statements', 'run();/* const secret = requireCronSecret(request) */run();', 'run(); run();'],
        ['a block comment over several lines', 'a();\n/*\n * const secret = requireCronSecret(request)\n */\nb();', 'a();\n \n\n\nb();'],
    ];
    for (const [label, text, rest] of commented) {
        const out = stripComments(text);
        expect(out, `${label}: the call that only the comment carried is gone`).not.toMatch(/requireCronSecret\(/);
        expect(out, `${label}: everything else is as it was`).toBe(rest);
    }

    // No comment in any of these, only a // or a block comment marker inside a string: the text must come back whole,
    // and the real call after the string must still be in it.
    const strings = [
        ['a URL in a single-quoted string', "const url = 'http://example.test/x'; const secret = requireCronSecret(request)"],
        ['a // after a letter inside a single-quoted string', "const p = '/a//b'; const secret = requireCronSecret(request)"],
        ['a // opening a double-quoted string', 'const u = "//example.test/x"; const secret = requireCronSecret(request)'],
        ['a // inside a template', 'const m = `a//b`; const secret = requireCronSecret(request)'],
        ['block comment markers inside two strings, the real call between them', "const g = '/* x'; const secret = requireCronSecret(request); const h = '*/'"],
        ['an escaped quote does not end the string', "const q = 'it\\'s // still the string'; const secret = requireCronSecret(request)"],
    ];
    for (const [label, text] of strings) {
        const out = stripComments(text);
        expect(out, `${label}: the text comes back whole`).toBe(text);
        expect(out, `${label}: the real call is still there`).toContain('const secret = requireCronSecret(request)');
    }

    // A real call stays, with the comment after it gone; a quote inside a comment does not start a string.
    const real = [
        ['a real call with a // comment after it', 'const secret = requireCronSecret(request) // the guard\nnext()', 'const secret = requireCronSecret(request) \nnext()'],
        ['an apostrophe inside a // comment', "// it's the guard\nconst secret = requireCronSecret(request)", '\nconst secret = requireCronSecret(request)'],
        ['an apostrophe inside a block comment', "/* it's the guard */ const secret = requireCronSecret(request)", '  const secret = requireCronSecret(request)'],
    ];
    for (const [label, text, rest] of real) {
        const out = stripComments(text);
        expect(out, `${label}: the call stays`).toContain('const secret = requireCronSecret(request)');
        expect(out, `${label}: the comment goes and nothing else`).toBe(rest);
    }
});
