// @ts-check
// ENG-016: the photo route's own cases (POST /api/job/{token}/photos). The library (e2e/job-photos.spec.js), the retention sweep
// (e2e/job-photo-retention.spec.js) and the timer's use of a photo (e2e/job-timer.spec.js) are other files' cases; this file is what only the route
// can show:
//   refusals    one case per rung of the order the route header gives (no access 401; not multipart 400; past the cap 413; no file 400; a type that
//               is neither 400; bytes that are not a JPEG, PNG or WebP 400; a cleaner not checked in, a before photo once started, an after photo
//               before the start and the 21st photo of a type 409), each with the status, the message, Cache-Control: no-store and the proof that
//               nothing was written (no job_photos row, no job_link_events row, no new file); and cases that break two rungs at once, so that a
//               re-ordering of the route fails one of them;
//   kept        a JPEG, a PNG and a WebP through the route (the shapes of photo and photos, the extension that follows the bytes and never the
//               name the client gave, the photo_added event with its actor and no photo address), the provider's and the admin's photos, and the
//               Exif cut seen in the stored file;
//   listed      the three answers that list a job's photos (the cleaner's page, the provider's panel and the admin's panel) leave out a row whose address
//               is neither a photo of the store nor an older raster upload, and a row that is left out still counts toward the limit of 20 (security gate
//               round 1, F1: both screens put the address in a link, and the provider's routes store any string); the rule itself, address by address;
//   the cap     a body of exactly PHOTO_MAX_BYTES is kept, one byte more is 413 (the whole multipart body is counted, its framing too), a body
//               with no length is stopped, and a Content-Length that is smaller than the body is stopped; after each the app keeps answering;
//   the counter readCappedBody (src/lib/read-capped-body.js) in plain Node with chunked streams: exactly the cap passes, one byte more is cut, a
//               stream that never ends is cancelled and not drained, and a Content-Length that is missing or false changes nothing.
// Not in this file: the 503 'store' answer. The running app cannot be pointed at a directory that will not take a write without changing the
// permissions of the shared dev stack's filesystem, and usePhotoDir() moves only the process that imports the store, so the case is left out and
// not faked.
// The over-cap requests are sent with node:http, not with the request fixture, so that the framing is chosen here to the byte. After a 413 the app
// closes the connection while the body may be arriving, so the client reads either the 413 or a reset (ECONNRESET, EPIPE); every such case
// accepts both, and asserts the 413 whenever it arrives, that nothing was written, and that a following GET /api/job/{token} is answered.
// Rows: every booking belongs to the e-mail prefix e2e-jrt- (provider 1's, so the foreign keys hold) and every cleaner to the number block
// +1 403 555 0270 to 0297; the customer number of the probe bookings is +1 403 555 0298. The block is walked through one number at a time and
// swept after every case. The prefix e2e-jpr- and the number 0299 belong to e2e/job-photo-retention.spec.js, which sweeps by them, so this file
// takes its own. The describes sweep, before their first case, after every case and after their last, the crew members of the block, the bookings of
// the prefix (links, codes, check-ins, sessions, photos and events go with them), the files those photo rows named, any file the case added to
// public/uploads/job-photos, and the sms_budget counters of the numbers, links and members. A failure message names the case, the status and the
// figures, never a cookie, a token or a code.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import mysql from 'mysql2/promise';
import { getCredentialHeaders } from './auth/credentials.js';
import { providers } from '../database/fixtures/accounts.js';
import { assertDevTarget, assertNoRealPeople } from '../database/fixtures/guard.js';
import { sha256Hex } from '../src/lib/link-token.js';
import { budgetScope } from '../src/lib/sms-budget.js';
import { CODE_MESSAGES } from '../src/lib/job-link-code.js';
import { PHOTO_MESSAGES, PHOTOS_MAX_PER_TYPE, isShownAddress } from '../src/lib/job-photos.js';
import { PHOTO_MAX_BYTES } from '../src/lib/job-photo-store.js';
import { readCappedBody } from '../src/lib/read-capped-body.js';

// Every request carries a fixture account's session header and a trace records request headers: tracing is off, as in e2e/provider-crew.spec.js.
test.use({ trace: 'off' });

const [PROVIDER1] = providers;
const EMAIL_PREFIX = 'e2e-jrt-';
// The number block of this file: the digits after '+1 403 555 0'. The last number is the customer's, the others are cleaners'.
const NUMBER_FIRST = 270;
const NUMBER_LAST = 298;
const stored = (n) => `+14035550${n}`;
const typed = (n) => `+1 403 555 0${n}`;

// The first request to a route is compiled by the dev server, so every request is given a minute.
const REQUEST_TIMEOUT = 60_000;
const RESET_CODES = new Set(['ECONNRESET', 'EPIPE', 'ECONNABORTED']);

// The address of every probe booking (Calgary) and the phone at the address.
const ADDRESS = { latitude: 51.04473, longitude: -114.07192 };
const HERE = { latitude: ADDRESS.latitude, longitude: ADDRESS.longitude, accuracy: 12.4 };

const PHOTO_DIRECTORY = path.join(process.cwd(), 'public', 'uploads', 'job-photos');
const STORED_NAME = /^[0-9a-f]{32}\.(jpg|png|webp)$/;
const photoUrlPattern = /^\/uploads\/job-photos\/[0-9a-f]{32}\.(jpg|png|webp)$/;

// ---- the job's own clock: every probe booking falls in America/Toronto ----

