// @ts-check
// The role in the access token that the mobile refresh route mints comes from the account row the session points to (users.role for a
// customer or an admin, service_providers for a provider). Eight cases, each titled for what the role comes from:
//   1  refresh returns the role the account holds, for a session row whose stored type differs from its account;
//   2, 3  a consistent customer session and a consistent provider session refresh to the claims they carry today;
//   4  a repeat sign-in on the same device puts the stored type back in step with the account;
//   5  the three sign-in routes that derive the type from the account re-store it in their upsert (source read, no request);
//   6, 7, 8  one case per role: a device registration, a sign-in and a refresh keep the role and the id column of the account that
//            made the call, read back from the row after the registration and after the sign-in.
// Cases 1 to 4 and 6 to 8 sign in through the app's own routes (POST /api/auth/mobile/login, the Bearer of
// e2e/auth/credentials.js) and read or arrange the session row with a small database helper. The helper refuses every target but the
// local dev database (assertDevTarget, then assertNoRealPeople, the guard the fixture loader uses) before it opens a write, and it
// only touches rows whose device_id starts with 'e2e-eng024-'. It reaches the database the way the department's test command lets it:
// that container runs with --network host, so the published port 127.0.0.1:3307 is the dev database.
// Fixture accounts: customer1 is users 1, the admin is users 3, provider1 is service_providers 1 (database/fixtures/accounts.js).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { test, expect } from '@playwright/test';
import { getCredentialHeaders } from './auth/credentials.js';
import { RESET_RETRIES } from './support/auth.js';
import { users, providers, FIXTURE_LOGINS } from '../database/fixtures/accounts.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';

// Every request carries a fixture account's session and a trace records request headers and bodies: tracing is off, as in
// e2e/ownership.spec.js. A failure message names the case, the status and the account, never a header or a token.
test.use({ trace: 'off' });

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const [CUSTOMER1, , ADMIN] = users;
const [PROVIDER1] = providers;
const DEVICE_PREFIX = 'e2e-eng024-';

// One object feeds both the guard and the connection, so the guard certifies the values that get used (as database/fixtures/load.js).
const DB = { host: '127.0.0.1', port: 3307, user: 'root', password: 'root123', database: 'workontap_db' };

/** @type {import('mysql2/promise').Connection | null} */
let connection = null;

// The one connection of this worker, opened on first use, after the guard has checked the target and the rows in it.
async function db() {
    if (connection) return connection;
    assertDevTarget(DB);
    let opened;
    try {
        opened = await mysql.createConnection(DB);
    } catch (error) {
        throw new Error(`the dev database did not accept a connection at ${DB.host}:${DB.port} (${/** @type {any} */ (error).code || 'no code'}); the test command runs the container with --network host`, { cause: error });
    }
    try {
        await assertNoRealPeople(opened);
    } catch (error) {
        await opened.end();
        throw error;
    }
    connection = opened;
    return connection;
}

test.afterAll(async () => {
    if (!connection) return;
    try {
        await connection.query('DELETE FROM mobile_auth_users WHERE device_id LIKE ?', [`${DEVICE_PREFIX}%`]);
    } finally {
        await connection.end();
        connection = null;
    }
});

// Every session row on one device. The refresh token is never selected.
async function rowsOnDevice(deviceId) {
    const [rows] = await (await db()).query('SELECT id, user_id, provider_id, user_type, device_id FROM mobile_auth_users WHERE device_id = ? ORDER BY id', [deviceId]);
    return /** @type {any[]} */ (rows);
}

async function clearDevice(deviceId) {
    await (await db()).query('DELETE FROM mobile_auth_users WHERE device_id = ?', [deviceId]);
}

// Arranges a session row whose stored type differs from its account's: the row is found by its refresh token.
async function setStoredType(refreshToken, type) {
    const [result] = await (await db()).query('UPDATE mobile_auth_users SET user_type = ? WHERE refresh_token = ?', [type, refreshToken]);
    expect(/** @type {any} */ (result).affectedRows, 'the row that holds the refresh token is found and typed').toBe(1);
}

// Signs a fixture account in through the app's mobile route on its own device id; returns the answer (it holds tokens: never print it).
async function signIn(request, who, deviceId, requestedRole) {
    const login = FIXTURE_LOGINS[who];
    const response = await request.post('/api/auth/mobile/login', {
        data: { email: login.email, password: login.password, role: requestedRole, device_id: deviceId },
        maxRetries: RESET_RETRIES,
        timeout: 60_000,
    });
    expect(response.status(), `${who} signs in on ${deviceId}`).toBe(200);
    const body = await response.json();
    expect(typeof body.refreshToken, `${who}'s sign-in answers a refresh token`).toBe('string');
    return body;
}

