import { FIXTURE_LOGINS } from '../../database/fixtures/accounts.js';

// Says what is most likely wrong, so a failed sign-in is not a bare "expected 200".
function explain(who, route, status, text) {
    const seen = `POST ${route} answered ${status}: ${text.slice(0, 160)}`;
    if (status === 401) {
        return `${seen}\nFixture ${who} could not sign in: are the fixtures loaded in the database the app reads? Run npm run db:fixtures.`;
    }
    if (who === 'admin' && status === 500) {
        return `${seen}\nThe admin login signs its token with JWT_SECRET and has no fallback: is JWT_SECRET set in the app's environment (.env.development.local)?`;
    }
    return seen;
}

/**
 * Signs the page's browser context in as a fixture account, through that role's own login route, so
 * the context holds the same httpOnly cookie a person's browser would. No token is written to disk.
 * @param {import('@playwright/test').Page} page
 * @param {'customer1'|'customer2'|'provider1'|'provider2'|'admin'} who
 */
export async function signInAs(page, who) {
    const login = FIXTURE_LOGINS[who];
    if (!login) {
        throw new Error(`signInAs: unknown fixture account '${who}'; use one of ${Object.keys(FIXTURE_LOGINS).join(', ')}`);
    }

    // page.request shares its cookie jar with the page, so the cookie the route sets applies to page.goto.
    const response = await page.request.post(login.loginRoute, {
        data: { email: login.email, password: login.password },
    });
    const status = response.status();
    const text = await response.text();
    // A Next error page is HTML, so only a JSON answer is parsed; anything else is reported as it came.
    const isJson = (response.headers()['content-type'] || '').includes('application/json');
    const body = isJson ? JSON.parse(text) : null;
    if (status !== 200 || !body?.success) {
        throw new Error(explain(who, login.loginRoute, status, text));
    }
}
