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
//  Auth wiring: every non-public row's file uses what the matrix says protects it, checked by reading its text
//    (wiringProblems; no request is sent). A `roles` row's file imports requireCaller from '@/lib/api-auth' (row g6) and
//    the method, as `methodText` cuts it, holds the design's "two lines at the top of each method" anywhere in it (rows c1, c2,
//    g12), so a file that guards its GET does not turn its PUT green (row g5): `const auth = await requireCaller(request,
//    [the row's roles])`, then `if (!auth.ok) return auth.response` (guardCallProblems' doc names the row of each piece). A
//    `self` row's file uses its named check: requireCronSecret (rows g8, g9, r1cron) or the Stripe signature check (rows g10,
//    g11, r1stripe); for verifyAiGatewayAuth a call anywhere in the file counts (row g13, a false pass). A `public` row needs
//    nothing and has no case. The `pending` row counts as classified for coverage, is annotated, and its wiring case is
//    skipped with the reason so every run prints it: nothing passes it silently, and AC5 does not hold while one `pending`
//    row remains (the matrix file's header says so). What the check reads right and wrong is the table `wiringShapes` (above
//    the cases), one row per shape with the verdict it gets, run by the case "the wiring check gives every shape of the
//    table its verdict": a sentence in this file about what the check catches or misses names a row of it.
// Until a route is converted its wiring case fails (row c1: an unguarded method is reported); those are the known failures
// in e2e/baseline.json that each converting ticket turns green.
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
    if (/^\s*export\s+(?:const|let|var)\s*[[{]/m.test(source)) forms.push('export const/let/var { ... } or [ ... ] (a destructuring export)');
    return forms;
}

// ---- what the coverage count says about each shape ---------------------------------------------------------------
// One row per shape of an `export` in a route file: the file text, the methods `exportedMethods` lists for it (`counted`), whether
// `otherExportForms` names it (`flagged`) and a label that says whether that is the right answer. The case "no route file exports a
// method in a form the coverage count cannot see" fails with the id of every row whose counted or flagged differs. Ids: e1 a form the
// count cannot see and the case flags, e2 a control, e3 to e6 shapes it does not read (e5 reads too much).
const exportShapes = [
    { id: 'e1', label: 'a destructuring export of two methods: not counted, flagged', source: 'export const { GET, POST } = handlers;\n', counted: [], flagged: true },
    { id: 'e2', label: "an `export const dynamic` line beside a GET: the GET is counted, nothing is flagged (control)", source: "export const dynamic = 'force-dynamic';\nexport async function GET(request) {\n  return 1;\n}\n", counted: ['GET'], flagged: false },
    { id: 'e3', label: 'a block comment before `export` on its line: false pass, not caught (layout: something before `export` on its line)', source: '/* d */ export async function GET(request) {\n  return 1;\n}\n', counted: [], flagged: false },
    { id: 'e4', label: 'an escape written in the name, `\\u0047ET`: false pass, not caught (deliberate: an escape in the name)', source: 'export async function \\u0047ET(request) {\n  return 1;\n}\n', counted: [], flagged: false },
    { id: 'e5', label: 'a name that begins with the method, `GET$`: counted as GET, over-read: a spurious key, loud when the matrix has no row for it', source: 'export async function GET$(request) {\n  return 1;\n}\n', counted: ['GET'], flagged: false },
    { id: 'e6', label: 'a second name in one exported declaration, `export const a = 1, GET = ...`: false pass, not caught (layout: a second name in one exported declaration)', source: 'export const a = 1, GET = async (request) => Response.json({});\n', counted: [], flagged: false },
];

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
 * `export async function <method>` at column 0 up to, not including, the earliest line after it that starts a boundary, looked for in
 * `code` and in `raw` (the same file with its comments in place; blanking keeps every offset, so one offset serves both). A boundary is
 * `export`, `function`, `async function` or `function*` at any indentation, or `const`, `let`, `var`, `class`, `import` or `}` at column 0.
 * Null when `code` has no such signature (rows f1 and x5).
 * What each part of the rule is for, by the rows that fail without it: looking in `raw` as well as `code`, rows s1 to s5, s7, s8, f2, r1g and n3;
 * the indented search in `code`, rows r1a, r1cron and r1stripe (a comment blanked in front of an `export`), in `raw`, rows r1g and n3;
 * the `}` at column 0, row b1.
 * What it costs: a nested function declaration, or an indented `export` in a block comment, above the guard ends the cut early, so a
 * guarded method reads as unguarded, loudly (rows n1, n3).
 * What it guarantees: for a `roles`, cron or Stripe row whose method's closing `}` starts its line at column 0 (row b1), whose own text holds no
 * `requireCaller`, `requireCronSecret` or `constructEvent` at all, and with no guard text or `export ... function` signature written into a string,
 * template, regex literal or comment anywhere in the file, the check reports the method: `raw` is never blanked, so the method's own `}` ends the cut
 * at or before it, and blanking only hides text, so it can hide a guard (loudly) and never make one appear.
 * What it does not read: after a closing brace that does not start its line, an indented `const` helper (row t2) or a second method on the same line (row t1) does not end the cut: false passes, not caught.
 */
function methodText(code, method, raw) {
    const start = code.search(new RegExp(`^export\\s+async\\s+function\\s+${method}\\s*\\(`, 'm'));
    if (start === -1) return null;
    const rest = code.slice(start);
    const afterSignature = rest.search(/[\n\r\u2028\u2029]/) + 1;
    const boundary = /^(?:export\s|(?:async\s+)?function[\s*]|const\s|let\s|var\s|class\s|import\s|\})/m;
    const indented = /^[ \t]*(?:export\s|(?:async\s+)?function[\s*])/m;
    const ends = [rest.slice(afterSignature).search(boundary), rest.slice(afterSignature).search(indented)];
    if (raw !== undefined) ends.push(raw.slice(start + afterSignature).search(boundary), raw.slice(start + afterSignature).search(indented));
    const found = ends.filter((n) => n !== -1);
    return found.length === 0 ? rest : rest.slice(0, afterSignature + Math.min(...found));
}

