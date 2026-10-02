// @ts-check
// Coverage and wiring (ENG-020; ADR-003; ENG-004 design, Approach 4). They read files and the route matrix and send
// no request, so they need no app (the config's global setup still checks that one is up).
//
//  Auth coverage - routes: every route file and exported method under src/app/api is a row of
//    e2e/auth/route-matrix.js, and every row names a file and method that exist, so a route added later fails the
//    suite until someone classifies it, and a route removed fails until its row goes. One case per (method, route)
//    in either list, titled "<METHOD> <route> is in the matrix"; a route that only the code has, or only the
//    matrix has, is a failing case of that name. A route file that exports a method in any form but
//    `export async function METHOD` (a const, a re-export, a non-async function) fails its own case, so a new
//    form cannot slip past the count.
//  Auth wiring: every non-public row's file uses what the matrix says protects it. A `roles` row's file imports
//    requireCaller from '@/lib/api-auth' and the row's own method has the design's "two lines at the top of
//    each method", so a file that guards its GET does not turn its PUT green: `const auth = await
//    requireCaller(request, [the row's roles])` outside any comment, then `if (!auth.ok) return auth.response`
//    (see guardCallProblems: a call in a comment, a call whose result is ignored and a wrong roles list all fail).
//    A `self` row's file uses its named
//    check: verifyAiGatewayAuth, requireCronSecret, or the Stripe signature check. A `public` row needs nothing
//    and has no case. The `pending` row counts as classified for coverage, is annotated, and its wiring case is
//    skipped with the reason so every run prints it: nothing passes it silently, and AC5 does not hold while one
//    `pending` row remains (the matrix file's header says so).
// Until a route is converted its wiring case fails; those are the known failures in e2e/baseline.json that each
// converting ticket turns green.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { matrix } from './auth/route-matrix.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const API_DIR = path.join(ROOT, 'src', 'app', 'api');
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const METHOD_NAMES = METHODS.join('|');
const KINDS = ['roles', 'public', 'self', 'pending'];
const ROLE_NAMES = ['admin', 'customer', 'provider'];

// ---- what the code exports -----------------------------------------------------------------------------------

const toPosix = (p) => p.split(path.sep).join('/');

/** Every file under src/app/api whose name starts with "route.", as { file, route } (file relative to the repo). */
function routeFiles() {
    if (!fs.existsSync(API_DIR)) return [];
    return fs
        .readdirSync(API_DIR, { recursive: true, withFileTypes: false })
        .map((entry) => toPosix(String(entry)))
        .filter((entry) => /(^|\/)route\.[^/]+$/.test(entry))
        .sort()
        .map((entry) => ({
            file: `src/app/api/${entry}`,
            // A directory named [id] is the route's own [id] segment, as in Appendix A.
            route: `/api/${entry}`.replace(/\/route\.[^/]+$/, ''),
            isJs: /(^|\/)route\.js$/.test(entry),
        }));
}

/** The methods a file exports as `export async function METHOD`, in file order. */
function exportedMethods(source) {
    const found = [];
    const pattern = new RegExp(`^\\s*export\\s+async\\s+function\\s+(${METHOD_NAMES})\\b`, 'gm');
    for (const match of source.matchAll(pattern)) found.push(match[1]);
    return found;
}

/** Ways of exporting an HTTP method (or everything) that the count above would not see. */
function otherExportForms(source) {
    const forms = [];
    const named = new RegExp(`^\\s*export\\s+(?:default\\s+)?(?:function\\s*\\*?|const|let|var|class)\\s+(?:${METHOD_NAMES})\\b`, 'm');
    const list = new RegExp(`^\\s*export\\s*\\{[^}]*\\b(?:${METHOD_NAMES})\\b[^}]*\\}`, 'm');
    if (named.test(source)) forms.push('export const/let/var/function/class METHOD');
    if (list.test(source)) forms.push('export { ... METHOD ... }');
    if (/^\s*export\s*\*/m.test(source)) forms.push('export * from');
    return forms;
}

const files = routeFiles();
const sources = new Map(files.map((f) => [f.file, fs.readFileSync(path.join(ROOT, f.file), 'utf8')]));

/** key "METHOD /route" -> file, for every `export async function METHOD` in a route.js file. */
const inCode = new Map();
for (const f of files) {
    if (!f.isJs) continue;
    for (const method of exportedMethods(sources.get(f.file))) inCode.set(`${method} ${f.route}`, f.file);
}

