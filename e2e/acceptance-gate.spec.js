// @ts-check
// The acceptance gate (e2e/acceptance/gate.js) read against the real map (e2e/acceptance/contract.js) and the real baseline (e2e/baseline.json).
// No app, no database, no browser: the gate is a function over a results file, and each case below breaks one thing in a run that is otherwise
// all PASS and requires the verdict to say so, so a gate that cannot fail is caught here and not in front of the client. The cases that run the
// command write their files under a temp directory and read the verdict from the child's exit status. Each title starts with "Gate:", and the
// file's name, the describe and the title together are its baseline key.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, expect } from '@playwright/test';
import * as contract from './acceptance/contract.js';
import { EXIT, HARD_GATES, evaluate, parseResults, validateMap } from './acceptance/gate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const gatePath = path.join(here, 'acceptance', 'gate.js');
const contractPath = path.join(here, 'acceptance', 'contract.js');
const baselinePath = path.join(here, 'baseline.json');
/** @type {{ cases: Record<string, { outcome: string, error?: string }> }} */
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const keys = Object.keys(baseline.cases);
const approval = { by: 'the drill', on: '2000-01-01', ref: 'acceptance-gate.spec.js' };

/** A run in which nothing is wrong: every key PASS.
 * @param {string[]} universe */
const everythingPasses = (universe) => ({ cases: Object.fromEntries(universe.map((key) => [key, { outcome: 'PASS' }])) });

/** The results with one key given another outcome.
 * @param {{ cases: Record<string, { outcome: string }> }} results
 * @param {string} key
 * @param {string} outcome */
const having = (results, key, outcome) => ({ cases: { ...results.cases, [key]: { outcome } } });

/** The keys a clause's patterns match, in baseline order.
 * @param {{ cases: RegExp[] }} clause
 * @param {string[]} [universe] */
const matchedBy = (clause, universe = keys) => universe.filter((key) => clause.cases.some((pattern) => pattern.test(key)));

/** The real map with its departures given `accepted`: null (open) or who accepted them.
 * @param {null | { by: string, on: string, ref: string }} accepted */
function mapDepartingWith(accepted) {
    return {
        ...contract,
        ITEMS: contract.ITEMS.map((item) => ({
            ...item,
            clauses: item.clauses.map((clause) => (clause.kind === 'departure' ? { ...clause, departure: { ...clause.departure, accepted } } : clause)),
        })),
    };
}

const accepting = mapDepartingWith(approval);
const allClauses = contract.ITEMS.flatMap((item) => item.clauses);
/** @param {{ items: { clauses: any[] }[] }} report
 * @param {string} id */
const clauseResult = (report, id) => report.items.flatMap((item) => item.clauses).find((clause) => clause.id === id);
/** @param {number} n */
const itemOf = (n) => /** @type {NonNullable<(typeof contract.ITEMS)[number]>} */ (contract.ITEMS.find((item) => item.n === n));

/** The last line of a command's output.
 * @param {string} text */
const lastLine = (text) => text.trimEnd().split('\n').pop();

/**
 * Runs the command on files in a temp directory; the directory is gone after `body`. `run` starts gate.js by its real path; `runVia` starts the
 * command by any other path to the same file (a link, a linked folder, the name without ".js").
 * @param {(dir: string, run: (args: string[]) => import('node:child_process').SpawnSyncReturns<string>, runVia: (script: string, args: string[]) => import('node:child_process').SpawnSyncReturns<string>) => void} body
 */
function inTempDir(body) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-gate-'));
    /** @type {(script: string, args: string[]) => import('node:child_process').SpawnSyncReturns<string>} */
    const runVia = (script, args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd: dir });
    try {
        body(dir, (args) => runVia(gatePath, args), runVia);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/** A map file that is the real one with its departures accepted, for the command to load.
 * @param {string} dir */
function writeAcceptingMap(dir) {
    const file = path.join(dir, 'accepting-map.mjs');
    fs.writeFileSync(
        file,
        [
            `import * as real from ${JSON.stringify(pathToFileURL(contractPath).href)};`,
            'export const DEFECTS = real.DEFECTS;',
            'export const NAMED_GAPS = real.NAMED_GAPS;',
            `const accepted = ${JSON.stringify(approval)};`,
            'export const ITEMS = real.ITEMS.map((item) => ({ ...item, clauses: item.clauses.map((clause) => (clause.kind === \'departure\' ? { ...clause, departure: { ...clause.departure, accepted } } : clause)) }));',
            '',
        ].join('\n'),
    );
    return file;
}

/**
 * @param {string} dir
 * @param {string} name
 * @param {unknown} content
 */
function writeFile(dir, name, content) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
    return file;
}

