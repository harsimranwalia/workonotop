// @ts-check
// ENG-018, the source pins of the design's "Pins" row (agents/architect/designs/ENG-018-transactional-sms-and-email.md) and the vectors of
// src/lib/link-pages.js, the one pure file step 8 adds. No app, no database, no browser: a case reads files of the repo, or imports a library that loads in
// plain Node, and says which file and which text it found. Each title starts with "Pins:", and the file's name, the describe and the title together are
// its baseline key:
//   Hooks    the twelve route files that import src/lib/notice-events.js (HOOKED below, written out) are the only files of src/app that do, each imports
//            afterCommit and calls an event only inside it, and the calls add up to the design's fourteen hooks.
//   Sent     the twelve name no sender they did not name before the hooks went in. Three kinds of name are still there and none is a notice: the in-app
//            pushes (notifyUser) of three routes, the number check's own code text (sendSMS) and the account holder's finish e-mail (sendEmail). The design
//            worded this pin wider, "no notifyUser for an event"; the pushes stay because taking them out is another ticket's change, and STILL_NAMED says
//            exactly what stays.
//   Library  src/lib/notice-templates.js and src/lib/notice-events.js import no sender module and name no sender; src/lib/notices.js imports the e-mail and
//            SMS modules and not the push one.
//   Kinds    NOTICE_KINDS, the keys of NOTICE_EVENTS and the kinds notice-events.js passes to tell( are one list, and no per-kind cap (a number's, the platform's, an
//            address's) names another kind.
//   Log      no console call in src/lib/email.js names the address, the subject, the body or the error; the catch logs the error's code and nothing more.
//   Timeouts src/lib/email.js sets connectionTimeout 10000, greetingTimeout 10000 and socketTimeout 20000 on the transport it creates.
//   Env      .env.example names the ten variables a notice reads and gives none a value, and each is read by code under src/.
//   Sweep    runCrewRetention calls pruneNotices and puts the count in its summary as notice_rows.
//   Pages    src/app/layout.js renders none of its four <Script> tags, and reads no seo_settings script, on a link page; src/middleware.js puts the policy on
//            the request and the response with a nonce from crypto.getRandomValues; linkPageKind and linkPagePolicy answer their vectors.
//   Card     (ENG-013 F7) CardForm.jsx asks for a new card entry when a confirm failed at Stripe and keeps its form when Stripe.js refused the fields, and the
//            setup route no longer says that the count of tries keeps a link from testing stolen card numbers. The form needs a Stripe key to run in a browser,
//            which dev does not have, so this is the one place its two branches are looked at.
// The files are read with their comments blanked, and each case that depends on that reading checks that what it looked for is really there, so a reading
// that finds nothing fails and does not pass.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { NOTICE_KINDS } from '../src/lib/notice-templates.js';
import { NOTICE_EVENTS } from '../src/lib/notice-events.js';
import { KIND_TEXTS_PER_NUMBER_DAY, KIND_TEXTS_PER_PLATFORM_DAY, KIND_MAILS_PER_ADDRESS_DAY, KIND_MAILS_PER_PLATFORM_DAY } from '../src/lib/sms-budget.js';
import { LINK_PAGE_PREFIXES, linkPageKind, linkPagePolicy } from '../src/lib/link-pages.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// The twelve route files that hand an event to src/lib/notice-events.js, written out. The list is not widened from the tree: the first case below fails when
// a thirteenth file imports the events.
const HOOKED = [
    'src/app/api/admin/bookings/[id]/job-link/route.js',
    'src/app/api/admin/bookings/route.js',
    'src/app/api/bookings/[id]/reassign/route.js',
    'src/app/api/bookings/route.js',
    'src/app/api/job/[token]/reports/route.js',
    'src/app/api/provider/available-jobs/[id]/route.js',
    'src/app/api/provider/available-jobs/route.js',
    'src/app/api/provider/crew/[id]/number-check/route.js',
    'src/app/api/provider/jobs/[id]/crew/route.js',
    'src/app/api/provider/jobs/[id]/job-link/route.js',
    'src/app/api/provider/jobs/time-tracking/route.js',
    'src/app/api/quote-requests/route.js',
];
const HOOKS = 14;

