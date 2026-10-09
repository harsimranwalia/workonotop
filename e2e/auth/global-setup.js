// globalSetup, listed after e2e/support/preflight.js (so the app is up and the fixtures are loaded): signs the six fixture
// credentials in once for the whole run (three web logins, three mobile logins, through getCredentialHeaders) and leaves the
// headers in process.env for the worker processes. Playwright spawns the workers after the global setup, with the runner's
// environment, so every replacement worker inherits them instead of signing in again.
//
// The headers hold session tokens for synthetic fixture accounts. They go to process.env only: never to disk, the console,
// an error message or an annotation. A failed sign-in aborts the run with credentials.js's own message: the account, the
// route and the status.
import { CREDENTIAL_ENV, getCredentialHeaders } from './credentials.js';

export default async function globalSetup(config) {
    const baseURL = config.projects[0].use.baseURL;
    // A value already in the caller's environment must not stand in for this run's own sign-ins.
    delete process.env[CREDENTIAL_ENV];
    let headers;
    try {
        headers = await getCredentialHeaders(baseURL);
    } catch (error) {
        // Playwright prints the stack of an error thrown from globalSetup; for this message it is only noise (as in preflight.js).
        const message = error instanceof Error ? error.message : 'credentials: sign-in failed';
        const aborted = new Error(message);
        aborted.stack = `Error: ${message}`;
        throw aborted;
    }
    process.env[CREDENTIAL_ENV] = JSON.stringify(headers);
}