test.describe('Acceptance gate: the contract map and the command that reads a run against it', () => {
    test('Gate: the map holds twelve items and nine defects, and the hard gates are exactly 2, 5, 9, 11 and 12', () => {
        expect(validateMap(contract)).toEqual([]);
        expect(contract.ITEMS.map((item) => item.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
        expect(contract.DEFECTS.map((defect) => defect.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        // Written out here on purpose: unmarking a hard gate in the map is then an edit to this test as well.
        expect(contract.ITEMS.filter((item) => item.hard).map((item) => item.n)).toEqual([2, 5, 9, 11, 12]);
        expect(HARD_GATES).toEqual([2, 5, 9, 11, 12]);
        expect(itemOf(11).clauses.map((clause) => clause.id)).toEqual(['W11.D1', 'W11.D2', 'W11.D3', 'W11.D4', 'W11.D5', 'W11.D6', 'W11.D7', 'W11.D8', 'W11.D9']);
    });

    test('Gate: every pattern in the map matches at least one case of the baseline, and every named gap is a case it records as skipped', () => {
        const unmatched = allClauses.flatMap((clause) => clause.cases.filter((pattern) => !keys.some((key) => pattern.test(key))).map((pattern) => `${clause.id}: ${pattern}`));
        expect(unmatched).toEqual([]);
        const stale = contract.NAMED_GAPS.filter((gap) => baseline.cases[gap.key]?.outcome !== 'SKIPPED').map((gap) => gap.key);
        expect(stale).toEqual([]);
    });

    test('Gate: the baseline read as the results leaves no item NOT MET, and each clause reads as far as its kind allows', () => {
        const report = evaluate(accepting, keys, baseline);
        expect(report.items.filter((item) => item.status === 'NOT MET').map((item) => item.n)).toEqual([]);
        expect(report.exit).toBe(EXIT.PASS);
        /** @type {Record<string, string[]>} */
        const allowed = { live: ['MET'], 'in-process': ['MET (in-process)'], attempt: ['ATTEMPT-ONLY', 'MET'], departure: ['DEPARTS'] };
        const wrong = allClauses.filter((clause) => !allowed[clause.kind ?? 'live'].includes(clauseResult(report, clause.id).status)).map((clause) => `${clause.id}: ${clauseResult(report, clause.id).status}`);
        expect(wrong).toEqual([]);
    });

    for (const n of HARD_GATES) {
        test(`Gate: item ${n} (hard gate): any one clause whose first case FAILs makes the item NOT MET, names the clause, and blocks`, () => {
            const passing = everythingPasses(keys);
            expect(evaluate(accepting, keys, passing).exit).toBe(EXIT.PASS);
            for (const clause of itemOf(n).clauses) {
                const [first] = matchedBy(clause);
                const report = evaluate(accepting, keys, having(passing, first, 'FAIL'));
                expect(clauseResult(report, clause.id).status, clause.id).toBe('NOT MET');
                expect(clauseResult(report, clause.id).problems.join('\n'), clause.id).toContain(`FAIL: ${first}`);
                expect(report.items.find((item) => item.n === n)?.status, clause.id).toBe('NOT MET');
                expect(report.blockingItems, clause.id).toContain(n);
                expect(report.exit, clause.id).toBe(EXIT.HARD_GATE);
            }
        });
    }

    for (const n of HARD_GATES) {
        test(`Gate: item ${n} (hard gate): a clause whose cases are renamed or deleted is NOT MET, and blocks`, () => {
            for (const clause of itemOf(n).clauses) {
                const gone = new Set(matchedBy(clause));
                const universe = keys.filter((key) => !gone.has(key));
                const report = evaluate(accepting, universe, everythingPasses(universe));
                expect(clauseResult(report, clause.id).status, clause.id).toBe('NOT MET');
                expect(clauseResult(report, clause.id).problems, clause.id).toEqual(['no case matches (renamed or deleted)']);
                expect(report.blockingItems, clause.id).toContain(n);
                expect(report.exit, clause.id).toBe(EXIT.HARD_GATE);
            }
        });
    }

    test('Gate: a skipped case that is not a named gap is NOT MET, and a named gap is MET and shown with its reason', () => {
        const clause = allClauses.find((candidate) => candidate.id === 'W9.assign-directly');
        const [first] = matchedBy(clause);
        const skipped = evaluate(accepting, keys, having(everythingPasses(keys), first, 'SKIPPED'));
        expect(clauseResult(skipped, 'W9.assign-directly').status).toBe('NOT MET');
        expect(clauseResult(skipped, 'W9.assign-directly').problems).toEqual([`skipped: ${first}`]);
        expect(skipped.exit).toBe(EXIT.HARD_GATE);

        expect(contract.NAMED_GAPS.length).toBeGreaterThan(0);
        const asRecorded = evaluate(accepting, keys, baseline);
        for (const gap of contract.NAMED_GAPS) {
            const holding = allClauses.filter((candidate) => candidate.cases.some((pattern) => pattern.test(gap.key)));
            expect(holding.length, gap.key).toBeGreaterThan(0);
            for (const candidate of holding) {
                const result = clauseResult(asRecorded, candidate.id);
                expect(result.status, candidate.id).toBe('MET');
                expect(result.namedGaps, candidate.id).toContainEqual({ key: gap.key, because: gap.because });
            }
        }
    });

    test('Gate: an attempt where a live proof was declared is NOT MET, and in an attempt clause it is ATTEMPT-ONLY until the case passes', () => {
        const live = allClauses.find((candidate) => candidate.id === 'W9.assign-directly');
        const [liveKey] = matchedBy(live);
        const attempted = evaluate(accepting, keys, having(everythingPasses(keys), liveKey, 'ATTEMPTED'));
        expect(clauseResult(attempted, 'W9.assign-directly').status).toBe('NOT MET');
        expect(clauseResult(attempted, 'W9.assign-directly').problems).toEqual([`attempt where live was declared: ${liveKey}`]);
        expect(attempted.exit).toBe(EXIT.HARD_GATE);

        const attempt = allClauses.find((candidate) => candidate.id === 'W10.job-booked');
        expect(attempt.kind).toBe('attempt');
        const [attemptKey] = matchedBy(attempt);
        expect(clauseResult(evaluate(accepting, keys, having(everythingPasses(keys), attemptKey, 'ATTEMPTED')), 'W10.job-booked').status).toBe('ATTEMPT-ONLY');
        expect(clauseResult(evaluate(accepting, keys, having(everythingPasses(keys), attemptKey, 'PASS')), 'W10.job-booked').status).toBe('MET');
        expect(clauseResult(evaluate(accepting, keys, having(everythingPasses(keys), attemptKey, 'FAIL')), 'W10.job-booked').status).toBe('NOT MET');
    });

    test('Gate: a case with no result is NOT MET, and NOT RUN under --partial, which is not a verdict', () => {
        const clause = allClauses.find((candidate) => candidate.id === 'W9.assign-directly');
        const [first] = matchedBy(clause);
        const results = everythingPasses(keys);
        delete results.cases[first];
        const whole = evaluate(accepting, keys, results);
        expect(clauseResult(whole, 'W9.assign-directly').status).toBe('NOT MET');
        expect(clauseResult(whole, 'W9.assign-directly').problems).toEqual(['no result: 1 case']);
        expect(whole.exit).toBe(EXIT.HARD_GATE);

        const window = evaluate(accepting, keys, results, { partial: true });
        expect(window.partial).toBe(true);
        expect(clauseResult(window, 'W9.assign-directly').status).toBe('NOT RUN');
        expect(window.exit).toBe(EXIT.PASS);
        // A window still fails on what it did read.
        const [other] = matchedBy(allClauses.find((candidate) => candidate.id === 'W9.push-to-marketplace'));
        expect(evaluate(accepting, keys, having(results, other, 'FAIL'), { partial: true }).exit).toBe(EXIT.HARD_GATE);
    });

    test('Gate: a case that is not a hard gate and FAILs is NOT MET and the verdict still exits 0', () => {
        const clause = allClauses.find((candidate) => candidate.id === 'W1.live-price');
        const [first] = matchedBy(clause);
        const report = evaluate(accepting, keys, having(everythingPasses(keys), first, 'FAIL'));
        expect(itemOf(1).hard).toBe(false);
        expect(report.items.find((item) => item.n === 1)?.status).toBe('NOT MET');
        expect(report.blockingItems).toEqual([]);
        expect(report.exit).toBe(EXIT.PASS);
    });

    test('Gate: a departure reads DEPARTS while its pin passes, blocks in a hard item until it is accepted, and is NOT MET when its pin FAILs', () => {
        const passing = everythingPasses(keys);
        const open = evaluate(mapDepartingWith(null), keys, passing);
        const departing = clauseResult(open, 'W5.one-door');
        expect(departing.status).toBe('DEPARTS');
        expect(departing.accepted).toBeNull();
        expect(open.items.find((item) => item.n === 5)?.status).toBe('DEPARTS');
        expect(open.blockingItems).toEqual([5]);
        expect(open.exit).toBe(EXIT.HARD_GATE);

        const closed = evaluate(mapDepartingWith(approval), keys, passing);
        expect(clauseResult(closed, 'W5.one-door').status).toBe('DEPARTS');
        expect(clauseResult(closed, 'W5.one-door').accepted).toEqual(approval);
        expect(closed.blockingItems).toEqual([]);
        expect(closed.exit).toBe(EXIT.PASS);

        const [pin] = matchedBy(allClauses.find((candidate) => candidate.id === 'W5.one-door'));
        const failed = evaluate(mapDepartingWith(approval), keys, having(passing, pin, 'FAIL'));
        expect(clauseResult(failed, 'W5.one-door').status).toBe('NOT MET');
        expect(failed.exit).toBe(EXIT.HARD_GATE);
    });

    test('Gate: on the real map and the recorded baseline the exit is 1 exactly when a departure has no acceptance', () => {
        const report = evaluate(contract, keys, baseline);
        const unaccepted = allClauses.filter((clause) => clause.kind === 'departure' && !clause.departure.accepted).map((clause) => clause.id);
        expect(report.items.filter((item) => item.unaccepted.length > 0).flatMap((item) => item.unaccepted)).toEqual(unaccepted);
        expect(report.exit).toBe(unaccepted.length > 0 ? EXIT.HARD_GATE : EXIT.PASS);
    });

    test('Gate: a map that unmarks a hard gate, repeats an id, names no case or a sticky pattern, or departs without saying how is refused', () => {
        /** @param {(items: any[]) => any[]} change */
        const problemsAfter = (change) => validateMap({ ...contract, ITEMS: change(structuredCloneItems()) });
        function structuredCloneItems() {
            return contract.ITEMS.map((item) => ({ ...item, clauses: item.clauses.map((clause) => ({ ...clause })) }));
        }
        const withItem = (n, change) => (items) => items.map((item) => (item.n === n ? change(item) : item));

        expect(problemsAfter(withItem(2, (item) => ({ ...item, hard: false }))).join('\n')).toContain('the hard gates are 5, 9, 11, 12');
        expect(problemsAfter(withItem(3, (item) => ({ ...item, hard: true }))).join('\n')).toContain('the hard gates are 2, 3, 5, 9, 11, 12');
        expect(problemsAfter((items) => items.slice(1)).join('\n')).toContain('the map holds 11 items');
        expect(problemsAfter(withItem(4, (item) => ({ ...item, clauses: [...item.clauses, { ...item.clauses[0] }] }))).join('\n')).toContain('the id is used twice');
        expect(problemsAfter(withItem(4, (item) => ({ ...item, clauses: [{ ...item.clauses[0], cases: [] }] }))).join('\n')).toContain('it names no case');
        expect(problemsAfter(withItem(4, (item) => ({ ...item, clauses: [{ ...item.clauses[0], cases: [/never/g] }] }))).join('\n')).toContain('the g or y flag');
        expect(problemsAfter(withItem(4, (item) => ({ ...item, clauses: [{ ...item.clauses[0], kind: 'guess' }] }))).join('\n')).toContain('kind "guess"');
        expect(problemsAfter(withItem(5, (item) => ({ ...item, clauses: item.clauses.map((clause) => (clause.kind === 'departure' ? { ...clause, departure: { accepted: null } } : clause)) }))).join('\n')).toContain('a departure needs');
        expect(problemsAfter(withItem(11, (item) => ({ ...item, clauses: item.clauses.slice(1) }))).join('\n')).toContain('item 11 must hold one clause per defect');
        expect(validateMap({ ...contract, NAMED_GAPS: [{ key: 'a case', outcome: 'PASS', because: 'no' }] }).join('\n')).toContain('a named gap needs');
        expect(validateMap({})).toEqual(['the map must export ITEMS, DEFECTS and NAMED_GAPS, each an array']);
    });

    test('Gate: a results file that is not the verdict reporter\'s is refused and the reporter\'s own shape is read', () => {
        expect(() => parseResults('')).toThrow('not JSON');
        expect(() => parseResults('{"cases": []}')).toThrow('no "cases" object');
        expect(() => parseResults('{}')).toThrow('no "cases" object');
        expect(() => parseResults('{"cases": {"a › b": {"outcome": "GREEN"}}}')).toThrow('"a › b" the outcome "GREEN"');
        expect(Object.keys(parseResults(fs.readFileSync(baselinePath, 'utf8')).cases)).toEqual(keys);
    });

    // What only the command does, beside the function the other cases call: it reads the clauses against the baseline's keys as well as the results'
    // (a union of windows can lack a case the baseline lists), takes --partial, prints who accepted a departure and when, and starts however the
    // path to it is typed.
    test('Gate: the command exits 1 on a hard-gate FAIL and 0 on a clean run, and prints the label and the table in --markdown', () => {
        inTempDir((dir, run, runVia) => {
            const map = writeAcceptingMap(dir);
            const common = ['--map', map, '--baseline', baselinePath];
            const clean = writeFile(dir, 'clean.json', everythingPasses(keys));
            const [pin] = matchedBy(allClauses.find((candidate) => candidate.id === 'W2.on-behalf'));
            const broken = writeFile(dir, 'broken.json', having(everythingPasses(keys), pin, 'FAIL'));

            const ok = run([...common, '--results', clean]);
            expect(ok.status, ok.stderr).toBe(EXIT.PASS);
            expect(ok.stdout).toContain('HARD GATES: none NOT MET and none departing unaccepted');
            // The accepted departure says who accepted it and when, in the item's row and under its clause.
            expect(ok.stdout).toContain(`DEPARTS (accepted ${approval.on})`);
            expect(ok.stdout).toContain(`accepted by ${approval.by} on ${approval.on} (${approval.ref})`);

            const red = run([...common, '--results', broken]);
            expect(red.status, red.stderr).toBe(EXIT.HARD_GATE);
            expect(red.stdout).toContain('HARD GATES: BLOCKED by item 2');
            expect(red.stdout).toContain(`FAIL: ${pin}`);

            // A results file that lacks one of the two cases of W9.assign-directly, as a union of windows can: the baseline lists the case, so the
            // clause is NOT MET and the exit is 1; under --partial the same file is NOT RUN, exit 0, and says it is not a verdict.
            const [lost] = matchedBy(allClauses.find((candidate) => candidate.id === 'W9.assign-directly'));
            const withHole = everythingPasses(keys);
            delete withHole.cases[lost];
            const hole = writeFile(dir, 'hole.json', withHole);
            const missed = run([...common, '--results', hole]);
            expect(missed.status, missed.stderr).toBe(EXIT.HARD_GATE);
            expect(missed.stdout).toContain('no result: 1 case');
            expect(missed.stdout).toContain('HARD GATES: BLOCKED by item 9');
            const window = run([...common, '--results', hole, '--partial']);
            expect(window.status, window.stderr).toBe(EXIT.PASS);
            expect(window.stdout).toContain('PARTIAL RUN');

            // However the path to gate.js is typed, the same files give the direct run's exit status and last line: through a link to the file, through
            // a linked folder and without ".js". (Started only when the path as typed was gate.js's own, each of these printed nothing and exited 0.)
            const link = path.join(dir, 'gate-link.js');
            fs.symlinkSync(gatePath, link);
            const folder = path.join(dir, 'acceptance-link');
            fs.symlinkSync(path.dirname(gatePath), folder, 'dir');
            const forms = { 'a link to gate.js': link, 'a linked folder': path.join(folder, 'gate.js'), 'the name without .js': gatePath.replace(/\.js$/, '') };
            for (const [how, script] of Object.entries(forms)) {
                const via = runVia(script, [...common, '--results', broken]);
                expect([via.status, lastLine(via.stdout), via.stderr], `started as ${how}`).toEqual([red.status, lastLine(red.stdout), '']);
            }

            const table = run([...common, '--results', baselinePath, '--markdown', '--label', 'abc1234 2000-01-01']);
            expect(table.status, table.stderr).toBe(EXIT.PASS);
            expect(table.stdout).toContain('Gate table for abc1234 2000-01-01, read from');
            expect(table.stdout.split('\n').filter((line) => /^\| W\d+ \|/.test(line))).toHaveLength(12);
            expect(table.stdout).toContain('Cases the dev environment cannot run, skipped by name:');
            expect(table.stdout).toContain(contract.NAMED_GAPS[0].because);

            const data = run([...common, '--results', clean, '--json']);
            expect(JSON.parse(data.stdout).exit).toBe(EXIT.PASS);
        });
    });

    test('Gate: the command exits 2 for a results file that is missing, garbled or not the reporter\'s, and an empty one is no pass', () => {
        inTempDir((dir, run) => {
            const common = ['--map', writeAcceptingMap(dir), '--baseline', baselinePath];
            const missing = run([...common, '--results', path.join(dir, 'nothing.json')]);
            expect(missing.status).toBe(EXIT.NO_RESULTS);
            expect(missing.stderr).toContain('does not exist');
            expect(run([...common, '--results', writeFile(dir, 'garbled.json', '{"cases": ')]).status).toBe(EXIT.NO_RESULTS);
            expect(run([...common, '--results', writeFile(dir, 'shape.json', { results: [] })]).status).toBe(EXIT.NO_RESULTS);
            expect(run([...common, '--results', writeFile(dir, 'outcome.json', { cases: { 'a › b': { outcome: 'GREEN' } } })]).status).toBe(EXIT.NO_RESULTS);
            expect(run([...common, '--results', writeFile(dir, 'empty.json', { cases: {} })]).status).toBe(EXIT.HARD_GATE);

            // The gate stopping on an error of its own is no verdict either, and it says so: here a pattern in the map whose test() throws, which the
            // map check lets through (it is a RegExp without the g or y flag). Left to Node, the error exits 1, which reads as a hard gate blocked.
            const real = JSON.stringify(pathToFileURL(contractPath).href);
            const throwing = writeFile(
                dir,
                'throws.mjs',
                [
                    `import * as real from ${real};`,
                    'export const DEFECTS = real.DEFECTS;',
                    'export const NAMED_GAPS = real.NAMED_GAPS;',
                    'class Throws extends RegExp { test() { throw new Error("a pattern in the map throws"); } }',
                    'export const ITEMS = real.ITEMS.map((item, at) => (at === 0 ? { ...item, clauses: item.clauses.map((clause, nth) => (nth === 0 ? { ...clause, cases: [new Throws("never")] } : clause)) } : item));',
                    '',
                ].join('\n'),
            );
            const stopped = run(['--baseline', baselinePath, '--results', writeFile(dir, 'clean.json', everythingPasses(keys)), '--map', throwing]);
            expect(stopped.status, stopped.stderr).toBe(EXIT.NO_RESULTS);
            expect(stopped.stderr).toContain('stopped without a verdict (a pattern in the map throws)');
            expect(stopped.stdout).toBe('');
        });
    });

    test('Gate: the command exits 3 for a map that does not load or is not the contract\'s twelve items with its five hard gates', () => {
        inTempDir((dir, run) => {
            const results = writeFile(dir, 'clean.json', everythingPasses(keys));
            const common = ['--baseline', baselinePath, '--results', results];
            expect(run([...common, '--map', path.join(dir, 'nothing.mjs')]).status).toBe(EXIT.BAD_MAP);
            expect(run([...common, '--map', writeFile(dir, 'syntax.mjs', 'export const ITEMS = [')]).status).toBe(EXIT.BAD_MAP);
            const real = JSON.stringify(pathToFileURL(contractPath).href);
            const unmarked = writeFile(
                dir,
                'unmarked.mjs',
                [`import * as real from ${real};`, 'export const DEFECTS = real.DEFECTS;', 'export const NAMED_GAPS = real.NAMED_GAPS;', 'export const ITEMS = real.ITEMS.map((item) => ({ ...item, hard: false }));', ''].join('\n'),
            );
            const run3 = run([...common, '--map', unmarked]);
            expect(run3.status).toBe(EXIT.BAD_MAP);
            expect(run3.stderr).toContain('the hard gates are none');
        });
    });
});
