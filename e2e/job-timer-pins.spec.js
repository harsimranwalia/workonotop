// @ts-check
// ENG-016, the source pins of the design's "Pins" row (agents/architect/designs/ENG-016-photos-and-countdown-timer-on-the-job-link.md, "Cases and
// baseline") and the constants of its "Named values" table that a library exports, each asserted at its value. No app, no database, no browser: a
// case reads files of the repo, or imports a library that loads in plain Node, and says which file and which text it found. Each title starts with
// "Pins:", and the file's name, the describe and the title together are its baseline key:
//   Tables   job_sessions is named, outside comments, in no new file but src/lib/job-timer.js; job_checkins in no new file, and under src/ only in
//        src/lib/job-checkin.js and src/lib/crew-retention.js; job_photos in no new file but src/lib/job-photos.js and src/lib/job-photo-retention.js.
//   Disk     node:fs (fs, fs/promises) is imported by no new file but src/lib/job-photo-store.js; PHOTO_DIR is under public/uploads/job-photos and git
//        ignores a file there.
//   SQL      no new file calls query( (prepared execute only); the SELECTs of the four new libraries hold no customer, user, price, amount, commission,
//        payment, stripe or booking_number word.
//   Pure     src/lib/job-clock.js has no import.
//   Self     the four self routes (photos POST, timer GET and POST, check-out POST) call findJobLink( before any body reader.
//   Named    EVENT_KINDS is its fourteen names in order; PHOTOS_MAX_PER_TYPE, PHOTO_MAX_BYTES, QUOTE_DEFAULT_MINUTES, EVENT_LIST_LIMIT, EVENT_DETAILS,
//        PHOTO_DAYS, ORPHAN_GRACE_HOURS, PHOTO_URL_BASE and LOCATION_REQUIRED are at their values; vercel.json runs /api/cron/job-photos at 37 4 * * *.
//        The three constants the page owns (PHOTO_LONG_EDGE_PX, PHOTO_JPEG_QUALITY, TIMER_POLL_SECONDS in src/components/job/jobLinkKit.js) are not pinned here.
//   Schema   the 0009 migration pair exists and database/schema.js carries its columns and its index.
// "A new file" is NEW_FILES below, written out: the files ENG-016 adds under src/. The list is not widened from git, because a later ticket's file that
// names job_sessions (the stop that ENG-017 moves to the link) is that ticket's to pin and not a breach of this one. A file of the list that is not in
// the tree fails the case that reads it, by name. A comment that only says a table's name is not a use of it: the files are read with their comments
// blanked (scanSource), and a file that names a table only in a comment is reported in a note on the case, as the ENG-015 pins do.
// The reading is not a parser, and each case that depends on it checks that what it looked for is really there (the owner of a table does name it, a
// handler that takes a body does read one), so a reading that finds nothing fails and does not pass.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// The files ENG-016 adds under src/ (the design's Components table, the "new" rows).
const NEW_FILES = [
    'src/lib/job-clock.js',
    'src/lib/job-photo-store.js',
    'src/lib/job-photos.js',
    'src/lib/job-photo-retention.js',
    'src/lib/job-timer.js',
    'src/lib/read-capped-body.js',
    'src/app/api/job/[token]/photos/route.js',
    'src/app/api/job/[token]/timer/route.js',
    'src/app/api/job/[token]/check-out/route.js',
    'src/app/api/cron/job-photos/route.js',
];

// ---- source reading (as e2e/job-link-retention.spec.js does it, with the regex, the ${ } and the stray-quote cases it leaves out) ----------------

// One pass over the characters of a source file: its text with every comment blanked (each character a space, line breaks kept, so a line number and an
// offset in the result are the file's own) and the string / template literals in it. A comment marker inside a string is text. A quote that has no
// partner on its line (an apostrophe in JSX text) is not a string. A template literal's ${ } is read as code, so a string, a comment or another template
// inside it is read right. A regex literal is told from a division by what comes before the slash: it follows an operator or an opening bracket (or `=>`,
// or return, typeof and the like), and it does not follow a `)`, a `]`, a `}`, a name, a number, `++` or a `>` that is not `=>`. A `<` before the slash is
// never a regex, which is what keeps a JSX closing tag (</div>) from being read as one that runs to the next slash on its line and swallows what is between.
const REGEX_AFTER_CHARACTER = '(,=:[!&|?{;+-*%~^';
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'yield', 'await']);
const LINE_END = /[\n\r\u2028\u2029]/;
const blank = (/** @type {string} */ text) => text.replace(/[^\n\r\u2028\u2029]/g, ' ');