const ZONE = 'America/Toronto';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function today() {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const get = (type) => parts.find((part) => part.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
}

const plusDays = (day, count) => new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + count)).toISOString().slice(0, 10);
const slotLabel = (day, slot) => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}: ${slot}`;
// A job dated yesterday: its check-in window is open for good.
const yesterday = () => plusDays(today(), -1);

// ---- the dev database, the way e2e/provider-crew.spec.js reaches it ----

// One object feeds both the guard and the connection, so the guard certifies the values that get used (as database/fixtures/load.js).
const DB = { host: '127.0.0.1', port: 3307, user: 'root', password: 'root123', database: 'workontap_db' };

/** @type {import('mysql2/promise').Connection | null} */
let connection = null;

// The one connection of this worker, opened on first use, after the guard has checked the target and the rows in it.
async function db() {
    if (connection) return connection;
    assertDevTarget(DB);
    let opened;
    try {
        opened = await mysql.createConnection(DB);
    } catch (error) {
        throw new Error(`the dev database did not accept a connection at ${DB.host}:${DB.port} (${/** @type {any} */ (error).code || 'no code'}); the test command runs the container with --network host`, { cause: error });
    }
    try {
        await assertNoRealPeople(opened);
    } catch (error) {
        await opened.end();
        throw error;
    }
    connection = opened;
    return connection;
}

// Every statement of this file is prepared, with a ? for every value.
async function rows(sql, params = []) {
    const [found] = await (await db()).execute(sql, params);
    return /** @type {any[]} */ (found);
}

const countOf = async (sql, params = []) => Number((await rows(sql, params))[0].n);

// The stored photo files of the directory, by name; [] when the directory is not there yet, or is a plain file (the 503 case puts one there).
async function photoFiles() {
    try {
        return (await fs.readdir(PHOTO_DIRECTORY)).filter((name) => STORED_NAME.test(name)).sort();
    } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes(/** @type {any} */ (error).code)) return [];
        throw error;
    }
}

// The files that were in the directory when a case began: whatever else is there when it ends is the case's own.
let filesBefore = new Set();

async function removeNewFiles() {
    for (const name of await photoFiles()) {
        if (!filesBefore.has(name)) await fs.rm(path.join(PHOTO_DIRECTORY, name), { force: true });
    }
}

// Deletes what this file left: the files of the photos its bookings hold, the sms_budget counters of its numbers, links and members, the bookings
// of its e-mail prefix (links, codes, check-ins, sessions, photos, logs, events and crew rows go with them) and the crew members of its number block.
async function clearRows() {
    const open = await db();
    // The photo store makes its directory when it first needs one, and the dev container runs as root: a directory made here first is the test
    // user's, and the sweep below can remove the files the app writes into it.
    await fs.mkdir(PHOTO_DIRECTORY, { recursive: true });
    const [photos] = /** @type {any[]} */ (await open.execute('SELECT p.photo_url FROM job_photos p JOIN bookings b ON b.id = p.booking_id WHERE b.customer_email LIKE ?', [`${EMAIL_PREFIX}%`]));
    for (const photo of photos) {
        if (photoUrlPattern.test(photo.photo_url)) await fs.rm(path.join(process.cwd(), 'public', photo.photo_url), { force: true });
    }
    const [links] = /** @type {any[]} */ (await open.execute('SELECT l.id FROM job_links l JOIN bookings b ON b.id = l.booking_id WHERE b.customer_email LIKE ?', [`${EMAIL_PREFIX}%`]));
    const [members] = /** @type {any[]} */ (await open.execute('SELECT id FROM provider_crew_members WHERE phone BETWEEN ? AND ?', [stored(NUMBER_FIRST), stored(NUMBER_LAST)]));
    const scopes = [budgetScope('provider', PROVIDER1.id)];
    for (let n = NUMBER_FIRST; n <= NUMBER_LAST; n += 1) scopes.push(budgetScope('number', stored(n)));
    for (const link of links) {
        scopes.push(budgetScope('ask', link.id), budgetScope('verify', link.id));
        for (const member of members) scopes.push(budgetScope('cooldown', link.id, member.id));
    }
    for (let from = 0; from < scopes.length; from += 200) {
        const chunk = scopes.slice(from, from + 200);
        await open.execute(`DELETE FROM sms_budget WHERE scope IN (${chunk.map(() => '?').join(', ')})`, chunk);
    }
    await open.execute('DELETE FROM bookings WHERE customer_email LIKE ?', [`${EMAIL_PREFIX}%`]);
    await open.execute('DELETE FROM provider_crew_members WHERE phone BETWEEN ? AND ?', [stored(NUMBER_FIRST), stored(NUMBER_LAST)]);
}

// The hooks of a describe that uses the database: a sweep before its first case, after every case (also a case that failed or timed out) and after
// its last, then the connection is closed. Every case also notes the photo files there are when it begins and removes the ones it added.
function sweepAround() {
    test.beforeAll(clearRows);
    test.beforeEach(async () => {
        filesBefore = new Set(await photoFiles());
    });
    test.afterEach(async () => {
        try {
            await removeNewFiles();
        } finally {
            await clearRows();
        }
    });
    test.afterAll(async () => {
        if (!connection) return;
        try {
            await clearRows();
        } finally {
            await connection.end();
            connection = null;
        }
    });
}

// ---- requests ----

// The credentials a case sends, as request headers (the cookie styles of getCredentialHeaders).
async function credentials(baseURL) {
    const styles = await getCredentialHeaders(String(baseURL));
    return { none: {}, provider: styles['provider-cookie'], admin: styles['admin-cookie'] };
}

async function setup(playwright, request, baseURL) {
    return { playwright, request, baseURL: String(baseURL), as: await credentials(baseURL) };
}

async function answerOf(response) {
    return { status: response.status(), body: await response.json().catch(() => null), cache: response.headers()['cache-control'] ?? '' };
}

// The data of an answer that succeeded. The message of a refusal is named, never the whole body (a success holds a link's path).
async function dataOf(response, status, who) {
    const answer = await answerOf(response);
    expect(answer.status, `${who}: status (${answer.body?.success === false ? answer.body.message : 'no message'})`).toBe(status);
    expect(answer.body?.success, `${who}: success`).toBe(true);
    return answer.body.data;
}

let sequence = 0;
const tag = () => `${Date.now().toString(36)}${(sequence += 1)}`;

// The next cleaner number of the block, 0270 to 0297, wrapping round once the whole block has been walked (the rows are swept after every case).
let nextNumber = NUMBER_FIRST;
function takeNumber() {
    const number = nextNumber;
    nextNumber = nextNumber >= NUMBER_LAST - 1 ? NUMBER_FIRST : nextNumber + 1;
    return number;
}

// A booking of provider 1 that is confirmed, in Calgary, dated yesterday, quoted for an hour.
async function insertBooking() {
    const id = tag();
    const day = yesterday();
    const [made] = /** @type {any[]} */ (await (await db()).execute(
        `INSERT INTO bookings (booking_number, service_id, service_name, service_price, customer_first_name, customer_last_name, customer_email, customer_phone,
           job_date, job_time_slot, job_description, address_line1, city, status, payment_status, provider_id, latitude, longitude, standard_duration_minutes)
         VALUES (?, 1, 'Probe service', 100.00, 'E2E', 'Probe', ?, ?, ?, ?, 'ENG-016 photo route probe, deleted by the case', '1 Probe Street', 'Calgary', 'confirmed', 'pending', ?, ?, ?, 60)`,
        [`E2EJR${id}`, `${EMAIL_PREFIX}${id}@example.invalid`, stored(NUMBER_LAST), day, slotLabel(day, 'Morning'), PROVIDER1.id, ADDRESS.latitude, ADDRESS.longitude]
    ));
    return Number(made.insertId);
}

// Provider 1 adds the cleaners through ENG-014's route, one number of the block each.
async function addMembers(ctx, names) {
    const made = [];
    for (const name of names) {
        const number = takeNumber();
        const data = await dataOf(await ctx.request.post('/api/provider/crew', { headers: ctx.as.provider, data: { name, phone: typed(number) } }), 201, `provider 1 adds ${name}`);
        made.push({ id: data.member.id, name, number, checked: false });
    }
    return made;
}

// Provider 1 sets the crew of a job (ENG-014's PUT, which replaces the set and keeps the rows of those who stay).
async function setCrew(ctx, bookingId, ids) {
    await dataOf(await ctx.request.put(`/api/provider/jobs/${bookingId}/crew`, { headers: ctx.as.provider, data: { crew_ids: ids } }), 200, `provider 1 puts ${ids.length} cleaners on job ${bookingId}`);
}

// The proof ENG-015's number-check routes leave behind: a used row for the member and the number they have now.
async function markChecked(member) {
    if (member.checked) return;
    const [current] = await rows('SELECT phone FROM provider_crew_members WHERE id = ?', [member.id]);
    await (await db()).execute('INSERT INTO crew_number_checks (crew_member_id, phone, code_hash, expires_at, used_at) VALUES (?, ?, ?, NOW(), NOW())', [member.id, current.phone, sha256Hex(`jrt-probe:${tag()}`)]);
    member.checked = true;
}

// The six digits of the member's live code on a link, found by hashing every candidate against code_hash.
async function findCode(linkId, memberId) {
    const [row] = await rows('SELECT code_hash FROM job_link_codes WHERE link_id = ? AND crew_member_id = ? AND used_at IS NULL AND expires_at > NOW() ORDER BY id DESC LIMIT 1', [linkId, memberId]);
    expect(row !== undefined, 'a live code row exists for the member (a text cannot be read in dev)').toBe(true);
    for (let n = 0; n < 1_000_000; n += 1) {
        const candidate = String(n).padStart(6, '0');
        if (sha256Hex(`${linkId}:${memberId}:${candidate}`) === row.code_hash) return candidate;
    }
    throw new Error('no six-digit code fits the stored hash');
}

// A cleaner opens the link: the number is checked, a code is asked for through the route, found from its hash and given back. The cookie comes
// from a context of its own so that no jar carries it into the next request; it is returned as a `cookie` header value and never printed.
async function signInWith(ctx, job, member) {
    await markChecked(member);
    const asked = await ctx.request.post(`/api/job/${job.token}/code`, { data: { phone: typed(member.number) } });
    expect(asked.status(), `${member.name} asks for a code`).toBe(200);
    const code = await findCode(job.linkId, member.id);
    const fresh = await ctx.playwright.request.newContext({ baseURL: ctx.baseURL });
    try {
        const verified = await fresh.post(`/api/job/${job.token}/verify`, { data: { phone: typed(member.number), code } });
        expect(verified.status(), `${member.name} gives the code back`).toBe(200);
        const line = verified.headersArray().filter((header) => header.name.toLowerCase() === 'set-cookie').map((header) => header.value).find((value) => value.startsWith(`jls_${job.linkId}=`));
        expect(line !== undefined, `the answer sets the session cookie of link ${job.linkId}`).toBe(true);
        return String(line).split(';')[0];
    } finally {
        await fresh.dispose();
    }
}

// A probe job of provider 1 with its crew, a link made by the provider's route and, with `signIn`, that member signed in (job.cookie).
async function makeJob(ctx, { members, signIn = null }) {
    const bookingId = await insertBooking();
    await setCrew(ctx, bookingId, members.map((member) => member.id));
    const created = await dataOf(await ctx.request.post(`/api/provider/jobs/${bookingId}/job-link`, { headers: ctx.as.provider, data: { action: 'create' } }), 200, 'provider 1 makes the job link');
    const linkPath = created.job_link?.path;
    expect(typeof linkPath === 'string' && /^\/job\/[A-Za-z0-9_-]{43}$/.test(linkPath), 'the link has a path of 43 base64url characters').toBe(true);
    const [link] = await rows('SELECT id FROM job_links WHERE booking_id = ?', [bookingId]);
    /** @type {{ bookingId: number, token: string, linkId: number, cookie: string | null }} */
    const job = { bookingId, token: String(linkPath).slice('/job/'.length), linkId: link.id, cookie: null };
    if (signIn) job.cookie = await signInWith(ctx, job, signIn);
    return job;
}

const asCleaner = (job) => ({ cookie: String(job.cookie) });

async function okOf(answer, who) {
    expect(answer.status, `${who}: status (${answer.body?.success === false ? answer.body.message : 'no message'})`).toBe(200);
    expect(answer.body?.success, `${who}: success`).toBe(true);
    return answer.body.data;
}

// A check-in with the body as it is given.
const tick = async (request, job, headers, ids, location = HERE) => answerOf(await request.post(`/api/job/${job.token}/check-in`, { headers, data: { crew_ids: ids, location }, timeout: REQUEST_TIMEOUT }));
const tickOk = async (request, job, headers, ids, who) => okOf(await tick(request, job, headers, ids), `${who} ticks ${JSON.stringify(ids)}`);

// A probe job with one cleaner (Ann) signed in and, unless `checkIn` is false, checked in.
async function probeJob(ctx, { checkIn = true } = {}) {
    const [member] = await addMembers(ctx, ['Ann']);
    const job = await makeJob(ctx, { members: [member], signIn: member });
    const cleaner = asCleaner(job);
    if (checkIn) await tickOk(ctx.request, job, cleaner, [member.id], 'the cleaner');
    return { member, job, cleaner };
}

const setStatus = async (bookingId, status) => {
    await (await db()).execute('UPDATE bookings SET status = ? WHERE id = ?', [status, bookingId]);
};

// Photo rows planted in SQL: rows only, with the addresses given, which name no file.
async function plantRows(bookingId, type, urls) {
    for (const url of urls) {
        await (await db()).execute('INSERT INTO job_photos (booking_id, photo_url, photo_type, uploaded_by) VALUES (?, ?, ?, ?)', [bookingId, url, type, PROVIDER1.id]);
    }
}

// An address in the shape the store gives out (32 lowercase hex characters), which is what the job link shows: a planted row that has to be listed needs one.
const storeAddress = () => `/uploads/job-photos/${randomBytes(16).toString('hex')}.jpg`;

const plantPhotos = (bookingId, type, count) => plantRows(bookingId, type, Array.from({ length: count }, () => storeAddress()));

// What a refused photo must not change: the photo rows, the event rows and the files.
async function watched(bookingId) {
    return {
        photos: await countOf('SELECT COUNT(*) AS n FROM job_photos WHERE booking_id = ?', [bookingId]),
        events: await countOf('SELECT COUNT(*) AS n FROM job_link_events WHERE booking_id = ?', [bookingId]),
        files: await photoFiles(),
    };
}

// ---- the bytes ----

// A minimal JPEG the photo store accepts: start of image, a JFIF header, a start of scan with two bytes of data and the end of image.
const TINY_JPEG = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0x34, 0xff, 0xd9,
]);
// Everything up to and including the start-of-scan header (30 bytes).
const JPEG_HEAD = TINY_JPEG.subarray(0, 30);
// A JPEG of exactly `size` bytes: the head, scan data of one repeated byte, the end of image.
const jpegOfSize = (size) => Buffer.concat([JPEG_HEAD, Buffer.alloc(size - JPEG_HEAD.length - 2, 0x55), Buffer.from([0xff, 0xd9])]);
const TRUNCATED_JPEG = TINY_JPEG.subarray(0, TINY_JPEG.length - 3);

// A 1 x 1 PNG, and a WebP header with a lossless chunk: the store decides the kind from the first bytes alone.
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const TINY_WEBP = Buffer.concat([
    Buffer.from('RIFF', 'latin1'),
    Buffer.from([0x1a, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP', 'latin1'),
    Buffer.from('VP8L', 'latin1'),
    Buffer.from([0x0d, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x10, 0x07, 0x10, 0x11, 0x11, 0x88, 0x88, 0xfe, 0x07, 0x00]),
]);

const segment = (marker, payload) => Buffer.concat([Buffer.from([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload]);
// An Exif APP1 segment that carries the text GPS and a position, placed straight after the start of image.
const EXIF = segment(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.from('II*\0 GPS 51.04473 -114.07192', 'latin1')]));
const JPEG_WITH_EXIF = Buffer.concat([TINY_JPEG.subarray(0, 2), EXIF, TINY_JPEG.subarray(2)]);

const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><script>1</script></svg>', 'utf8');
const SVG_WITH_XML_HEADER = Buffer.concat([Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n', 'utf8'), SVG]);
const HTML = Buffer.from('<!doctype html><html><body>not a photo</body></html>', 'utf8');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< >>\nendobj\n', 'latin1');
const TWO_BYTES = Buffer.from([0xff, 0xd8]);

// ---- multipart bodies, built by hand so that their length is exact ----

// parts: { name, value } for a field, { name, filename, type, bytes } for a file. The framing is the boundary lines and the part headers.
function multipartBody(parts, boundary = `----jrt${tag()}`) {
    const chunks = [];
    for (const part of parts) {
        const head = part.filename === undefined
            ? `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"\r\n\r\n`
            : `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: ${part.type}\r\n\r\n`;
        chunks.push(Buffer.from(head, 'latin1'), part.filename === undefined ? Buffer.from(String(part.value), 'utf8') : part.bytes, Buffer.from('\r\n', 'latin1'));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`, 'latin1'));
    return { contentType: `multipart/form-data; boundary=${boundary}`, body: Buffer.concat(chunks) };
}

const typePart = (value) => ({ name: 'type', value });
const photoPart = (bytes, { name = 'photo.jpg', type = 'image/jpeg' } = {}) => ({ name: 'photo', filename: name, type, bytes });

// A multipart body of exactly `total` bytes: the parts in `before`, then a photo part whose JPEG is as long as the rest allows.
function exactBody(total, before = []) {
    const boundary = '----jrtexact';
    const framing = multipartBody([...before, photoPart(Buffer.alloc(0))], boundary).body.length;
    return multipartBody([...before, photoPart(jpegOfSize(total - framing))], boundary);
}

async function postBody(request, job, headers, contentType, body) {
    return answerOf(await request.post(`/api/job/${job.token}/photos`, { headers: { ...headers, 'content-type': contentType }, data: body, timeout: REQUEST_TIMEOUT }));
}

async function postParts(request, job, headers, parts) {
    const built = multipartBody(parts);
    return postBody(request, job, headers, built.contentType, built.body);
}

function expectRefusal(answer, status, message, who) {
    expect(answer.status, `${who}: status (${answer.body?.message ?? 'no message'})`).toBe(status);
    expect(answer.body, `${who}: the refusal`).toEqual({ success: false, message });
    expect(answer.cache, `${who}: no-store`).toContain('no-store');
}

// Sends one request and expects the refusal; then expects that nothing was written.
async function refused(job, who, status, message, send) {
    const before = await watched(job.bookingId);
    expectRefusal(await send(), status, message, who);
    expect(await watched(job.bookingId), `${who}: no photo row, no event row and no file was written`).toEqual(before);
}

// The job page answers: the app keeps serving after a body it had to cut.
async function expectServing(request, job, headers, who) {
    const answer = await answerOf(await request.get(`/api/job/${job.token}`, { headers, timeout: REQUEST_TIMEOUT }));
    expect([answer.status, answer.body?.success], `${who}: the job page answers afterwards`).toEqual([200, true]);
}

// ---- one POST over node:http, with the framing chosen here ----

function* slices(buffer, size = 65536) {
    for (let at = 0; at < buffer.length; at += size) yield buffer.subarray(at, at + size);
}

// The start of a multipart body and then filler without an end, for a sender that stops only when the app does.
function* endlessUpload(boundary) {
    yield Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\nbefore\r\n--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`, 'latin1');
    const filler = Buffer.alloc(65536, 0x61);
    for (;;) yield filler;
}

