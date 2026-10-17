// The acceptance gate: reads a run's results and says, for each of the contract's twelve "How we'll know it worked"
// items, whether the suite shows it, and exits 1 when a hard-gate item is not shown.
//
//   npm run acceptance                          (reads test-results/baseline-candidate.json)
//   node e2e/acceptance/gate.js [--results FILE] [--map FILE] [--baseline FILE] [--partial] [--json] [--markdown] [--label TEXT]
//
// It reads the file the verdict reporter writes (`{ cases: { "<file> › <describe> › <title>": { outcome, error? } } }`), or
// any union of runs in that shape, and resolves the map in ./contract.js against e2e/baseline.json. It lives outside the run
// on purpose: a reporter sees one invocation and cannot tell a window of a long run from a complete one.
//
// Playwright already fails a run on any FAIL. A hard gate also goes unproven under a green run when the case that proved it
// was renamed or deleted, was skipped, only attempted, was never run, or the run was partial. Each of those reads NOT MET here.
//
// Exit status
//   0  no hard-gate item is NOT MET, and none DEPARTS unaccepted
//   1  a hard-gate item is NOT MET, or DEPARTS from the contract with no acceptance written into the map
//   2  the results file is missing or is not the reporter's shape: never a pass
//   3  the map is invalid (see validateMap)
// A non-hard item that is NOT MET is printed so and the exit stays 0: the contract needs only the hard gates for delivery,
// and the suite's own exit status still reports every FAIL.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ITEM_COUNT = 12;
export const DEFECT_COUNT = 9;
// The contract marks these five [hard gate]. A map that marks any other set is invalid, so editing the map cannot unmark one.
export const HARD_GATES = [2, 5, 9, 11, 12];
export const KINDS = ['live', 'in-process', 'attempt', 'departure'];
export const EXIT = { PASS: 0, HARD_GATE: 1, NO_RESULTS: 2, BAD_MAP: 3 };

const OUTCOMES = ['PASS', 'FAIL', 'ATTEMPTED', 'SKIPPED'];
// Worst first: an item takes the status of its worst clause.
const STATUS_ORDER = ['NOT MET', 'NOT RUN', 'DEPARTS', 'ATTEMPT-ONLY', 'MET (in-process)', 'MET'];
const here = path.dirname(fileURLToPath(import.meta.url));

const isText = (value) => typeof value === 'string' && value.trim() !== '';

/**
 * Everything wrong with a map; an empty list means the map can be judged.
 * @param {any} contract the module's exports: ITEMS, DEFECTS, NAMED_GAPS
 * @returns {string[]}
 */
export function validateMap(contract) {
    const { ITEMS, DEFECTS, NAMED_GAPS } = contract || {};
    if (![ITEMS, DEFECTS, NAMED_GAPS].every(Array.isArray)) return ['the map must export ITEMS, DEFECTS and NAMED_GAPS, each an array'];
    const problems = [];
    if (ITEMS.length !== ITEM_COUNT) problems.push(`the map holds ${ITEMS.length} items, the contract has ${ITEM_COUNT}`);
    if (DEFECTS.length !== DEFECT_COUNT) problems.push(`the map holds ${DEFECTS.length} defects, the contract lists ${DEFECT_COUNT}`);
    const numbers = ITEMS.map((item) => item.n);
    for (let n = 1; n <= ITEM_COUNT; n += 1) {
        if (numbers.filter((number) => number === n).length !== 1) problems.push(`item ${n} must appear exactly once`);
    }
    const hard = ITEMS.filter((item) => item.hard).map((item) => item.n).sort((a, b) => a - b);
    if (hard.join() !== HARD_GATES.join()) problems.push(`the hard gates are ${hard.join(', ') || 'none'}, the contract marks ${HARD_GATES.join(', ')}`);

    const ids = new Set();
    for (const item of ITEMS) {
        if (!isText(item.says)) problems.push(`item ${item.n} has no words from the contract`);
        if (!Array.isArray(item.clauses) || item.clauses.length === 0) problems.push(`item ${item.n} has no clause`);
        for (const clause of item.clauses || []) {
            const where = `clause ${clause.id ?? '(no id)'} of item ${item.n}`;
            if (!new RegExp(`^W${item.n}\\.[A-Za-z0-9-]+$`).test(clause.id ?? '')) problems.push(`${where}: the id must be W${item.n}.<slug>`);
            if (ids.has(clause.id)) problems.push(`${where}: the id is used twice`);
            ids.add(clause.id);
            if (!isText(clause.says)) problems.push(`${where}: it has no words`);
            const kind = clause.kind ?? 'live';
            if (!KINDS.includes(kind)) problems.push(`${where}: kind "${kind}" is none of ${KINDS.join(', ')}`);
            if (!Array.isArray(clause.cases) || clause.cases.length === 0) problems.push(`${where}: it names no case`);
            for (const pattern of clause.cases || []) {
                if (!(pattern instanceof RegExp)) problems.push(`${where}: a case pattern is not a regular expression`);
                // A global or sticky pattern keeps a position between test() calls and would skip keys.
                else if (pattern.global || pattern.sticky) problems.push(`${where}: a case pattern carries the g or y flag`);
            }
            const departure = clause.departure;
            if (kind === 'departure') {
                if (!departure || !isText(departure.what) || !isText(departure.from)) problems.push(`${where}: a departure needs { what, from, accepted } in plain words`);
                else if (departure.accepted !== null && !(isText(departure.accepted?.by) && isText(departure.accepted?.on) && isText(departure.accepted?.ref))) {
                    problems.push(`${where}: accepted is null or { by, on, ref }, all text`);
                }
            } else if (departure) {
                problems.push(`${where}: only a departure clause carries a departure`);
            }
        }
    }
    const eleven = ITEMS.find((item) => item.n === 11);
    const wanted = DEFECTS.map((defect) => `W11.D${defect.n}`).join();
    if (eleven && (eleven.clauses || []).map((clause) => clause.id).join() !== wanted) problems.push(`item 11 must hold one clause per defect (${wanted})`);
    for (const gap of NAMED_GAPS) {
        if (!isText(gap.key) || gap.outcome !== 'SKIPPED' || !isText(gap.because)) problems.push(`a named gap needs a key, outcome "SKIPPED" and the reason (${gap.key ?? 'no key'})`);
    }
    return problems;
}