/** A comment with every character but its newlines replaced by a space: what is left has the comment's length and lines. */
const blank = (c) => c.replace(/[^\n]/g, ' ');

/** `text` with its comments blanked, not deleted, so an offset in the result is the same offset in `text`. Three regular
 *  expressions, not a parser. What it reads right and wrong is the table `wiringShapes`, run by the case "the wiring check
 *  gives every shape of the table its verdict": rows c4, s1 to s8, s14, g6, f1, f2 and x1 to x6. */
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/^\s*\/\/.*$/gm, blank).replace(/([^:'"`])\/\/.*$/gm, (m, ch) => ch + blank(m.slice(1)));

/**
 * The design's two lines at the top of a method (ENG-004 design, Interfaces):
 *     const auth = await requireCaller(request, ['admin']);
 *     if (!auth.ok) return auth.response;
 * What is reported when a piece of them is missing, by row: the call only in a comment (rows c4, x6), without `await` (g1), without keeping its
 * result (g2), the result kept but never used to refuse (g3), or the refusal testing another variable (g16), a roles list that is not the row's
 * (g4 another role, g15 a role more) or not written out in brackets (g14), a request that is not the handler's own first parameter (g7), a handler
 * that takes no parameter (g17). The row's roles in the row's own order are the row's roles (g18). `code` is the method's text as `methodText` returns it.
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
    // the cron and Stripe calls are looked for in the method's text as `methodText` cuts it (rows g5, g9, g11; past a closing
    // brace that does not start its line, t1, t2), the imports in the blanked file (row g6), the AI gateway call anywhere in the
    // blanked file (row g13). What else the check reads right and wrong is the table `wiringShapes`.
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

// ---- what the wiring check says about each shape ----------------------------------------------------------------
// One row per shape: the matrix row and the file text it is run on, the verdict `wiringProblems` gives it ('REPORTED' when it
// returns a problem, 'clean' when it returns none) and a label that says whether that is the right answer; `says`, when a row has
// it, is text the problems must contain. The case "the wiring check gives every shape of the table its verdict" fails with the id
// of every row whose verdict differs or whose problems lack its `says`. Ids: s shapes, c controls, f false failures, x more shapes
// (ENG-020 round 3 escalation), g the guard's own pieces and the self checks, r a one-line method or an indented neighbour, b the closing
// brace (b3 to b5: with its lines ended by CR, U+2028 or U+2029), p a longer name that begins with the method's, j text that is not code,
// n false failures the indented search costs, t layout or names it does not read.
// Nothing in this section uses a name defined outside it.

const imp = "import { requireCaller } from '@/lib/api-auth';\n";
const getRow = { kind: 'roles', method: 'GET', roles: ['admin'] };
const postRow = { kind: 'roles', method: 'POST', roles: ['admin'] };
const guard = "  const auth = await requireCaller(request, ['admin']);\n  if (!auth.ok) return auth.response;\n";
const ung = (line) => `export async function GET(request) {\n  ${line}\n  return Response.json({ ok: true });\n}\n\n`;
const getWith = (lines) => `export async function GET(request) {\n${lines}  return 1;\n}\n`;
const postBlock = "export async function POST(request) {\n  /* admin only */\n" + guard + "  return Response.json({ ok: true });\n}\n";
const helper = (indent, kw = 'async function') => `${indent}${kw} adminOnly(request) {\n${indent}  /* helper */\n${guard}}\n`;
const handler = (name, body = '') => `export async function ${name}(request) {\n${body}  return Response.json({ ok: true });\n}\n`;
const cronImp = "import { requireCronSecret } from '@/lib/api-auth';\n";
const cronCall = "  const denied = requireCronSecret(request);\n  if (denied) return denied;\n";
const cronRow = { kind: 'self', method: 'GET', self: 'CRON_SECRET, made fail-closed' };
const stripeCall = "  const event = stripe.webhooks.constructEvent(body, signature, secret);\n";
const stripeRow = { kind: 'self', method: 'POST', self: 'Stripe signature, verified before any branch (unchanged)' };
const gatewayRow = { kind: 'self', method: 'GET', self: 'AI gateway key (unchanged)' };
const oneLine = (name) => `export async function ${name}(request) { return Response.json({ ok: true }); }\n\n`;

const wiringShapes = [
    { id: 's1', label: "unguarded GET holds 'image/*', guarded POST below with a block comment in its body: must be reported", row: getRow, source: imp + ung("const a = 'image/*';") + postBlock, verdict: 'REPORTED' },
    { id: 's2', label: 'same as s1, the GET holds the line comment // accepts image/*: must be reported', row: getRow, source: imp + ung('// accepts image/*') + postBlock, verdict: 'REPORTED' },
    { id: 's3', label: "same as s1, the GET holds a URL string 'https://x.test/*': must be reported", row: getRow, source: imp + ung("const u = 'https://x.test/*';") + postBlock, verdict: 'REPORTED' },
    { id: 's4', label: 'same as s1, the GET holds the regex literal /^\\/*$/: must be reported', row: getRow, source: imp + ung('const re = /^\\/*$/;') + postBlock, verdict: 'REPORTED' },
    { id: 's5', label: 'same as s1, the GET holds a template literal with ${base}/*: must be reported', row: getRow, source: imp + ung('const t = `${base}/*`;') + postBlock, verdict: 'REPORTED' },
    { id: 's6', label: 'unguarded GET holds a template literal with ${base}//x (a line cut only), guarded POST below: must be reported', row: getRow, source: imp + ung('const t = `${base}//x`;') + postBlock, verdict: 'REPORTED' },
    { id: 's7', label: 'same as s1, the GET holds a double-quoted "*/*": must be reported', row: getRow, source: imp + ung('const h = "*/*";') + postBlock, verdict: 'REPORTED' },
    { id: 's8', label: "unguarded GET holds 'image/*', then a column-0 helper holding the guard text after a block comment: must be reported", row: getRow, source: imp + ung("const a = 'image/*';") + helper(''), verdict: 'REPORTED' },
    { id: 's9', label: 'unguarded GET, then a guarded POST indented two spaces: must be reported', row: getRow, source: imp + ung('return 1;') + postBlock.replace(/^export/, '  export'), verdict: 'REPORTED' },
    { id: 's10', label: 'unguarded GET, then a guarded `/** x */ export async function POST` on one line: must be reported', row: getRow, source: imp + ung('return 1;') + '/** x */ ' + postBlock, verdict: 'REPORTED' },
    { id: 's11', label: 'unguarded GET, then an indented helper holding the guard text: must be reported', row: getRow, source: imp + ung('return 1;') + helper('  '), verdict: 'REPORTED' },
    { id: 's12', label: 'unguarded GET, then a function* helper holding the guard text: must be reported', row: getRow, source: imp + ung('return 1;') + helper('', 'function*'), verdict: 'REPORTED' },
    { id: 's13', label: 'guard text written into a string in an unguarded GET: false pass, deliberate shape, not caught', row: getRow, source: imp + "export async function GET(request) {\n  const s = \"const auth = await requireCaller(request, ['admin']); if (!auth.ok) return auth.response;\";\n  return Response.json({ s });\n}\n", verdict: 'clean' },
    { id: 's14', label: 'guard text in a line comment glued to a quote in an unguarded GET: false pass, deliberate shape, not caught', row: getRow, source: imp + "export async function GET(request) {\n  const x = 'a'// const auth = await requireCaller(request, ['admin']); if (!auth.ok) return auth.response;\n  return Response.json({ x });\n}\n", verdict: 'clean' },
    { id: 's15', label: 'unguarded GET whose closing brace shares its last line, then a column-0 function* helper holding the guard text: must be reported', row: getRow, source: imp + 'export async function GET(request) {\n  return 1; }\nfunction* adminOnly(request) {\n  /* helper */\n' + guard + '}\n', verdict: 'REPORTED' },
    { id: 'c1', label: 'control, unguarded GET alone: must be reported', row: getRow, source: imp + ung('return 1;'), verdict: 'REPORTED' },
    { id: 'c2', label: 'control, guarded GET alone: must read as guarded', row: getRow, source: imp + "export async function GET(request) {\n" + guard + "  return Response.json({ ok: true });\n}\n", verdict: 'clean' },
    { id: 'c3', label: 'control, guarded GET after a JSDoc: must read as guarded', row: getRow, source: imp + "/** doc */\nexport async function GET(request) {\n" + guard + "  return 1;\n}\n", verdict: 'clean' },
    { id: 'c4', label: 'a block-commented guarded copy of GET above the live unguarded GET: must be reported', row: getRow, source: imp + "/*\nexport async function GET(request) {\n" + guard + "}\n*/\n" + ung('return 1;'), verdict: 'REPORTED' },
    { id: 'f1', label: "guarded GET holds 'image/*' after its guard, guarded POST with a block comment in its body, POST's row: false failure, loud", row: postRow, source: imp + "export async function GET(request) {\n" + guard + "  const a = 'image/*';\n  return 1;\n}\n\n" + postBlock, verdict: 'REPORTED', says: 'does not export `async function POST`' },
    { id: 'f2', label: "guarded GET holds 'image/*' before its guard, guarded POST with a block comment in its body, GET's row: false failure, loud", row: getRow, source: imp + "export async function GET(request) {\n  const a = 'image/*';\n" + guard + "  return 1;\n}\n\n" + postBlock, verdict: 'REPORTED', says: 'does not have `const auth = await requireCaller(' },
    { id: 'x1', label: 'guarded GET, a regex literal ending in \\// on the line above its guard: must read as guarded', row: getRow, source: imp + getWith('  const re = /^https?:\\/\\//;\n' + guard), verdict: 'clean' },
    { id: 'x2', label: "guarded GET, 'a//b' on the line above its guard: must read as guarded", row: getRow, source: imp + getWith("  const s = 'a//b';\n" + guard), verdict: 'clean' },
    { id: 'x3', label: "guarded GET, 'http://x'; before the guard on the guard's own line: must read as guarded", row: getRow, source: imp + "export async function GET(request) {\n  const u = 'http://x'; const auth = await requireCaller(request, ['admin']);\n  if (!auth.ok) return auth.response;\n}\n", verdict: 'clean' },
    { id: 'x4', label: 'guarded GET, /* and */ inside one template literal above its guard: must read as guarded', row: getRow, source: imp + getWith('  const css = `a /* b */ c`;\n' + guard), verdict: 'clean' },
    { id: 'x5', label: 'guarded GET glued to a closer, /* doc */export async function GET: false failure, loud', row: getRow, source: imp + "/* doc */export async function GET(request) {\n" + guard + "}\n", verdict: 'REPORTED', says: 'does not export `async function GET`' },
    { id: 'x6', label: 'unguarded GET, the guard written in // comments on their own lines: must be reported', row: getRow, source: imp + "export async function GET(request) {\n  // const auth = await requireCaller(request, ['admin']);\n  // if (!auth.ok) return auth.response;\n  return 1;\n}\n", verdict: 'REPORTED' },
    { id: 'g1', label: 'the guard call without await: must be reported', row: getRow, source: imp + getWith("  const auth = requireCaller(request, ['admin']);\n  if (!auth.ok) return auth.response;\n"), verdict: 'REPORTED' },
    { id: 'g2', label: 'the call awaited but its result not kept: must be reported', row: getRow, source: imp + getWith("  await requireCaller(request, ['admin']);\n"), verdict: 'REPORTED' },
    { id: 'g3', label: 'the result kept but never used to refuse (no if (!auth.ok) return auth.response): must be reported', row: getRow, source: imp + getWith("  const auth = await requireCaller(request, ['admin']);\n"), verdict: 'REPORTED' },
    { id: 'g4', label: "the call names ['customer'] and the row says ['admin']: must be reported", row: getRow, source: imp + getWith(guard.replace("'admin'", "'customer'")), verdict: 'REPORTED' },
    { id: 'g5', label: "a guarded GET above an unguarded PUT, the PUT's row: must be reported", row: { kind: 'roles', method: 'PUT', roles: ['admin'] }, source: imp + getWith(guard) + '\n' + handler('PUT'), verdict: 'REPORTED' },
    { id: 'g6', label: 'a guarded GET whose only import of requireCaller is in a line comment: must be reported', row: getRow, source: "// import { requireCaller } from '@/lib/api-auth';\n" + getWith(guard), verdict: 'REPORTED' },
    { id: 'g7', label: "the call hands over req, the handler's own first parameter is request: must be reported", row: getRow, source: imp + getWith("  const auth = await requireCaller(req, ['admin']);\n  if (!auth.ok) return auth.response;\n"), verdict: 'REPORTED' },
    { id: 'g8', label: 'cron row: GET imports and calls requireCronSecret: must read as guarded', row: cronRow, source: cronImp + handler('GET', cronCall), verdict: 'clean' },
    { id: 'g9', label: 'cron row: GET has no call, the POST below it has one: must be reported', row: cronRow, source: cronImp + handler('GET') + '\n' + handler('POST', cronCall), verdict: 'REPORTED' },
    { id: 'g10', label: 'Stripe row: POST calls webhooks.constructEvent: must read as guarded', row: stripeRow, source: handler('POST', stripeCall), verdict: 'clean' },
    { id: 'g11', label: 'Stripe row: POST has no call, the GET below it has one: must be reported', row: stripeRow, source: handler('POST') + '\n' + handler('GET', stripeCall), verdict: 'REPORTED' },
    { id: 'g12', label: "GET queries the database before its guard: not caught, the guard need not be the method's first statement", row: getRow, source: imp + getWith("  const rows = await db.query('SELECT 1');\n" + guard), verdict: 'clean' },
    { id: 'g13', label: 'AI gateway row: POST calls verifyAiGatewayAuth(request), GET does not: false pass, file level by design (the PATCH handlers hand over to POST), not caught', row: gatewayRow, source: "import { verifyAiGatewayAuth } from '@/lib/ai-gateway-auth';\n" + handler('POST', '  const auth = verifyAiGatewayAuth(request);\n  if (!auth.ok) return auth.response;\n') + '\n' + handler('GET'), verdict: 'clean' },
    { id: 'g14', label: 'the roles passed as a variable, requireCaller(request, ROLES), not as a list in brackets: false failure, loud', row: getRow, source: imp + getWith('  const auth = await requireCaller(request, ROLES);\n  if (!auth.ok) return auth.response;\n'), verdict: 'REPORTED', says: 'a literal roles list' },
    { id: 'r1a', label: 'a one-line unguarded GET, then a guarded `/** x */ export async function POST` on one line: must be reported', row: getRow, source: imp + oneLine('GET') + '/** x */ export async function POST(request) {\n' + guard + '  return 1;\n}\n', verdict: 'REPORTED' },
    { id: 'r1b', label: 'a one-line unguarded GET, then a guarded POST indented two spaces: must be reported', row: getRow, source: imp + oneLine('GET') + '  export async function POST(request) {\n' + guard + '  return 1;\n  }\n', verdict: 'REPORTED' },
    { id: 'r1c', label: 'a one-line unguarded GET, then an indented helper holding the guard text: must be reported', row: getRow, source: imp + oneLine('GET') + '  async function adminOnly(request) {\n' + guard + '  }\n', verdict: 'REPORTED' },
    { id: 'r1g', label: 'a one-line unguarded GET holding "*/*" (its `/*` opens a block comment that ends in the helper\'s own comment), then an indented helper holding the guard text: must be reported', row: getRow, source: imp + 'export async function GET(request) { const h = "*/*"; return Response.json({ h }); }\n\n  async function adminOnly(request) {\n  /* helper */\n' + guard + '  }\n', verdict: 'REPORTED' },
    { id: 'r1cron', label: 'cron row: a one-line GET with no call, then a `/** x */ export async function POST` that calls requireCronSecret: must be reported', row: cronRow, source: cronImp + oneLine('GET') + '/** x */ export async function POST(request) {\n' + cronCall + '  return 1;\n}\n', verdict: 'REPORTED' },
    { id: 'r1stripe', label: 'Stripe row: a one-line POST with no check, then a `/** x */ export async function GET` that calls webhooks.constructEvent: must be reported', row: stripeRow, source: oneLine('POST') + '/** x */ export async function GET(request) {\n' + stripeCall + '  return 1;\n}\n', verdict: 'REPORTED' },
    { id: 'n1', label: 'a guarded GET with a nested function declaration above its guard: false failure, loud', row: getRow, source: imp + 'export async function GET(request) {\n  function pick(x) { return x; }\n' + guard + '  return 1;\n}\n', verdict: 'REPORTED', says: 'does not have `const auth = await requireCaller(' },
    { id: 'n3', label: 'a guarded GET with an indented export inside a block comment above its guard: false failure, loud', row: getRow, source: imp + 'export async function GET(request) {\n  /*\n  export async function OLD(request) {}\n  */\n' + guard + '  return 1;\n}\n', verdict: 'REPORTED', says: 'does not have `const auth = await requireCaller(' },
    { id: 't1', label: 'an unguarded one-line GET and a guarded POST on the same line: false pass, not caught (layout: the closing brace is not alone at column 0)', row: getRow, source: imp + "export async function GET(request) { return Response.json({ ok: true }); } export async function POST(request) { const auth = await requireCaller(request, ['admin']); if (!auth.ok) return auth.response; return 1; }\n", verdict: 'clean' },
    { id: 't2', label: 'an unguarded one-line GET, then an indented const arrow function holding the guard text: false pass, not caught (layout: the closing brace is not alone at column 0)', row: getRow, source: imp + oneLine('GET') + '  const adminOnly = async (request) => {\n' + guard + '  };\n', verdict: 'clean' },
    { id: 'b1', label: 'an unguarded GET closed by a `}` alone at column 0, then an indented const arrow function holding the guard text: must be reported', row: getRow, source: imp + ung('return 1;') + '  const adminOnly = async (request) => {\n' + guard + '  };\n', verdict: 'REPORTED' },
    { id: 'g15', label: "the call names ['admin', 'customer'] and the row says ['admin']: a role more, must be reported", row: getRow, source: imp + getWith(guard.replace("['admin']", "['admin', 'customer']")), verdict: 'REPORTED', says: 'but the matrix says' },
    { id: 'g16', label: 'the call keeps its result in auth and the refusal tests another variable, if (!x.ok) return x.response: must be reported', row: getRow, source: imp + getWith("  const auth = await requireCaller(request, ['admin']);\n  if (!x.ok) return x.response;\n"), verdict: 'REPORTED', says: 'does not `if (!auth.ok) return auth.response`' },
    { id: 'g17', label: 'a handler that takes no parameter, the guard written with request: must be reported', row: getRow, source: imp + 'export async function GET() {\n' + guard + '  return 1;\n}\n', verdict: 'REPORTED', says: 'takes no request parameter' },
    { id: 'g18', label: "row roles ['customer', 'admin'], the call names ['customer', 'admin']: the row's own order, must read as guarded", row: { kind: 'roles', method: 'GET', roles: ['customer', 'admin'] }, source: imp + getWith(guard.replace("['admin']", "['customer', 'admin']")), verdict: 'clean' },
    { id: 'p1cron', label: 'cron row: a `GET$` helper that calls requireCronSecret, exported above the real GET, which has no call: must be reported', row: cronRow, source: cronImp + handler('GET$', cronCall) + '\n' + handler('GET'), verdict: 'REPORTED' },
    { id: 'p1stripe', label: 'Stripe row: a `POST$` helper that calls webhooks.constructEvent, exported above the real POST, which has no check: must be reported', row: stripeRow, source: handler('POST$', stripeCall) + '\n' + handler('POST'), verdict: 'REPORTED' },
    { id: 'p1roles', label: 'a guarded `GET$` helper exported above the real GET, which has no guard: must be reported', row: getRow, source: imp + handler('GET$', guard) + '\n' + handler('GET'), verdict: 'REPORTED', says: 'does not have `const auth = await requireCaller(' },
    { id: 'b2', label: "an unguarded GET holding 'image/*' closed by a `}` alone at column 0 (blanked in the comment-free text), then an indented const arrow function with a block comment and the guard text: must be reported", row: getRow, source: imp + ung("const a = 'image/*';") + '  const adminOnly = async (request) => {\n  /* helper */\n' + guard + '  };\n', verdict: 'REPORTED' },
    { id: 'j1', label: "cron row: JSX text holding a column-0 signature line and requireCronSecret(request), above the real GET, which has no call: false pass, deliberate shape (text that is not code), not caught", row: cronRow, source: cronImp + "function Doc() {\n  return (<pre>\nexport async function GET(request) {'{'}\n  requireCronSecret(request)\n</pre>);\n}\n\n" + handler('GET'), verdict: 'clean' },
    { id: 'b3', label: 'b1 with every line ended by a lone CR and one final LF: must be reported', row: getRow, source: (imp + ung('return 1;') + '  const adminOnly = async (request) => {\n' + guard + '  };').replace(/\n/g, '\r') + '\n', verdict: 'REPORTED' },
    { id: 'b4', label: 'b1 with every line ended by U+2028 and one final LF: must be reported', row: getRow, source: (imp + ung('return 1;') + '  const adminOnly = async (request) => {\n' + guard + '  };').replace(/\n/g, '\u2028') + '\n', verdict: 'REPORTED' },
    { id: 'b5', label: 'b1 with every line ended by U+2029 and one final LF: must be reported', row: getRow, source: (imp + ung('return 1;') + '  const adminOnly = async (request) => {\n' + guard + '  };').replace(/\n/g, '\u2029') + '\n', verdict: 'REPORTED' },
    { id: 't3', label: 'cron row: GET calls helpers.requireCronSecret(request), another function with the guard name: false pass, not caught (names, not bindings)', row: cronRow, source: cronImp + handler('GET', '  const denied = helpers.requireCronSecret(request);\n  if (denied) return denied;\n'), verdict: 'clean' },
];

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
        for (const s of exportShapes) {
            if (exportedMethods(s.source).join() !== s.counted.join() || (otherExportForms(s.source).length > 0) !== s.flagged) offenders.push(`row ${s.id}: ${s.label}`);
        }
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

    test('the wiring check gives every shape of the table its verdict', () => {
        const ids = wiringShapes.map((s) => s.id);
        const repeated = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
        // One line, because the verdict reporter prints only the first line of an error.
        if (repeated.length > 0) throw new Error(`wiringShapes lists ${repeated.join(', ')} more than once`);
        const wrong = [];
        for (const s of wiringShapes) {
            const found = wiringProblems(s.row, s.source);
            const got = found.length > 0 ? 'REPORTED' : 'clean';
            if (got !== s.verdict) wrong.push(`${s.id} ${s.label}: wanted ${s.verdict}, got ${got}`);
            else if (s.says !== undefined && !found.some((line) => line.includes(s.says))) wrong.push(`${s.id} ${s.label}: the problems do not say "${s.says}"`);
        }
        if (wrong.length > 0) throw new Error(`${wrong.length} of ${wiringShapes.length} shapes got another verdict: ${wrong.join(' | ')}`);
    });
});
