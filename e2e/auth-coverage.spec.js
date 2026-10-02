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

/**
 * The text of one exported method, cut from `code` (the file with its comments blanked): from the line that holds
 * `export async function <method>` at column 0 up to, not including, the earliest line after it that starts at column 0
 * with `export`, `function`, `async function`, `function*`, `const`, `let`, `var`, `class`, `import` or `}`, looked for in
 * `code` and in `raw` (the same file with its comments in place; blanking keeps every offset, so one offset serves both).
 * With no such line, to the end of the file. Null when `code` has no such signature. What each part of the end rule is
 * for: looking in `raw` as well, rows s1 to s5, s7 and s8; the closing brace and `function*`, rows s9 to s12.
 */
function methodText(code, method, raw) {
    const start = code.search(new RegExp(`^export\\s+async\\s+function\\s+${method}\\b`, 'm'));
    if (start === -1) return null;
    const rest = code.slice(start);
    const afterSignature = rest.indexOf('\n') + 1;
    const boundary = /^(?:export\s|(?:async\s+)?function[\s*]|const\s|let\s|var\s|class\s|import\s|\})/m;
    const ends = [rest.slice(afterSignature).search(boundary)];
    if (raw !== undefined) ends.push(raw.slice(start + afterSignature).search(boundary));
    const found = ends.filter((n) => n !== -1);
    return found.length === 0 ? rest : rest.slice(0, afterSignature + Math.min(...found));
}

/** A comment with every character but its newlines replaced by a space: what is left has the comment's length and lines. */
const blank = (c) => c.replace(/[^\n]/g, ' ');

/** `text` with its comments blanked, not deleted, so an offset in the result is the same offset in `text`. Three regular
 *  expressions, not a parser. What it reads right and wrong is the table `wiringShapes`, run by the case "the wiring check
 *  gives every shape of the table its verdict": rows c4, s1 to s8, s13, s14, f1, f2 and x1 to x6. */
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/^\s*\/\/.*$/gm, blank).replace(/([^:'"`])\/\/.*$/gm, (m, ch) => ch + blank(m.slice(1)));

/**
 * The design's two lines at the top of a method (ENG-004 design, Interfaces):
 *     const auth = await requireCaller(request, ['admin']);
 *     if (!auth.ok) return auth.response;
 * What is reported when a piece of them is missing, by row: the call only in a comment (rows c4, x6), without `await` (g1),
 * without keeping its result (g2), the result kept but never used to refuse (g3), a roles list that is not the row's (g4),
 * a request that is not the handler's own first parameter (g7). `code` is the method's text as `methodText` returns it.
 * Returns the list of what is missing.
 */
function guardCallProblems(row, code) {
    // The handler's own first parameter.
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

/** The problems found in one row's file text, as a list of lines: empty is the verdict `clean` of the table `wiringShapes`, any line `REPORTED`. */
function wiringProblems(row, source) {
    const problems = [];
    // The file's comments are blanked first and the method is cut from the blanked text, with `source` as a second place to
    // look for its end (methodText). A guard call that only a comment holds is not found (rows c4, x6). The roles guard and
    // the cron and Stripe calls are looked for in the method's own text (rows g5, g9, g11), the imports in the blanked file
    // (row g6), the AI gateway call anywhere in the blanked file (row g13). What else the check reads right and wrong is the
    // table `wiringShapes`.
    const code = withoutComments(source);
    const methodCode = methodText(code, row.method, source);
    if (methodCode === null) return [`the file does not export \`async function ${row.method}\``];

    if (row.kind === 'roles') {
        if (!importsName(code, 'requireCaller', '@/lib/api-auth')) problems.push("does not import requireCaller from '@/lib/api-auth'");
        problems.push(...guardCallProblems(row, methodCode));
        return problems;
    }

    if (row.kind === 'self') {
        const text = String(row.self || '');
        if (/AI gateway/i.test(text)) {
            // File level: a call anywhere in the file is enough (row g13, a false pass).
            if (!importsName(code, 'verifyAiGatewayAuth', '@/lib/ai-gateway-auth')) problems.push("does not import verifyAiGatewayAuth from '@/lib/ai-gateway-auth'");
            if (!/\bverifyAiGatewayAuth\s*\(/.test(code)) problems.push('never calls verifyAiGatewayAuth(request)');
        } else if (/CRON_SECRET/.test(text)) {
            if (!importsName(code, 'requireCronSecret', '@/lib/api-auth')) problems.push("does not import requireCronSecret from '@/lib/api-auth'");
            if (!/\brequireCronSecret\s*\(/.test(methodCode)) problems.push(`${row.method} does not call requireCronSecret(request)`);
        } else if (/Stripe signature/i.test(text)) {
            if (!/\bwebhooks\.constructEvent\s*\(/.test(methodCode)) problems.push(`${row.method} does not verify the Stripe signature (webhooks.constructEvent)`);
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
