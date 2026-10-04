// The credentials the role-by-route test sends, obtained through the same routes a person's browser or the mobile app
// uses, and handed out as request headers. They are signed in once per run, by the global setup (e2e/auth/global-setup.js),
// which leaves them in process.env (CREDENTIAL_ENV) for the worker processes Playwright spawns after it: a worker is
// replaced after every failed case, so signing in per worker cost six logins per failure. Only when that variable is absent
// (a spec run outside this config) does getCredentialHeaders sign in itself, once per worker process, as it always did.
// No token is written to disk or logged; a failure names the account, the route and the status, never a body that could
// hold a token.
//
//   cookie styles  the role's own login route (as e2e/support/auth.js signInAs does, FIXTURE_LOGINS), then the one
//                  httpOnly cookie that route set is read back from that account's APIRequestContext and sent as a
//                  `cookie` header: customer_token, provider_token or adminAuth.
//   bearer styles  POST /api/auth/mobile/login, then the `token` of its answer is sent as `Authorization: Bearer`.
//                  That route also sets a cookie; it is discarded, so a Bearer style carries only the Bearer.
//                  The admin by Bearer (ENG-021) is the same route with the admin fixture's login: the route finds an
//                  admin in `users` whatever role is asked for and signs { role: 'admin', type: 'admin' }. The app's admin
//                  screens send a Bearer only, so a route that is converted to the guard needs a style that shows a real
//                  mobile admin token getting through it. It is not one of the design's three original Bearer/cookie
//                  pairs, which is why it comes last: answer annotations list the styles in this order.
import { request } from '@playwright/test';
import { FIXTURE_LOGINS } from '../../database/fixtures/accounts.js';
import { RESET_RETRIES } from '../support/auth.js';

// The seven styles, in the order the role-by-route test sends them (a new style goes last, so the answer annotations that
// list them keep their order). `none` is the request with no credential.
export const CREDENTIAL_STYLES = ['none', 'customer-cookie', 'provider-cookie', 'admin-cookie', 'customer-bearer', 'provider-bearer', 'admin-bearer'];

// The role each signed-in style is, as the app decides it from the signed payload.
export const STYLE_ROLE = {
    'customer-cookie': 'customer',
    'provider-cookie': 'provider',
    'admin-cookie': 'admin',
    'customer-bearer': 'customer',
    'provider-bearer': 'provider',
    'admin-bearer': 'admin',
};

const COOKIE_STYLES = [
    { style: 'customer-cookie', who: 'customer1', cookie: 'customer_token' },
    { style: 'provider-cookie', who: 'provider1', cookie: 'provider_token' },
    { style: 'admin-cookie', who: 'admin', cookie: 'adminAuth' },
];
const BEARER_STYLES = [
    { style: 'customer-bearer', who: 'customer1', role: 'customer' },
    { style: 'provider-bearer', who: 'provider1', role: 'provider' },
    { style: 'admin-bearer', who: 'admin', role: 'admin' },
];
// One mobile session row per account, upserted on this device id, so no other session is replaced.
const DEVICE_ID = 'e2e-auth-matrix';
const LOGIN_TIMEOUT_MS = 60_000;

const loginFor = (who) => {
    const login = FIXTURE_LOGINS[who];
    if (!login) throw new Error(`credentials: unknown fixture account '${who}'`);
    return login;
};

// Reads only the answer's own `message`, never the whole body, so a token cannot end up in an error.
async function answer(response) {
    const isJson = (response.headers()['content-type'] || '').includes('application/json');
    const body = isJson ? await response.json().catch(() => null) : null;
    return { status: response.status(), body, message: typeof body?.message === 'string' ? body.message.slice(0, 120) : '' };
}

function failure(who, route, status, message) {
    const hint = status === 401 ? ' Are the fixtures loaded in the database the app reads? Run npm run db:fixtures.' : '';
    return new Error(`credentials: fixture ${who} could not sign in: POST ${route} answered ${status}${message ? ` (${message})` : ''}.${hint}`);
}