/** @param {string} text */
function scanSource(text) {
    let code = '';
    /** @type {string[]} */
    const literals = [];

    // The end of the quoted string that starts at `at` (the index after its closing quote), or -1 when its line ends first. Only a line feed or a carriage
    // return ends a line inside a string: the line and paragraph separators are allowed in one.
    const quotedEnd = (/** @type {number} */ at) => {
        for (let j = at + 1; j < text.length; j++) {
            if (text[j] === '\\') j++;
            else if (text[j] === text[at]) return j + 1;
            else if (text[j] === '\n' || text[j] === '\r') return -1;
        }
        return -1;
    };

    // The end of the regex literal that starts at `at` (the index after its flags), or -1 when its line ends first.
    const regexEnd = (/** @type {number} */ at) => {
        let inClass = false;
        for (let j = at + 1; j < text.length; j++) {
            const ch = text[j];
            if (LINE_END.test(ch)) return -1;
            if (ch === '\\') j++;
            else if (ch === '[') inClass = true;
            else if (ch === ']') inClass = false;
            else if (ch === '/' && !inClass) {
                let k = j + 1;
                while (k < text.length && /[a-z]/i.test(text[k])) k++;
                return k;
            }
        }
        return -1;
    };

    // Whether a slash at the end of `code` begins a regex literal and not a division (or a JSX closing tag, or text).
    const regexAllowed = () => {
        let end = code.length;
        while (end > 0 && /\s/.test(code[end - 1])) end--;
        if (end === 0) return true;
        const last = code[end - 1];
        if ((last === '+' || last === '-') && code[end - 2] === last) return false;
        if (last === '>') return code[end - 2] === '=';
        if (REGEX_AFTER_CHARACTER.includes(last)) return true;
        let start = end;
        while (start > 0 && /[\w$]/.test(code[start - 1])) start--;
        return REGEX_AFTER_WORD.has(code.slice(start, end));
    };

    // A template literal that starts at `start`; returns the index after it.
    const scanTemplate = (/** @type {number} */ start) => {
        let i = start + 1;
        code += '`';
        while (i < text.length) {
            if (text[i] === '\\') {
                code += text.slice(i, i + 2);
                i += 2;
            } else if (text[i] === '`') {
                code += '`';
                i++;
                break;
            } else if (text[i] === '$' && text[i + 1] === '{') {
                code += '${';
                i = scanCode(i + 2, true);
                if (i < text.length) {
                    code += '}';
                    i++;
                }
            } else {
                code += text[i];
                i++;
            }
        }
        literals.push(text.slice(start, i));
        return i;
    };

    // Code from `from`; when `inExpression`, up to the `}` that closes a ${ } (its index is returned), else to the end of the text.
    function scanCode(/** @type {number} */ from, /** @type {boolean} */ inExpression) {
        let i = from;
        let depth = 0;
        while (i < text.length) {
            const ch = text[i];
            if (text.startsWith('//', i)) {
                let end = i;
                while (end < text.length && !LINE_END.test(text[end])) end++;
                code += blank(text.slice(i, end));
                i = end;
            } else if (text.startsWith('/*', i)) {
                const close = text.indexOf('*/', i + 2);
                const end = close === -1 ? text.length : close + 2;
                code += blank(text.slice(i, end));
                i = end;
            } else if (ch === "'" || ch === '"') {
                const end = quotedEnd(i);
                if (end === -1) {
                    code += ch;
                    i++;
                } else {
                    literals.push(text.slice(i, end));
                    code += text.slice(i, end);
                    i = end;
                }
            } else if (ch === '`') {
                i = scanTemplate(i);
            } else if (ch === '/' && text[i + 1] !== '>' && regexAllowed() && regexEnd(i) !== -1) {
                const end = regexEnd(i);
                code += text.slice(i, end);
                i = end;
            } else if (ch === '}' && inExpression && depth === 0) {
                return i;
            } else {
                if (ch === '{') depth++;
                else if (ch === '}') depth--;
                code += ch;
                i++;
            }
        }
        return i;
    }

    scanCode(0, false);
    return { code, literals };
}