const keyOf = (row) => `${row.method} ${row.route}`;
// The matrix's route strings already start with /api (Appendix A, verbatim), so the file is src/app<route>/route.js.
const fileOf = (row) => `src/app${row.route}/route.js`;
/** key -> first row with that key, so a duplicated row still gives one case title. */
const inMatrix = new Map();
for (const row of matrix) if (!inMatrix.has(keyOf(row))) inMatrix.set(keyOf(row), row);

// ---- wiring -----------------------------------------------------------------------------------------------------

const importsName = (source, name, from) =>
    new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*['"]${from}(?:\\.js)?['"]`).test(source);

/** The text of one exported method: from its signature to the next top-level declaration (or the end of the file). */
function methodText(source, method) {
    const start = source.search(new RegExp(`^export\\s+async\\s+function\\s+${method}\\b`, 'm'));
    if (start === -1) return null;
    const rest = source.slice(start);
    const afterSignature = rest.indexOf('\n') + 1;
    const next = rest.slice(afterSignature).search(/^(?:export\s|(?:async\s+)?function\s|const\s|let\s|var\s|class\s|import\s)/m);
    return next === -1 ? rest : rest.slice(0, afterSignature + next);
}

/** Code only: block comments and line comments taken out, so a guard call in a comment is not a guard call. A `//`
 *  that follows a colon, a quote or a backtick is kept (a URL in a string), so a string is never cut in half. */
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/.*$/gm, '$1');

/**
 * What the design's two lines at the top of a method have to look like (ENG-004 design, Interfaces):
 *     const auth = await requireCaller(request, ['admin']);
 *     if (!auth.ok) return auth.response;
 * Not enough, each of which passed the first form of this check (a bare look for `requireCaller(`) and is a route that
 * is open: the call only in a comment, the call without `await` or without keeping its result, the result kept but never
 * used to refuse, and a roles list that is not the row's. So it needs all of: the call outside any comment, awaited,
 * with the handler's own request, with a literal list that names exactly the row's roles, its result in a variable,
 * and `if (!<that variable>.ok) return <that variable>.response`. Returns the list of what is missing.
 */
function guardCallProblems(row, body) {
    const code = withoutComments(body);
    // The handler's own first parameter (`request` in every route today; the eight handlers that take none have to add it).
    const param = code.match(/^export\s+async\s+function\s+\w+\s*\(\s*(\w*)/)?.[1];
    if (!param) return [`${row.method} takes no request parameter to hand to requireCaller`];
    const call = code.match(new RegExp(`\\b(?:const|let)\\s+(\\w+)\\s*=\\s*await\\s+requireCaller\\s*\\(\\s*${param}\\s*,\\s*\\[([^\\]]*)\\]\\s*\\)`));
    if (!call) {
        return [`${row.method} does not have \`const auth = await requireCaller(${param}, [roles])\` outside a comment (awaited, a literal roles list, the result kept)`];
    }
    const problems = [];
    const [, result, list] = call;
    const named = list.split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean).sort();
    const want = [...row.roles].sort();
    if (named.join() !== want.join()) problems.push(`${row.method} calls requireCaller with [${named}] but the matrix says [${want}]`);
    if (!new RegExp(`\\bif\\s*\\(\\s*!\\s*${result}\\.ok\\s*\\)\\s*\\{?\\s*return\\s+${result}\\.response\\b`).test(code)) {
        problems.push(`${row.method} does not \`if (!${result}.ok) return ${result}.response\` after the guard call`);
    }
    return problems;
}