// Exchanges a refresh token; returns the claims of the access token it answers, and the new refresh token.
async function refresh(request, refreshToken, who) {
    const response = await request.post('/api/auth/mobile/refresh', { data: { refreshToken }, maxRetries: RESET_RETRIES, timeout: 60_000 });
    expect(response.status(), `${who}'s refresh`).toBe(200);
    const body = await response.json();
    expect(typeof body.token, `${who}'s refresh answers an access token`).toBe('string');
    return { claims: claimsOf(body.token), refreshToken: body.refreshToken };
}

// The payload of a JWT, decoded and not verified: the case asks what the token says, the app signed it.
function claimsOf(token) {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

test.describe('Mobile refresh role', () => {
    // Red if refresh takes a customer account's role from anything but the account row: the row below is stored as 'admin' on
    // customer 1's account, and the token that comes back must say customer.
    test('refresh returns the role the account holds', async ({ request }) => {
        const device = `${DEVICE_PREFIX}1`;
        await clearDevice(device);
        const signedIn = await signIn(request, 'customer1', device, 'customer');
        await setStoredType(signedIn.refreshToken, 'admin');
        const { claims } = await refresh(request, signedIn.refreshToken, 'customer1');
        expect(claims.role, 'the refreshed token\'s role').toBe('customer');
        expect(claims.type, 'the refreshed token\'s type').toBe('customer');
        expect(claims.id, 'the refreshed token\'s id').toBe(CUSTOMER1.id);
        expect(claims.email, 'the refreshed token\'s email').toBe(CUSTOMER1.email);
    });

    // A session whose stored type agrees with its account refreshes to a token that names that account: its role, type, id and email
    // (customer 1 and provider 1 are both id 1, so the email is what tells the two tables apart).
    test('a customer session refreshes to a customer token', async ({ request }) => {
        const device = `${DEVICE_PREFIX}2`;
        await clearDevice(device);
        const signedIn = await signIn(request, 'customer1', device, 'customer');
        const { claims } = await refresh(request, signedIn.refreshToken, 'customer1');
        expect(claims.role, 'role').toBe('customer');
        expect(claims.type, 'type').toBe('customer');
        expect(claims.id, 'id').toBe(CUSTOMER1.id);
        expect(claims.email, 'email').toBe(CUSTOMER1.email);
        expect(claims.providerId, 'a customer token names no provider').toBeUndefined();
    });

    test('a provider session refreshes to a provider token', async ({ request }) => {
        const device = `${DEVICE_PREFIX}3`;
        await clearDevice(device);
        const signedIn = await signIn(request, 'provider1', device, 'provider');
        const first = await refresh(request, signedIn.refreshToken, 'provider1');
        const { claims } = first;
        expect(claims.role, 'role').toBe('provider');
        expect(claims.type, 'type').toBe('provider');
        expect(claims.id, 'id').toBe(PROVIDER1.id);
        expect(claims.providerId, 'providerId').toBe(PROVIDER1.id);
        expect(claims.email, 'email').toBe(PROVIDER1.email);

        // Red if refresh takes a provider account's role from the stored type, or chooses the account's table by it: the row below is
        // stored as 'admin' on provider 1's account, and the token that comes back must still say provider.
        await setStoredType(first.refreshToken, 'admin');
        const again = await refresh(request, first.refreshToken, 'provider1');
        expect(again.claims.role, 'role after the stored type changed').toBe('provider');
        expect(again.claims.type, 'type after the stored type changed').toBe('provider');
        expect(again.claims.id, 'id after the stored type changed').toBe(PROVIDER1.id);
        expect(again.claims.providerId, 'providerId after the stored type changed').toBe(PROVIDER1.id);
        expect(again.claims.email, 'email after the stored type changed').toBe(PROVIDER1.email);
    });

    // Red if the sign-in's upsert leaves the stored type as it found it: the second sign-in is on the same device, so it updates the row.
    test('a repeat sign-in keeps the stored type in step with the account', async ({ request }) => {
        const device = `${DEVICE_PREFIX}4`;
        await clearDevice(device);
        const first = await signIn(request, 'customer1', device, 'customer');
        await setStoredType(first.refreshToken, 'admin');
        await signIn(request, 'customer1', device, 'customer');
        const rows = await rowsOnDevice(device);
        expect(rows.length, 'one session row on the device').toBe(1);
        expect(rows[0].user_type, 'the stored type after the repeat sign-in').toBe('customer');
        expect(rows[0].user_id, 'the row stays customer 1\'s').toBe(CUSTOMER1.id);
    });

    // The social sign-in routes cannot be driven over HTTP without a provider's identity token, so for them (and for the mobile sign-in,
    // which case 4 also drives) the source is read: the upsert list of each route's one mobile_auth_users INSERT re-stores user_type.
    // Red if the line is deleted from any of the three.
    test('the sign-in routes that derive the type from the account re-store it on a repeat sign-in', () => {
        const routes = ['src/app/api/auth/mobile/login/route.js', 'src/app/api/auth/google/route.js', 'src/app/api/auth/apple/route.js'];
        for (const file of routes) {
            const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
            const statements = source.match(/INSERT INTO mobile_auth_users[^`]*`/g) ?? [];
            expect(statements.length, `${file}: one INSERT into mobile_auth_users`).toBe(1);
            const at = statements[0].search(/ON DUPLICATE KEY UPDATE/i);
            expect(at, `${file}: the INSERT has an ON DUPLICATE KEY UPDATE list`).toBeGreaterThan(-1);
            const list = statements[0].slice(at);
            expect(/\buser_type\s*=\s*VALUES\(\s*user_type\s*\)/i.test(list), `${file}: the upsert list re-stores user_type`).toBe(true);
        }
    });

    // The role and the id column come from the account that made the call. One case per role; each runs on its own device id, and the
    // device's rows are cleared first because the registration updates an existing row without writing its type
    // (push-token/route.js:38-48), so only a device with no row yet exercises its INSERT. Steps: a device registration with the
    // account's Bearer (what the app sends: 'customer' for an admin), the row read back, a sign-in on the same device, the row read
    // back again (one row, unchanged), a refresh with that sign-in's refresh token, the claims.
    const ROLES = [
        { who: 'customer1', role: 'customer', requested: 'customer', named: 'customer', idColumn: 'user_id', otherColumn: 'provider_id', account: CUSTOMER1, style: 'customer-bearer' },
        { who: 'provider1', role: 'provider', requested: 'provider', named: 'provider', idColumn: 'provider_id', otherColumn: 'user_id', account: PROVIDER1, style: 'provider-bearer' },
        { who: 'admin', role: 'admin', requested: 'customer', named: 'customer', idColumn: 'user_id', otherColumn: 'provider_id', account: ADMIN, style: 'admin-bearer' },
    ];
    for (const spec of ROLES) {
        test(`a device registration, a sign-in and a refresh keep the ${spec.role}'s own role and id`, async ({ request, baseURL }) => {
            const device = `${DEVICE_PREFIX}reg-${spec.role}`;
            await clearDevice(device);
            const headers = (await getCredentialHeaders(String(baseURL)))[spec.style];

            const registered = await request.post('/api/mobile/push-token', {
                headers,
                data: { userId: spec.account.id, userType: spec.named, pushToken: `${DEVICE_PREFIX}${spec.role}`, platform: 'android', deviceId: device },
                maxRetries: RESET_RETRIES,
                timeout: 60_000,
            });
            expect(registered.status(), `${spec.who}'s device registration`).toBe(200);
            expect((await registered.json()).success, `${spec.who}'s device registration is saved`).toBe(true);

            const stored = await rowsOnDevice(device);
            expect(stored.length, 'one session row on the device after the registration').toBe(1);
            expect(stored[0].user_type, 'the stored type after the registration').toBe(spec.role);
            expect(stored[0][spec.idColumn], `${spec.idColumn} after the registration`).toBe(spec.account.id);
            expect(stored[0][spec.otherColumn], `${spec.otherColumn} after the registration`).toBeNull();

            const signedIn = await signIn(request, spec.who, device, spec.requested);

            const kept = await rowsOnDevice(device);
            expect(kept.length, 'still one session row on the device after the sign-in').toBe(1);
            expect(kept[0].id, 'the sign-in updated the registration\'s row').toBe(stored[0].id);
            expect(kept[0].user_type, 'the stored type after the sign-in').toBe(spec.role);
            expect(kept[0][spec.idColumn], `${spec.idColumn} after the sign-in`).toBe(spec.account.id);
            expect(kept[0][spec.otherColumn], `${spec.otherColumn} after the sign-in`).toBeNull();

            const { claims } = await refresh(request, signedIn.refreshToken, spec.who);
            expect(claims.role, 'the refreshed token\'s role').toBe(spec.role);
            expect(claims.type, 'the refreshed token\'s type').toBe(spec.role);
            expect(claims.id, 'the refreshed token\'s id').toBe(spec.account.id);
            expect(claims.email, 'the refreshed token\'s email').toBe(spec.account.email);
            if (spec.role === 'provider') expect(claims.providerId, 'the refreshed token\'s providerId').toBe(spec.account.id);
        });
    }
});