async function pump(clientRequest, chunks, stopAfter, isDone) {
    let total = 0;
    try {
        for (const chunk of chunks) {
            if (isDone() || total >= stopAfter) break;
            total += chunk.length;
            if (!clientRequest.write(chunk)) {
                await new Promise((resolve) => {
                    clientRequest.once('drain', resolve);
                    clientRequest.once('close', resolve);
                    clientRequest.once('error', resolve);
                });
            }
        }
        if (!isDone()) clientRequest.end();
    } catch {
        // The app cut the request: the answer or the reset is read by the caller.
    }
}

// declared: the Content-Length to send (a number, true or false), or null for chunked transfer with no Content-Length at all.
// Resolves { status, headers, text } for an answer and { reset: code } for a connection the app closed first.
function sendRaw(baseURL, pathName, { headers, declared, chunks, stopAfter = Number.POSITIVE_INFINITY }) {
    const target = new URL(pathName, baseURL);
    const client = target.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
        let settled = false;
        const framing = declared === null ? { 'transfer-encoding': 'chunked' } : { 'content-length': String(declared) };
        const clientRequest = client.request(target, { method: 'POST', agent: false, headers: { ...headers, ...framing } }, (response) => {
            const parts = [];
            let answered = false;
            const done = () => {
                if (answered || settled) return;
                answered = true;
                settled = true;
                clearTimeout(timer);
                clientRequest.destroy();
                resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(parts).toString('utf8') });
            };
            response.on('data', (part) => parts.push(part));
            response.on('end', done);
            response.on('close', done);
            response.on('error', done);
        });
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            clientRequest.destroy();
            reject(new Error('the app gave no answer within the time allowed'));
        }, REQUEST_TIMEOUT);
        clientRequest.on('error', (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (RESET_CODES.has(/** @type {any} */ (error).code)) resolve({ reset: /** @type {any} */ (error).code });
            else reject(error);
        });
        pump(clientRequest, chunks, stopAfter, () => settled);
    });
}

function rawAnswer(result) {
    let body = null;
    try {
        body = JSON.parse(result.text);
    } catch {
        body = null;
    }
    return { status: result.status, body, cache: String(result.headers['cache-control'] ?? '') };
}