/**
 * Reads a results file. Throws when it is not the reporter's shape.
 * @param {string} text
 */
export function parseResults(text) {
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error('the results file is not JSON');
    }
    const cases = data?.cases;
    if (!cases || typeof cases !== 'object' || Array.isArray(cases)) throw new Error('the results file has no "cases" object: it is not the verdict reporter\'s file');
    for (const [key, result] of Object.entries(cases)) {
        if (!OUTCOMES.includes(result?.outcome)) throw new Error(`the results file gives "${key}" the outcome "${result?.outcome}", not one of ${OUTCOMES.join(', ')}`);
    }
    return /** @type {{ cases: Record<string, { outcome: string, error?: string }> }} */ (data);
}

const worst = (statuses) => STATUS_ORDER.find((status) => statuses.includes(status)) ?? 'MET';

/**
 * One clause, first row that applies (the design's table). `problems` lists every reason, so one run names every broken case.
 */
function judge(clause, universe, cases, gaps, partial) {
    const kind = clause.kind ?? 'live';
    const matched = universe.filter((key) => clause.cases.some((pattern) => pattern.test(key)));
    const verdict = { id: clause.id, says: clause.says, kind, matched: matched.length, problems: [], namedGaps: [], attempted: 0, accepted: null, departure: null };
    if (matched.length === 0) return { ...verdict, status: 'NOT MET', problems: ['no case matches (renamed or deleted)'] };

    let unread = 0;
    for (const key of matched) {
        const result = cases[key];
        if (!result) {
            unread += 1;
        } else if (result.outcome === 'FAIL') {
            verdict.problems.push(`FAIL: ${key}`);
        } else if (result.outcome === 'SKIPPED') {
            if (gaps.has(key)) verdict.namedGaps.push({ key, because: gaps.get(key).because });
            else verdict.problems.push(`skipped: ${key}`);
        } else if (result.outcome === 'ATTEMPTED') {
            if (kind === 'attempt') verdict.attempted += 1;
            else verdict.problems.push(`attempt where ${kind} was declared: ${key}`);
        }
    }
    if (unread > 0 && !partial) verdict.problems.push(`no result: ${unread} case${unread === 1 ? '' : 's'}`);
    if (verdict.problems.length > 0) return { ...verdict, status: 'NOT MET' };
    if (unread > 0) return { ...verdict, status: 'NOT RUN', problems: [`no result: ${unread} case${unread === 1 ? '' : 's'} (partial run)`] };

    if (kind === 'departure') return { ...verdict, status: 'DEPARTS', departure: clause.departure, accepted: clause.departure.accepted };
    if (verdict.attempted > 0) return { ...verdict, status: 'ATTEMPT-ONLY' };
    return { ...verdict, status: kind === 'in-process' ? 'MET (in-process)' : 'MET' };
}

/**
 * @param {any} contract a valid map (see validateMap)
 * @param {string[]} universe every case key the clauses can resolve against: the baseline's keys and the results' keys
 * @param {{ cases: Record<string, { outcome: string, error?: string }> }} results
 * @param {{ partial?: boolean }} [options] partial: a case with no result is NOT RUN and not NOT MET (a window of a longer run)
 */
