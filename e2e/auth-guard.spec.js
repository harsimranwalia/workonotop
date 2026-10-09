// @ts-check
// Guard-level cases for src/lib/api-auth.js (ENG-020, ENG-021). They run in plain Node: no browser, no route, no
// real database and no app request, so they hold the guard to the design's rules (ENG-004 design, Interfaces)
// before any handler calls it. One case per rule; the route-by-route checks are auth-coverage and auth-matrix.
//
// jwt.js reads JWT_SECRET once, when it is first imported, so the spec sets the secret in beforeAll and loads
// the guard with a dynamic import() after it (a top-level import would run before the secret is set, and a
// top-level import() would also run while Playwright collects the files). The old value is put back afterwards.
//
// The Bearer cases reach getMobileSession, which asks the database. db.js uses global.mysqlPool when there is one
// and captures it when it is first imported, so beforeAll puts a STUB pool there before the guard is imported (and
// afterAll takes it away again). The stub, `db` below, has modes, and every test starts in `down`:
//   down    getConnection rejects, as a refused connection does: the lookup fails, getMobileSession returns null and
//           the guard falls through to the token's own signature. This is what the test container does with no
//           database, so the cases written before the stub existed still mean what they said.
//   norows  the database is up and the session lookup (mobile_auth_users) finds no row, whatever the string. This is
//           the mode in which getMobileSession rebuilds a verified token's payload (`type` becomes `role || type`).
//   row     the lookup finds one active row, for exactly the string in db.row, and the status query says 'active'.
// The stub also counts the connections asked for (db.connections), so a case can say the cookie path makes none.
import { test, expect } from '@playwright/test';
import jwt from 'jsonwebtoken';

const SECRET = 'eng020-guard-spec-secret, not a real one';

// Payloads as the logins sign them (design, "Facts this rests on"): the customer, provider and admin web logins
// and the mobile login, which signs { id, providerId?, email, role, type } with role = type.
const ADMIN = { id: 1, email: 'admin@workontap.test', role: 'admin' };
const CUSTOMER = { id: 11, email: 'customer@workontap.test', role: 'user', status: 'active' };
const PROVIDER = { providerId: 21, email: 'provider@workontap.test', name: 'Pro One', type: 'provider', status: 'active' };
const MOBILE_ADMIN = { id: 1, email: 'admin@workontap.test', role: 'admin', type: 'admin', status: 'active' };
const MOBILE_CUSTOMER = { id: 11, email: 'customer@workontap.test', role: 'user', type: 'user', status: 'active' };
const MOBILE_PROVIDER = { id: 21, providerId: 21, email: 'provider@workontap.test', role: 'provider', type: 'provider', status: 'active' };

const sign = (payload, secret = SECRET) => jwt.sign(payload, secret, { expiresIn: '1h' });
const signExpired = (payload) => jwt.sign({ ...payload, exp: Math.floor(Date.now() / 1000) - 60 }, SECRET);

const request = (headers = {}, init = {}) => new Request('http://localhost/api/probe', { headers, ...init });
const asCookie = (name, token) => ({ cookie: `${name}=${token}` });
const asBearer = (token) => ({ authorization: `Bearer ${token}` });

async function expectRefusal(result, status, message) {
    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(status);
    expect(await result.response.json()).toEqual({ success: false, message });
}
const expectUnauthorized = (result) => expectRefusal(result, 401, 'Unauthorized');
const expectForbidden = (result) => expectRefusal(result, 403, 'Forbidden');

// The database stand-in (see the header). `mode` and `row` are set by the case; db.reset() puts everything back to
// `down` before each test. mobile_auth_users is the first query getMobileSession makes, the status query the second.
const db = {
    mode: 'down',
    /** @type {null | { token: string, provider_id: number | null, user_id: number | null, user_type: string }} */
    row: null,
    connections: 0,
    reset() {
        this.mode = 'down';
        this.row = null;
        this.connections = 0;
    },
};

const stubPool = {
    async getConnection() {
        db.connections += 1;
        if (db.mode === 'down') throw Object.assign(new Error('connect ECONNREFUSED (spec stub)'), { code: 'ECONNREFUSED' });
        return {
            async execute(sql, params) {
                if (String(sql).includes('mobile_auth_users')) {
                    const { token, ...columns } = db.row ?? {};
                    return [db.mode === 'row' && db.row && params[0] === token ? [columns] : [], []];
                }
                if (/SELECT status FROM/.test(String(sql))) return [[{ status: 'active' }], []];
                throw new Error(`spec stub: unexpected query ${String(sql).slice(0, 60)}`);
            },
            release() {},
        };
    },
};

const globals = /** @type {any} */ (globalThis);

/** @type {typeof import('../src/lib/api-auth.js')} */
let guard;
/** @type {typeof import('../src/lib/jwt.js')} */
let jwtLib;
let savedSecret;
let savedPool;