// An upload over node:http with the whole body declared. Returns true when the answer arrived (and was the expected refusal), false for a reset.
async function sentRefused(ctx, job, headers, built, status, message, who) {
    const result = await sendRaw(ctx.baseURL, `/api/job/${job.token}/photos`, { headers: { ...headers, 'content-type': built.contentType }, declared: built.body.length, chunks: slices(built.body) });
    if (result.reset) return false;
    expectRefusal(rawAnswer(result), status, message, who);
    return true;
}

// ---- the refusals, in the order the route judges them ----

test.describe('Job photo route: the refusals, in the order the route judges them', () => {
    sweepAround();

    test('Photos: rung 1, a live link with no credential is 401 "Enter your code to continue." and writes nothing, also when the request breaks the body rules as well (JSON, no file, a wrong type, a GIF)', async ({ playwright, request, baseURL }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const { job } = await probeJob(ctx);
        const url = `/api/job/${job.token}/photos`;
        await refused(job, 'a good photo with no credential', 401, CODE_MESSAGES.signIn, () => postParts(request, job, {}, [typePart('before'), photoPart(TINY_JPEG)]));
        await refused(job, 'JSON with no credential', 401, CODE_MESSAGES.signIn, async () => answerOf(await request.post(url, { data: { type: 'before' }, timeout: REQUEST_TIMEOUT })));
        await refused(job, 'no file and a wrong type with no credential', 401, CODE_MESSAGES.signIn, () => postParts(request, job, {}, [typePart('during')]));
        await refused(job, 'a GIF with a wrong type with no credential', 401, CODE_MESSAGES.signIn, () => postParts(request, job, {}, [typePart('during'), photoPart(GIF)]));
        await refused(job, 'a cleaner session of no job here: a cookie that names another link', 401, CODE_MESSAGES.signIn, () => postParts(request, job, { cookie: 'jls_0=not-a-session' }, [typePart('before'), photoPart(TINY_JPEG)]));
    });

    test('Photos: rung 1 against rung 3, a body past the cap with no credential is 401 (access is judged before a byte of the body is read)', async ({ playwright, request, baseURL }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const { job, cleaner } = await probeJob(ctx);
        const before = await watched(job.bookingId);
        const built = exactBody(PHOTO_MAX_BYTES + 1, [typePart('before')]);
        const answered = await sentRefused(ctx, job, {}, built, 401, CODE_MESSAGES.signIn, 'past the cap with no credential');
        expect(await watched(job.bookingId), `past the cap with no credential (${answered ? 'answered' : 'reset'}): nothing was written`).toEqual(before);
        await expectServing(request, job, cleaner, 'after the refused body');
    });

    test('Photos: rung 2, a JSON body is 400 "Invalid request." and writes nothing; so is JSON past the cap (the type of the body is judged before it is read), and a multipart type with no form in it', async ({ playwright, request, baseURL }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const { job, cleaner } = await probeJob(ctx);
        const url = `/api/job/${job.token}/photos`;
        await refused(job, 'a JSON body', 400, 'Invalid request.', async () => answerOf(await request.post(url, { headers: cleaner, data: { type: 'before' }, timeout: REQUEST_TIMEOUT })));
        await refused(job, 'a text body', 400, 'Invalid request.', () => postBody(request, job, cleaner, 'text/plain', Buffer.from('type=before')));
        await refused(job, 'a body with no content type', 400, 'Invalid request.', async () => answerOf(await request.post(url, { headers: cleaner, data: Buffer.from('type=before'), timeout: REQUEST_TIMEOUT })));
        await refused(job, 'multipart with a body that is not a form', 400, 'Invalid request.', () => postBody(request, job, cleaner, 'multipart/form-data; boundary=zzz', Buffer.from('this is not a form body')));

        const before = await watched(job.bookingId);
        const big = Buffer.alloc(PHOTO_MAX_BYTES + 2048, 0x7b);
        const result = await sendRaw(ctx.baseURL, url, { headers: { ...cleaner, 'content-type': 'application/json' }, declared: big.length, chunks: slices(big) });
        if (!result.reset) expectRefusal(rawAnswer(result), 400, 'Invalid request.', 'JSON past the cap');
        expect(await watched(job.bookingId), 'JSON past the cap: nothing was written').toEqual(before);
        await expectServing(request, job, cleaner, 'after the JSON past the cap');
    });

    test('Photos: rung 3, a multipart body one byte past the cap is 413 "That photo is too big. Take it again." and writes nothing, also with a wrong type or no type (the cap is judged before the form is read), and the framing counts: a file under the cap in a body over it is 413', async ({ playwright, request, baseURL }) => {
        test.setTimeout(240_000);
        const ctx = await setup(playwright, request, baseURL);
        const { job, cleaner } = await probeJob(ctx);
        const before = await watched(job.bookingId);
        const bodies = [
            ['one byte past the cap', exactBody(PHOTO_MAX_BYTES + 1, [typePart('before')])],
            ['one byte past the cap with a wrong type', exactBody(PHOTO_MAX_BYTES + 1, [typePart('during')])],
            ['one byte past the cap with no type', exactBody(PHOTO_MAX_BYTES + 1, [])],
            ['a file of the cap less ten bytes, whose framing carries the body past the cap', multipartBody([typePart('before'), photoPart(jpegOfSize(PHOTO_MAX_BYTES - 10))])],
        ];
        for (const [what, built] of bodies) {
            expect(built.body.length > PHOTO_MAX_BYTES, `${what}: the body is past the cap`).toBe(true);
            await sentRefused(ctx, job, cleaner, built, 413, PHOTO_MESSAGES.tooBig, what);
            expect(await watched(job.bookingId), `${what}: nothing was written`).toEqual(before);
            await expectServing(request, job, cleaner, what);
        }
    });

    test('Photos: rung 4, a form with no file part and a form whose photo field is plain text are each 400 "Invalid request."; with a wrong type as well it is the same 400 (the file is judged before the type)', async ({ playwright, request, baseURL }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const { job, cleaner } = await probeJob(ctx);
        await refused(job, 'only a type', 400, 'Invalid request.', () => postParts(request, job, cleaner, [typePart('before')]));
        await refused(job, 'an empty form', 400, 'Invalid request.', () => postParts(request, job, cleaner, []));
        await refused(job, 'a photo field that is plain text', 400, 'Invalid request.', () => postParts(request, job, cleaner, [typePart('before'), { name: 'photo', value: 'not a file' }]));
        await refused(job, 'no file and a wrong type', 400, 'Invalid request.', () => postParts(request, job, cleaner, [typePart('during')]));
        await refused(job, 'a file under another field name', 400, 'Invalid request.', () => postParts(request, job, cleaner, [typePart('before'), { ...photoPart(TINY_JPEG), name: 'picture' }]));
    });

    test('Photos: rung 5, a type that is neither before nor after, and a missing type, are 400 "Pick before or after."; with a cleaner who is not checked in, or bytes that are not a photo, it is the same 400 (the type is judged before the rest)', async ({ playwright, request, baseURL }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const here = await probeJob(ctx);
        for (const [what, type] of [['during', 'during'], ['an empty type', ''], ['a capital letter', 'Before'], ['two types in one word', 'before,after']]) {
            await refused(here.job, `type ${what}`, 400, PHOTO_MESSAGES.type, () => postParts(request, here.job, here.cleaner, [typePart(type), photoPart(TINY_JPEG)]));
        }
        await refused(here.job, 'no type', 400, PHOTO_MESSAGES.type, () => postParts(request, here.job, here.cleaner, [photoPart(TINY_JPEG)]));
        await refused(here.job, 'a wrong type and a GIF', 400, PHOTO_MESSAGES.type, () => postParts(request, here.job, here.cleaner, [typePart('during'), photoPart(GIF)]));

        // Rung 5 against rung 7 (a cleaner who is not checked in): the type's 400.
        const away = await probeJob(ctx, { checkIn: false });
        await refused(away.job, 'a wrong type from a cleaner who is not checked in', 400, PHOTO_MESSAGES.type, () => postParts(request, away.job, away.cleaner, [typePart('during'), photoPart(TINY_JPEG)]));
        await refused(away.job, 'no type from a cleaner who is not checked in', 400, PHOTO_MESSAGES.type, () => postParts(request, away.job, away.cleaner, [photoPart(TINY_JPEG)]));
    });

    test('Photos: rung 6, bytes that are not a JPEG, PNG or WebP are 400 "That file is not a photo we can use. Take it again." whatever name and type the client gave (a GIF, an SVG with and without an XML header, an HTML page, a PDF header, an empty file, two bytes, a truncated JPEG); a cleaner who is not checked in gets the same 400', async ({ playwright, request, baseURL }) => {
        test.setTimeout(240_000);
        const ctx = await setup(playwright, request, baseURL);
        const { job, cleaner } = await probeJob(ctx);
        const kinds = [
            ['a GIF', GIF],
            ['an SVG', SVG],
            ['an SVG with an XML header', SVG_WITH_XML_HEADER],
            ['an HTML page', HTML],
            ['a PDF header', PDF],
            ['an empty file', Buffer.alloc(0)],
            ['a two-byte file', TWO_BYTES],
            ['a truncated JPEG', TRUNCATED_JPEG],
        ];
        for (const [what, bytes] of kinds) {
            for (const type of ['before', 'after']) {
                await refused(job, `${what} as ${type}, sent as image/jpeg named x.jpg`, 400, PHOTO_MESSAGES.image, () => postParts(request, job, cleaner, [typePart(type), photoPart(bytes, { name: 'x.jpg', type: 'image/jpeg' })]));
            }
        }
        // Rung 6 against rung 7: a cleaner who is not checked in and sends a GIF is told about the file, not about the check-in.
        const away = await probeJob(ctx, { checkIn: false });
        await refused(away.job, 'a GIF from a cleaner who is not checked in', 400, PHOTO_MESSAGES.image, () => postParts(request, away.job, away.cleaner, [typePart('before'), photoPart(GIF)]));
        // Rung 6 against rungs 8 and 10: an after photo before the start, with the after photos already at the limit, is told about the file.
        const full = await probeJob(ctx);
        await plantPhotos(full.job.bookingId, 'after', PHOTOS_MAX_PER_TYPE);
        await refused(full.job, 'a GIF as an after photo before the start with 20 after photos', 400, PHOTO_MESSAGES.image, () => postParts(request, full.job, full.cleaner, [typePart('after'), photoPart(GIF)]));
    });

    test('Photos: rung 7, a cleaner who is not checked in is 409 "Check in first, then add a photo." for a before and for an after photo; the provider and the admin need no check-in and are not refused', async ({ playwright, request, baseURL }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const { job, cleaner } = await probeJob(ctx, { checkIn: false });
        await refused(job, 'a before photo from a cleaner who is not checked in', 409, PHOTO_MESSAGES.notHere, () => postParts(request, job, cleaner, [typePart('before'), photoPart(TINY_JPEG)]));
        await refused(job, 'an after photo from a cleaner who is not checked in', 409, PHOTO_MESSAGES.notHere, () => postParts(request, job, cleaner, [typePart('after'), photoPart(TINY_JPEG)]));
        // Rung 7 against rungs 8 to 10: the job has started and holds 20 before photos, and the answer is the check-in's.
        await setStatus(job.bookingId, 'in_progress');
        await plantPhotos(job.bookingId, 'before', PHOTOS_MAX_PER_TYPE);
        await refused(job, 'a before photo from a cleaner who is not checked in, on a started job with 20 before photos', 409, PHOTO_MESSAGES.notHere, () => postParts(request, job, cleaner, [typePart('before'), photoPart(TINY_JPEG)]));
        // The provider needs no check-in: on that same job the next rung speaks (a before photo once started), not the check-in's.
        await refused(job, 'a before photo from the provider on a started job', 409, PHOTO_MESSAGES.started, () => postParts(request, job, ctx.as.provider, [typePart('before'), photoPart(TINY_JPEG)]));
        await refused(job, 'a before photo from the admin on a started job', 409, PHOTO_MESSAGES.started, () => postParts(request, job, ctx.as.admin, [typePart('before'), photoPart(TINY_JPEG)]));
    });

    test('Photos: rung 8, a before photo once the job has started is 409 "The job has started, so more before photos can not be added." (with 20 before photos already there it is this answer and not the limit)', async ({ playwright, request, baseURL }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const { job, cleaner } = await probeJob(ctx);
        await setStatus(job.bookingId, 'in_progress');
        await refused(job, 'a before photo from a checked-in cleaner once started', 409, PHOTO_MESSAGES.started, () => postParts(request, job, cleaner, [typePart('before'), photoPart(TINY_JPEG)]));
        await plantPhotos(job.bookingId, 'before', PHOTOS_MAX_PER_TYPE);
        await refused(job, 'a before photo once started with 20 before photos', 409, PHOTO_MESSAGES.started, () => postParts(request, job, cleaner, [typePart('before'), photoPart(TINY_JPEG)]));
        await refused(job, 'a before photo from the provider once started', 409, PHOTO_MESSAGES.started, () => postParts(request, job, ctx.as.provider, [typePart('before'), photoPart(TINY_JPEG)]));
    });

    test('Photos: rung 9, an after photo before the job has started is 409 "Start the job before adding after photos." (with 20 after photos already there it is this answer and not the limit)', async ({ playwright, request, baseURL }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const { job, cleaner } = await probeJob(ctx);
        await refused(job, 'an after photo from a checked-in cleaner before the start', 409, PHOTO_MESSAGES.notStarted, () => postParts(request, job, cleaner, [typePart('after'), photoPart(TINY_JPEG)]));
        await plantPhotos(job.bookingId, 'after', PHOTOS_MAX_PER_TYPE);
        await refused(job, 'an after photo before the start with 20 after photos', 409, PHOTO_MESSAGES.notStarted, () => postParts(request, job, cleaner, [typePart('after'), photoPart(TINY_JPEG)]));
        await refused(job, 'an after photo from the admin before the start', 409, PHOTO_MESSAGES.notStarted, () => postParts(request, job, ctx.as.admin, [typePart('after'), photoPart(TINY_JPEG)]));
    });

    test('Photos: rung 10, the 21st photo of a type is 409 "This job has all the photos it can hold." for a before photo on a confirmed job and for an after photo on a started one (20 rows planted by SQL, one sent)', async ({ playwright, request, baseURL }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const { job, cleaner } = await probeJob(ctx);
        await plantPhotos(job.bookingId, 'before', PHOTOS_MAX_PER_TYPE);
        await refused(job, 'the 21st before photo', 409, PHOTO_MESSAGES.tooMany, () => postParts(request, job, cleaner, [typePart('before'), photoPart(TINY_JPEG)]));
        expect(await countOf("SELECT COUNT(*) AS n FROM job_photos WHERE booking_id = ? AND photo_type = 'before'", [job.bookingId]), 'the before photos stay at 20').toBe(PHOTOS_MAX_PER_TYPE);

        await setStatus(job.bookingId, 'in_progress');
        await plantPhotos(job.bookingId, 'after', PHOTOS_MAX_PER_TYPE);
        await refused(job, 'the 21st after photo', 409, PHOTO_MESSAGES.tooMany, () => postParts(request, job, cleaner, [typePart('after'), photoPart(TINY_JPEG)]));
        expect(await countOf("SELECT COUNT(*) AS n FROM job_photos WHERE booking_id = ? AND photo_type = 'after'", [job.bookingId]), 'the after photos stay at 20').toBe(PHOTOS_MAX_PER_TYPE);
    });

    test('Photos: the 20th photo of a type is kept (19 planted, one sent, 200) and the next one is refused', async ({ playwright, request, baseURL }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const { job, cleaner } = await probeJob(ctx);
        await plantPhotos(job.bookingId, 'before', PHOTOS_MAX_PER_TYPE - 1);
        const kept = await postParts(request, job, cleaner, [typePart('before'), photoPart(TINY_JPEG)]);
        expect(kept.status, `the 20th before photo is kept (${kept.body?.message ?? 'no message'})`).toBe(200);
        expect(kept.body.data.photos.length, 'the answer lists 20 photos').toBe(PHOTOS_MAX_PER_TYPE);
        await refused(job, 'the photo after the 20th', 409, PHOTO_MESSAGES.tooMany, () => postParts(request, job, cleaner, [typePart('before'), photoPart(TINY_JPEG)]));
    });

    // The two types meet at the start of the job: a cleaner who took 20 before photos must be able to add the first after photo, which a count of both
    // types together refuses. The other way round (a job that holds after photos and has not started) is a state no route makes, so it is not a case.
    test('Photos: the limit is per type: a started job that holds 20 before photos takes its first after photo (200), and with 19 more after photos the 21st is refused', async ({ playwright, request, baseURL }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const { job, cleaner } = await probeJob(ctx);
        const countOfType = (type) => countOf('SELECT COUNT(*) AS n FROM job_photos WHERE booking_id = ? AND photo_type = ?', [job.bookingId, type]);
        await plantPhotos(job.bookingId, 'before', PHOTOS_MAX_PER_TYPE);
        await setStatus(job.bookingId, 'in_progress');
        const first = await postParts(request, job, cleaner, [typePart('after'), photoPart(TINY_JPEG)]);
        expect(first.status, `the first after photo of a job with 20 before photos is kept (${first.body?.message ?? 'no message'})`).toBe(200);
        expect([await countOfType('before'), await countOfType('after')], 'the before photos are as they were and the photo is the first after photo').toEqual([PHOTOS_MAX_PER_TYPE, 1]);
        await plantPhotos(job.bookingId, 'after', PHOTOS_MAX_PER_TYPE - 1);
        await refused(job, 'the 21st after photo', 409, PHOTO_MESSAGES.tooMany, () => postParts(request, job, cleaner, [typePart('after'), photoPart(TINY_JPEG)]));
        expect([await countOfType('before'), await countOfType('after')], 'both types stay at 20').toEqual([PHOTOS_MAX_PER_TYPE, PHOTOS_MAX_PER_TYPE]);
    });

    // The store is the last thing the route reaches: a photo that passes every rung and can not be written is 503 and leaves no row, no event and no file. The app runs
    // as root in its container, so no directory mode would stop it; a plain file where the directory should be does, because the store can not make a directory over
    // a file. The directory goes back in the finally, with the files it held. Mutant that turns this case red: the route answers 500 or 200 for a failed write, or
    // keeps a row or an event for a photo that was not stored.
    test('Photos: a store that can not write is 503 "Photos can not be saved right now. Try again in a minute." and keeps no row, no event and no file', async ({ playwright, request, baseURL }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const { job, cleaner } = await probeJob(ctx);
        const aside = `${PHOTO_DIRECTORY}.aside-${tag()}`;
        let moved = false;
        try {
            try {
                await fs.rename(PHOTO_DIRECTORY, aside);
                moved = true;
            } catch (error) {
                if (/** @type {any} */ (error).code !== 'ENOENT') throw error;
            }
            await fs.writeFile(PHOTO_DIRECTORY, 'a file where the photo directory should be');
            await refused(job, 'a photo the store can not write', 503, PHOTO_MESSAGES.store, () => postParts(request, job, cleaner, [typePart('before'), photoPart(TINY_JPEG)]));
        } finally {
            if ((await fs.stat(PHOTO_DIRECTORY).catch(() => null))?.isFile()) await fs.rm(PHOTO_DIRECTORY, { force: true });
            if (moved) await fs.rename(aside, PHOTO_DIRECTORY);
        }
        const kept = await postParts(request, job, cleaner, [typePart('before'), photoPart(TINY_JPEG)]);
        expect(kept.status, `with the directory back the same photo is kept (${kept.body?.message ?? 'no message'})`).toBe(200);
    });
});