export function evaluate(contract, universe, results, { partial = false } = {}) {
    const gaps = new Map(contract.NAMED_GAPS.map((gap) => [gap.key, gap]));
    const items = contract.ITEMS.map((item) => {
        const clauses = item.clauses.map((clause) => judge(clause, universe, results.cases, gaps, partial));
        const status = worst(clauses.map((clause) => clause.status));
        const unaccepted = clauses.filter((clause) => clause.status === 'DEPARTS' && !clause.accepted).map((clause) => clause.id);
        const blocking = item.hard && (status === 'NOT MET' || unaccepted.length > 0);
        return { n: item.n, hard: Boolean(item.hard), says: item.says, status, clauses, blocking, unaccepted };
    });
    const blockingItems = items.filter((item) => item.blocking).map((item) => item.n);
    return { partial, items, blockingItems, exit: blockingItems.length > 0 ? EXIT.HARD_GATE : EXIT.PASS };
}

// ---- output ----------------------------------------------------------------------------------------------------------------

const statusText = (clause) => (clause.status === 'DEPARTS' && clause.accepted ? `DEPARTS (accepted ${clause.accepted.on})` : clause.status);

function itemStatusText(item) {
    if (item.status === 'NOT MET' && !item.hard) return 'NOT MET (not a hard gate)';
    const departing = item.clauses.find((clause) => clause.status === 'DEPARTS');
    return item.status === 'DEPARTS' && departing && departing.accepted && item.unaccepted.length === 0 ? statusText(departing) : item.status;
}

function renderText(report, header) {
    const lines = [header, ''];
    lines.push(`${'#'.padStart(2)}  ${'gate'.padEnd(4)}  ${'status'.padEnd(26)}  clauses  the contract says`);
    for (const item of report.items) {
        const met = item.clauses.filter((clause) => clause.status === 'MET' || clause.status === 'MET (in-process)').length;
        const words = item.says.length > 78 ? `${item.says.slice(0, 75)}...` : item.says;
        lines.push(`${String(item.n).padStart(2)}  ${(item.hard ? 'HARD' : '').padEnd(4)}  ${itemStatusText(item).padEnd(26)}  ${`${met}/${item.clauses.length}`.padEnd(7)}  ${words}`);
        for (const clause of item.clauses.filter((candidate) => candidate.status !== 'MET')) {
            lines.push(`        ${clause.id}  ${statusText(clause)}`);
            for (const problem of clause.problems) lines.push(`            ${problem}`);
            if (clause.status === 'ATTEMPT-ONLY') lines.push(`            ${clause.attempted} of ${clause.matched} cases end in an attempt row: ${clause.says}`);
            if (clause.status === 'MET (in-process)') lines.push(`            run in the test process with a stand-in, not against the live service: ${clause.says}`);
            if (clause.status === 'DEPARTS') {
                lines.push(`            ${clause.departure.what}`);
                lines.push(`            the contract says: ${clause.departure.from}`);
                lines.push(clause.accepted ? `            accepted by ${clause.accepted.by} on ${clause.accepted.on} (${clause.accepted.ref})` : '            NOT ACCEPTED: close it, or write who accepted it into the map');
            }
        }
        for (const clause of item.clauses.filter((candidate) => candidate.namedGaps.length > 0)) {
            lines.push(`        ${clause.id}  MET with ${clause.namedGaps.length} named gap${clause.namedGaps.length === 1 ? '' : 's'}`);
            for (const gap of clause.namedGaps) lines.push(`            ${gap.because}`);
        }
    }
    lines.push('');
    if (report.partial) {
        const unread = report.items.reduce((sum, item) => sum + item.clauses.filter((clause) => clause.status === 'NOT RUN').length, 0);
        lines.push(`PARTIAL RUN: ${unread} clause${unread === 1 ? '' : 's'} NOT RUN. This is not a verdict; the last word is a complete run.`);
    }
    lines.push(report.exit === EXIT.PASS ? 'HARD GATES: none NOT MET and none departing unaccepted' : `HARD GATES: BLOCKED by item${report.blockingItems.length === 1 ? '' : 's'} ${report.blockingItems.join(', ')}`);
    return lines.join('\n');
}