// The senders of src/: sendEmail (src/lib/email.js), sendSMS and sendSMSResult (src/lib/sms.js), sendPushNotification and notifyUser (src/lib/push.js).
const SENDERS = ['sendEmail', 'sendSMS', 'sendPushNotification', 'notifyUser'];
const SENDER_MODULES = /from\s+['"][^'"]*\/(?:email|sms|push)(?:\.js)?['"]/;

// The files of the twelve that still name a sender, and the names each may keep. notifyUser in the three booking routes is the in-app push that was there
// before this ticket; in time-tracking it is an import nothing calls, also from before. sendSMS in the number-check route is the code text of the check,
// which is not a notice (src/lib/job-link-code.js), and sendEmail in time-tracking is the account holder's finish e-mail, whose HTML another spec pins.
const STILL_NAMED = {
    'src/app/api/admin/bookings/route.js': ['notifyUser'],
    'src/app/api/bookings/route.js': ['notifyUser'],
    'src/app/api/provider/available-jobs/route.js': ['notifyUser'],
    'src/app/api/provider/crew/[id]/number-check/route.js': ['sendSMS'],
    'src/app/api/provider/jobs/time-tracking/route.js': ['notifyUser', 'sendEmail'],
};
// The two names above that are real sends and not pushes: each must still be there, so that the list cannot go stale.
const NOT_NOTICES = [
    ['src/app/api/provider/crew/[id]/number-check/route.js', 'sendSMS'],
    ['src/app/api/provider/jobs/time-tracking/route.js', 'sendEmail'],
];

const ENV_NAMES = [
    'NEXT_PUBLIC_APP_URL', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER',
    'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM', 'ADMIN_EMAIL',
];

const textOf = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

// The text with block comments and whole-line and trailing line comments blanked. A `//` inside a string is kept (a URL, a path) because a line comment
// is taken only where a space or the start of the line comes before it.
function codeOf(file) {
    return textOf(file)
        .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
        .split('\n')
        .map((line) => line.replace(/(^|\s)\/\/.*$/, '$1'))
        .join('\n');
}

function sourceFiles(dir) {
    const found = [];
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const relative = `${dir}/${entry.name}`;
        if (entry.isDirectory()) found.push(...sourceFiles(relative));
        else if (/\.(js|jsx)$/.test(entry.name)) found.push(relative);
    }
    return found;
}

// The argument text of every call that `opening` finds in `code`; `opening` is a global regular expression that ends at the call's opening parenthesis. The
// closing parenthesis is found by counting, skipping what is inside a string, and a call that never closes fails the case.
function callsOf(code, opening) {
    const calls = [];
    for (const start of code.matchAll(opening)) {
        const from = start.index + start[0].length;
        let depth = 1;
        let quote = '';
        let end = -1;
        for (let at = from; at < code.length && end < 0; at += 1) {
            const char = code[at];
            if (quote) {
                if (char === '\\') at += 1;
                else if (char === quote) quote = '';
            } else if (char === "'" || char === '"' || char === '`') quote = char;
            else if (char === '(') depth += 1;
            else if (char === ')') {
                depth -= 1;
                if (depth === 0) end = at;
            }
        }
        expect(end, `the call ${start[0]} at offset ${start.index} closes`).toBeGreaterThan(-1);
        calls.push(code.slice(from, end));
    }
    return calls;
}

const names = (code, word) => new RegExp(`\\b${word}\\b`).test(code);