// ---- what is kept ----

const KEPT = [
    ['JPEG', TINY_JPEG, 'jpg', 'image/jpeg', 'kitchen-before.jpg'],
    ['PNG sent as image/jpeg named x.jpg', TINY_PNG, 'png', 'image/jpeg', 'x.jpg'],
    ['WebP sent as image/png named lounge.png', TINY_WEBP, 'webp', 'image/png', 'lounge.png'],
];

test.describe('Job photo route: what is kept', () => {
    sweepAround();

    for (const [label, bytes, ext, claimedType, claimedName] of KEPT) {
        test(`AC1: a ${label} from a checked-in cleaner is 200 with { photo, photos }, stored as ${ext} from its bytes, with a photo_added event for the cleaner and no photo address in it`, async ({ playwright, request, baseURL }) => {
            test.setTimeout(180_000);
            const ctx = await setup(playwright, request, baseURL);
            const { member, job, cleaner } = await probeJob(ctx);
            const eventsBefore = await countOf("SELECT COUNT(*) AS n FROM job_link_events WHERE booking_id = ? AND kind = 'photo_added'", [job.bookingId]);

            const answer = await postParts(request, job, cleaner, [typePart('before'), photoPart(bytes, { name: claimedName, type: claimedType })]);
            expect(answer.status, `the ${label} is kept (${answer.body?.message ?? 'no message'})`).toBe(200);
            expect(answer.cache, 'no-store').toContain('no-store');
            expect(answer.body.success, 'success').toBe(true);
            const { photo, photos } = answer.body.data;
            expect(Number.isInteger(photo.id), 'photo.id is an integer').toBe(true);
            expect(photo.type, 'photo.type').toBe('before');
            expect(photo.url, 'the address has 32 hex characters and the extension of the bytes').toMatch(new RegExp(`^/uploads/job-photos/[0-9a-f]{32}\\.${ext}$`));
            expect(photo.url.includes(claimedName) || photo.url.includes(claimedName.split('.')[0]), 'the name the client gave is nowhere in the address').toBe(false);
            expect([photo.taken_by.kind, photo.taken_by.name], 'taken_by names the cleaner').toEqual(['cleaner', member.name]);
            expect(Number.isFinite(Date.parse(photo.taken_at)), 'taken_at is a time').toBe(true);
            expect(Array.isArray(photos) && photos.length === 1 && photos[0].id === photo.id, 'photos lists the job\'s one photo').toBe(true);

            const onDisk = await fs.readFile(path.join(process.cwd(), 'public', photo.url));
            expect(Buffer.compare(onDisk, bytes), 'the stored file holds the bytes that were sent').toBe(0);

            const [row] = await rows('SELECT photo_url, photo_type, taken_by_kind, taken_by_ref, uploaded_by FROM job_photos WHERE booking_id = ?', [job.bookingId]);
            expect([row.photo_url, row.photo_type, row.taken_by_kind, String(row.taken_by_ref), row.uploaded_by], 'the row names the address, the type, the cleaner and the booking\'s provider').toEqual([photo.url, 'before', 'cleaner', String(member.id), PROVIDER1.id]);

            const events = await rows("SELECT * FROM job_link_events WHERE booking_id = ? AND kind = 'photo_added'", [job.bookingId]);
            expect(events.length - eventsBefore, 'one photo_added event').toBe(1);
            expect([events[0].actor_kind, events[0].crew_member_id, events[0].detail], 'the event names the cleaner and the type').toEqual(['cleaner', member.id, 'before']);
            const text = JSON.stringify(events);
            expect(text.includes(photo.url) || text.includes(photo.url.split('/').pop()) || /uploads|job-photos/.test(text), 'the event holds no photo address').toBe(false);
        });
    }

    test('AC1: the provider and the admin each add a photo with no check-in; the photo and the photo_added event name who took it', async ({ playwright, request, baseURL }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const { job } = await probeJob(ctx, { checkIn: false });
        for (const [who, headers, kind] of [['the provider', ctx.as.provider, 'provider'], ['the admin', ctx.as.admin, 'admin']]) {
            const answer = await postParts(request, job, headers, [typePart('before'), photoPart(TINY_JPEG)]);
            expect(answer.status, `${who} adds a before photo (${answer.body?.message ?? 'no message'})`).toBe(200);
            expect(answer.body.data.photo.taken_by.kind, `${who}: taken_by.kind`).toBe(kind);
            expect(typeof answer.body.data.photo.taken_by.name, `${who}: taken_by.name is text`).toBe('string');
            const [row] = await rows("SELECT actor_kind, detail FROM job_link_events WHERE booking_id = ? AND kind = 'photo_added' AND actor_kind = ?", [job.bookingId, kind]);
            expect([row?.actor_kind, row?.detail], `${who}: the photo_added event`).toEqual([kind, 'before']);
        }
        expect(await countOf('SELECT COUNT(*) AS n FROM job_photos WHERE booking_id = ?', [job.bookingId]), 'two photos are kept').toBe(2);
    });

    test('AC1: a JPEG with an Exif segment that carries GPS is kept without it: the stored file has neither Exif nor GPS, starts FF D8 and ends FF D9', async ({ playwright, request, baseURL }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const { job, cleaner } = await probeJob(ctx);
        expect(JPEG_WITH_EXIF.includes('Exif') && JPEG_WITH_EXIF.includes('GPS'), 'the upload carries the Exif text and the GPS text').toBe(true);
        const answer = await postParts(request, job, cleaner, [typePart('before'), photoPart(JPEG_WITH_EXIF)]);
        expect(answer.status, `the JPEG with Exif is kept (${answer.body?.message ?? 'no message'})`).toBe(200);
        const onDisk = await fs.readFile(path.join(process.cwd(), 'public', answer.body.data.photo.url));
        expect(onDisk.includes('Exif'), 'the stored file has no Exif').toBe(false);
        expect(onDisk.includes('GPS'), 'the stored file has no GPS').toBe(false);
        expect([onDisk[0], onDisk[1]], 'the stored file starts FF D8').toEqual([0xff, 0xd8]);
        expect([onDisk[onDisk.length - 2], onDisk[onDisk.length - 1]], 'the stored file ends FF D9').toEqual([0xff, 0xd9]);
        expect(onDisk.length, 'only the Exif segment was cut').toBe(JPEG_WITH_EXIF.length - EXIF.length);
    });
});

