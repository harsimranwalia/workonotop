// @ts-check
// ENG-006, defect 7: the key every session, e-mail verification and password reset token is signed and checked with is the JWT_SECRET
// that is set at the moment of use (jwtSecret in src/lib/jwt.js), and nothing is signed or accepted while it is unset or blank. Four
// cases, in plain Node (no browser, no app request, no real database):
//   1  JWT_SECRET unset, empty or blank: the three signers and jwtSecret() throw an error that names JWT_SECRET, and the three
//      verifiers answer null and log the variable by name;
//   2  JWT_SECRET unset, empty or blank: the API guard answers 401 to a session cookie;
//   3  with JWT_SECRET set, a token signed under another key is refused (verifyToken and the guard) and one signed under it is accepted,
//      and a second configured value takes over from the first, so the variable is read each time;
//   4  every file that signs or checks a session takes the key from src/lib/jwt.js and calls it first in its try, and no file under src/
//      reads JWT_SECRET but jwt.js and the Edge middleware (source read, no request).
// jwt.js reads the variable each time it signs or checks, so each case sets the value it needs when it starts and puts the old one back
// when it ends; beforeAll loads the modules while JWT_SECRET holds an unrelated value, so a module that kept the key it saw at import
// is red in cases 1 and 3. api-auth.js imports mobile-auth.js -> db.js, which makes a pool when first imported unless
// globalThis.mysqlPool is set, so beforeAll gives it a stub and afterAll takes it away. Cases 1 to 3 use cookies and constructed tokens
// only; nothing here asks the database.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import jwt from 'jsonwebtoken';

// Tokens are built and read here: tracing is off, as in e2e/ownership.spec.js.
test.use({ trace: 'off' });

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Values that exist only in this spec.
const IMPORT_KEY = 'eng006-key-held-while-the-modules-load, not a real one';
const SPEC_KEY = 'eng006-session-secret-spec-key, not a real one';
const CONFIGURED_KEY = 'eng006-configured-key, not a real one';
const OTHER_KEY = 'eng006-other-key, not a real one';

const CUSTOMER = { id: 11, email: 'customer@workontap.test', role: 'user', status: 'active' };
const sign = (payload, key) => jwt.sign(payload, key, { expiresIn: '1h' });

/** The ways the variable can fail to hold a key. */
const UNSET_OR_BLANK = [
    ['unset', undefined],
    ['empty', ''],
    ['blank', '   '],
];

const globals = /** @type {any} */ (globalThis);
/** @type {typeof import('../src/lib/jwt.js')} */
let lib;
/** @type {typeof import('../src/lib/api-auth.js')} */
let guard;
let savedSecret;
let savedPool;

test.beforeAll(async () => {
    savedSecret = process.env.JWT_SECRET;
    savedPool = globals.mysqlPool;
    process.env.JWT_SECRET = IMPORT_KEY;
    globals.mysqlPool = {
        async getConnection() {
            throw new Error('session-secret spec stub: no case here asks the database');
        },
    };
    lib = await import('../src/lib/jwt.js');
    guard = await import('../src/lib/api-auth.js');
});

