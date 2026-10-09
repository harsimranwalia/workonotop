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
// Two optional fields of a row's probe keep a request that does real work from being sent (the row's note in
// route-matrix.js cites the handler lines and says why):
//   hold         '<reason>': the case sends NOTHING, from any credential, and FAILS with the reason on its first line. One
//                request does real work whoever sends it (a cron job that runs for any caller while CRON_SECRET is unset).
//                A known failure until the converting ticket adds the guard and removes the hold.
//   holdAllowed  '<reason>': roles rows only. The styles whose role the row ALLOWS are not sent (the `answers` annotation
//                prints `held` for them and they are not judged); `none` and every wrong role are still sent and still
//                judged as above (401, and exactly 403). Used where an allowed caller's request does real work with no input.
//
// One case per row, titled `Role by route › <METHOD> <route>`, so e2e/baseline.json can name the row. The credentials come
// from e2e/auth/credentials.js (the three web logins and the two mobile logins): signed in once per run by the global setup
// (e2e/auth/global-setup.js) and handed to the workers in process.env, and once per worker only when that variable is absent;
// one request context per credential style is made in beforeAll and reused across the rows.
//
// Fixtures: this file reloads nothing itself. Whoever starts the run reloads them first (the department's recipe runs
// `npm run db:fixtures` in the app container before the test command). What a run leaves behind, measured: CHECKSUM TABLE over
// every table of the dev DB, before and after a run of the eleven rows whose probes ENG-020 changed or held (B3, 2026-10-02),
// differed in activity_logs and mobile_auth_users and in no other table, and the app log of that window held no mail and no
// ALTER TABLE (its only Stripe lines were the handlers' own banner and the log of the missing-body error: no Stripe call).
// Every probe uses a fixture account, an id no fixture row has, and an empty body or none (207 of 207 rows, by a script).
// That alone does not stop a handler before its first side effect. A request that does real work whatever it carries gets
// its row held (above; the matrix header names the three held rows). A row that is not held may still be stopped only by
// what the fixtures hold or lack: the matrix header's "What a probe does" says which rows carry a note on that and which do not.

import { test } from '@playwright/test';
import { matrix } from './auth/route-matrix.js';
import { CREDENTIAL_STYLES, STYLE_ROLE, getCredentialHeaders } from './auth/credentials.js';
import { RESET_RETRIES } from './support/auth.js';

// Every probe carries a fixture account's session header. A Playwright trace records the request headers of the API contexts
// it traces, and the config keeps a trace for each failed case, so this file turns tracing off: no TRACE holds a token. That
// is the whole claim. The department's recipe also copies the app's own log to test-results/app.log, and the Stripe webhook
// row (kind `self`, so every credential style is sent) makes that route log `request.headers` itself
// (src/app/api/stripe/webhook/route.js:16): once that row is probed, app.log holds the six fixture session headers. Dev
// accounts only, in a gitignored directory; ENG-022 owns that route and should delete the log line.
// A failure still names the credential style, the row and the statuses in its message.
test.use({ trace: 'off' });

const REQUEST_MS = 45_000;
const HELD = 'held';
const refused = (status) => status === 401 || status === 403;

// True for a style a holdAllowed row does not send: a signed-in style whose role the row allows. Only roles rows have one.
const isHeldStyle = (row, style) =>
    Boolean(row.probe.holdAllowed) && row.kind === 'roles' && style !== 'none' && row.roles.includes(STYLE_ROLE[style]);

// Sends the row's probe once per credential style (except the styles a holdAllowed row exempts, which are recorded as
// `held`) and returns { style: status }. No redirect is followed, so a 3xx is reported as it came; nothing but the status is
// read, so no body (and no token) is held or printed.
async function send(contexts, row) {
    const url = row.probe.path + (row.probe.query || '');
    const answers = {};
    for (const style of CREDENTIAL_STYLES) {
        if (isHeldStyle(row, style)) {
            answers[style] = HELD;
            continue;
        }
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

// Returns one line per wrong answer, each naming the credential and the status it got. A style that was not sent is not judged.
function judge(row, answers) {
    const problems = [];
    const name = (style) => (style === 'none' ? 'none (no credential)' : `${style} (${STYLE_ROLE[style]})`);
    const wrong = (style, want, why = '') => problems.push(`${name(style)}${why}: got ${answers[style]}, want ${want}`);
    const list = (statuses) => `one of ${statuses.join(', ')}`;
    const signedIn = CREDENTIAL_STYLES.filter((style) => style !== 'none');

    if (row.kind === 'roles') {
        if (answers.none !== row.probe.anon) wrong('none', `${row.probe.anon}`);
        for (const style of signedIn) {
            if (answers[style] === HELD) continue;
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

            const allowed = row.kind === 'roles' ? ` (${row.roles.join(', ')})` : '';
            const label = `${row.method} ${row.route} [${row.kind}${allowed}]`;

            if (row.probe.holdAllowed && row.kind !== 'roles') {
                throw new Error(`${label} has probe.holdAllowed, which is for roles rows only: use probe.hold for a row of kind ${row.kind}`);
            }
            if (row.probe.hold) {
                // Nothing is sent, from any credential. The reason is on the first line, the only line the console reporter prints.
                testInfo.annotations.push({ type: 'answers', description: CREDENTIAL_STYLES.map((style) => `${style}=${HELD}`).join(' ') });
                throw new Error(`${label} held, nothing sent: ${row.probe.hold}`);
            }

            const answers = await send(contexts, row);
            testInfo.annotations.push({ type: 'answers', description: CREDENTIAL_STYLES.map((style) => `${style}=${answers[style]}`).join(' ') });
            const problems = judge(row, answers);
            if (problems.length > 0) {
                // The first wrong answer is on the first line (the console reporter prints only that line); every wrong
                // answer, that one included, has its own line below it.
                const more = problems.length > 1 ? ` (+${problems.length - 1} more)` : '';
                throw new Error(`${label} answered wrongly: ${problems[0]}${more}\n  ${problems.join('\n  ')}`);
            }
        });
    }
});