async function cookieHeader(playwright, baseURL, { style, who, cookie }) {
    const login = loginFor(who);
    const context = await playwright.request.newContext({ baseURL });
    try {
        const response = await context.post(login.loginRoute, {
            data: { email: login.email, password: login.password },
            maxRetries: RESET_RETRIES,
            timeout: LOGIN_TIMEOUT_MS,
        });
        const { status, body, message } = await answer(response);
        if (status !== 200 || !body?.success) throw failure(who, login.loginRoute, status, message);
        const state = await context.storageState();
        const held = state.cookies.find((entry) => entry.name === cookie);
        if (!held) throw new Error(`credentials: ${style}: POST ${login.loginRoute} answered 200 but did not set the ${cookie} cookie`);
        return { cookie: `${cookie}=${held.value}` };
    } finally {
        await context.dispose();
    }
}

async function bearerHeader(playwright, baseURL, { style, who, role }) {
    const login = loginFor(who);
    const route = '/api/auth/mobile/login';
    const context = await playwright.request.newContext({ baseURL });
    try {
        const response = await context.post(route, {
            data: { email: login.email, password: login.password, role, device_id: DEVICE_ID },
            maxRetries: RESET_RETRIES,
            timeout: LOGIN_TIMEOUT_MS,
        });
        const { status, body, message } = await answer(response);
        if (status !== 200 || !body?.success) throw failure(who, route, status, message);
        if (typeof body.token !== 'string' || body.token === '') throw new Error(`credentials: ${style}: POST ${route} answered 200 without a token`);
        return { authorization: `Bearer ${body.token}` };
    } finally {
        await context.dispose();
    }
}

// The one variable that carries the headers from the global setup to the workers: a JSON object of the seven styles, for the
// run's baseURL (config.projects[0], the only project). It holds session tokens for the synthetic fixture accounts, so it
// lives in process.env only: nothing prints, logs, annotates or writes it.
export const CREDENTIAL_ENV = 'E2E_AUTH_HEADERS';

// The headers the global setup left in process.env, or null when the variable is absent or is not the seven styles (a value
// that does not parse, or that lacks a style, is ignored, never put in a message, and the caller signs in itself).
function sharedHeaders() {
    const raw = process.env[CREDENTIAL_ENV];
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        const whole = parsed !== null && typeof parsed === 'object' && CREDENTIAL_STYLES.every((style) => parsed[style] !== null && typeof parsed[style] === 'object');
        return whole ? parsed : null;
    } catch {
        return null;
    }
}

let loaded = null; // baseURL -> Promise, so a worker that finds no shared headers signs in once per worker process

/**
 * Returns the seven credential styles as request headers: { none: {}, 'customer-cookie': { cookie }, ...,
 * 'admin-bearer': { authorization } }. When the global setup left them in process.env (CREDENTIAL_ENV) they are
 * returned as they are and nothing signs in. Otherwise the logins run once per worker process and every later call gets
 * the same headers. A failed sign-in rejects with a message naming the account and route (and is not cached).
 * @param {string} baseURL
 * @param {import('@playwright/test').PlaywrightWorkerArgs['playwright']} [playwright]
 * @returns {Promise<Record<string, Record<string, string>>>}
 */
export function getCredentialHeaders(baseURL, playwright = { request }) {
    const shared = sharedHeaders();
    if (shared) return Promise.resolve(shared);
    if (!loaded) loaded = new Map();
    if (!loaded.has(baseURL)) {
        const promise = (async () => {
            const headers = { none: {} };
            const wanted = [
                ...COOKIE_STYLES.map((spec) => cookieHeader(playwright, baseURL, spec).then((h) => [spec.style, h])),
                ...BEARER_STYLES.map((spec) => bearerHeader(playwright, baseURL, spec).then((h) => [spec.style, h])),
            ];
            for (const [style, value] of await Promise.all(wanted)) headers[style] = value;
            // Keep the order stable for anything that iterates.
            return Object.fromEntries(CREDENTIAL_STYLES.map((style) => [style, headers[style]]));
        })();
        loaded.set(baseURL, promise);
        promise.catch(() => loaded.delete(baseURL));
    }
    return loaded.get(baseURL);
}