test.afterAll(() => {
    if (savedSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = savedSecret;
    if (savedPool === undefined) delete globals.mysqlPool;
    else globals.mysqlPool = savedPool;
});

/** Runs fn with JWT_SECRET set to `value` (undefined = the variable is absent) and console.error captured, puts everything back, and returns the lines logged. */
async function withJwtSecret(value, fn) {
    const before = process.env.JWT_SECRET;
    const original = console.error;
    const lines = [];
    console.error = (...args) => lines.push(args.join(' '));
    if (value === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = value;
    try {
        await fn();
    } finally {
        console.error = original;
        if (before === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = before;
    }
    return lines;
}

/** Runs fn and counts the calls to jsonwebtoken's sign and verify: src/lib/jwt.js calls them through this same default export. */
async function jwtCallsDuring(fn) {
    const original = { sign: jwt.sign, verify: jwt.verify };
    const calls = { sign: 0, verify: 0 };
    for (const name of ['sign', 'verify']) {
        jwt[name] = (...args) => {
            calls[name]++;
            return original[name].apply(jwt, args);
        };
    }
    try {
        await fn();
    } finally {
        Object.assign(jwt, original);
    }
    return calls;
}

const asCookie = (token) => new Request('http://localhost/api/probe', { headers: { cookie: `customer_token=${token}` } });

async function expectUnauthorized(result) {
    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(401);
    expect(await result.response.json()).toEqual({ success: false, message: 'Unauthorized' });
}

test('with JWT_SECRET unset or blank, no session, verification or reset token is signed and none is accepted', async () => {
    const session = sign({ id: 11, email: 'customer@workontap.test', role: 'user' }, SPEC_KEY);
    const verification = sign({ providerId: 21, email: 'provider@workontap.test', type: 'email_verification' }, SPEC_KEY);
    const reset = sign({ providerId: 21, email: 'provider@workontap.test', type: 'password_reset' }, SPEC_KEY);
    expect(typeof lib.jwtSecret, 'src/lib/jwt.js exports jwtSecret').toBe('function');

    for (const [label, value] of UNSET_OR_BLANK) {
        let lines;
        const calls = await jwtCallsDuring(async () => {
            lines = await withJwtSecret(value, () => {
                expect(() => lib.jwtSecret(), `${label}: jwtSecret() throws`).toThrow(/JWT_SECRET/);
                expect(() => lib.generateToken({ id: 11, role: 'user' }), `${label}: generateToken throws`).toThrow(/JWT_SECRET/);
                expect(() => lib.generateEmailVerificationToken(21, 'provider@workontap.test'), `${label}: generateEmailVerificationToken throws`).toThrow(/JWT_SECRET/);
                expect(() => lib.generatePasswordResetToken(21, 'provider@workontap.test'), `${label}: generatePasswordResetToken throws`).toThrow(/JWT_SECRET/);
                expect(lib.verifyToken(session), `${label}: verifyToken answers null`).toBeNull();
                expect(lib.verifyEmailVerificationToken(verification), `${label}: verifyEmailVerificationToken answers null`).toBeNull();
                expect(lib.verifyPasswordResetToken(reset), `${label}: verifyPasswordResetToken answers null`).toBeNull();
            });
        });
        expect(lines.filter((line) => line.includes('JWT_SECRET')).length, `${label}: each of the three verifiers logged the variable by name`).toBe(3);
        expect(calls, `${label}: no token is signed or checked against any key`).toEqual({ sign: 0, verify: 0 });
    }
});

test('the API guard answers 401 to a session cookie while JWT_SECRET is unset', async () => {
    const cookie = sign(CUSTOMER, SPEC_KEY);
    for (const [label, value] of UNSET_OR_BLANK) {
        await withJwtSecret(value, async () => {
            const result = await guard.requireCaller(asCookie(cookie), ['customer']);
            expect(result.ok, `${label}: the cookie is not a session`).toBe(false);
            await expectUnauthorized(result);
        });
    }
});

test('a session signed with a key other than the configured JWT_SECRET is refused and one signed with it is accepted', async () => {
    const signedConfigured = sign(CUSTOMER, CONFIGURED_KEY);
    const signedOther = sign(CUSTOMER, OTHER_KEY);

    await withJwtSecret(CONFIGURED_KEY, async () => {
        expect(lib.verifyToken(signedOther), 'a token signed under another key is refused').toBeNull();
        expect(lib.verifyToken(signedConfigured)?.id, 'a token signed under the configured key is accepted').toBe(CUSTOMER.id);
        await expectUnauthorized(await guard.requireCaller(asCookie(signedOther), ['customer']));
        const accepted = await guard.requireCaller(asCookie(signedConfigured), ['customer']);
        expect(accepted.ok, 'the guard accepts the cookie signed under the configured key').toBe(true);
        expect(accepted.ok && accepted.caller).toEqual({ role: 'customer', id: CUSTOMER.id, email: CUSTOMER.email, via: 'cookie' });
    });

    // The variable is read each time: once it holds the other value, that is the key in force.
    await withJwtSecret(OTHER_KEY, async () => {
        expect(lib.verifyToken(signedOther)?.id, 'the second configured value takes over').toBe(CUSTOMER.id);
        expect(lib.verifyToken(signedConfigured), 'a token signed under the first configured value is refused').toBeNull();
    });
});

// The ten files that sign or check a session in Node. Every one imports jwtSecret from the shared module (mobile-auth.js sits beside it).
const SIGNING_ROUTES = [
    'src/app/api/auth/login/route.js',
    'src/app/api/auth/google/route.js',
    'src/app/api/auth/apple/route.js',
    'src/app/api/auth/signup/route.js',
    'src/app/api/auth/mobile/login/route.js',
    'src/app/api/auth/mobile/google/route.js',
    'src/app/api/auth/mobile/refresh/route.js',
    'src/app/api/admin/login/route.js',
];
const KEY_FILES = [...SIGNING_ROUTES, 'src/app/api/admin/logout/route.js', 'src/lib/mobile-auth.js'];

/**
 * The text with its comments taken out and nothing else changed (the reader of e2e/cron-secret.spec.js): a `//` comment goes up to its
 * line break, a block comment becomes one space plus the line feeds it held, and a '...', "..." or `...` string is copied whole, so a
 * comment marker inside one is text. Regex literals and `${ }` are not tracked.
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

const raw = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
/** The file's code: its text with the comments taken out. */
const code = (file) => stripComments(raw(file));

/** Every script file under src/, as a path from the repository root. */
function sourceFiles(dir = 'src') {
    const found = [];
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) found.push(...sourceFiles(rel));
        else if (/\.(?:[cm]?jsx?|tsx?)$/.test(entry.name)) found.push(rel);
    }
    return found.sort();
}

/**
 * The calls `jwt.sign(` and `jwt.verify(` in comment-free code, each with the text of its second argument (the key). Parentheses,
 * brackets and braces nest, and a '...', "..." or `...` string is copied whole, so a comma inside one does not end an argument.
 * @param {string} text
 * @returns {{ name: string, key: string }[]}
 */
function jwtCallKeys(text) {
    const calls = [];
    for (const call of text.matchAll(/\bjwt\.(sign|verify)\(/g)) {
        let depth = 0;
        let argument = 0;
        let key = '';
        for (let i = call.index + call[0].length; i < text.length; i++) {
            const ch = text[i];
            if (ch === "'" || ch === '"' || ch === '`') {
                let j = i + 1;
                while (j < text.length && text[j] !== ch) j += text[j] === '\\' ? 2 : 1;
                if (argument === 1) key += text.slice(i, j + 1);
                i = j;
            } else if ('([{'.includes(ch)) {
                depth++;
                if (argument === 1) key += ch;
            } else if (')]}'.includes(ch)) {
                if (depth === 0) break;
                depth--;
                if (argument === 1) key += ch;
            } else if (ch === ',' && depth === 0) {
                argument++;
            } else if (argument === 1) {
                key += ch;
            }
        }
        calls.push({ name: call[1], key: key.trim() });
    }
    return calls;
}

test('every route that signs or checks a session takes the key from src/lib/jwt.js', () => {
    for (const file of KEY_FILES) {
        const source = code(file);
        expect(source, `${file}: imports jwtSecret from the shared module`).toMatch(/import\s*\{[^}]*\bjwtSecret\b[^}]*\}\s*from\s*['"](?:@\/lib\/jwt|\.\/jwt)(?:\.js)?['"]/);
        expect(source, `${file}: does not name JWT_SECRET itself`).not.toMatch(/\bJWT_SECRET\b/);
    }

    // A route that signs asks for the key before it reads the request or touches the database: it is the first statement of its try.
    for (const file of SIGNING_ROUTES) {
        expect(code(file), `${file}: jwtSecret() is the first statement of the try`).toMatch(/\btry\s*\{\s*const\s+secret\s*=\s*jwtSecret\(\s*\)\s*;?/);
    }

    // getMobileSession asks before its lookup.
    const mobile = code('src/lib/mobile-auth.js');
    const session = mobile.slice(mobile.indexOf('export async function getMobileSession'));
    expect(session, 'getMobileSession is in mobile-auth.js').toContain('execute(');
    expect(session.indexOf('jwtSecret('), 'getMobileSession calls jwtSecret()').toBeGreaterThan(-1);
    expect(session.indexOf('jwtSecret('), 'getMobileSession calls jwtSecret() before its query').toBeLessThan(session.indexOf('execute('));

    // Across src/, the variable is read in the shared module and in the Edge middleware, which cannot import it.
    const readers = sourceFiles().filter((file) => /\bJWT_SECRET\b/.test(code(file)));
    expect(readers, 'the files that name JWT_SECRET in code').toEqual(['src/lib/jwt.js', 'src/middleware.js']);

    // The files that import jsonwebtoken are the shared module and the nine routes above, so a new signer has to be named here; and every
    // call to jwt.sign or jwt.verify in them takes its key from `secret` (the route's first statement) or from jwtSecret() itself.
    const importers = sourceFiles().filter((file) => /from\s*['"]jsonwebtoken['"]/.test(code(file)));
    expect(importers, 'the files that import jsonwebtoken').toEqual([...SIGNING_ROUTES, 'src/app/api/admin/logout/route.js', 'src/lib/jwt.js'].sort());
    for (const file of importers) {
        const calls = jwtCallKeys(code(file));
        expect(calls.length, `${file}: calls jwt.sign or jwt.verify`).toBeGreaterThan(0);
        for (const { name, key } of calls) expect(key, `${file}: the key of jwt.${name}`).toMatch(/^(?:secret|jwtSecret\(\s*\))$/);
    }

    // In the raw text, comments included, no file under src/ gives the variable a value to use when it is missing.
    for (const file of sourceFiles()) {
        expect(raw(file), `${file}: nothing follows JWT_SECRET with || or ??`).not.toMatch(/JWT_SECRET\s*(?:\|\||\?\?)/);
    }
});