test.beforeAll(async () => {
    savedSecret = process.env.JWT_SECRET;
    savedPool = globals.mysqlPool;
    process.env.JWT_SECRET = SECRET;
    globals.mysqlPool = stubPool;
    guard = await import('../src/lib/api-auth.js');
    jwtLib = await import('../src/lib/jwt.js');
});

test.afterAll(() => {
    if (savedSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = savedSecret;
    if (savedPool === undefined) delete globals.mysqlPool;
    else globals.mysqlPool = savedPool;
});

test.beforeEach(() => db.reset());

test.describe('Auth guard - refusals', () => {
    test('no credential is 401 Unauthorized', async () => {
        await expectUnauthorized(await guard.requireCaller(request(), ['admin']));
        await expectUnauthorized(await guard.requireCaller(request(), ['admin', 'customer', 'provider']));
    });

    test('a token with a bad signature is 401, as a cookie and as a Bearer', async () => {
        const forged = sign(ADMIN, 'another secret');
        await expectUnauthorized(await guard.requireCaller(request(asCookie('adminAuth', forged)), ['admin']));
        await expectUnauthorized(await guard.requireCaller(request(asBearer(forged)), ['admin']));
    });

    test('an expired token is 401, as a cookie and as a Bearer', async () => {
        await expectUnauthorized(await guard.requireCaller(request(asCookie('adminAuth', signExpired(ADMIN))), ['admin']));
        await expectUnauthorized(await guard.requireCaller(request(asBearer(signExpired(MOBILE_ADMIN))), ['admin']));
    });

    test('a malformed Cookie or Authorization header is 401, never an exception', async () => {
        const headers = [
            { cookie: 'adminAuth=' },
            { cookie: '=; ; adminAuth' },
            { cookie: 'adminAuth=%E0%A4%A' },
            { cookie: 'adminAuth=not.a.token; customer_token=also-not' },
            { authorization: 'Bearer' },
            { authorization: 'Bearer ' },
            { authorization: 'Bearer not.a.token' },
            { authorization: 'Basic YTpi' },
        ];
        for (const h of headers) {
            await expectUnauthorized(await guard.requireCaller(request(h), ['admin', 'customer', 'provider']));
        }
    });

    test('a customer on an admin route is 403 Forbidden, never 401, by cookie and by Bearer', async () => {
        await expectForbidden(await guard.requireCaller(request(asCookie('customer_token', sign(CUSTOMER))), ['admin']));
        await expectForbidden(await guard.requireCaller(request(asBearer(sign(MOBILE_CUSTOMER))), ['admin']));
    });

    test('a provider on an admin route and on a customer route is 403, by cookie and by Bearer', async () => {
        await expectForbidden(await guard.requireCaller(request(asCookie('provider_token', sign(PROVIDER))), ['admin']));
        await expectForbidden(await guard.requireCaller(request(asCookie('provider_token', sign(PROVIDER))), ['customer']));
        await expectForbidden(await guard.requireCaller(request(asBearer(sign(MOBILE_PROVIDER))), ['customer']));
    });

    test('an admin on a customer-only route is 403 (there is no "admin may do anything" in roles)', async () => {
        await expectForbidden(await guard.requireCaller(request(asCookie('adminAuth', sign(ADMIN))), ['customer']));
    });
});

test.describe('Auth guard - what counts as a session', () => {
    test('a customer token copied into the adminAuth cookie is not an admin session', async () => {
        const customerToken = sign(CUSTOMER);
        // Alone: the token is genuine but it is not an admin's, so the answer is 403 and never an admin caller.
        await expectForbidden(await guard.requireCaller(request(asCookie('adminAuth', customerToken)), ['admin']));
        // With the customer's own cookie as well, the caller is the customer.
        const both = { cookie: `adminAuth=${customerToken}; customer_token=${customerToken}` };
        await expectForbidden(await guard.requireCaller(request(both), ['admin']));
        const asCustomer = await guard.requireCaller(request(both), ['customer']);
        expect(asCustomer.ok).toBe(true);
        expect(asCustomer.caller).toEqual({ role: 'customer', id: 11, email: CUSTOMER.email, via: 'cookie' });
        // Not a way to a provider or to anything else either: a payload only counts in the cookie of its own role.
        await expectForbidden(await guard.requireCaller(request(asCookie('adminAuth', sign(PROVIDER))), ['admin']));
        await expectForbidden(await guard.requireCaller(request(asCookie('customer_token', sign(PROVIDER))), ['customer']));
        await expectForbidden(await guard.requireCaller(request(asCookie('customer_token', sign(ADMIN))), ['admin']));
    });

    test('the email_verification and password_reset tokens are never a session (401), as a cookie and as a Bearer', async () => {
        const tokens = [
            jwtLib.generateEmailVerificationToken(21, 'provider@workontap.test'),
            jwtLib.generatePasswordResetToken(21, 'provider@workontap.test'),
        ];
        for (const token of tokens) {
            for (const headers of [asCookie('provider_token', token), asCookie('customer_token', token), asCookie('adminAuth', token), asBearer(token)]) {
                await expectUnauthorized(await guard.requireCaller(request(headers), ['provider']));
                await expectUnauthorized(await guard.requireCaller(request(headers), ['admin', 'customer', 'provider']));
            }
        }
        // Not even with a role claim added to one of them.
        const dressed = sign({ providerId: 21, email: PROVIDER.email, type: 'password_reset', role: 'provider' });
        await expectUnauthorized(await guard.requireCaller(request(asCookie('provider_token', dressed)), ['provider']));
    });

    test('a token without its id is 401 (providerId counts as the id of a provider only)', async () => {
        await expectUnauthorized(await guard.requireCaller(request(asCookie('adminAuth', sign({ email: ADMIN.email, role: 'admin' }))), ['admin']));
        await expectUnauthorized(await guard.requireCaller(request(asCookie('customer_token', sign({ email: CUSTOMER.email, role: 'user' }))), ['customer']));
        await expectUnauthorized(await guard.requireCaller(request(asCookie('provider_token', sign({ email: PROVIDER.email, type: 'provider' }))), ['provider']));
        await expectUnauthorized(await guard.requireCaller(request(asBearer(sign({ email: ADMIN.email, role: 'admin', type: 'admin' }))), ['admin']));
        // providerId is not an id for a customer or an admin.
        await expectUnauthorized(await guard.requireCaller(request(asCookie('customer_token', sign({ providerId: 21, email: CUSTOMER.email, role: 'user' }))), ['customer']));
        await expectUnauthorized(await guard.requireCaller(request(asCookie('adminAuth', sign({ providerId: 1, email: ADMIN.email, role: 'admin' }))), ['admin']));
    });

    // A signed token whose id claim is there but is not a usable id (api-auth.js idNumber: a positive safe integer, or the
    // digits of one: no sign, no leading zero, no fraction, no exponent, no blank, nothing after the digits). One case per
    // value, so a guard that starts to accept one of them fails on that value's case alone. ENG-021 added the values from
    // '5abc' on (MySQL reads '5abc' as 5 in an integer comparison): the first five are the ones the case began with.
    const BAD_IDS = [0, '', ' ', true, {}, '5abc', 1.5, '1.5', '0', -3, '007', ' 5 ', '1e3', Number.MAX_SAFE_INTEGER + 1, '9007199254740993'];
    for (const bad of BAD_IDS) {
        test(`a signed token whose id is ${JSON.stringify(bad)} is 401 for every role, as a cookie and as a Bearer`, async () => {
            const all = ['admin', 'customer', 'provider'];
            // [cookie name or null for a Bearer, payload, the role the token claims]. A web provider token carries only
            // providerId; the mobile tokens carry id (and a provider's providerId) as well, both bad here.
            const tokens = [
                ['adminAuth', { id: bad, email: ADMIN.email, role: 'admin' }, 'admin'],
                ['customer_token', { id: bad, email: CUSTOMER.email, role: 'user', status: 'active' }, 'customer'],
                ['provider_token', { providerId: bad, email: PROVIDER.email, type: 'provider', status: 'active' }, 'provider'],
                [null, { ...MOBILE_ADMIN, id: bad }, 'admin'],
                [null, { ...MOBILE_CUSTOMER, id: bad }, 'customer'],
                [null, { ...MOBILE_PROVIDER, id: bad, providerId: bad }, 'provider'],
            ];
            for (const [cookie, payload, role] of tokens) {
                const headers = cookie ? asCookie(cookie, sign(payload)) : asBearer(sign(payload));
                await expectUnauthorized(await guard.requireCaller(request(headers), [role]));
                await expectUnauthorized(await guard.requireCaller(request(headers), all));
            }
        });
    }

    test('a cookie sent twice is decided by the later one, as request.cookies.get does: garbage last is 401, valid last is a session', async () => {
        const admin = sign(ADMIN);
        // The garbage first does not hide the valid cookie after it...
        const laterValid = await guard.requireCaller(request({ cookie: `adminAuth=garbage; adminAuth=${admin}` }), ['admin']);
        expect(laterValid.ok, 'garbage first, valid last').toBe(true);
        expect(laterValid.caller).toEqual({ role: 'admin', id: 1, email: ADMIN.email, via: 'cookie' });
        // ...and the valid cookie first does not outlive the garbage after it: the later value is the one that counts.
        await expectUnauthorized(await guard.requireCaller(request({ cookie: `adminAuth=${admin}; adminAuth=garbage` }), ['admin']));
        // With other cookies between the two the rule is the same.
        const between = { cookie: `adminAuth=${admin}; theme=dark; adminAuth=garbage` };
        await expectUnauthorized(await guard.requireCaller(request(between), ['admin', 'customer', 'provider']));
        // The premise, from Next itself: the same headers through NextRequest (what a handler reads cookies with today)
        // also give the later value, so the guard and `request.cookies.get` never disagree about a duplicated cookie.
        const { NextRequest } = (await import('next/server.js')).default;
        for (const [header, last] of [[`adminAuth=garbage; adminAuth=${admin}`, admin], [`adminAuth=${admin}; adminAuth=garbage`, 'garbage']]) {
            const next = new NextRequest('http://localhost/api/probe', { headers: { cookie: header } });
            expect(next.cookies.get('adminAuth')?.value, 'what request.cookies.get returns for the duplicated cookie').toBe(last);
        }
    });

    test('an unknown role, an admin named only by type, or two claims that name different roles, is no session (401)', async () => {
        const all = ['admin', 'customer', 'provider'];
        const unknown = [
            { id: 5, email: 'x@workontap.test', role: 'moderator' },
            { id: 5, email: 'x@workontap.test', role: 'ADMIN' },
            { id: 5, email: 'x@workontap.test', role: 'constructor' },
            { id: 5, email: 'x@workontap.test', type: 'admin' },
            { id: 5, email: 'x@workontap.test' },
        ];
        for (const payload of unknown) {
            const token = sign(payload);
            for (const headers of [asCookie('adminAuth', token), asCookie('customer_token', token), asCookie('provider_token', token), asBearer(token)]) {
                await expectUnauthorized(await guard.requireCaller(request(headers), all));
            }
        }
        // Cookies only here. The same payloads as a Bearer, with a session lookup that finds no row, are in 'the Bearer
        // path with a session lookup' (ENG-021 F1(b)): there getMobileSession's own JWT path rewrites `type` to
        // `role || type`, and the guard has to read the token's own claims. No login signs such a token (the mobile
        // login sets role and type from one variable).
        const disagree = [
            { id: 5, email: 'x@workontap.test', role: 'user', type: 'provider' },
            { id: 5, email: 'x@workontap.test', role: 'admin', type: 'provider' },
        ];
        for (const payload of disagree) {
            const token = sign(payload);
            for (const headers of [asCookie('adminAuth', token), asCookie('customer_token', token), asCookie('provider_token', token)]) {
                await expectUnauthorized(await guard.requireCaller(request(headers), all));
            }
        }
    });
});

test.describe('Auth guard - allowed callers', () => {
    test('an admin by cookie passes an admin route and is { role, id, email, via: cookie }', async () => {
        const result = await guard.requireCaller(request(asCookie('adminAuth', sign(ADMIN))), ['admin']);
        expect(result.ok).toBe(true);
        expect(result.caller).toEqual({ role: 'admin', id: 1, email: ADMIN.email, via: 'cookie' });
        expect(Object.keys(result).sort()).toEqual(['caller', 'ok']);
    });

    test('a customer by cookie and a provider by cookie are normalised; a provider has only providerId', async () => {
        const customer = await guard.requireCaller(request(asCookie('customer_token', sign(CUSTOMER))), ['customer']);
        expect(customer.ok).toBe(true);
        expect(customer.caller).toEqual({ role: 'customer', id: 11, email: CUSTOMER.email, via: 'cookie' });

        const provider = await guard.requireCaller(request(asCookie('provider_token', sign(PROVIDER))), ['provider']);
        expect(provider.ok).toBe(true);
        expect(provider.caller).toEqual({ role: 'provider', id: 21, email: PROVIDER.email, via: 'cookie' });
    });

    test('the Bearer path falls through to verifyToken when the database lookup fails: mobile tokens of all three roles pass', async () => {
        const cases = [
            [MOBILE_ADMIN, 'admin', 1],
            [MOBILE_CUSTOMER, 'customer', 11],
            [MOBILE_PROVIDER, 'provider', 21],
            [PROVIDER, 'provider', 21],
        ];
        for (const [payload, role, id] of cases) {
            const result = await guard.requireCaller(request(asBearer(sign(payload))), [role]);
            expect(result.ok, `${role} Bearer`).toBe(true);
            expect(result.caller).toEqual({ role, id, email: payload.email, via: 'bearer' });
        }
    });

    test('the first verified credential whose role is allowed wins, in the order admin, customer, provider, Bearer', async () => {
        const headers = {
            cookie: `provider_token=${sign(PROVIDER)}; customer_token=${sign(CUSTOMER)}; adminAuth=${sign(ADMIN)}`,
            authorization: `Bearer ${sign(MOBILE_PROVIDER)}`,
        };
        const all = ['admin', 'customer', 'provider'];
        expect((await guard.requireCaller(request(headers), all)).caller.role).toBe('admin');
        expect((await guard.requireCaller(request(headers), ['customer', 'provider'])).caller.role).toBe('customer');
        expect((await guard.requireCaller(request(headers), ['provider'])).caller).toMatchObject({ role: 'provider', via: 'cookie' });
        // Only the Bearer is left once the cookies are not allowed.
        const bearerOnly = { cookie: `customer_token=${sign(CUSTOMER)}`, authorization: `Bearer ${sign(MOBILE_PROVIDER)}` };
        expect((await guard.requireCaller(request(bearerOnly), ['provider'])).caller).toMatchObject({ role: 'provider', via: 'bearer' });
    });

    test('a credential that already settles the request wins over a Bearer that would not verify', async () => {
        const headers = { ...asCookie('adminAuth', sign(ADMIN)), ...asBearer('not.a.token') };
        const result = await guard.requireCaller(request(headers), ['admin']);
        expect(result.ok).toBe(true);
        expect(result.caller.via).toBe('cookie');
    });
});

test.describe('Auth guard - how it is called', () => {
    test('requireCaller throws a programming error for an empty or unknown roles list', async () => {
        for (const roles of [[], ['superuser'], ['admin', 'user'], ['Admin'], undefined, null, 'admin', new Set(['admin'])]) {
            await expect(guard.requireCaller(request(asCookie('adminAuth', sign(ADMIN))), roles)).rejects.toThrow(/roles must be a non-empty array/);
        }
    });

    test('the guard never reads the body, on a refusal or on success', async () => {
        const post = (headers) => request({ ...headers, 'content-type': 'application/json' }, { method: 'POST', body: JSON.stringify({ a: 1 }) });
        const refused = post({});
        await expectUnauthorized(await guard.requireCaller(refused, ['admin']));
        expect(refused.bodyUsed).toBe(false);
        const allowed = post(asCookie('adminAuth', sign(ADMIN)));
        expect((await guard.requireCaller(allowed, ['admin'])).ok).toBe(true);
        expect(allowed.bodyUsed).toBe(false);
        expect(await allowed.json()).toEqual({ a: 1 });
    });

    test('callerFrom returns the caller or null and never refuses; roles narrows it', async () => {
        expect(await guard.callerFrom(request())).toBeNull();
        expect(await guard.callerFrom(request(asCookie('customer_token', 'garbage')))).toBeNull();
        const customer = request(asCookie('customer_token', sign(CUSTOMER)));
        expect(await guard.callerFrom(customer)).toEqual({ role: 'customer', id: 11, email: CUSTOMER.email, via: 'cookie' });
        expect(await guard.callerFrom(customer, ['customer'])).toMatchObject({ role: 'customer' });
        expect(await guard.callerFrom(customer, ['admin'])).toBeNull();
        expect(await guard.callerFrom(request(asCookie('customer_token', sign(CUSTOMER))), ['admin'])).toBeNull();
        await expect(guard.callerFrom(customer, [])).rejects.toThrow(/roles must be a non-empty array/);
    });
});

test.describe('Auth guard - cron secret', () => {
    function withCronSecret(value, fn) {
        const before = process.env.CRON_SECRET;
        if (value === undefined) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = value;
        try {
            return fn();
        } finally {
            if (before === undefined) delete process.env.CRON_SECRET;
            else process.env.CRON_SECRET = before;
        }
    }

    function loggedErrors(fn) {
        const original = console.error;
        const lines = [];
        console.error = (...args) => lines.push(args.join(' '));
        try {
            return { result: fn(), lines };
        } finally {
            console.error = original;
        }
    }

    const cron = (headers = {}, query = '') => new Request(`http://localhost/api/cron/probe${query}`, { headers });

    test('with CRON_SECRET unset every request is 401 and the route logs that it is not set', async () => {
        const probes = [cron(), cron(asBearer('undefined')), cron(asBearer('')), cron({}, '?secret=undefined'), cron({}, '?secret=')];
        for (const probe of probes) {
            const { result, lines } = loggedErrors(() => withCronSecret(undefined, () => guard.requireCronSecret(probe)));
            await expectUnauthorized(result);
            expect(lines.some((line) => line.includes('CRON_SECRET is not set'))).toBe(true);
        }
        // An empty variable is unset too.
        const { result } = loggedErrors(() => withCronSecret('', () => guard.requireCronSecret(cron(asBearer('')))));
        await expectUnauthorized(result);
    });

    test('with CRON_SECRET set, the secret passes as a Bearer or as ?secret=, and nothing else does', async () => {
        const secret = 'cron-spec-secret';
        const run = (probe) => withCronSecret(secret, () => guard.requireCronSecret(probe));
        expect(run(cron(asBearer(secret)))).toEqual({ ok: true });
        expect(run(cron({}, `?secret=${secret}`))).toEqual({ ok: true });
        for (const probe of [cron(), cron(asBearer('wrong')), cron(asBearer('')), cron({}, '?secret=wrong'), cron({}, '?secret='), cron(asBearer(`${secret}x`)), cron(asBearer(secret.slice(1))), cron({ authorization: `Basic ${secret}` })]) {
            await expectUnauthorized(run(probe));
        }
        // A user's token is not the cron secret.
        await expectUnauthorized(run(cron(asBearer(sign(ADMIN)))));
    });

    test('a request whose url cannot be parsed is decided by the Bearer secret alone, and the guard logs one line about it', async () => {
        const secret = 'cron-spec-secret';
        // A plain object, not a Request (a Request will not take a url that does not parse); a bare path is what a handler
        // would see if something upstream handed it one. The path carries the right secret in its query on purpose: it
        // must stay unread, and must not reach the log.
        const unparsable = (headers = {}) => ({ url: `/api/cron/probe?secret=${secret}`, headers: new Headers(headers) });
        const run = (probe) => loggedErrors(() => withCronSecret(secret, () => guard.requireCronSecret(probe)));
        const expectOneLineAboutTheUrl = (lines) => {
            expect(lines, 'exactly one error line, not none (silent) and not two').toHaveLength(1);
            expect(lines[0]).toContain('api-auth: could not read ?secret= from the cron request url');
            expect(lines[0], 'the log line never carries the secret').not.toContain(secret);
        };

        const passes = run(unparsable(asBearer(secret)));
        expect(passes.result).toEqual({ ok: true });
        expectOneLineAboutTheUrl(passes.lines);

        for (const probe of [unparsable(), unparsable(asBearer('wrong')), unparsable(asBearer(''))]) {
            const refused = run(probe);
            await expectUnauthorized(refused.result);
            expectOneLineAboutTheUrl(refused.lines);
        }

        // A url that parses logs nothing: the line is for the failure, not for every request.
        const parsed = run(cron(asBearer(secret)));
        expect(parsed.result).toEqual({ ok: true });
        expect(parsed.lines).toEqual([]);
    });
});

test.describe('Auth guard - a Bearer session lookup that rejects', () => {
    // getMobileSession keeps everything it does inside one try/catch and answers null (a database that is down
    // included), so it cannot reject today. To see what the guard does the day a later edit lets it, the case makes the
    // one thing that catch does, its console.error, throw: the lookup fails (the test container has no database), the
    // catch runs, its console.error throws, and the call rejects. The old guard caught that rejection with
    // `catch { session = null }`, fell through to the token's own signature and passed this very token, with no line
    // in the log.
    test('the guard logs one line and answers 401; it does not fall through to the token signature in silence', async () => {
        const original = console.error;
        const lines = [];
        let lookupRejected = false;
        console.error = (...args) => {
            if (String(args[0]).includes('[Mobile Auth]')) {
                lookupRejected = true;
                throw new Error('session lookup rejected');
            }
            lines.push(args.join(' '));
        };
        let result;
        try {
            result = await guard.requireCaller(request(asBearer(sign(MOBILE_ADMIN))), ['admin']);
        } finally {
            console.error = original;
        }
        expect(lookupRejected, "premise: getMobileSession's own catch ran and its console.error threw").toBe(true);
        await expectUnauthorized(result);
        // The database layer logs its own failed query before the guard sees anything (db.js, "Database execute error"),
        // so the count is of the guard's lines only.
        const guardLines = lines.filter((line) => line.startsWith('api-auth:'));
        expect(guardLines, "exactly one line from the guard, not none (silent) and not two").toHaveLength(1);
        expect(guardLines[0]).toContain('api-auth: could not read the request credentials');
        expect(guardLines[0]).toContain('session lookup rejected');
    });
});

test.describe('Auth guard - ids and role claims (ENG-021)', () => {
    test('an id signed as its digits is returned as a number: "21" is 21, 21 stays 21, a provider\'s providerId "21" is 21', async () => {
        const asCustomer = (id) => guard.requireCaller(request(asCookie('customer_token', sign({ ...CUSTOMER, id }))), ['customer']);
        const fromDigits = await asCustomer('21');
        expect(fromDigits.ok).toBe(true);
        expect(fromDigits.caller.id, 'the id "21" signed as a string').toBe(21);
        expect(typeof fromDigits.caller.id).toBe('number');
        const fromNumber = await asCustomer(21);
        expect(fromNumber.ok).toBe(true);
        expect(fromNumber.caller.id).toBe(21);
        const provider = await guard.requireCaller(request(asCookie('provider_token', sign({ ...PROVIDER, providerId: '21' }))), ['provider']);
        expect(provider.ok).toBe(true);
        expect(provider.caller).toEqual({ role: 'provider', id: 21, email: PROVIDER.email, via: 'cookie' });
        // The Bearer path normalises the same way.
        const bearer = await guard.requireCaller(request(asBearer(sign({ ...MOBILE_CUSTOMER, id: '11' }))), ['customer']);
        expect(bearer.ok).toBe(true);
        expect(bearer.caller.id).toBe(11);
    });

    test('a role claim that is none of admin, provider, user or customer is refused outright, even when type is recognised', async () => {
        const all = ['admin', 'customer', 'provider'];
        for (const role of ['superuser', 'ADMIN', 'moderator', '', 0, false]) {
            const payload = { id: 11, email: CUSTOMER.email, role, type: 'user' };
            const token = sign(payload);
            const label = `role ${JSON.stringify(role)} with type 'user'`;
            // As a cookie, in the cookie of the role the recognised `type` names.
            for (const roles of [['customer'], all]) {
                const result = await guard.requireCaller(request(asCookie('customer_token', token)), roles);
                expect(result.ok, `${label}, customer_token cookie, roles ${roles}`).toBe(false);
                expect(result.response.status, `${label}, customer_token cookie, roles ${roles}`).toBe(401);
            }
            // As a Bearer, with the lookup finding no row and with the database down.
            for (const mode of ['norows', 'down']) {
                db.mode = mode;
                for (const roles of [['customer'], all]) {
                    const result = await guard.requireCaller(request(asBearer(token)), roles);
                    expect(result.ok, `${label}, Bearer, ${mode}, roles ${roles}`).toBe(false);
                    expect(result.response.status, `${label}, Bearer, ${mode}, roles ${roles}`).toBe(401);
                }
            }
        }
    });

    test('the real web payloads still pass, and a role of null is no role claim at all', async () => {
        // The customer login signs { id, role: 'user' } (no type); the provider login signs { providerId, type: 'provider' } (no role).
        const customer = await guard.requireCaller(request(asCookie('customer_token', sign({ id: 11, email: CUSTOMER.email, role: 'user' }))), ['customer']);
        expect(customer.ok).toBe(true);
        expect(customer.caller).toEqual({ role: 'customer', id: 11, email: CUSTOMER.email, via: 'cookie' });
        const provider = await guard.requireCaller(request(asCookie('provider_token', sign({ providerId: 21, email: PROVIDER.email, type: 'provider' }))), ['provider']);
        expect(provider.ok).toBe(true);
        expect(provider.caller).toEqual({ role: 'provider', id: 21, email: PROVIDER.email, via: 'cookie' });
        // A login that signs `role: undefined` leaves no key at all; null is the same absence, so `type` decides.
        const nulled = { id: 11, email: CUSTOMER.email, role: null, type: 'user' };
        const asCookieResult = await guard.requireCaller(request(asCookie('customer_token', sign(nulled))), ['customer']);
        expect(asCookieResult.ok, 'role null, cookie').toBe(true);
        expect(asCookieResult.caller).toEqual({ role: 'customer', id: 11, email: CUSTOMER.email, via: 'cookie' });
        for (const mode of ['norows', 'down']) {
            db.mode = mode;
            const asBearerResult = await guard.requireCaller(request(asBearer(sign(nulled))), ['customer']);
            expect(asBearerResult.ok, `role null, Bearer, ${mode}`).toBe(true);
            expect(asBearerResult.caller).toEqual({ role: 'customer', id: 11, email: CUSTOMER.email, via: 'bearer' });
        }
    });
});

test.describe('Auth guard - the Bearer path with a session lookup (ENG-021)', () => {
    const all = ['admin', 'customer', 'provider'];
    const MODES = ['norows', 'down'];

    // A Bearer request, and what the guard says; `label` names the shape and the mode in a failure message.
    async function bearerOutcome(token, roles) {
        return guard.requireCaller(request(asBearer(token)), roles);
    }
    async function expectBearerRefused(label, token, roles) {
        const result = await bearerOutcome(token, roles);
        expect(result.ok, label).toBe(false);
        expect(result.response.status, label).toBe(401);
    }

    test('F1(a): a verified token whose type is special-purpose is 401 as a Bearer even when it carries a role', async () => {
        const claims = [['admin', 'admin'], ['user', 'customer'], ['provider', 'provider']];
        for (const mode of MODES) {
            db.mode = mode;
            for (const type of ['email_verification', 'password_reset']) {
                for (const [claim, allowed] of claims) {
                    const token = sign({ id: 1, email: ADMIN.email, role: claim, type });
                    for (const roles of [[allowed], all]) {
                        await expectBearerRefused(`${mode}: role ${claim}, type ${type}, roles ${roles}`, token, roles);
                    }
                }
            }
        }
        expect(db.connections, 'premise: the lookup ran against the stub').toBeGreaterThan(0);
    });

    test('F1(b): a verified token whose role and type name different roles is 401 as a Bearer', async () => {
        const disagree = [
            { id: 1, email: ADMIN.email, role: 'admin', type: 'provider' },
            { id: 11, email: CUSTOMER.email, role: 'user', type: 'admin' },
            { id: 21, email: PROVIDER.email, role: 'provider', type: 'user' },
        ];
        for (const mode of MODES) {
            db.mode = mode;
            for (const payload of disagree) {
                for (const roles of [['admin'], ['customer'], ['provider'], all]) {
                    await expectBearerRefused(`${mode}: role ${payload.role}, type ${payload.type}, roles ${roles}`, sign(payload), roles);
                }
            }
        }
        expect(db.connections, 'premise: the lookup ran against the stub').toBeGreaterThan(0);
    });

    test('F1(c): "Bearer <valid> x", "<valid> x y" and the same with a tab are 401, with norows and with down; the bare token passes', async () => {
        const valid = sign(MOBILE_ADMIN);
        const shapes = {
            'one more word': `${valid} x`,
            'two more words': `${valid} x y`,
            'a tab and a word': `${valid}\tx`,
            'a space, a tab and a word': `${valid} \tx`,
            'two spaces and a word': `${valid}  x`,
        };
        for (const mode of MODES) {
            db.mode = mode;
            for (const [name, token] of Object.entries(shapes)) {
                for (const roles of [['admin'], all]) {
                    await expectBearerRefused(`${mode}: Bearer <valid> with ${name}, roles ${roles}`, token, roles);
                }
            }
            const bare = await bearerOutcome(valid, ['admin']);
            expect(bare.ok, `${mode}: the bare token`).toBe(true);
            expect(bare.caller).toEqual({ role: 'admin', id: 1, email: ADMIN.email, via: 'bearer' });
        }
    });

    test('the normal mobile tokens of all three roles still pass as a Bearer, with norows and with down', async () => {
        const cases = [
            [MOBILE_ADMIN, 'admin', 1],
            [MOBILE_CUSTOMER, 'customer', 11],
            [MOBILE_PROVIDER, 'provider', 21],
            [PROVIDER, 'provider', 21],
        ];
        for (const mode of MODES) {
            db.mode = mode;
            for (const [payload, role, id] of cases) {
                const result = await bearerOutcome(sign(payload), [role]);
                expect(result.ok, `${mode}: ${role} Bearer`).toBe(true);
                expect(result.caller).toEqual({ role, id, email: payload.email, via: 'bearer' });
            }
        }
    });

    // A string that does NOT verify here (signed with another secret) but decodes, as the string the mobile app holds
    // and mobile_auth_users stores does: getMobileSession reads its payload with decodeToken when a row matches it.
    test('the issued-string path survives: a stored string that does not verify is a session of the row\'s user_type; with no row it is 401', async () => {
        const issued = [
            ['customer', MOBILE_CUSTOMER, { provider_id: null, user_id: 11, user_type: 'customer' }, 11],
            ['provider', MOBILE_PROVIDER, { provider_id: 21, user_id: null, user_type: 'provider' }, 21],
            ['admin', MOBILE_ADMIN, { provider_id: null, user_id: 1, user_type: 'admin' }, 1],
        ];
        for (const [role, payload, columns, id] of issued) {
            const token = sign(payload, 'another secret');
            db.mode = 'row';
            db.row = { token, ...columns };
            for (const roles of [[role], all]) {
                const result = await bearerOutcome(token, roles);
                expect(result.ok, `row for the string: ${role} Bearer, roles ${roles}`).toBe(true);
                expect(result.caller).toEqual({ role, id, email: payload.email, via: 'bearer' });
            }
            // The row is for exactly that string: another string of the same shape finds none.
            await expectBearerRefused(`row for another string: ${role} Bearer`, sign(payload, 'yet another secret'), all);
            // No row, or no database: no session.
            for (const mode of MODES) {
                db.mode = mode;
                await expectBearerRefused(`${mode}: ${role} Bearer that does not verify`, token, all);
            }
        }
    });

    test('the cookie path never touches the database: a request a cookie settles makes zero lookups', async () => {
        db.mode = 'down';
        const settled = [
            [asCookie('adminAuth', sign(ADMIN)), ['admin']],
            [asCookie('customer_token', sign(CUSTOMER)), ['customer']],
            [asCookie('provider_token', sign(PROVIDER)), ['provider']],
            [{ ...asCookie('adminAuth', sign(ADMIN)), ...asBearer('not.a.token') }, ['admin']],
        ];
        for (const [headers, roles] of settled) {
            const result = await guard.requireCaller(request(headers), roles);
            expect(result.ok, `cookie-settled request for ${roles}`).toBe(true);
        }
        expect(await guard.callerFrom(request(asCookie('customer_token', sign(CUSTOMER))))).not.toBeNull();
        // A refused cookie with no Bearer asks the database nothing either.
        await expectUnauthorized(await guard.requireCaller(request(asCookie('adminAuth', sign(ADMIN, 'another secret'))), ['admin']));
        expect(db.connections, 'getConnection calls for the cookie-only requests').toBe(0);
        // The premise, so that a zero means something: a Bearer does reach the stub.
        await guard.requireCaller(request(asBearer(sign(MOBILE_ADMIN))), ['admin']);
        expect(db.connections, 'premise: a Bearer request reaches the stub').toBeGreaterThan(0);
    });

    // What the matrix's admin-bearer style is judged by on a row that does not allow admin (auth-matrix: 403 exactly).
    test('an admin by Bearer on a customer-only or a provider-only route is 403, never 401, with norows and with down', async () => {
        for (const mode of MODES) {
            db.mode = mode;
            for (const roles of [['customer'], ['provider'], ['customer', 'provider']]) {
                const result = await bearerOutcome(sign(MOBILE_ADMIN), roles);
                expect(result.ok, `${mode}: admin Bearer, roles ${roles}`).toBe(false);
                await expectForbidden(result);
            }
        }
    });
});
