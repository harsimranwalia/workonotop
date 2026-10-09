// Console reporter: one line per case, and a verdict that is never softer than what happened.
//   PASS
//   FAIL [NEW] | FAIL [known]   with the first error line
//   ATTEMPTED (missing: X)      a credential gap: verified by what the code attempts, not a pass
//   SKIPPED (reason)
// "known" means e2e/baseline.json records the case as FAIL, so a failure that predates a branch can be told
// from one the branch caused. The baseline is a record, never a filter: every failure still prints FAIL and
// still fails the run. This reporter never changes the exit code.
//
// It also writes test-results/baseline-candidate.json from the run. A ticket that changes a case on purpose
// copies it over e2e/baseline.json in the same PR, from a full run with the fixtures loaded.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASELINE_FILE = fileURLToPath(new URL('../baseline.json', import.meta.url));
const ANSI_COLOUR = /\u001b\[[0-9;]*m/g;

// file › describe › title, without the root and project titles.
const caseKey = (test) => test.titlePath().slice(2).join(' › ');

function firstErrorLine(result) {
    const message = (result.error?.message || 'no error message').replace(ANSI_COLOUR, '');
    const line = message.split('\n').map((text) => text.trim()).find((text) => text !== '') || 'no error message';
    return line.length > 180 ? `${line.slice(0, 177)}...` : line;
}

function verdictOf(result) {
    if (result.status === 'passed') {
        const gap = result.annotations.find((annotation) => annotation.type === 'verified-by-attempt');
        return gap ? { outcome: 'ATTEMPTED', detail: gap.description } : { outcome: 'PASS' };
    }
    if (result.status === 'skipped') {
        const reason = result.annotations.find((annotation) => annotation.type === 'skip')?.description;
        return { outcome: 'SKIPPED', detail: reason || 'no reason given' };
    }
    // failed, timedOut or interrupted: the case did not show what it asserts.
    return { outcome: 'FAIL', error: firstErrorLine(result) };
}

export default class VerdictReporter {
    constructor() {
        this.cases = new Map();
        this.outputDir = 'test-results';
        // null when there is no baseline file yet, as on the very first run.
        this.baseline = fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')).cases : null;
    }

    printsToStdio() {
        return true;
    }

    onBegin(config, suite) {
        this.outputDir = config.projects[0].outputDir;
        const baseline = this.baseline ? `e2e/baseline.json (${Object.keys(this.baseline).length} cases)` : 'none (e2e/baseline.json is missing: every failure counts as NEW)';
        console.log(`target: ${config.projects[0].use.baseURL}; ${suite.allTests().length} cases; baseline: ${baseline}`);
    }

    onTestEnd(test, result) {
        const key = caseKey(test);
        const verdict = verdictOf(result);
        this.cases.set(key, verdict);

        if (verdict.outcome === 'FAIL') {
            const known = this.baseline?.[key]?.outcome === 'FAIL';
            console.log(`FAIL [${known ? 'known' : 'NEW'}] ${key} — ${verdict.error}`);
        } else if (verdict.outcome === 'ATTEMPTED') {
            console.log(`ATTEMPTED (${verdict.detail}) ${key} — verified by what the code attempts; not a pass; evidence: test-results/app.log`);
        } else if (verdict.outcome === 'SKIPPED') {
            console.log(`SKIPPED (${verdict.detail}) ${key}`);
        } else {
            console.log(`PASS ${key}`);
        }
    }

    // A failure outside any case, such as the preflight: no case is reported, so say why the run stopped.
    onError(error) {
        console.log(`ERROR ${(error.message || 'unknown error').replace(ANSI_COLOUR, '').split('\n')[0]}`);
    }

    onEnd() {
        // Nothing ran: `--list`, or a run stopped before its first case. onError has said why.
        if (this.cases.size === 0) return;

        const counts = { PASS: 0, FAIL: 0, ATTEMPTED: 0, SKIPPED: 0 };
        const newFailures = [];
        const differs = [];
        for (const [key, verdict] of this.cases) {
            counts[verdict.outcome] += 1;
            const was = this.baseline?.[key]?.outcome;
            if (verdict.outcome === 'FAIL' && was !== 'FAIL') newFailures.push(key);
            if (this.baseline && was !== verdict.outcome) differs.push(`${key}: baseline ${was ?? 'has no entry'}, now ${verdict.outcome}`);
        }

        const known = counts.FAIL - newFailures.length;
        console.log(`Summary: PASS ${counts.PASS}, FAIL ${counts.FAIL} (NEW ${newFailures.length}, known ${known}), ATTEMPTED ${counts.ATTEMPTED}, SKIPPED ${counts.SKIPPED}; ${this.cases.size} cases`);
        console.log(newFailures.length === 0 ? 'NEW failures: none' : `NEW failures:\n${newFailures.map((key) => `  ${key}`).join('\n')}`);
        if (this.baseline) {
            console.log(differs.length === 0 ? 'Differs from baseline: nothing' : `Differs from baseline:\n${differs.map((line) => `  ${line}`).join('\n')}`);
        }

        const candidate = { cases: {} };
        for (const key of [...this.cases.keys()].sort()) {
            const { outcome, error } = this.cases.get(key);
            candidate.cases[key] = error ? { outcome, error } : { outcome };
        }
        const file = path.join(this.outputDir, 'baseline-candidate.json');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify(candidate, null, 2)}\n`);
    }
}