// ---- the addresses the lists show ----

// Security gate round 1, F1. Both screens put the address of every row in a link (an <a href> that opens it, an <img src> that shows it), and the rows
// are not all the store's: the provider's own routes keep any string (src/app/api/provider/jobs/photos/route.js) and the older upload keeps the
// extension of a file whose declared type is image/* (src/app/api/upload/route.js), SVG included, which the uploads route serves inline. So the three answers
// that list a job's photos leave out a row unless its address is a photo of the store or an older raster upload.
const OLDER_UPLOAD_URL = '/uploads/1-photo.png';
const HOSTILE_URLS = [
    '/uploads/1-x.svg',
    `/uploads/job-photos/${'0'.repeat(32)}.svg`,
    'https://evil.example/p.png',
    '//evil.example/p.png',
    'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSkgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIi8+',
    '/uploads/../x.png',
    '/uploads/1-a/b.png',
];

const readData = async (request, url, headers, who) => okOf(await answerOf(await request.get(url, { headers, timeout: REQUEST_TIMEOUT })), who);
// What a list says of each photo that matters here, sorted so that the order the rows came in does not.
const typedUrls = (data) => data.photos.map((photo) => `${photo.type} ${photo.url}`).sort();

test.describe('Job photo route: the addresses the lists show', () => {
    sweepAround();

    // Mutant that turns this case red: a list is built from the rows as they are (the code at d411ae7), or only one or two of the three answers filter, or the
    // pattern lets an SVG, a store-shaped address with another extension, an address with a host or a scheme, or a path that climbs or nests through.
    test('F1: the cleaner\'s page, the provider\'s panel and the admin\'s panel each list the two photos whose addresses the page may link and none of the eight beside them (an SVG, a store-shaped SVG, two off-site addresses, a script address, a data address, a path that climbs, a path that nests)', async ({ playwright, request, baseURL }) => {
        test.setTimeout(180_000);
        const ctx = await setup(playwright, request, baseURL);
        const { job, cleaner } = await probeJob(ctx);
        const storedUrl = storeAddress();
        await plantRows(job.bookingId, 'before', HOSTILE_URLS.slice(0, 4));
        await plantRows(job.bookingId, 'before', [OLDER_UPLOAD_URL]);
        await plantRows(job.bookingId, 'after', HOSTILE_URLS.slice(4));
        await plantRows(job.bookingId, 'after', [storedUrl]);
        expect(await countOf('SELECT COUNT(*) AS n FROM job_photos WHERE booking_id = ?', [job.bookingId]), 'the ten rows are in the table: they are left out of the lists, not out of the job').toBe(HOSTILE_URLS.length + 2);

        const expected = [`before ${OLDER_UPLOAD_URL}`, `after ${storedUrl}`].sort();
        const answers = [
            ['the cleaner\'s page', await readData(request, `/api/job/${job.token}`, cleaner, 'the cleaner reads the job')],
            ['the provider\'s panel', await readData(request, `/api/provider/jobs/${job.bookingId}/job-link`, ctx.as.provider, 'the provider reads the panel')],
            ['the admin\'s panel', await readData(request, `/api/admin/bookings/${job.bookingId}/job-link`, ctx.as.admin, 'the admin reads the panel')],
        ];
        for (const [who, data] of answers) {
            expect(typedUrls(data), `${who} lists the older upload and the stored photo and nothing else`).toEqual(expected);
            const text = JSON.stringify(data);
            for (const url of HOSTILE_URLS) expect(text.includes(url), `${who} holds no ${url.slice(0, 24)} anywhere in its answer`).toBe(false);
        }
    });

    // The count that gates a new photo is the route's own COUNT(*) over the rows, left-out ones included (addPhoto), so the page must not offer a photo the route will
    // refuse, and must not count a type with the other's rows. Mutant that turns this case red: photo_can is worked out from the list that is shown, or from both
    // types together, or for the wrong type; or the answer to the POST lists the rows that are left out.
    test('F1: a row that is left out of the lists still counts toward the 20 of its type: with 19 such rows one more photo is kept, then the page offers no more and the route refuses the next, and the after photos are counted apart', async ({ playwright, request, baseURL }) => {
        test.setTimeout(240_000);
        const ctx = await setup(playwright, request, baseURL);
        const { job, cleaner } = await probeJob(ctx);
        const hidden = (letter) => Array.from({ length: PHOTOS_MAX_PER_TYPE - 1 }, (_, n) => `/uploads/${n + 1}-${letter}.svg`);
        await plantRows(job.bookingId, 'before', hidden('b'));
        const open = await readData(request, `/api/job/${job.token}`, cleaner, 'the cleaner reads a job with 19 before photos left out');
        expect([open.photos, open.photo_can.before], 'nothing is listed and one more before photo may be added').toEqual([[], true]);

        const kept = await postParts(request, job, cleaner, [typePart('before'), photoPart(TINY_JPEG)]);
        expect(kept.status, `the 20th before photo is kept (${kept.body?.message ?? 'no message'})`).toBe(200);
        expect(kept.body.data.photos.map((photo) => photo.id), 'the answer to the POST lists the new photo and not the 19 left out').toEqual([kept.body.data.photo.id]);
        const full = await readData(request, `/api/job/${job.token}`, cleaner, 'the cleaner reads a job that holds 20 before photos');
        expect([full.photos.length, full.photo_can.before], 'one photo is listed and the page offers no more: the 19 left out are in the count').toEqual([1, false]);
        await refused(job, 'the 21st before photo, 19 of the 20 being left out of the lists', 409, PHOTO_MESSAGES.tooMany, () => postParts(request, job, cleaner, [typePart('before'), photoPart(TINY_JPEG)]));

        // The job starts: the 20 before rows are another type's and the after photos start from none, hidden ones counted the same way.
        await setStatus(job.bookingId, 'in_progress');
        const started = await readData(request, `/api/job/${job.token}`, cleaner, 'the cleaner reads the started job');
        expect(started.photo_can, 'started: no more before photos, and the 20 before rows are not the after photos\' count').toEqual({ before: false, after: true });
        await plantRows(job.bookingId, 'after', hidden('a'));
        const afterKept = await postParts(request, job, cleaner, [typePart('after'), photoPart(TINY_JPEG)]);
        expect(afterKept.status, `the 20th after photo is kept (${afterKept.body?.message ?? 'no message'})`).toBe(200);
        const end = await readData(request, `/api/job/${job.token}`, cleaner, 'the cleaner reads a job that holds 20 of each');
        expect([end.photos.map((photo) => photo.type).sort(), end.photo_can], 'the two photos taken here are listed and neither type has room').toEqual([['after', 'before'], { before: false, after: false }]);
        await refused(job, 'the 21st after photo, 19 of the 20 being left out of the lists', 409, PHOTO_MESSAGES.tooMany, () => postParts(request, job, cleaner, [typePart('after'), photoPart(TINY_JPEG)]));
    });
});

