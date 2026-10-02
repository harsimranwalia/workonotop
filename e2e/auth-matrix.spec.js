// Role by route: every row of the route matrix (e2e/auth/route-matrix.js, Appendix A of the ENG-004 design) is probed
// with no credential and with each fixture credential, and the answer is judged by the row's kind:
//
//   roles    no credential: 401 (probe.anon). A signed-in role the row does not allow: exactly 403 (never 401, never a
//            404). A role the row allows: anything except 401 or 403, or a status in probe.allowed when the handler's own
//            validation legitimately answers 401 or 403.
//   public   no credential: a status in probe.anon; no credential style gets a 401 or 403 unless probe.anon lists it.
//   self     every style, signed in or not, gets a status in probe.anon (a user's cookie is not the route's secret).
//   pending  annotated, printed and skipped, with the reason; AC5 does not hold while a row is pending.
//
// One case per row, titled `Role by route › <METHOD> <route>`, so e2e/baseline.json can name the row. The credentials come
// from e2e/auth/credentials.js (the three web logins and the mobile login, once per worker process); one request context
// per credential style is made in beforeAll and reused across the rows. This file reloads nothing: the fixtures are reloaded
// by whoever starts the run, and every probe uses an id no fixture row has or an empty body, so nothing is meant to change.
import { test } from '@playwright/test';
import { matrix } from './auth/route-matrix.js';
import { CREDENTIAL_STYLES, STYLE_ROLE, getCredentialHeaders } from './auth/credentials.js';
import { RESET_RETRIES } from './support/auth.js';

const REQUEST_MS = 45_000;
const refused = (status) => status === 401 || status === 403;

// Sends the row's probe once per credential style and returns { style: status }. No redirect is followed, so a 3xx is
// reported as it came; nothing but the status is read, so no body (and no token) is held or printed.
async function send(contexts, row) {
    const url = row.probe.path + (row.probe.query || '');
    const answers = {};
    for (const style of CREDENTIAL_STYLES) {
        const response = await contexts[style].fetch(url, {
            method: row.method,
            data: row.probe.body,
            maxRetries: RESET_RETRIES,
            maxRedirects: 0,
            timeout: REQUEST_MS,
        });
        answers[style] = response.status();
        await response.dispose();
    }
    return answers;
}

// Returns one line per wrong answer, each naming the credential and the status it got.
function judge(row, answers) {
    const problems = [];
    const name = (style) => (style === 'none' ? 'none (no credential)' : `${style} (${STYLE_ROLE[style]})`);
    const wrong = (style, want, why = '') => problems.push(`${name(style)}${why}: got ${answers[style]}, want ${want}`);
    const list = (statuses) => `one of ${statuses.join(', ')}`;
    const signedIn = CREDENTIAL_STYLES.filter((style) => style !== 'none');

    if (row.kind === 'roles') {
        if (answers.none !== row.probe.anon) wrong('none', `${row.probe.anon}`);
        for (const style of signedIn) {
            if (row.roles.includes(STYLE_ROLE[style])) {
                const ok = row.probe.allowed ? row.probe.allowed.includes(answers[style]) : !refused(answers[style]);
                if (!ok) wrong(style, row.probe.allowed ? list(row.probe.allowed) : 'anything but 401 or 403', ', role allowed');
            } else if (answers[style] !== 403) {
                wrong(style, '403 exactly', ', role not allowed');
            }
        }
    } else if (row.kind === 'public') {
        if (!row.probe.anon.includes(answers.none)) wrong('none', list(row.probe.anon));
        for (const style of signedIn) {
            if (refused(answers[style]) && !row.probe.anon.includes(answers[style])) {
                wrong(style, 'anything but 401 or 403', ', public route');
            }
        }
    } else if (row.kind === 'self') {
        for (const style of CREDENTIAL_STYLES) {
            if (!row.probe.anon.includes(answers[style])) wrong(style, list(row.probe.anon), ", the route's own secret decides");
        }
    }
    return problems;
}

test.describe('Role by route', () => {
    test.describe.configure({ timeout: 120_000 });

    /** @type {Record<string, import('@playwright/test').APIRequestContext>} */
    let contexts = {};

    test.beforeAll(async ({ playwright }, testInfo) => {
        const baseURL = testInfo.project.use.baseURL;
        const headers = await getCredentialHeaders(baseURL, playwright);
        for (const style of CREDENTIAL_STYLES) {
            contexts[style] = await playwright.request.newContext({ baseURL, extraHTTPHeaders: headers[style] });
        }
    });

    test.afterAll(async () => {
        await Promise.all(Object.values(contexts).map((context) => context.dispose()));
        contexts = {};
    });

    for (const row of matrix) {
        test(`${row.method} ${row.route}`, async ({}, testInfo) => {
            if (row.kind === 'pending') {
                // Printed on every run and recorded on the case: a pending row is classified, never passed.
                console.log(`PENDING ${row.method} ${row.route}: ${row.pending}`);
                testInfo.annotations.push({ type: 'pending', description: row.pending });
                test.skip(true, `pending: ${row.pending}`);
            }

            const answers = await send(contexts, row);
            testInfo.annotations.push({ type: 'answers', description: CREDENTIAL_STYLES.map((style) => `${style}=${answers[style]}`).join(' ') });
            const problems = judge(row, answers);
            if (problems.length > 0) {
                const allowed = row.kind === 'roles' ? ` (${row.roles.join(', ')})` : '';
                throw new Error(`${row.method} ${row.route} [${row.kind}${allowed}] answered wrongly:\n  ${problems.join('\n  ')}`);
            }
        });
    }
});