/** @param {string} directory @returns {string[]} */
function filesUnder(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const found = path.join(directory, entry.name);
        if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : filesUnder(found);
        return [path.relative(ROOT, found).split(path.sep).join('/')];
    });
}

const isCode = (/** @type {string} */ file) => /\.(?:js|jsx|mjs|cjs|ts|tsx)$/.test(file);
const textOf = (/** @type {string} */ file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const codeOf = (/** @type {string} */ file) => scanSource(textOf(file)).code;

/** `file:line: text` of every line of `code` that `pattern` (no g flag) matches, so a failure says where. */
function linesWith(/** @type {string} */ file, /** @type {string} */ code, /** @type {RegExp} */ pattern) {
    return code.split('\n').flatMap((line, index) => (pattern.test(line) ? [`${file}:${index + 1}: ${line.trim().slice(0, 100)}`] : []));
}

/** Every module a file loads, read from its code: import ... from 'x', import 'x', export ... from 'x', import('x') and require('x'). */
function specifiersOf(/** @type {string} */ code) {
    return [
        ...[...code.matchAll(/\bimport\s*(?:[\w$*{}\s,]*?\bfrom\s*)?(['"])([^'"]+)\1/g)].map((match) => match[2]),
        ...[...code.matchAll(/\bexport\s*(?:\*|\{[^}]*\})\s*(?:as\s+[\w$]+\s*)?from\s*(['"])([^'"]+)\1/g)].map((match) => match[2]),
        ...[...code.matchAll(/\b(?:import|require)\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g)].map((match) => match[2]),
    ];
}

/** The new files with their text and their code. A file of the list that is not in the tree fails here, by name, before any case reads it. */
function newFiles() {
    const missing = NEW_FILES.filter((file) => !fs.existsSync(path.join(ROOT, file)));
    expect(missing, 'files ENG-016 adds (NEW_FILES at the head of e2e/job-timer-pins.spec.js) that are not in the tree').toEqual([]);
    return NEW_FILES.map((file) => ({ file, text: textOf(file), code: codeOf(file) }));
}

/** The new files that name `table` in code. The ones that say it only in a comment are reported in a note on the case, and are not a use of it. */
function newFilesNaming(/** @type {string} */ table) {
    const sources = newFiles();
    const naming = sources.filter((source) => source.code.includes(table)).map((source) => source.file);
    const commentOnly = sources.filter((source) => source.text.includes(table) && !naming.includes(source.file)).map((source) => source.file);
    if (commentOnly.length > 0) test.info().annotations.push({ type: 'note', description: `${table} is named only in a comment in: ${commentOnly.join(', ')}` });
    return naming;
}

/** A library of the repo loaded in plain Node; one that will not load fails the case with its name and the reason. */
async function loaded(/** @type {string} */ file, /** @type {() => Promise<any>} */ importer) {
    try {
        return await importer();
    } catch (error) {
        throw new Error(`${file} could not be imported in plain Node: ${error instanceof Error ? error.message : String(error)}`);
    }
}

// ================================================================================================================================
// Pins: source checks, no app and no database
// ================================================================================================================================

test.describe('Job timer and photos: the pins', () => {
    // Mutant that turns this case red: a route or another library reads or writes the clock's stretches itself, around job-timer.js, so a start or a
    // pause is written without the booking lock, the status change and the log lines that keep the provider's own page and its reports in step.
    test('Pins: job_sessions is named in no new file but job-timer.js', () => {
        const OWNER = 'src/lib/job-timer.js';
        const naming = newFilesNaming('job_sessions');
        expect(naming.includes(OWNER), `${OWNER} names job_sessions in code (the reading reaches the library that owns it)`).toBe(true);
        expect(naming.filter((file) => file !== OWNER), `new files other than ${OWNER} that name job_sessions in code`).toEqual([]);
    });

    // Mutant that turns this case red: a new file reads or writes the check-ins itself, around job-checkin.js, so who is here is judged without the
    // assignment epoch and the checked-out stamp, and a cleaner who left (or was taken off the crew) counts as present. src/lib/job-link.js reads
    // the ticks through job-checkin.js, and it is not one of the files that may name the table.
    test('Pins: job_checkins is named in no new file, and in src/ only by job-checkin.js and crew-retention.js', () => {
        const OWNER = 'src/lib/job-checkin.js';
        const ALLOWED = [OWNER, 'src/lib/crew-retention.js'];
        expect(newFilesNaming('job_checkins'), 'new files that name job_checkins in code').toEqual([]);
        const files = filesUnder(path.join(ROOT, 'src')).filter(isCode);
        const naming = files.filter((file) => codeOf(file).includes('job_checkins')).sort();
        expect(naming.includes(OWNER), `the walk of ${files.length} files under src/ reaches ${OWNER}, which names job_checkins in code`).toBe(true);
        expect(naming.filter((file) => !ALLOWED.includes(file)), `files under src/ other than ${ALLOWED.join(' and ')} that name job_checkins in code (src/lib/job-link.js may not)`).toEqual([]);
    });

    // Mutant that turns this case red: a new route or library reads or writes job_photos itself, around the two libraries that know its rules (the cap
    // of 20 a type, the lock, the retention that leaves a provider's own photos alone), so a photo is stored or deleted without them.
    test('Pins: job_photos is named in no new file but job-photos.js and job-photo-retention.js', () => {
        const OWNERS = ['src/lib/job-photo-retention.js', 'src/lib/job-photos.js'];
        const naming = newFilesNaming('job_photos');
        for (const owner of OWNERS) expect(naming.includes(owner), `${owner} names job_photos in code (the reading reaches the library that owns it)`).toBe(true);
        expect(naming.filter((file) => !OWNERS.includes(file)), `new files other than ${OWNERS.join(' and ')} that name job_photos in code`).toEqual([]);
    });

    // Mutant that turns this case red: a route or another library imports node:fs and writes or reads a photo itself, so the one place that knows the
    // photos are on a disk (and that a move to object storage rewrites) is not the only one.
    test('Pins: node:fs is imported by no new file but job-photo-store.js', () => {
        const OWNER = 'src/lib/job-photo-store.js';
        const DISK = /^(?:node:)?(?:fs|graceful-fs|fs-extra)(?:\/.*)?$/;
        const loading = newFiles().map(({ file, code }) => ({ file, modules: specifiersOf(code).filter((specifier) => DISK.test(specifier)) }));
        expect(loading.find((one) => one.file === OWNER)?.modules.length ?? 0, `${OWNER} imports node:fs/promises (the reading reaches the file that owns the disk)`).toBeGreaterThan(0);
        expect(
            loading.filter((one) => one.file !== OWNER && one.modules.length > 0).map((one) => `${one.file} imports ${one.modules.join(', ')}`),
            `new files other than ${OWNER} that import node:fs, fs, fs/promises or node:fs/promises`
        ).toEqual([]);
    });

    // Mutant that turns this case red: a new file sends a statement as text (query) and not prepared (execute), which is how a value from a phone
    // (a position, an action, a type) reaches a statement as SQL.
    test('Pins: no new file contains a query( call', () => {
        const calling = newFiles().flatMap(({ file, code }) => linesWith(file, code, /\bquery\s*\(/));
        expect(calling, 'lines of the new files that call query( (a bare call or connection.query), comments aside; ENG-016 sends prepared execute only').toEqual([]);
    });

    // Mutant that turns this case red: a SELECT in a new library reads a customer's contact, a price or a payment, so the job page or a panel can put
    // it on a crew's phone. Every quoted and template string of the four libraries that holds the word SELECT is read; a column list kept in a
    // constant and interpolated into a statement (PHOTO_COLUMNS) is read as part of it.
    test("Pins: the new libraries' SELECTs name no customer_, user_id, price, amount, commission, payment, stripe or booking_number", () => {
        const LIBS = ['src/lib/job-clock.js', 'src/lib/job-photos.js', 'src/lib/job-photo-retention.js', 'src/lib/job-timer.js'];
        const FORBIDDEN = ['customer_', 'user_id', 'price', 'amount', 'commission', 'payment', 'stripe', 'booking_number'];
        const TABLE_READ = { 'src/lib/job-photos.js': 'job_photos', 'src/lib/job-photo-retention.js': 'job_photos', 'src/lib/job-timer.js': 'job_sessions' };
        /** @type {Record<string, string[]>} */
        const selectsOf = {};
        for (const file of LIBS) {
            expect(fs.existsSync(path.join(ROOT, file)), `${file} is in the tree`).toBe(true);
            const { code, literals } = scanSource(textOf(file));
            // const NAME = 'text' (or "text", or a template with no ${ }): a statement may carry one in a ${NAME}, and the words in it are part of the statement.
            const constants = new Map(
                [...code.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\$]|\\.|\$(?!\{))*`)/g)].map((match) => [match[1], match[2].slice(1, -1)])
            );
            selectsOf[file] = literals
                .filter((literal) => /\bselect\b/i.test(literal))
                .map((literal) => literal.replace(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g, (whole, name) => constants.get(name) ?? whole).replace(/\s+/g, ' '));
        }
        for (const [file, table] of Object.entries(TABLE_READ)) {
            expect(selectsOf[file].some((select) => select.includes(table)), `the reading finds a SELECT from ${table} in ${file} (it found ${selectsOf[file].length} SELECT statements)`).toBe(true);
        }
        for (const file of LIBS) {
            for (const word of FORBIDDEN) {
                const holding = selectsOf[file].filter((select) => select.toLowerCase().includes(word));
                expect(holding.map((select) => select.slice(0, 140)), `${file}: SELECT statements that hold ${word} (case does not matter)`).toEqual([]);
            }
        }
    });

    // Mutant that turns this case red: job-clock.js imports something (a database helper, a clock, a library of the repo), so the rule that divides the
    // quote among the cleaners cannot be loaded and tried in plain Node with a made-up set of rows.
    test('Pins: job-clock.js has no import', () => {
        const FILE = 'src/lib/job-clock.js';
        expect(fs.existsSync(path.join(ROOT, FILE)), `${FILE} is in the tree`).toBe(true);
        const code = codeOf(FILE);
        expect(code.includes('export function clockView'), `${FILE} is the clock (it exports clockView)`).toBe(true);
        expect(linesWith(FILE, code, /\bimport\b/), 'lines with an import statement, a dynamic import() or import.meta, comments aside').toEqual([]);
        expect(linesWith(FILE, code, /\brequire\s*\(/), 'lines with a require( call, comments aside').toEqual([]);
        expect(linesWith(FILE, code, /\bexport\s+(?:\*|\{[^}]*\})\s*(?:as\s+[\w$]+\s*)?from\b/), 'lines that re-export from another file, comments aside').toEqual([]);
    });

    // Mutant that turns this case red: the photo directory is moved out from under public/uploads/job-photos (or made absolute), so the files are not
    // where .gitignore keeps a commit from taking them, and the uploads route does not serve them under their address.
    test('Pins: PHOTO_DIR is under public/uploads/job-photos', async () => {
        const WHERE = 'public/uploads/job-photos';
        const { PHOTO_DIR } = await loaded('src/lib/job-photo-store.js', () => import('../src/lib/job-photo-store.js'));
        expect(typeof PHOTO_DIR, 'src/lib/job-photo-store.js exports PHOTO_DIR as a string').toBe('string');
        const relative = path.relative(process.cwd(), PHOTO_DIR).split(path.sep).join('/');
        expect(relative === WHERE || relative.startsWith(`${WHERE}/`), `PHOTO_DIR ${JSON.stringify(PHOTO_DIR)} is ${JSON.stringify(relative)} from ${process.cwd()}, not ${WHERE} or a folder of it`).toBe(true);
    });

    // Mutant that turns this case red: the line in .gitignore goes (or is narrowed to a file name), so a photo of a customer's home that a cleaner
    // took on the stack's disk is one `git add .` from a commit.
    test('Pins: git ignores public/uploads/job-photos/x.jpg', () => {
        const SAMPLE = 'public/uploads/job-photos/x.jpg';
        const answer = spawnSync('git', ['check-ignore', '-q', SAMPLE], { cwd: ROOT, encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'] });
        if (answer.status === 0 || answer.status === 1) {
            expect(answer.status, `git check-ignore -q ${SAMPLE} in ${ROOT}: 0 is ignored, 1 is not (see .gitignore)`).toBe(0);
            return;
        }
        // Git could not answer (it is not installed, or this folder is not a git checkout): read .gitignore itself, and say so in a note.
        const lines = textOf('.gitignore').split(/\r?\n/).map((line) => line.trim());
        const COVERING = ['/public/uploads/job-photos/', '/public/uploads/job-photos', 'public/uploads/job-photos/', 'public/uploads/job-photos', '/public/uploads/job-photos/*', 'public/uploads/job-photos/*'];
        test.info().annotations.push({ type: 'note', description: `git could not answer here (status ${answer.status}, ${answer.error?.message ?? String(answer.stderr).trim().slice(0, 80)}); .gitignore was read instead` });
        expect(lines.some((line) => COVERING.includes(line)), `git could not answer, and .gitignore has none of the lines ${COVERING.slice(0, 4).join(' | ')}`).toBe(true);
    });

    // Mutant that turns this case red: a handler reads the body (a multipart photo of up to 4 MB, or a JSON position) before the token is looked up, so
    // a request with a made-up token makes the server read and hold what it sends before it learns there is no such link; or findJobLink is dropped.
    test('Pins: the four self routes call findJobLink( before any body reader', () => {
        const SELF_ROUTES = [
            { file: 'src/app/api/job/[token]/photos/route.js', method: 'POST', takesBody: true },
            { file: 'src/app/api/job/[token]/timer/route.js', method: 'GET', takesBody: false },
            { file: 'src/app/api/job/[token]/timer/route.js', method: 'POST', takesBody: true },
            { file: 'src/app/api/job/[token]/check-out/route.js', method: 'POST', takesBody: true },
        ];
        // The text of one exported handler, cut from `code` (the file with its comments blanked): from the line that holds `export async function
        // <method>(` to the closing brace at the start of a line.
        const handlerOf = (/** @type {string} */ code, /** @type {string} */ method) => {
            const start = code.search(new RegExp(`^export\\s+async\\s+function\\s+${method}\\s*\\(`, 'm'));
            if (start === -1) return null;
            const rest = code.slice(start);
            const end = rest.search(/^\}/m);
            return end === -1 ? rest : rest.slice(0, end + 1);
        };
        for (const { file, method, takesBody } of SELF_ROUTES) {
            const where = `${file} ${method}`;
            expect(fs.existsSync(path.join(ROOT, file)), `${file} is in the tree`).toBe(true);
            const handler = handlerOf(codeOf(file), method);
            expect(handler !== null, `${file} has \`export async function ${method}(\` outside a comment`).toBe(true);
            const text = String(handler);
            const request = /^export\s+async\s+function\s+\w+\s*\(\s*(\w+)/.exec(text)?.[1] ?? '';
            expect(request !== '', `${where} takes the request as its first parameter`).toBe(true);
            const lookup = text.search(/\bfindJobLink\s*\(/);
            expect(lookup >= 0, `${where} calls findJobLink( outside a comment`).toBe(true);
            const READERS = [
                [`${request}.json(`, new RegExp(`\\b${request}\\s*\\.\\s*json\\s*\\(`)],
                [`${request}.formData(`, new RegExp(`\\b${request}\\s*\\.\\s*formData\\s*\\(`)],
                [`${request}.text(`, new RegExp(`\\b${request}\\s*\\.\\s*text\\s*\\(`)],
                [`${request}.arrayBuffer(`, new RegExp(`\\b${request}\\s*\\.\\s*arrayBuffer\\s*\\(`)],
                [`${request}.blob(`, new RegExp(`\\b${request}\\s*\\.\\s*blob\\s*\\(`)],
                [`${request}.body`, new RegExp(`\\b${request}\\s*\\.\\s*body\\b`)],
                ['readCappedBody(', /\breadCappedBody\s*\(/],
                ['.formData(', /\.\s*formData\s*\(/],
                ['arrayBuffer(', /\barrayBuffer\s*\(/],
            ];
            const found = READERS.map(([label, pattern]) => ({ label: String(label), at: text.search(/** @type {RegExp} */ (pattern)) })).filter((reader) => reader.at !== -1);
            if (takesBody) {
                expect(found.length > 0, `${where} reads a body, and the pin recognised none of ${READERS.map(([label]) => label).join(' ')} in it, so it would pass without looking: add the reader the handler uses`).toBe(true);
            }
            for (const reader of found) {
                expect(lookup < reader.at, `${where}: findJobLink( is at ${lookup} and ${reader.label} is at ${reader.at} (offsets in the handler's text), so a body is read before the link is looked up`).toBe(true);
            }
        }
    });

    // Mutant that turns this case red: an event kind is renamed, dropped or added (the six of ENG-016 are photo_added, check_out, timer_start,
    // timer_pause, timer_resume and over_quote), so the record's words change under the admin's panel and the two panels' sentences.
    test('Pins: EVENT_KINDS is the fourteen names, in order', async () => {
        const { EVENT_KINDS } = await loaded('src/lib/job-link-base.js', () => import('../src/lib/job-link-base.js'));
        expect([...EVENT_KINDS], 'EVENT_KINDS exported by src/lib/job-link-base.js').toEqual([
            'link_created',
            'link_off',
            'link_reissued',
            'code_asked',
            'code_suppressed',
            'code_failed',
            'signed_in',
            'check_in',
            'photo_added',
            'check_out',
            'timer_start',
            'timer_pause',
            'timer_resume',
            'over_quote',
        ]);
    });

    // ---- Named values: each exported constant of the design's table, asserted at its value ----------------------------------------------------

    // Mutant that turns this case red: the cap is raised or dropped, so one session can store as many photos as it likes.
    test('Pins: PHOTOS_MAX_PER_TYPE is 20', async () => {
        const { PHOTOS_MAX_PER_TYPE } = await loaded('src/lib/job-photos.js', () => import('../src/lib/job-photos.js'));
        expect(PHOTOS_MAX_PER_TYPE, 'PHOTOS_MAX_PER_TYPE exported by src/lib/job-photos.js, the before photos and the after photos a job may hold').toBe(20);
    });

    // Mutant that turns this case red: the cap on one photo is raised past what a function body can carry on Vercel (4.5 MB), so a big photo fails
    // there without our message, or it is cut so far that a phone's shrunken photo does not fit.
    test("Pins: PHOTO_MAX_BYTES, the cap on one photo's bytes, is 4000000", async () => {
        const { PHOTO_MAX_BYTES } = await loaded('src/lib/job-photo-store.js', () => import('../src/lib/job-photo-store.js'));
        expect(PHOTO_MAX_BYTES, 'PHOTO_MAX_BYTES exported by src/lib/job-photo-store.js, the most bytes one photo may have').toBe(4000000);
    });

    // Mutant that turns this case red: the default differs from the provider's own timer route (its `|| 60`), so a booking with no quote reads one
    // quote on the provider's page and another on the link.
    test('Pins: QUOTE_DEFAULT_MINUTES is 60', async () => {
        const { QUOTE_DEFAULT_MINUTES } = await loaded('src/lib/job-clock.js', () => import('../src/lib/job-clock.js'));
        expect(QUOTE_DEFAULT_MINUTES, 'QUOTE_DEFAULT_MINUTES exported by src/lib/job-clock.js, the quote in minutes of a booking that has none').toBe(60);
    });

    // Mutant that turns this case red: the list is cut back to 50 (a busy job's first events fall out of the list) or a detail is renamed or dropped.
    test('Pins: EVENT_LIST_LIMIT is 100 and EVENT_DETAILS is the twelve names', async () => {
        const { EVENT_LIST_LIMIT, EVENT_DETAILS } = await loaded('src/lib/job-link-base.js', () => import('../src/lib/job-link-base.js'));
        expect(EVENT_LIST_LIMIT, 'EVENT_LIST_LIMIT exported by src/lib/job-link-base.js').toBe(100);
        expect([...EVENT_DETAILS], 'EVENT_DETAILS exported by src/lib/job-link-base.js').toEqual([
            'no_match',
            'cannot_text',
            'not_checked',
            'cooldown',
            'number_cap',
            'provider_cap',
            'sent',
            'not_sent',
            'before',
            'after',
            'last_out',
            'removed',
        ]);
    });

    // Mutant that turns this case red: a link photo is deleted before the time in which a dispute can come has passed, or a file with no row is
    // deleted while it is young enough to be one that addPhoto has written and not yet committed a row for.
    test('Pins: PHOTO_DAYS is 365 and ORPHAN_GRACE_HOURS is 24', async () => {
        const { PHOTO_DAYS, ORPHAN_GRACE_HOURS } = await loaded('src/lib/job-photo-retention.js', () => import('../src/lib/job-photo-retention.js'));
        expect(PHOTO_DAYS, 'PHOTO_DAYS exported by src/lib/job-photo-retention.js, the days a link photo is kept').toBe(365);
        expect(ORPHAN_GRACE_HOURS, 'ORPHAN_GRACE_HOURS exported by src/lib/job-photo-retention.js, the hours a file with no row is left alone').toBe(24);
    });

    // Mutant that turns this case red: the entry is dropped (the photos are never trimmed) or moved onto another path or another hour.
    test('Pins: vercel.json runs /api/cron/job-photos at "37 4 * * *"', () => {
        const PATH = '/api/cron/job-photos';
        const vercel = JSON.parse(textOf('vercel.json'));
        const entries = (vercel.crons ?? []).filter((/** @type {{ path: string }} */ cron) => cron.path === PATH);
        expect(entries.length, `entries of vercel.json crons for ${PATH}`).toBe(1);
        expect(entries[0].schedule, `schedule of the vercel.json cron entry for ${PATH}`).toBe('37 4 * * *');
    });

    // Mutant that turns this case red: the address base and the directory part ways, so a stored photo is served under an address that is not its file.
    test('Pins: PHOTO_URL_BASE is /uploads/job-photos/ and is where PHOTO_DIR is served from', async () => {
        const { PHOTO_URL_BASE, PHOTO_DIR } = await loaded('src/lib/job-photo-store.js', () => import('../src/lib/job-photo-store.js'));
        expect(PHOTO_URL_BASE, 'PHOTO_URL_BASE exported by src/lib/job-photo-store.js, what every photo address starts with').toBe('/uploads/job-photos/');
        expect(`public${PHOTO_URL_BASE}`, `PHOTO_URL_BASE under public/ is the folder PHOTO_DIR (${JSON.stringify(PHOTO_DIR)}) names`).toBe(`${String(PHOTO_DIR).replace(/\/+$/, '')}/`);
    });

    // Mutant that turns this case red: a start is allowed without the phone's position, or another action is refused without it.
    test('Pins: LOCATION_REQUIRED is ["start"]', async () => {
        const { LOCATION_REQUIRED } = await loaded('src/lib/job-timer.js', () => import('../src/lib/job-timer.js'));
        expect([...LOCATION_REQUIRED], 'LOCATION_REQUIRED exported by src/lib/job-timer.js, the actions refused without a position').toEqual(['start']);
    });

    // ---- the migration ----------------------------------------------------------------------------------------------------------------------

    // Mutant that turns this case red: a column or the index is in the migration and not in schema.js (or the other way), so a fresh install and a
    // migrated database part ways, or the down file is gone and the migration cannot be undone.
    test('Pins: the 0009 migration pair exists and database/schema.js carries its columns and index', () => {
        const UP = 'database/migrations/0009-job-photos-and-timer.up.sql';
        const DOWN = 'database/migrations/0009-job-photos-and-timer.down.sql';
        const NAMES = ['checked_out_at', 'over_quote_at', 'taken_by_kind', 'taken_by_ref', 'idx_job_photos_uploaded'];
        for (const file of [UP, DOWN]) {
            expect(fs.existsSync(path.join(ROOT, file)), `${file} exists`).toBe(true);
            expect(textOf(file).trim().length > 0, `${file} is not empty`).toBe(true);
        }
        const schema = codeOf('database/schema.js');
        const up = codeOfSql(UP);
        for (const name of NAMES) {
            expect(schema.includes(name), `database/schema.js names ${name} outside a comment`).toBe(true);
            expect(up.includes(name), `${UP} names ${name} outside a comment`).toBe(true);
        }
    });
});

/**
 * The text of an .sql file with its comments blanked: a block comment, `-- ` to the end of the line (MySQL wants a space after the dashes) and `#` to
 * the end of the line. One pass from left to right, so whichever starts first wins, and quoted text is kept as it is (a `--` in a string is not a comment).
 */
function codeOfSql(/** @type {string} */ file) {
    const token = /'(?:[^'\\]|\\[\s\S]|'')*'|"(?:[^"\\]|\\[\s\S]|"")*"|`[^`]*`|\/\*[\s\S]*?\*\/|--(?=\s|$).*|#.*/g;
    return textOf(file).replace(token, (found) => (/^['"`]/.test(found) ? found : blank(found)));
}