// The rule itself, in plain Node, address by address. Mutant that turns a row red: the pattern admits the address (an extension, a second segment, a host, a
// scheme, a newline) or turns away one of the shapes the page has to show (the store's three extensions, an older upload in any case of its extension).
const SHOWN = [
    `/uploads/job-photos/${'0'.repeat(32)}.jpg`,
    `/uploads/job-photos/${'f'.repeat(32)}.png`,
    `/uploads/job-photos/${'a1'.repeat(16)}.webp`,
    '/uploads/1-photo.png',
    '/uploads/1760000000000-kitchen_before.jpg',
    '/uploads/1-a.b.c.jpeg',
    '/uploads/17-Photo_1.PNG',
    '/uploads/17-x.WebP',
    '/uploads/17-x.gif',
];
const NOT_SHOWN = [
    // What the older upload keeps when a file is declared image/* and is not a raster, and the store's own shape with an extension it never gives.
    '/uploads/1-x.svg', '/uploads/1-x.SVG', '/uploads/1-x.pdf', '/uploads/1-x.png.svg', '/uploads/1-x', '/uploads/1-x.html',
    `/uploads/job-photos/${'0'.repeat(32)}.svg`, `/uploads/job-photos/${'0'.repeat(32)}.gif`, `/uploads/job-photos/${'0'.repeat(32)}.jpeg`,
    // The store's shape, slightly off.
    `/uploads/job-photos/${'A'.repeat(32)}.jpg`, `/uploads/job-photos/${'0'.repeat(31)}.jpg`, `/uploads/job-photos/${'0'.repeat(33)}.jpg`,
    `/uploads/job-photos/${'0'.repeat(32)}.JPG`, `/uploads/job-photos/${'0'.repeat(32)}`, '/uploads/job-photos/', '/uploads/job-photos/x.png', `/uploads/job-photos/sub/${'0'.repeat(32)}.jpg`,
    // The older upload's shape, slightly off.
    '/uploads/photo.png', '/uploads/x-photo.png', '/uploads/-photo.png', '/uploads/1photo.png', '/uploads//1-x.png', '/uploads/1-a b.png', '/uploads/1-a%2fb.png', '/uploads/1-ü.png',
    // A path that leaves the folder or goes deeper, an address with a host or a scheme, and a script.
    '/uploads/../x.png', '/uploads/1-a/b.png', '/uploads/1-a/../b.png', '/x.png', 'uploads/1-x.png', './uploads/1-x.png',
    'https://evil.example/p.png', 'http://localhost:3000/uploads/1-x.png', '//evil.example/p.png', '/\\evil.example/p.png', '\\\\evil.example\\p.png',
    'javascript:alert(1)', 'data:image/png;base64,iVBORw0KGgo=', 'data:image/svg+xml;base64,PHN2Zy8+', 'blob:https://evil.example/1',
    // Anything after the extension, and anything around the address.
    '/uploads/1-x.png?x=1', '/uploads/1-x.png#x', '/uploads/1-x.png\n', '/uploads/1-x.png\r\n', '/uploads/1-x.png ', ' /uploads/1-x.png', '\n/uploads/1-x.png', '',
];

