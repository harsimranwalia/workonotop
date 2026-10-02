// globalSetup: stops the whole run in one line when the app is not up or the fixtures are not loaded,
// instead of letting every case fail for the same reason.
import { FIXTURE_LOGINS } from '../../database/fixtures/accounts.js';

const POLL_MS = 2_000;
const WAIT_MS = 120_000;
const ATTEMPT_MS = 30_000;
const LOGIN_MS = 60_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Playwright prints the stack of an error thrown from globalSetup; for these messages it is only noise.
function abort(message) {
    const error = new Error(message);
    error.stack = `Error: ${message}`;
    return error;
}

// A cold `next dev` can take a while to answer its first request, so poll rather than fail at once.
async function waitForApp(baseURL) {
    const deadline = Date.now() + WAIT_MS;
    let lastProblem = 'no answer';
    while (Date.now() < deadline) {
        try {
            const timeout = Math.min(ATTEMPT_MS, deadline - Date.now());
            const response = await fetch(baseURL, { signal: AbortSignal.timeout(timeout) });
            if (response.ok) return;
            lastProblem = `HTTP ${response.status}`;
        } catch (error) {
            lastProblem = error.cause?.code || error.name;
        }
        await sleep(POLL_MS);
    }
    throw abort(`app not reachable at ${baseURL} after ${WAIT_MS / 1000} s (last: ${lastProblem})`);
}

// The suite is only meaningful against the fixture data (several cases pass on an empty database), so the
// run requires that a fixture customer can sign in through the app, which reads the database the app uses.
async function requireFixtures(baseURL) {
    const { email, password, loginRoute } = FIXTURE_LOGINS.customer1;
    let response;
    try {
        response = await fetch(new URL(loginRoute, baseURL), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email, password }),
            signal: AbortSignal.timeout(LOGIN_MS),
        });
    } catch (error) {
        throw abort(`fixture sign-in at ${baseURL}${loginRoute} failed (${error.cause?.code || error.name})`);
    }
    if (!response.ok) {
        throw abort(`fixtures not loaded in the database the app reads (fixture sign-in answered ${response.status}); run the fixture command: npm run db:fixtures`);
    }
}

export default async function preflight(config) {
    const baseURL = config.projects[0].use.baseURL;
    await waitForApp(baseURL);
    await requireFixtures(baseURL);
}