function renderMarkdown(report, label, caseCount) {
    const lines = [`Gate table for ${label || 'an unlabelled run'}, read from ${caseCount} cases.`, ''];
    lines.push('| Item | Hard gate | Status | Live | With a stand-in | Attempt only | Departs | Not met | The contract says |');
    lines.push('|---|---|---|---|---|---|---|---|---|');
    const count = (item, test) => item.clauses.filter(test).length;
    for (const item of report.items) {
        const cells = [
            count(item, (clause) => clause.status === 'MET'),
            count(item, (clause) => clause.status === 'MET (in-process)'),
            count(item, (clause) => clause.status === 'ATTEMPT-ONLY'),
            count(item, (clause) => clause.status === 'DEPARTS'),
            count(item, (clause) => clause.status === 'NOT MET' || clause.status === 'NOT RUN'),
        ];
        lines.push(`| W${item.n} | ${item.hard ? 'yes' : ''} | ${itemStatusText(item)} | ${cells.join(' | ')} | ${item.says.replace(/\|/g, '\\|')} |`);
    }
    const defects = report.items.find((item) => item.n === 11);
    if (defects) {
        lines.push('', '| Defect | Status | The contract says |', '|---|---|---|');
        for (const clause of defects.clauses) lines.push(`| ${clause.id.replace('W11.', '')} | ${statusText(clause)} | ${clause.says.replace(/\|/g, '\\|')} |`);
    }
    const departures = report.items.flatMap((item) => item.clauses.filter((clause) => clause.status === 'DEPARTS'));
    if (departures.length > 0) {
        lines.push('', 'Where the build departs from the contract:', '');
        for (const clause of departures) {
            const decision = clause.accepted ? `accepted by ${clause.accepted.by} on ${clause.accepted.on} (${clause.accepted.ref})` : 'not yet accepted or closed';
            lines.push(`* ${clause.id}: ${clause.departure.what} The contract says: ${clause.departure.from} (${decision}.)`);
        }
    }
    const gaps = report.items.flatMap((item) => item.clauses.flatMap((clause) => clause.namedGaps.map((gap) => `${clause.id}: ${gap.because}`)));
    if (gaps.length > 0) {
        lines.push('', 'Cases the dev environment cannot run, skipped by name:', '');
        for (const gap of gaps) lines.push(`* ${gap}`);
    }
    return lines.join('\n');
}

// ---- command line ----------------------------------------------------------------------------------------------------------

function parseArgs(argv) {
    const args = { results: 'test-results/baseline-candidate.json', map: path.join(here, 'contract.js'), baseline: path.join(here, '..', 'baseline.json'), partial: false, json: false, markdown: false, label: '' };
    for (let i = 0; i < argv.length; i += 1) {
        const flag = argv[i];
        if (flag === '--partial' || flag === '--json' || flag === '--markdown') args[flag.slice(2)] = true;
        else if (['--results', '--map', '--baseline', '--label'].includes(flag)) args[flag.slice(2)] = argv[(i += 1)] ?? '';
        else throw new Error(`unknown argument ${flag}`);
    }
    return args;
}

export async function main(argv) {
    let args;
    try {
        args = parseArgs(argv);
    } catch (error) {
        console.error(`acceptance gate: ${error.message}`);
        return EXIT.BAD_MAP;
    }

    let contract;
    try {
        contract = await import(pathToFileURL(path.resolve(args.map)).href);
    } catch (error) {
        console.error(`acceptance gate: the map ${args.map} does not load (${error.message})`);
        return EXIT.BAD_MAP;
    }
    const problems = validateMap(contract);
    if (problems.length > 0) {
        console.error(`acceptance gate: the map is invalid:\n${problems.map((problem) => `  ${problem}`).join('\n')}`);
        return EXIT.BAD_MAP;
    }

    let results;
    try {
        results = parseResults(fs.readFileSync(args.results, 'utf8'));
    } catch (error) {
        console.error(`acceptance gate: no verdict, ${error.code === 'ENOENT' ? `${args.results} does not exist; run the suite first` : error.message}`);
        return EXIT.NO_RESULTS;
    }
    let baselineKeys = [];
    try {
        baselineKeys = Object.keys(JSON.parse(fs.readFileSync(args.baseline, 'utf8')).cases);
    } catch (error) {
        console.error(`acceptance gate: ${args.baseline} could not be read as the baseline (${error.message})`);
        return EXIT.NO_RESULTS;
    }
    const universe = [...new Set([...baselineKeys, ...Object.keys(results.cases)])];

    const report = evaluate(contract, universe, results, { partial: args.partial });
    const caseCount = Object.keys(results.cases).length;
    if (args.json) console.log(JSON.stringify(report, (key, value) => (value instanceof RegExp ? value.source : value), 2));
    else if (args.markdown) console.log(renderMarkdown(report, args.label, caseCount));
    else console.log(renderText(report, `acceptance gate: ${args.results} holds ${caseCount} cases; baseline ${baselineKeys.length}; map ${path.relative(process.cwd(), path.resolve(args.map))}`));
    return report.exit;
}

// Run as a command and not imported by a spec: process.argv[1] is this file only then.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).then((code) => {
        process.exitCode = code;
    });
}