test.describe('Job photo route: which addresses the lists show, in plain Node', () => {
    test('F1: isShownAddress is true for a photo of the store and for an older raster upload in any case of its extension, and false for every address in the table of what a row can hold', () => {
        for (const url of SHOWN) expect(isShownAddress(url), `${url} is shown`).toBe(true);
        for (const url of NOT_SHOWN) expect(isShownAddress(url), `${JSON.stringify(url)} is not shown`).toBe(false);
        // A value that is not a string is not an address (a row's column is not null, but the function takes what it is given).
        for (const value of [undefined, null, 42, true, {}, [], [SHOWN[0]], { toString: () => SHOWN[0] }]) expect(isShownAddress(value), `${typeof value} ${JSON.stringify(value)} is not shown`).toBe(false);
    });
});

// ---- the cap on the body ----

test.describe('Job photo route: the cap on the body', () => {
    sweepAround();

    test('Photos: a multipart body of exactly the cap is kept (200), the file as long as the framing allows', async ({ playwright, request, baseURL }) => {
        test.setTimeout(240_000);
        const ctx = await setup(playwright, request, baseURL);
        const { job, cleaner } = await probeJob(ctx);
        const built = exactBody(PHOTO_MAX_BYTES, [typePart('before')]);
        expect(built.body.length, 'the body is exactly the cap').toBe(PHOTO_MAX_BYTES);
        const answer = await postBody(request, job, cleaner, built.contentType, built.body);
        expect(answer.status, `a body of exactly the cap is kept (${answer.body?.message ?? 'no message'})`).toBe(200);
        expect(answer.cache, 'no-store').toContain('no-store');
        expect(answer.body.data.photo.url, 'the address').toMatch(photoUrlPattern);
        expect(await countOf('SELECT COUNT(*) AS n FROM job_photos WHERE booking_id = ?', [job.bookingId]), 'one photo row').toBe(1);
    });

    test('Photos: a body with no length (chunked, no Content-Length) that runs far past the cap is stopped: 413 or a reset, nothing is written, and the app keeps answering', async ({ playwright, request, baseURL }) => {
        test.setTimeout(240_000);
        const ctx = await setup(playwright, request, baseURL);
        const { job, cleaner } = await probeJob(ctx);
        const before = await watched(job.bookingId);
        const boundary = '----jrtendless';
        const result = await sendRaw(ctx.baseURL, `/api/job/${job.token}/photos`, {
            headers: { ...cleaner, 'content-type': `multipart/form-data; boundary=${boundary}` },
            declared: null,
            chunks: endlessUpload(boundary),
            stopAfter: PHOTO_MAX_BYTES * 6,
        });
        if (!result.reset) expectRefusal(rawAnswer(result), 413, PHOTO_MESSAGES.tooBig, 'a chunked body past the cap');
        expect(await watched(job.bookingId), `a chunked body past the cap (${result.reset ?? 'answered'}): nothing was written`).toEqual(before);
        await expectServing(request, job, cleaner, 'after the chunked body');
    });

    test('Photos: a Content-Length smaller than the body that is sent never lets the surplus into a photo: the answer is a refusal (the route\'s 413 or 400, or the server\'s own 400) or a reset, nothing is written, and the app keeps answering', async ({ playwright, request, baseURL }) => {
        test.setTimeout(240_000);
        const ctx = await setup(playwright, request, baseURL);
        const { job, cleaner } = await probeJob(ctx);
        const before = await watched(job.bookingId);
        // The HTTP layer ends a body at its declared length and reads the surplus as the start of another request, so the counter in the route sees
        // at most what was declared; what the client sees is the route's refusal of the cut form, the server's own 400 for the surplus, or a reset.
        const built = exactBody(PHOTO_MAX_BYTES + 4096, [typePart('before')]);
        for (const declared of [100, 5000, PHOTO_MAX_BYTES - 1000]) {
            const result = await sendRaw(ctx.baseURL, `/api/job/${job.token}/photos`, {
                headers: { ...cleaner, 'content-type': built.contentType },
                declared,
                chunks: slices(built.body),
            });
            if (!result.reset) {
                expect([400, 413].includes(result.status), `declared ${declared} for a body of ${built.body.length}: status ${result.status}`).toBe(true);
            }
            expect(await watched(job.bookingId), `declared ${declared} (${result.reset ?? 'answered'}): nothing was written`).toEqual(before);
            await expectServing(request, job, cleaner, `after declaring ${declared}`);
        }
    });
});

// ---- the counter, in plain Node ----

// A request whose body is the stream, with the headers as given.
const requestOf = (stream, headers = {}) => new Request('http://localhost/photos', { method: 'POST', headers, body: stream, duplex: 'half' });

// A stream of chunks of the sizes given. It is read only on demand (a high-water mark of 0), so `pulled` is the number of chunks the reader asked for.
function sourceOf(sizes) {
    const state = { pulled: 0, sent: 0, cancelled: false };
    const queue = [...sizes];
    const stream = new ReadableStream({
        pull(controller) {
            const size = queue.shift();
            if (size === undefined) {
                controller.close();
                return;
            }
            state.pulled += 1;
            state.sent += size;
            controller.enqueue(new Uint8Array(size).fill(0x61));
        },
        cancel() {
            state.cancelled = true;
        },
    }, { highWaterMark: 0 });
    return { stream, state };
}

// A stream that has no end: every pull makes another chunk.
function endlessSource(size) {
    const state = { pulled: 0, sent: 0, cancelled: false };
    const stream = new ReadableStream({
        pull(controller) {
            state.pulled += 1;
            state.sent += size;
            controller.enqueue(new Uint8Array(size).fill(0x61));
        },
        cancel() {
            state.cancelled = true;
        },
    }, { highWaterMark: 0 });
    return { stream, state };
}

test.describe('readCappedBody: the counter in front of the form parser', () => {
    test('Photos: a body of exactly the cap passes, in one chunk and in many', async () => {
        const many = sourceOf([300, 300, 300, 100]);
        const passed = await readCappedBody(requestOf(many.stream), 1000);
        expect(passed.ok, 'four chunks that add up to the cap').toBe(true);
        expect(passed.bytes.length, 'all 1000 bytes are returned').toBe(1000);
        expect(many.state.cancelled, 'the source was read to its end, not cancelled').toBe(false);

        const one = sourceOf([1000]);
        const single = await readCappedBody(requestOf(one.stream), 1000);
        expect([single.ok, single.bytes.length], 'one chunk of exactly the cap').toEqual([true, 1000]);
    });

    test('Photos: a body one byte over the cap is refused, reading stops there and the source is cancelled', async () => {
        const source = sourceOf([500, 500, 1, 400, 400]);
        const result = await readCappedBody(requestOf(source.stream), 1000);
        expect(result.ok, 'one byte over the cap').toBe(false);
        expect(source.state.cancelled, 'the source was cancelled').toBe(true);
        expect(source.state.pulled <= 3, `reading stopped at the chunk that crossed the cap (${source.state.pulled} chunks were pulled)`).toBe(true);
        expect(source.state.sent <= 1001, `no byte past the crossing chunk was made (${source.state.sent})`).toBe(true);
    });

    test('Photos: a stream that never ends is cut at the cap, its source is cancelled and it is not drained', async () => {
        const source = endlessSource(1024);
        const result = await readCappedBody(requestOf(source.stream), 10_000);
        expect(result.ok, 'a stream with no end').toBe(false);
        expect(source.state.cancelled, 'the source was cancelled').toBe(true);
        expect(source.state.pulled <= 12, `the reader stopped after about ten chunks (${source.state.pulled} were pulled)`).toBe(true);
    });

    test('Photos: a Content-Length that is missing or false does not matter: the bytes that arrive are what is counted', async () => {
        const none = sourceOf([600, 600]);
        expect((await readCappedBody(requestOf(none.stream), 1000)).ok, 'no Content-Length, 1200 bytes against a cap of 1000').toBe(false);

        const small = sourceOf([300, 300]);
        const kept = await readCappedBody(requestOf(small.stream, { 'content-length': '5' }), 1000);
        expect([kept.ok, kept.bytes.length], 'a Content-Length of 5 does not cut a body of 600 that fits').toEqual([true, 600]);

        const lie = sourceOf([600, 600]);
        expect((await readCappedBody(requestOf(lie.stream, { 'content-length': '5' }), 1000)).ok, 'a Content-Length of 5 does not let 1200 bytes through').toBe(false);

        const huge = sourceOf([10]);
        const fits = await readCappedBody(requestOf(huge.stream, { 'content-length': '999999999' }), 1000);
        expect([fits.ok, fits.bytes.length], 'a Content-Length of 999999999 does not refuse a body of 10').toEqual([true, 10]);

        const words = sourceOf([10]);
        const readable = await readCappedBody(requestOf(words.stream, { 'content-length': 'abc' }), 1000);
        expect([readable.ok, readable.bytes.length], 'a Content-Length that is not a number does not matter').toEqual([true, 10]);
    });

    test('Photos: a request with no body passes with no bytes', async () => {
        const result = await readCappedBody(new Request('http://localhost/photos', { method: 'POST' }), 1000);
        expect([result.ok, result.bytes.length]).toEqual([true, 0]);
    });
});