/** What the row's file has to contain; returns the list of what is missing. */
function wiringProblems(row, source) {
    const problems = [];
    const body = methodText(source, row.method);
    if (body === null) return [`the file does not export \`async function ${row.method}\``];

    if (row.kind === 'roles') {
        if (!importsName(source, 'requireCaller', '@/lib/api-auth')) problems.push("does not import requireCaller from '@/lib/api-auth'");
        problems.push(...guardCallProblems(row, body));
        return problems;
    }

    if (row.kind === 'self') {
        const text = String(row.self || '');
        if (/AI gateway/i.test(text)) {
            // File level: today the AI gateway PATCH handlers hand over to POST, which makes the call.
            if (!importsName(source, 'verifyAiGatewayAuth', '@/lib/ai-gateway-auth')) problems.push("does not import verifyAiGatewayAuth from '@/lib/ai-gateway-auth'");
            if (!/\bverifyAiGatewayAuth\s*\(/.test(source)) problems.push('never calls verifyAiGatewayAuth(request)');
        } else if (/CRON_SECRET/.test(text)) {
            if (!importsName(source, 'requireCronSecret', '@/lib/api-auth')) problems.push("does not import requireCronSecret from '@/lib/api-auth'");
            if (!/\brequireCronSecret\s*\(/.test(body)) problems.push(`${row.method} does not call requireCronSecret(request)`);
        } else if (/Stripe signature/i.test(text)) {
            if (!/\bwebhooks\.constructEvent\s*\(/.test(body)) problems.push(`${row.method} does not verify the Stripe signature (webhooks.constructEvent)`);
        } else {
            problems.push(`no wiring rule for the self-authenticating check "${text}": add one to e2e/auth-coverage.spec.js`);
        }
        return problems;
    }
    return [`no wiring rule for kind '${row.kind}'`];
}

// ---- the cases --------------------------------------------------------------------------------------------------

test.describe('Auth coverage - routes', () => {
    test('the route files are found and every row of the matrix is well formed', () => {
        expect(files.length, `no route file found under ${API_DIR}`).toBeGreaterThan(0);
        expect(inCode.size, 'no exported method found in the route files').toBeGreaterThan(0);
        const problems = [];
        const seen = new Set();
        for (const row of matrix) {
            const key = keyOf(row);
            if (seen.has(key)) problems.push(`${key}: listed twice`);
            seen.add(key);
            if (!METHODS.includes(row.method)) problems.push(`${key}: unknown method`);
            if (!KINDS.includes(row.kind)) problems.push(`${key}: unknown kind '${row.kind}'`);
            if (row.kind === 'roles' && !(Array.isArray(row.roles) && row.roles.length > 0 && row.roles.every((r) => ROLE_NAMES.includes(r)))) {
                problems.push(`${key}: roles must be a non-empty subset of ${ROLE_NAMES.join(', ')}`);
            }
        }
        expect(problems).toEqual([]);
    });

    test('no route file exports a method in a form the coverage count cannot see', () => {
        const offenders = [];
        for (const f of files) {
            if (!f.isJs) {
                offenders.push(`${f.file}: a route file that is not route.js (the matrix and these tests read route.js only)`);
                continue;
            }
            for (const form of otherExportForms(sources.get(f.file))) offenders.push(`${f.file}: ${form}`);
        }
        expect(offenders, 'use `export async function METHOD` (or extend this spec to read the new form)').toEqual([]);
    });

    const keys = [...new Set([...inCode.keys(), ...inMatrix.keys()])].sort((a, b) => {
        const [ma, ra] = a.split(' ');
        const [mb, rb] = b.split(' ');
        return ra === rb ? METHODS.indexOf(ma) - METHODS.indexOf(mb) : ra < rb ? -1 : 1;
    });

    for (const key of keys) {
        test(`${key} is in the matrix`, () => {
            const row = inMatrix.get(key);
            const file = inCode.get(key);
            if (!row) {
                throw new Error(`${file} exports ${key.split(' ')[0]} and the matrix has no row for ${key}: classify it in e2e/auth/route-matrix.js (public, self, or roles)`);
            }
            if (!file) {
                throw new Error(`the matrix has a row for ${key} but ${fileOf(row)} does not export \`async function ${row.method}\` (or does not exist): remove or fix the row`);
            }
            if (row.kind === 'pending') {
                // Classified, but not decided: said on every run and in the report, never a bare pass.
                console.log(`PENDING ${key}: ${row.pending}`);
                test.info().annotations.push({ type: 'pending', description: String(row.pending) });
            }
        });
    }
});

test.describe('Auth wiring', () => {
    // One case per non-public row, in the matrix's order. A row whose file is missing fails here as well as in coverage.
    for (const row of matrix.filter((r) => r.kind !== 'public')) {
        test(`${keyOf(row)} uses the guard`, () => {
            if (row.kind === 'pending') {
                console.log(`PENDING ${keyOf(row)}: ${row.pending}`);
                test.info().annotations.push({ type: 'pending', description: String(row.pending) });
                test.skip(true, `PENDING, not checked: ${row.pending}`);
                return;
            }
            const file = fileOf(row);
            const source = sources.get(file);
            expect(source, `${file} does not exist`).toBeDefined();
            const problems = wiringProblems(row, /** @type {string} */ (source));
            // One line, because the verdict reporter prints only the first line of an error.
            if (problems.length > 0) throw new Error(`${file}: ${problems.join('; ')}`);
        });
    }
});