test.describe('Pins: the hooks of the twelve route files', () => {
    test('Pins: the files of src/app that import notice-events.js are the twelve, each imports afterCommit and calls its events only inside it, fourteen hooks in all', () => {
        const importing = sourceFiles('src/app').filter((file) => /from\s+['"]@\/lib\/notice-events['"]/.test(codeOf(file)));
        expect([...importing].sort()).toEqual([...HOOKED].sort());
        let hooks = 0;
        for (const file of HOOKED) {
            const code = codeOf(file);
            expect(/import\s*\{[^}]*\bafterCommit\b[^}]*\}\s*from\s*['"]@\/lib\/notices['"]/.test(code), `${file} imports afterCommit from @/lib/notices`).toBe(true);
            const inside = callsOf(code, /\bafterCommit\(/g);
            expect(inside.length, `afterCommit( calls in ${file}`).toBeGreaterThan(0);
            hooks += inside.length;
            const events = [...code.matchAll(/\bnotice[A-Z]\w*\(/g)].length;
            const hooked = inside.reduce((sum, call) => sum + [...call.matchAll(/\bnotice[A-Z]\w*\(/g)].length, 0);
            expect(hooked, `event calls in ${file}, inside afterCommit`).toBeGreaterThan(0);
            expect(events, `event calls in ${file}: all of them, and the ones inside afterCommit`).toBe(hooked);
        }
        expect(hooks, 'afterCommit( calls in the twelve files (the design\'s hooks)').toBe(HOOKS);
    });
});

test.describe('Pins: what sends, and where', () => {
    test('Pins: the twelve hooked routes name no sender beyond STILL_NAMED, and the two that are real sends are still there', () => {
        for (const file of HOOKED) {
            const code = codeOf(file);
            const named = SENDERS.filter((sender) => names(code, sender));
            const allowed = STILL_NAMED[file] ?? [];
            expect(named.filter((sender) => !allowed.includes(sender)), `senders ${file} names that it did not name when the notices were hooked in`).toEqual([]);
        }
        for (const [file, sender] of NOT_NOTICES) {
            expect(names(codeOf(file), sender), `${file} still names ${sender} (take it out of STILL_NAMED and NOT_NOTICES if it does not)`).toBe(true);
        }
        for (const file of Object.keys(STILL_NAMED)) expect(HOOKED, `${file} of STILL_NAMED`).toContain(file);
    });

    test('Pins: only src/lib/notices.js reaches the e-mail and SMS modules for a notice; the templates and the events import none and name no sender', () => {
        for (const file of ['src/lib/notice-templates.js', 'src/lib/notice-events.js']) {
            const code = codeOf(file);
            expect(SENDER_MODULES.test(code), `${file} imports email.js, sms.js or push.js`).toBe(false);
            for (const sender of [...SENDERS, 'sendSMSResult']) expect(names(code, sender), `${file} names ${sender}`).toBe(false);
        }
        const code = codeOf('src/lib/notices.js');
        expect(/from\s+['"]\.\/email\.js['"]/.test(code), 'notices.js imports email.js').toBe(true);
        expect(/from\s+['"]\.\/sms\.js['"]/.test(code), 'notices.js imports sms.js').toBe(true);
        for (const sender of ['sendPushNotification', 'notifyUser']) expect(names(code, sender), `notices.js names ${sender}`).toBe(false);
        expect(/from\s+['"]\.\/push\.js['"]/.test(code), 'notices.js imports push.js').toBe(false);
    });
});

test.describe('Pins: the kinds', () => {
    test('Pins: NOTICE_KINDS, the keys of NOTICE_EVENTS and the kinds notice-events.js tells are one list, and no per-number cap names another kind', () => {
        expect(NOTICE_KINDS.length, 'the nine kinds').toBe(9);
        expect([...Object.keys(NOTICE_EVENTS)].sort()).toEqual([...NOTICE_KINDS].sort());
        const told = [...codeOf('src/lib/notice-events.js').matchAll(/\btell\(execute,\s*deps,\s*\{\s*kind:\s*'([a-z_]+)'/g)].map((match) => match[1]);
        expect(told.length, 'tell( calls the reading found').toBeGreaterThanOrEqual(NOTICE_KINDS.length);
        expect([...new Set(told)].sort(), 'the kinds notice-events.js passes to tell(').toEqual([...NOTICE_KINDS].sort());
        const capped = Object.keys(KIND_TEXTS_PER_NUMBER_DAY);
        expect(capped.length, 'kinds with a per-number cap').toBeGreaterThan(0);
        for (const kind of capped) expect(NOTICE_KINDS, `a per-number cap for ${kind}`).toContain(kind);
        // ENG-018 security B1: the kind's day for the platform and the e-mail's caps are keyed by kind too, and none names a kind that is not one.
        const tables = { KIND_TEXTS_PER_PLATFORM_DAY, KIND_MAILS_PER_ADDRESS_DAY, KIND_MAILS_PER_PLATFORM_DAY };
        for (const [table, caps] of Object.entries(tables)) {
            expect(Object.keys(caps).length, `kinds in ${table}`).toBeGreaterThan(0);
            for (const kind of Object.keys(caps)) expect(NOTICE_KINDS, `${table} names ${kind}`).toContain(kind);
        }
    });
});

test.describe('Pins: the e-mail transport', () => {
    test('Pins: no console call in email.js names the address, the subject, the body or the error, and the catch logs the error code and nothing more', () => {
        const calls = callsOf(codeOf('src/lib/email.js'), /\bconsole\.[a-z]+\(/g);
        expect(calls.some((call) => call.includes('send failed')), 'the log call in the catch is among the calls the reading found').toBe(true);
        expect(calls.length, 'console calls the reading found in src/lib/email.js').toBeGreaterThanOrEqual(3);
        for (const call of calls) {
            expect(call.includes('`'), `a template string can carry anything into the log: ${call}`).toBe(false);
            // Strings are blanked (a fixed text is allowed to say "to"); what is left is names, and the only ones allowed are the error's code and the message id.
            const used = call
                .replace(/(['"])(?:\\.|(?!\1).)*\1/g, '""')
                .replace(/\berror\??\.code\b/g, 'CODE')
                .replace(/\binfo\.messageId\b/g, 'MESSAGE_ID');
            expect(used, `the names a log call uses: ${call}`).not.toMatch(/\b(?:to|subject|html|text|error|info|from|transporter)\b/);
        }
    });

    test('Pins: email.js sets the three timeouts on the transport it creates, each far below the one nodemailer would use', () => {
        const code = codeOf('src/lib/email.js');
        const options = callsOf(code, /\bnodemailer\.createTransport\(/g);
        expect(options.length, 'createTransport( calls').toBe(1);
        const timeout = (name) => Number((new RegExp(`\\b${name}:\\s*([0-9_]+)\\b`).exec(options[0])?.[1] ?? 'NaN').replace(/_/g, ''));
        // nodemailer 8.0.1 waits 120000, 30000 and 600000 when these are not set.
        expect(timeout('connectionTimeout'), 'connectionTimeout').toBe(10000);
        expect(timeout('greetingTimeout'), 'greetingTimeout').toBe(10000);
        expect(timeout('socketTimeout'), 'socketTimeout').toBe(20000);
    });
});

test.describe('Pins: the environment', () => {
    test('Pins: .env.example names the ten variables a notice reads and gives none a value', () => {
        const lines = textOf('.env.example').split('\n').map((line) => line.replace(/\r$/, ''));
        for (const name of ENV_NAMES) {
            const assigning = lines.filter((line) => new RegExp(`^\\s*#?\\s*${name}\\s*=`).test(line));
            expect(assigning.length, `lines in .env.example that assign ${name}`).toBeGreaterThan(0);
            for (const line of assigning) expect(line.slice(line.indexOf('=') + 1).trim(), `the value on the line "${line}"`).toBe('');
            expect(lines.includes(`${name}=`), `${name}= on a line of its own, uncommented`).toBe(true);
        }
    });

    test('Pins: each of the ten variables is read by code under src/, so the list names real ones', () => {
        const code = sourceFiles('src').map((file) => codeOf(file)).join('\n');
        for (const name of ENV_NAMES) expect(names(code, name), `${name} in src/ outside comments`).toBe(true);
    });
});

test.describe('Pins: the retention sweep', () => {
    test('Pins: runCrewRetention calls pruneNotices and puts its count in the summary as notice_rows', () => {
        const code = codeOf('src/lib/crew-retention.js');
        expect(code).toMatch(/import\s*\{[^}]*\bpruneNotices\b[^}]*\}\s*from\s*['"]\.\/notices\.js['"]/);
        expect(code).toMatch(/\bsummary\.notice_rows\s*=\s*await\s+pruneNotices\(execute\)/);
        const sweep = code.indexOf('function runCrewRetention');
        expect(sweep, 'runCrewRetention in src/lib/crew-retention.js').toBeGreaterThan(-1);
        expect(code.indexOf('pruneNotices(execute)'), 'the call is inside the sweep').toBeGreaterThan(sweep);
    });
});

test.describe('Pins: the link pages', () => {
    test('Pins: layout.js reads no seo_settings script on a link page and renders none of its four <Script> tags there', () => {
        const code = codeOf('src/app/layout.js');
        expect(code).toMatch(/import\s*\{\s*linkPageKind\s*\}\s*from\s*['"]@\/lib\/link-pages['"]/);
        expect(code).toMatch(/const\s+linkPage\s*=\s*linkPageKind\(rawPathname\)\s*!==\s*null/);
        expect([...code.matchAll(/getSeoForPath\(/g)].length, 'calls of getSeoForPath( in layout.js').toBe(1);
        expect(code).toMatch(/linkPage\s*\?\s*\{\s*headerScripts:\s*''\s*\}\s*:\s*await\s+getSeoForPath\(/);
        const gate = code.search(/\{\s*linkPage\s*\?\s*null\s*:/);
        expect(gate, 'the {linkPage ? null : ( ... )} gate round the <Script> tags').toBeGreaterThan(-1);
        const tags = [...code.matchAll(/<Script\b/g)].map((match) => match.index);
        expect(tags.length, '<Script> tags in layout.js').toBe(4);
        for (const at of tags) expect(at, 'offset of a <Script> tag, which must come after the gate').toBeGreaterThan(gate);
    });

    test('Pins: middleware.js puts the policy on the request, where Next finds the nonce, and on the response, with a nonce from crypto.getRandomValues', () => {
        const code = codeOf('src/middleware.js');
        expect(code).toMatch(/requestHeaders\.set\(\s*["']Content-Security-Policy["']\s*,\s*policy\s*\)/);
        expect(code).toMatch(/response\.headers\.set\(\s*["']Content-Security-Policy["']\s*,\s*policy\s*\)/);
        expect(code).toMatch(/\bcrypto\.getRandomValues\(/);
        expect(code, 'a nonce from Math.random').not.toMatch(/Math\.random/);
        expect(code).toMatch(/linkPagePolicy\(linkKind,\s*newNonce\(\)/);
    });

    test('Pins: linkPageKind answers job and card for the two prefixes with something after them, decoded once and lower-cased, and null for everything else', () => {
        expect(LINK_PAGE_PREFIXES).toEqual(['/job/', '/card/']);
        const vectors = [
            ['/job/abc', 'job'], ['/job/abc/', 'job'], ['/job/a/b', 'job'], ['/card/abc', 'card'], ['/card/abc/', 'card'],
            ['/JOB/abc', 'job'], ['/Card/abc', 'card'], ['/%6Aob/abc', 'job'], ['/job%2Fabc', 'job'], ['/%63ard/abc', 'card'],
            ['/job/%E0%A4%A', 'job'],
            ['/job/', null], ['/job', null], ['/card/', null], ['/card', null], ['/jobs/abc', null], ['/jobx/abc', null], ['/cards/abc', null],
            ['/admin/job/abc', null], ['/api/job/abc', null], ['/api/card/abc/setup', null], ['/', null], ['', null],
            ['/%256Aob/abc', null], ['/%E0%A4%A', null], ['//job/abc', null],
            [undefined, null], [null, null], [42, null], [{}, null],
        ];
        for (const [pathname, kind] of vectors) expect(linkPageKind(pathname), `linkPageKind(${JSON.stringify(pathname)})`).toBe(kind);
    });

    test('Pins: linkPagePolicy gives the job page and the card page their one-line policy, the strict one unless it is told it is not production', () => {
        const nonce = 'AbC+123/xyz=';
        const common = [
            "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:",
        ];
        const job = [
            "default-src 'none'", `script-src 'self' 'nonce-${nonce}'`, ...common, "connect-src 'self'", "frame-src 'none'",
            "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "object-src 'none'",
        ].join('; ');
        const card = [
            "default-src 'none'", `script-src 'self' 'nonce-${nonce}' https://js.stripe.com`, ...common, "connect-src 'self' https://api.stripe.com",
            'frame-src https://js.stripe.com https://hooks.stripe.com',
            "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "object-src 'none'",
        ].join('; ');
        expect(linkPagePolicy('job', nonce)).toBe(job);
        expect(linkPagePolicy('card', nonce)).toBe(card);
        expect(linkPagePolicy('job', nonce, { production: true })).toBe(job);
        expect(linkPagePolicy('job', nonce, { production: false })).toBe(job.replace(`'nonce-${nonce}'`, `'nonce-${nonce}' 'unsafe-eval'`));
        expect(linkPagePolicy('card', nonce, { production: false })).toBe(card.replace('https://js.stripe.com;', "https://js.stripe.com 'unsafe-eval';"));
        for (const policy of [job, card]) {
            expect(policy.split(`'nonce-${nonce}'`).length - 1, 'the nonce appears once, in script-src').toBe(1);
            expect(policy, 'a wildcard source').not.toMatch(/(?:^|\s)\*(?:\s|;|$)/);
            expect(policy, 'an inline script allowed without the nonce').not.toMatch(/script-src[^;]*'unsafe-inline'/);
        }
        expect(job, 'the job policy names Stripe').not.toMatch(/stripe/i);
        expect(card.match(/https:\/\/[a-z.]+/g)).toEqual([
            'https://js.stripe.com', 'https://api.stripe.com', 'https://js.stripe.com', 'https://hooks.stripe.com',
        ]);
    });
});

test.describe('Pins: the card entry', () => {
    test('Pins: CardForm starts a new card entry after a confirm that failed at Stripe and stays on its form after a validation_error; the setup route does not claim the count guards against stolen cards', () => {
        const form = codeOf('src/components/card/CardForm.jsx');
        const refused = form.search(/result\.error\.type\s*===\s*['"]validation_error['"]/);
        expect(refused, "the test for Stripe.js's validation_error in CardEntry").toBeGreaterThan(-1);
        const retry = form.search(/onFailure\(\s*['"]retry['"]\s*,\s*result\.error\.message/);
        expect(retry, "onFailure('retry', ...) with Stripe's words in CardEntry").toBeGreaterThan(refused);
        expect(form.slice(refused, retry), 'the retry is the else of the validation_error test').toMatch(/\}\s*else\s*\{/);
        expect(form).toMatch(/next\s*===\s*['"]retry['"]\s*\)\s*\{\s*setNotice\(text\s*\|\|\s*NOT_SAVED_TEXT\);\s*setAttempt\(\(n\)\s*=>\s*n\s*\+\s*1\);/);
        const route = textOf('src/app/api/card/[token]/setup/route.js');
        expect(route).not.toMatch(/keeps a link from testing/);
        expect(route).toMatch(/not a guard against testing stolen card numbers/);
    });
});
