// @ts-check
// ENG-016, the photo store in plain Node and the source pins that guard it. The cases run src/lib/job-photo-store.js on real bytes (a one-pixel JPEG,
// PNG and WebP as an encoder wrote them, and the files a client might send in their place), so nothing in this file starts a browser, reaches the
// database or asks the running app. addPhoto, photosFor, the routes and the retention need the database and the app: their cases are in the other
// ENG-016 files. Each title starts with the design's id for the row it settles
// (agents/architect/designs/ENG-016-photos-and-countdown-timer-on-the-job-link.md, "Cases and baseline"), and the file's name, the describe and the
// title together are its baseline key:
//   AC1     the part of it that needs no database: a photo saved through the store holds the bytes less the metadata (no Exif, no GPS), under an
//           address that is 32 random hex characters and the extension of the bytes;
//   Photos  sniffImage (a JPEG, a PNG and a WebP accepted; a GIF, an SVG with and without an XML header, an HTML page, a PDF, a WAV, an empty file and a
//           two-byte file refused); stripJpegMetadata (the Exif JPEG comes back without Exif and GPS, starting FF D8 and ending FF D9; a truncated JPEG
//           and one that does not parse cleanly to its scan are refused; a PNG, a WebP and a JPEG with no Exif come back as they came); savePhoto (PNG
//           bytes are stored .png; a thousand addresses are distinct and match the pattern; forty at once do not write over one another); removePhoto
//           (throws on /uploads/../x, /uploads/job-photos/../../x, an upper-case name and a name with no extension, and deletes nothing); storedPhotos;
//           and a PHOTO_DIR that cannot be written, which makes savePhoto throw (addPhoto answers that as `store`);
//   Pins    source checks: node:fs is imported by no new file but the store; job_photos is named only by job-photos.js and job-photo-retention.js; no
//           new file contains query(; PHOTO_DIR, PHOTO_URL_BASE, PHOTO_MAX_BYTES and PHOTOS_MAX_PER_TYPE are at their values; git ignores
//           public/uploads/job-photos/x.jpg; usePhotoDir is named by nothing under src/ but the store; the store draws an address from
//           crypto.randomBytes(16) and writes it with the exclusive flag.
// Where the files go: a case that saves a file points the store at a scratch directory of its own (usePhotoDir, the store's test-only seam), deletes
// the files it made, checks with storedPhotos() that the directory holds what it held before the case, and, in a finally, puts the store back and
// removes the scratch directory. Nothing here is written to public/uploads/job-photos, which is the stack's disk. Cases run in the order of the file,
// one worker, and they do not depend on one another.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { PHOTO_DIR, PHOTO_MAX_BYTES, PHOTO_URL_BASE, removePhoto, savePhoto, sniffImage, storedPhotos, stripJpegMetadata, usePhotoDir } from '../src/lib/job-photo-store.js';

// Nothing here sends a request, so a trace would record nothing; the convention of the other plain-Node specs is kept: tracing is off.
test.use({ trace: 'off' });

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const STORE = 'src/lib/job-photo-store.js';
const LIBRARY = 'src/lib/job-photos.js';
const RETENTION = 'src/lib/job-photo-retention.js';
const ADDRESS = /^\/uploads\/job-photos\/[0-9a-f]{32}\.(jpg|png|webp)$/;

// ---- the bytes ------------------------------------------------------------------------------------------------------------------------------
// A JPEG, a PNG and a WebP of one pixel each, as an encoder (Pillow) wrote them, kept as base64 so that this file needs nothing beside it. Everything
// else is built here from the formats' own markers. A JPEG segment is FF, a marker byte, a two-byte length that counts itself, then the payload.

const JPEG = Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////' +
        '////////////////////////2wBDAf//////////////////////////////////////////////////////////////////' +
        '////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAP/xAAUEAEAAAAAAAAAAAAA' +
        'AAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKAA/9k=',
    'base64'
);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4//8/AAX+Av4zEpUUAAAAAElFTkSuQmCC', 'base64');
const WEBP = Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=', 'base64');

const latin1 = (text) => Buffer.from(text, 'latin1');

/** A JPEG segment: FF, the marker, a two-byte length that counts itself, then the payload. */
function segment(marker, payload) {
    const head = Buffer.from([0xff, marker, 0, 0]);
    head.writeUInt16BE(payload.length + 2, 2);
    return Buffer.concat([head, payload]);
}

/** `piece` put into `bytes` just before offset `at`. */
const splice = (bytes, at, piece) => Buffer.concat([bytes.subarray(0, at), piece, bytes.subarray(at)]);

/** Whether `actual` is a Buffer that holds exactly the bytes of `expected` (an answer of null is not). */
const sameBytes = (actual, expected) => Buffer.isBuffer(actual) && actual.equals(expected);

const AFTER_SOI = 2;
// The JFIF segment the encoder wrote after the start of image: its marker, then 16 bytes that count themselves.
const AFTER_APP0 = AFTER_SOI + 2 + 16;
const START_OF_SCAN = Buffer.from([0xff, 0xda]);
const SOS_AT = JPEG.indexOf(START_OF_SCAN);

// What a camera writes: an APP1 segment that starts with the Exif header, holds the start of a TIFF block, and carries the text GPS with a position.
const EXIF = segment(0xe1, Buffer.concat([latin1('Exif\0\0'), latin1('MM\0*\0\0\0\b'), latin1('GPS 43.6532N 79.3832W')]));
// Two APP1 segments that are not Exif: XMP, and one too short to hold the Exif header.
const XMP = segment(0xe1, Buffer.concat([latin1('http://ns.adobe.com/xap/1.0/\0'), latin1('<x:xmpmeta/>')]));
const SHORT_APP1 = segment(0xe1, latin1('Exif'));
const JPEG_WITH_EXIF = splice(JPEG, AFTER_SOI, EXIF);

// The files a client might send in place of a photo.
const GIF = Buffer.concat([latin1('GIF89a'), Buffer.from([1, 0, 1, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0, 0x3b])]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><script>alert(1)</script></svg>');
const SVG_WITH_XML_HEADER = Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>');
const HTML = Buffer.from('<!doctype html><html><body><script>alert(1)</script></body></html>');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const WAV = Buffer.concat([latin1('RIFF'), Buffer.from([4, 0, 0, 0]), latin1('WAVE')]);
const TWO_BYTES = Buffer.from([0xff, 0xd8]);

// ---- the scratch directory ------------------------------------------------------------------------------------------------------------------

/**
 * Runs `body` with the store pointed at a directory of its own, three levels down in a fresh temporary directory so that a path built from a bad
 * address lands inside it, and not made yet (the store makes it). Puts the store back and removes everything in a finally. When the body ends, the
 * store must list what it listed before the body began: a case deletes the files it made.
 * @param {(where: { root: string, directory: string }) => Promise<void>} body
 */
async function inScratch(body) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eng016-photos-'));
    const directory = path.join(root, 'one', 'two', 'job-photos');
    const earlier = usePhotoDir(directory);
    try {
        const before = await storedPhotos();
        await body({ root, directory });
        usePhotoDir(directory);
        expect(await storedPhotos(), 'the case deleted the photo files it made').toEqual(before);
    } finally {
        usePhotoDir(earlier);
        fs.rmSync(root, { recursive: true, force: true });
    }
}

// ================================================================================================================================
// The store in plain Node
// ================================================================================================================================

test.describe('ENG-016 photos: the store in plain Node', () => {
    // Mutant that turns this case red: sniffImage stops reading the signature (it answers jpg for any bytes, or trusts a name or a type), so a kind of
    // file the app has not chosen to serve is stored, and a PNG or a WebP is given the wrong extension.
    test('Photos: sniffImage accepts a JPEG, a PNG and a WebP by their first bytes and names the extension to store', () => {
        expect(sniffImage(JPEG)).toEqual({ ext: 'jpg' });
        expect(sniffImage(JPEG_WITH_EXIF)).toEqual({ ext: 'jpg' });
        expect(sniffImage(PNG)).toEqual({ ext: 'png' });
        expect(sniffImage(WEBP)).toEqual({ ext: 'webp' });
        expect(sniffImage(new Uint8Array(PNG)), 'a plain Uint8Array is bytes too').toEqual({ ext: 'png' });
    });

    // Mutant that turns this case red: sniffImage accepts a GIF, an SVG, an HTML page or a PDF (a wider list of signatures, or a look at the type the
    // client sent), so a file that can carry script is stored and then served by this app from its own origin.
    test('Photos: sniffImage refuses a GIF, an SVG with and without an XML header, an HTML page, a PDF, a WAV, an empty file, a two-byte file and anything that is not bytes', () => {
        const refused = { GIF, SVG, 'SVG with an XML header': SVG_WITH_XML_HEADER, HTML, PDF, WAV, 'an empty file': Buffer.alloc(0), 'two bytes': TWO_BYTES };
        for (const [name, bytes] of Object.entries(refused)) expect(sniffImage(bytes), name).toBeNull();
        const notBytes = { undefined: undefined, null: null, 'a string that looks like a JPEG start': String.fromCharCode(0xff, 0xd8, 0xff, 0xe0), 'a number': 7, 'an object': {}, 'an array of numbers': [0xff, 0xd8, 0xff] };
        for (const [name, value] of Object.entries(notBytes)) expect(sniffImage(value), name).toBeNull();
    });

    // Mutant that turns this case red: sniffImage reads less of the signature than the format has (RIFF alone for a WebP, FF D8 alone for a JPEG, the
    // first bytes of a PNG), so a WAV, a half-written file or the start of another format is taken for a photo.
    test('Photos: sniffImage needs the whole signature: a PNG cut inside it, RIFF that is not WEBP, a WebP cut inside its tag and FF D8 without the third byte are refused', () => {
        expect(sniffImage(PNG.subarray(0, 7))).toBeNull();
        expect(sniffImage(WAV)).toBeNull();
        expect(sniffImage(Buffer.concat([latin1('RIFF'), Buffer.from([0, 0, 0, 0]), latin1('WEB')]))).toBeNull();
        expect(sniffImage(WEBP.subarray(0, 11))).toBeNull();
        expect(sniffImage(Buffer.from([0xff, 0xd8, 0x00]))).toBeNull();
    });

    // Mutant that turns this case red: stripJpegMetadata hands the Exif JPEG back as it came, or takes out a segment that is not the camera's, so a
    // photo of a house keeps the position of the phone that took it in a file that anyone with the address can read.
    test('Photos: stripJpegMetadata returns the Exif JPEG without Exif and GPS, starting FF D8 and ending FF D9, and equal to the JPEG the segment was put into', () => {
        expect(JPEG_WITH_EXIF.includes('Exif') && JPEG_WITH_EXIF.includes('GPS'), 'the fixture carries the camera segment and a position').toBe(true);
        expect(JPEG.includes('Exif') || JPEG.includes('GPS'), 'and the plain JPEG does not').toBe(false);
        const clean = stripJpegMetadata(JPEG_WITH_EXIF);
        expect(Buffer.isBuffer(clean), 'a buffer comes back').toBe(true);
        expect(clean.includes('Exif'), 'no Exif is left').toBe(false);
        expect(clean.includes('GPS'), 'no GPS is left').toBe(false);
        expect([...clean.subarray(0, 2)], 'it starts FF D8').toEqual([0xff, 0xd8]);
        expect([...clean.subarray(-2)], 'it ends FF D9').toEqual([0xff, 0xd9]);
        expect(sameBytes(clean, JPEG), 'what is left is the JPEG, byte for byte').toBe(true);
    });

    // Mutant that turns this case red: only the first Exif segment is taken out, or only one that sits straight after the start of image, so a second
    // one (cameras and editors do write more than one) keeps the position; or a segment that is not Exif (XMP, a short APP1) goes with them.
    test('Photos: stripJpegMetadata takes out every Exif segment wherever it sits before the scan, with the fill bytes before it, and leaves XMP and a short APP1 alone', () => {
        expect(JPEG.readUInt16BE(4), 'the fixture starts with the JFIF segment this case counts on').toBe(16);
        expect(JPEG.indexOf(START_OF_SCAN), 'and has one start of scan').toBe(JPEG.lastIndexOf(START_OF_SCAN));
        let several = splice(JPEG, AFTER_SOI, EXIF);
        several = splice(several, AFTER_SOI, EXIF);
        several = splice(several, AFTER_APP0 + 2 * EXIF.length, EXIF);
        several = splice(several, SOS_AT + 3 * EXIF.length, EXIF);
        expect(several.length, 'four Exif segments: two before the JFIF segment, one after it and one straight before the scan').toBe(JPEG.length + 4 * EXIF.length);
        expect(sameBytes(stripJpegMetadata(several), JPEG), 'all four are gone and the rest is untouched').toBe(true);

        const padded = splice(JPEG, AFTER_SOI, Buffer.from([0xff, 0xff]));
        expect(sameBytes(stripJpegMetadata(padded), padded), 'fill bytes before a marker are allowed').toBe(true);
        const paddedExif = splice(JPEG, AFTER_SOI, Buffer.concat([Buffer.from([0xff, 0xff]), EXIF]));
        expect(sameBytes(stripJpegMetadata(paddedExif), JPEG), 'and go with the Exif segment they come before').toBe(true);

        const kept = splice(splice(JPEG, AFTER_SOI, XMP), AFTER_SOI, SHORT_APP1);
        expect(sameBytes(stripJpegMetadata(kept), kept), 'XMP, and an APP1 too short to hold the Exif header, are not Exif and stay').toBe(true);
    });

    // Mutant that turns this case red: a JPEG with no Exif is copied, re-encoded or cut about, or a PNG or a WebP is, so a photo changes for no reason.
    test('Photos: stripJpegMetadata gives a JPEG with no Exif back as it came, and a PNG and a WebP as they came', () => {
        expect(sameBytes(stripJpegMetadata(JPEG), JPEG), 'a JPEG with no Exif').toBe(true);
        expect(sameBytes(stripJpegMetadata(PNG), PNG), 'a PNG').toBe(true);
        expect(sameBytes(stripJpegMetadata(WEBP), WEBP), 'a WebP').toBe(true);
    });

    // Mutant that turns this case red: stripJpegMetadata passes along what it cannot read, so the clean-up step becomes a way round the check on the
    // first bytes.
    test('Photos: stripJpegMetadata refuses what is not a JPEG, a PNG or a WebP', () => {
        const refused = { GIF, SVG, HTML, PDF, 'an empty file': Buffer.alloc(0), 'two bytes': TWO_BYTES };
        for (const [name, bytes] of Object.entries(refused)) expect(stripJpegMetadata(bytes), name).toBeNull();
        for (const value of [undefined, null, 'x']) expect(stripJpegMetadata(value), String(value)).toBeNull();
    });

    // Mutant that turns this case red: a JPEG that stops early is stored as it came when the walk fails to reach its scan, so a photo cut off by a
    // dropped connection, or made to look like one, is kept with whatever the part that was never read holds.
    test('Photos: the truncated JPEG is refused, wherever it is cut', () => {
        for (let at = 0; at < JPEG.length; at += 1) expect(stripJpegMetadata(JPEG.subarray(0, at)), `the JPEG cut at ${at} of ${JPEG.length}`).toBeNull();
        for (let at = 0; at < JPEG_WITH_EXIF.length; at += 1) expect(stripJpegMetadata(JPEG_WITH_EXIF.subarray(0, at)), `the Exif JPEG cut at ${at} of ${JPEG_WITH_EXIF.length}`).toBeNull();
        expect(sameBytes(stripJpegMetadata(JPEG), JPEG), 'and the whole of it is not').toBe(true);
    });

    // Mutant that turns this case red: a JPEG whose markers do not parse cleanly to its scan is stored as it came (the walk gives up and returns the
    // buffer), so bytes that nothing accounted for are kept along with whatever sits in them.
    test('Photos: a JPEG that does not parse cleanly to its scan is refused, not stored as it came', () => {
        const edited = (change) => {
            const copy = Buffer.from(JPEG);
            change(copy);
            return copy;
        };
        const refused = {
            'a first segment whose length runs past the end of the file': edited((copy) => copy.writeUInt16BE(0xffff, 4)),
            'a segment length of 1, under the 2 that count themselves': edited((copy) => copy.writeUInt16BE(1, 4)),
            'a segment length of 0': edited((copy) => copy.writeUInt16BE(0, 4)),
            'a marker that has no length where a segment should start': edited((copy) => { copy[3] = 0x01; }),
            'FF 00 where a marker should be': edited((copy) => { copy[3] = 0x00; }),
            'a restart marker before the scan': splice(JPEG, AFTER_SOI, Buffer.from([0xff, 0xd0])),
            'a second start of image': splice(JPEG, AFTER_SOI, Buffer.from([0xff, 0xd8])),
            'a stray byte between segments': splice(JPEG, AFTER_SOI, Buffer.from([0x12])),
            'an end of image before the scan': Buffer.concat([JPEG.subarray(0, AFTER_APP0), Buffer.from([0xff, 0xd9])]),
            'no start of scan at all': Buffer.concat([JPEG.subarray(0, SOS_AT), Buffer.from([0xff, 0xd9])]),
            'a scan with no end of image': JPEG.subarray(0, JPEG.length - 2),
            'a last marker that is not FF D9': edited((copy) => { copy[copy.length - 1] = 0xd8; }),
            'a byte after the end of image': Buffer.concat([JPEG, Buffer.from([0x0a])]),
        };
        for (const [name, bytes] of Object.entries(refused)) expect(stripJpegMetadata(bytes), name).toBeNull();
    });

    // Mutant that turns this case red: the answer is put together wrongly once there are many cuts (a range copied twice, or dropped), so a crafted file
    // made of thousands of tiny segments comes out damaged or with Exif left in it.
    test('Photos: stripJpegMetadata cleans a file made of twenty thousand tiny segments in one pass', () => {
        const comment = Buffer.from([0xff, 0xfe, 0x00, 0x02]);
        const tinyExif = segment(0xe1, latin1('Exif\0\0'));
        const crowd = Buffer.concat([JPEG.subarray(0, AFTER_SOI), ...Array.from({ length: 20000 }, (_, index) => (index % 2 === 0 ? tinyExif : comment)), JPEG.subarray(AFTER_SOI)]);
        const expected = Buffer.concat([JPEG.subarray(0, AFTER_SOI), ...Array.from({ length: 10000 }, () => comment), JPEG.subarray(AFTER_SOI)]);
        expect(crowd.length - expected.length, 'ten thousand Exif segments are to go').toBe(10000 * tinyExif.length);
        expect(sameBytes(stripJpegMetadata(crowd), expected), 'they go, and the ten thousand comments and the JPEG stay').toBe(true);
    });

    // Mutant that turns this case red: savePhoto writes the bytes it was handed and the cleaned ones are never what reaches the disk (or the cleaning
    // step is left out between the sniff and the save), or the address holds anything but 32 hex characters and an extension.
    test('AC1: a photo saved through the store holds the bytes less the metadata, and its address is 32 random hex characters and the extension of the bytes', async () => {
        await inScratch(async ({ directory }) => {
            const kind = sniffImage(JPEG_WITH_EXIF);
            const clean = stripJpegMetadata(JPEG_WITH_EXIF);
            const { url } = await savePhoto(clean, kind.ext);
            expect(url, 'the address').toMatch(ADDRESS);
            expect(url.startsWith(PHOTO_URL_BASE), 'it starts with PHOTO_URL_BASE').toBe(true);
            const name = url.slice(PHOTO_URL_BASE.length);
            const stored = fs.readFileSync(path.join(directory, name));
            expect(sameBytes(stored, JPEG), 'the file holds the JPEG less the camera segment').toBe(true);
            expect(stored.includes('GPS') || stored.includes('Exif'), 'no position and no Exif in the file').toBe(false);
            expect(fs.readdirSync(directory), 'one file, and it is the one the address names').toEqual([name]);
            await removePhoto(url);
            expect(fs.existsSync(path.join(directory, name)), 'removePhoto deleted it').toBe(false);
        });
    });

    // Mutant that turns this case red: the extension comes from somewhere the sender controls (a name, a type, a default of jpg), so PNG bytes sent as
    // image/jpeg under a .jpg name are stored as .jpg; or savePhoto takes an extension that is not one of the three, and a name can be put into the
    // address through it.
    test('Photos: PNG bytes are stored as .png and WebP bytes as .webp whatever the sender called them, and savePhoto takes no extension but the three', async () => {
        await inScratch(async ({ directory }) => {
            for (const [bytes, ext] of [[PNG, 'png'], [WEBP, 'webp'], [JPEG, 'jpg']]) {
                const { url } = await savePhoto(stripJpegMetadata(bytes), sniffImage(bytes).ext);
                expect(url.endsWith(`.${ext}`), `${ext} bytes are stored as .${ext}`).toBe(true);
                expect(url, 'and nothing a sender chose is in the address').toMatch(ADDRESS);
                await removePhoto(url);
            }
            const wrongExtensions = ['jpeg', 'gif', 'svg', 'JPG', '.jpg', '../x', 'jpg/../../x', '', undefined, null, 7];
            for (const ext of wrongExtensions) await expect(savePhoto(JPEG, ext), `the extension ${JSON.stringify(ext)}`).rejects.toThrow();
            for (const notBytes of ['text', null, undefined, 7, {}]) await expect(savePhoto(notBytes, 'jpg'), `bytes that are ${JSON.stringify(notBytes)}`).rejects.toThrow();
            expect(await storedPhotos(), 'none of them wrote a file').toEqual([]);
            expect(fs.existsSync(directory) ? fs.readdirSync(directory) : [], 'or anything else').toEqual([]);
        });
    });

    // Mutant that turns this case red: an address is built from something that repeats or can be guessed (a clock, a counter, a short random number, the
    // job), so two photos meet at one address or a stranger can work out the address of the next one.
    test('Photos: savePhoto x1000 gives a thousand distinct addresses of 32 lowercase hex characters and an extension, spread over every hex digit', async () => {
        await inScratch(async () => {
            const urls = [];
            for (let index = 0; index < 1000; index += 1) urls.push((await savePhoto(PNG, ['jpg', 'png', 'webp'][index % 3])).url);
            expect(new Set(urls).size, 'distinct addresses').toBe(1000);
            expect(urls.filter((url) => !ADDRESS.test(url)), 'addresses that do not match the pattern').toEqual([]);
            expect((await storedPhotos()).length, 'one file for each').toBe(1000);
            // Random names put each hex digit at a given place about 62 times in 1000; a counter or a clock puts one digit there almost every time.
            for (const place of [0, 31]) {
                const counts = new Map();
                for (const url of urls) counts.set(url[PHOTO_URL_BASE.length + place], (counts.get(url[PHOTO_URL_BASE.length + place]) ?? 0) + 1);
                const shown = [...counts.entries()].sort().map(([digit, count]) => `${digit}:${count}`).join(' ');
                expect([...counts.keys()].sort().join(''), `the digits at place ${place} of the names (${shown})`).toBe('0123456789abcdef');
                expect(Math.min(...counts.values()) >= 15 && Math.max(...counts.values()) <= 125, `each turns up about 62 times in 1000 at place ${place} (${shown})`).toBe(true);
            }
            await Promise.all(urls.map((url) => removePhoto(url)));
        });
    });

    // Mutant that turns this case red: two calls that run together share a name or a file, so one photo is written over another when two phones upload
    // at once.
    test('Photos: forty saves at once are forty files, each holding its own bytes', async () => {
        await inScratch(async ({ directory }) => {
            const bodies = Array.from({ length: 40 }, (_, index) => Buffer.from(`photo number ${index}`));
            const urls = await Promise.all(bodies.map((body) => savePhoto(body, 'jpg').then((saved) => saved.url)));
            expect(new Set(urls).size, 'distinct addresses').toBe(40);
            for (const [index, url] of urls.entries()) {
                expect(fs.readFileSync(path.join(directory, url.slice(PHOTO_URL_BASE.length))).toString(), `the file for photo ${index}`).toBe(`photo number ${index}`);
            }
            await Promise.all(urls.map((url) => removePhoto(url)));
        });
    });

    // Mutant that turns this case red: removePhoto checks less than the whole address (a prefix, a pattern that lets .. through, a name in any case or with
    // no extension), so a bad row, or a crafted address, makes it delete a file that is not a photo of ours.
    test('Photos: removePhoto throws on /uploads/../x, /uploads/job-photos/../../x, an upper-case name and a name with no extension, and deletes nothing', async () => {
        await inScratch(async ({ root, directory }) => {
            // Files where a path built from a bad address would land: beside the photo directory, two levels up, and in the root.
            const decoys = [path.join(directory, '..', 'x'), path.join(directory, '..', '..', 'x'), path.join(root, 'x')];
            fs.mkdirSync(directory, { recursive: true });
            for (const decoy of decoys) fs.writeFileSync(decoy, 'keep');
            const hex = 'a1'.repeat(16);
            const bad = [
                '/uploads/../x',
                '/uploads/job-photos/../../x',
                `/uploads/job-photos/${hex.toUpperCase()}.jpg`,
                `/uploads/job-photos/${hex}`,
                `/uploads/job-photos/${hex}.gif`,
                `/uploads/job-photos/${hex}.jpeg`,
                `/uploads/job-photos/${hex}.jpg\n`,
                `/uploads/job-photos/${hex}.jpg?x=1`,
                `/uploads/job-photos/${hex.slice(1)}.jpg`,
                `/uploads/job-photos/${hex}a.jpg`,
                `/uploads/job-photos//${hex}.jpg`,
                `/uploads/job-photos/sub/${hex}.jpg`,
                `/uploads/job-photos/..%2f${hex}.jpg`,
                `/uploads/${hex}.jpg`,
                `uploads/job-photos/${hex}.jpg`,
                `https://example.com/uploads/job-photos/${hex}.jpg`,
                '/uploads/job-photos/',
                '',
                '/',
                undefined,
                null,
                42,
                {},
                [`/uploads/job-photos/${hex}.jpg`],
            ];
            for (const url of bad) await expect(removePhoto(url), `the address ${JSON.stringify(url)}`).rejects.toThrow();
            for (const decoy of decoys) expect(fs.readFileSync(decoy, 'utf8'), `${path.relative(root, decoy)} was not touched`).toBe('keep');
        });
    });

    // Mutant that turns this case red: removePhoto throws when the file is not there, so the retention sweep stops at the first row whose file is
    // already gone, and a failed upload cannot clean up after itself twice.
    test('Photos: removePhoto of a file that is already gone is a success, with the directory there or not', async () => {
        await inScratch(async () => {
            await removePhoto(`${PHOTO_URL_BASE}${'0'.repeat(32)}.webp`);
            const { url } = await savePhoto(JPEG, 'jpg');
            await removePhoto(url);
            await removePhoto(url);
            expect(await storedPhotos()).toEqual([]);
        });
    });

    // Mutant that turns this case red: storedPhotos lists every entry of the directory (or reports a time that is not the file's), so the daily sweep
    // deletes a file it never made, or reads a fresh photo as an orphan two days old.
    test('Photos: storedPhotos lists the files savePhoto made with the second each was written, and nothing else; an absent directory is an empty list', async () => {
        await inScratch(async ({ directory }) => {
            expect(await storedPhotos(), 'the directory does not exist yet').toEqual([]);
            const { url } = await savePhoto(WEBP, 'webp');
            const agedName = `${'d'.repeat(32)}.jpg`;
            const old = Math.floor(Date.now() / 1000) - 5 * 86400;
            fs.writeFileSync(path.join(directory, agedName), 'x');
            fs.utimesSync(path.join(directory, agedName), old, old);
            const strangers = ['notes.txt', '.gitkeep', `${'A'.repeat(32)}.jpg`, `${'b'.repeat(32)}.gif`, `${'e'.repeat(31)}.jpg`];
            for (const stranger of strangers) fs.writeFileSync(path.join(directory, stranger), 'x');
            const lookalike = `${'c'.repeat(32)}.png`;
            fs.mkdirSync(path.join(directory, lookalike));

            const found = await storedPhotos();
            expect(found.map((photo) => photo.url).sort(), 'the two files whose names are ones savePhoto could have made, and not a directory with such a name').toEqual([`${PHOTO_URL_BASE}${agedName}`, url].sort());
            const fresh = found.find((photo) => photo.url === url);
            expect(Number.isInteger(fresh.modified_epoch), 'a whole second').toBe(true);
            expect(Math.abs(fresh.modified_epoch - Math.floor(Date.now() / 1000)) <= 5, 'the second it was written').toBe(true);
            expect(found.find((photo) => photo.url.endsWith(agedName)).modified_epoch, 'a file written five days ago says so').toBe(old);
            expect(fs.readdirSync(directory).sort(), 'every entry that was there is still there: listing them touched nothing').toEqual([...strangers, lookalike, agedName, url.slice(PHOTO_URL_BASE.length)].sort());

            await removePhoto(url);
            await removePhoto(`${PHOTO_URL_BASE}${agedName}`);
        });
    });

    // Mutant that turns this case red: savePhoto swallows a disk that refuses, or storedPhotos reads a directory it cannot open as an empty one, so
    // addPhoto would write a row for a file that is not there instead of answering that photos can not be saved right now.
    test('Photos: a PHOTO_DIR that cannot be written, a path beneath a regular file, makes savePhoto throw and leaves no file', async () => {
        await inScratch(async ({ root, directory }) => {
            const blocker = path.join(root, 'a-regular-file');
            fs.writeFileSync(blocker, 'x');
            expect(usePhotoDir(path.join(blocker, 'job-photos')), 'usePhotoDir gives back the directory it replaced').toBe(directory);
            await expect(savePhoto(JPEG, 'jpg')).rejects.toThrow();
            await expect(storedPhotos(), 'a directory that cannot be read is an error, not an empty list').rejects.toThrow();
            expect(fs.readdirSync(root), 'and nothing was made beside the file').toEqual(['a-regular-file']);
            expect(fs.readFileSync(blocker, 'utf8'), 'or in it').toBe('x');
        });
    });

    // Mutant that turns this case red: usePhotoDir takes anything, so a case that passes it nothing, or a number, leaves the store pointing at a
    // directory nobody chose and the next case writes there.
    test('Photos: usePhotoDir gives back the directory it replaced and refuses what is not a directory name', async () => {
        await inScratch(async ({ directory }) => {
            expect(usePhotoDir(directory), 'the directory the scratch case set').toBe(directory);
            for (const notADirectory of ['', undefined, null, 7, {}]) expect(() => usePhotoDir(notADirectory), JSON.stringify(notADirectory)).toThrow();
            expect(usePhotoDir(directory), 'a refusal changed nothing').toBe(directory);
        });
    });

    // Mutant that turns this case red: the default directory is not public/uploads/job-photos under the working directory (an absolute path, another
    // folder), so the files are written where the uploads route does not look and every photo address is a 404.
    test('Photos: with no directory injected the files go under public/uploads/job-photos of the working directory, where the uploads route reads', async () => {
        await inScratch(async ({ root }) => {
            const here = process.cwd();
            process.chdir(root);
            try {
                usePhotoDir(PHOTO_DIR);
                const { url } = await savePhoto(PNG, 'png');
                const file = path.join(root, 'public', 'uploads', url.slice('/uploads/'.length));
                expect(sameBytes(fs.readFileSync(file), PNG), 'the file is where /uploads/... is served from').toBe(true);
                expect((await storedPhotos()).map((photo) => photo.url), 'storedPhotos looks there too').toEqual([url]);
                await removePhoto(url);
                expect(fs.existsSync(file), 'and removePhoto deletes it from there').toBe(false);
            } finally {
                process.chdir(here);
            }
        });
    });
});

// ---- source reading (as e2e/job-link-retention.spec.js does it) -----------------------------------------------------------------------------

// One pass over the characters of a source file: its text with the comments taken out (line breaks kept) and the string / template literals in it.
// A comment marker inside a string is text. Regex literals and `${ }` are not tracked; none of the files read here needs it, and each case
// that depends on the reading checks that what it looked for is really there.
function scanSource(text) {
    let code = '';
    const literals = [];
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (text.startsWith('//', i)) {
            while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
        } else if (text.startsWith('/*', i)) {
            const close = text.indexOf('*/', i + 2);
            const end = close === -1 ? text.length : close + 2;
            code += ' ' + text.slice(i, end).replace(/[^\n]/g, '');
            i = end;
        } else if (ch === "'" || ch === '"' || ch === '`') {
            let j = i + 1;
            while (j < text.length && text[j] !== ch) j += text[j] === '\\' ? 2 : 1;
            literals.push(text.slice(i, j + 1));
            code += text.slice(i, j + 1);
            i = j + 1;
        } else {
            code += ch;
            i++;
        }
    }
    return { code, literals };
}

function filesUnder(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const found = path.join(directory, entry.name);
        if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : filesUnder(found);
        return [path.relative(ROOT, found).split(path.sep).join('/')];
    });
}

const textOf = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const codeOf = (file) => scanSource(textOf(file)).code;

// The arguments of every call of `name(` in `code`, as text, found by matching the parentheses (strings are skipped over).
function callsOf(code, name) {
    const found = [];
    const pattern = new RegExp(`\\b${name.replace(/\./g, '\\.')}\\s*\\(`, 'g');
    for (let match = pattern.exec(code); match; match = pattern.exec(code)) {
        let depth = 1;
        let i = match.index + match[0].length;
        const start = i;
        while (i < code.length && depth > 0) {
            const ch = code[i];
            if (ch === "'" || ch === '"' || ch === '`') {
                i += 1;
                while (i < code.length && code[i] !== ch) i += code[i] === '\\' ? 2 : 1;
            } else if (ch === '(') depth += 1;
            else if (ch === ')') depth -= 1;
            i += 1;
        }
        found.push(code.slice(start, i - 1).replace(/\s+/g, ' ').trim());
    }
    return found;
}

// The files of the photo half that the pins read: every src/lib/job-photo*.js, the clock, the timer and the capped body reader, the three job routes
// that take a photo, a timer action or a check-out, and the retention cron. A file that another part of the build has not written yet is left out of
// the walk; the cases that depend on the walk check that the two files the store pins stand on are in it.
function photoFiles() {
    const libraries = fs.readdirSync(path.join(ROOT, 'src/lib')).filter((name) => /^job-photo[\w-]*\.js$/.test(name)).map((name) => `src/lib/${name}`);
    const others = [
        'src/lib/job-clock.js',
        'src/lib/job-timer.js',
        'src/lib/read-capped-body.js',
        'src/app/api/job/[token]/photos/route.js',
        'src/app/api/job/[token]/timer/route.js',
        'src/app/api/job/[token]/check-out/route.js',
        'src/app/api/cron/job-photos/route.js',
    ].filter((file) => fs.existsSync(path.join(ROOT, file)));
    return [...new Set([...libraries, ...others])].sort();
}

// A file-system module under any of its spellings, as the specifier of an import, a dynamic import, a require or a re-export: every one of those has
// the module's name in a quoted string, so the quoted name is what is looked for, in the code of a file (comments are not code).
const FS_MODULE = /(['"`])(?:node:)?fs(?:\/promises)?\1/;
const importsFs = (text) => FS_MODULE.test(scanSource(text).code);

// ================================================================================================================================
// Pins: source checks, no database and no app
// ================================================================================================================================

test.describe('ENG-016 photos: pins', () => {
    // Mutant that turns this case red: a route or another library imports node:fs (in any of its spellings) and reads or writes a photo itself, so
    // the disk is touched in more than one place and moving the photos to object storage is no longer a rewrite of one file.
    test('Pins: node:fs is imported by no new file but src/lib/job-photo-store.js, whatever the spelling or the form', () => {
        const spellings = ['fs', 'node:fs', 'fs/promises', 'node:fs/promises'];
        const forms = [
            (name) => `import fs from '${name}';`,
            (name) => `import { readFile } from "${name}";`,
            (name) => `import * as disk from '${name}';`,
            (name) => `import '${name}';`,
            (name) => `const disk = await import('${name}');`,
            (name) => `const disk = require("${name}");`,
            (name) => `export * from '${name}';`,
            (name) => `export { readFile } from '${name}';`,
        ];
        for (const name of spellings) for (const form of forms) expect(importsFs(form(name)), `the reading sees ${form(name)}`).toBe(true);
        const clean = ["import path from 'node:path';", "import { randomBytes } from 'node:crypto';", "import { savePhoto } from './job-photo-store.js';", '// import fs from "node:fs";', '/* const disk = require("fs"); */'];
        for (const text of clean) expect(importsFs(text), `and does not see ${text}`).toBe(false);

        const files = photoFiles();
        expect(files.includes(STORE) && files.includes(LIBRARY), `the walk reaches the store and the photo library among ${files.length} files`).toBe(true);
        expect(importsFs(textOf(STORE)), 'the store does import a file-system module: the reading sees the one place the disk is touched').toBe(true);
        expect(files.filter((file) => file !== STORE && importsFs(textOf(file))), 'new files other than the store that import a file-system module').toEqual([]);
        test.info().annotations.push({ type: 'note', description: `${files.length} files read: ${files.join(', ')}` });
    });

    // Mutant that turns this case red: a route or another library reads or writes job_photos itself, around the library that holds the rules (who may
    // add a photo, when, how many, and the lock that makes it true), so a photo can be added to a job it should not be.
    test('Pins: job_photos is named in code by no new file but src/lib/job-photos.js and src/lib/job-photo-retention.js', () => {
        const owners = [LIBRARY, RETENTION];
        const files = photoFiles();
        const naming = files.filter((file) => codeOf(file).includes('job_photos')).sort();
        expect(naming.includes(LIBRARY), `the walk reaches the library that owns the table among ${files.length} files`).toBe(true);
        expect(naming.filter((file) => !owners.includes(file)), 'new files other than the two owners that name job_photos in code').toEqual([]);
        // Honest about the rest: a comment that only says the name is not a use of the table, but it is reported.
        const commentOnly = files.filter((file) => textOf(file).includes('job_photos') && !naming.includes(file));
        if (commentOnly.length > 0) test.info().annotations.push({ type: 'note', description: `job_photos is named only in a comment in: ${commentOnly.join(', ')}` });
    });

    // Mutant that turns this case red: a new file sends a statement as text (query) and not prepared (execute), which is how an injection reaches the
    // photos and the record of a job.
    test('Pins: no new file of the photo half contains a query( call, only prepared execute', () => {
        const files = photoFiles();
        expect(files.length, 'the walk finds the photo half').toBeGreaterThanOrEqual(2);
        const calling = [];
        for (const file of files) {
            for (const [index, line] of codeOf(file).split('\n').entries()) if (/\bquery\s*\(/.test(line)) calling.push(`${file}:${index + 1}`);
        }
        expect(calling, `the lines that call query( (a bare call or connection.query) in ${files.length} files`).toEqual([]);
    });

    // Mutant that turns this case red: PHOTO_DIR moves, or PHOTO_URL_BASE stops being the address that directory is served at, or the store starts out
    // looking in some other directory than PHOTO_DIR, so the files are written where the uploads route does not look and every photo address is a 404.
    test('Pins: PHOTO_DIR is public/uploads/job-photos, and PHOTO_URL_BASE is the address the uploads route serves that directory at', () => {
        expect(PHOTO_DIR).toBe('public/uploads/job-photos');
        expect(PHOTO_URL_BASE, 'the directory under public/, with a slash on each side').toBe(`/${PHOTO_DIR.slice('public/'.length)}/`);
        const code = codeOf(STORE);
        expect(code, 'the store declares and exports PHOTO_DIR').toMatch(/\bexport\s+const\s+PHOTO_DIR\s*=/);
        expect(code, 'and it is where the functions look until usePhotoDir says otherwise').toMatch(/\blet\s+\w+\s*=\s*PHOTO_DIR\s*;/);
    });

    // Mutant that turns this case red: one of the three values is changed without the case that depends on it noticing (a bigger body than Vercel's own
    // limit lets through, a base that no longer matches the route, a cap per job that is not the design's).
    test('Pins: PHOTO_URL_BASE, PHOTO_MAX_BYTES and PHOTOS_MAX_PER_TYPE are exported at their values', async () => {
        const { PHOTOS_MAX_PER_TYPE } = await import('../src/lib/job-photos.js');
        const named = [
            ['PHOTO_URL_BASE', PHOTO_URL_BASE, '/uploads/job-photos/', STORE],
            ['PHOTO_MAX_BYTES', PHOTO_MAX_BYTES, 4000000, STORE],
            ['PHOTOS_MAX_PER_TYPE', PHOTOS_MAX_PER_TYPE, 20, LIBRARY],
        ];
        for (const [name, value, expected, file] of named) {
            expect(new RegExp(`\\bexport\\s+const\\s+${name}\\s*=`).test(codeOf(file)), `${file} declares and exports ${name}`).toBe(true);
            expect(value, `the value ${name} is exported at`).toBe(expected);
        }
    });

    // Mutant that turns this case red: the rule is taken out of .gitignore (or a later line takes it back), so the photos of customers' homes that a
    // stack keeps on its disk are one `git add .` from a commit.
    test('Pins: git check-ignore public/uploads/job-photos/x.jpg succeeds (where git cannot answer, .gitignore is read for the rule)', () => {
        const PHOTO = 'public/uploads/job-photos/x.jpg';
        // `git check-ignore -q` exits 0 when the path is ignored and 1 when it is not; any other end (no git, a checkout whose git directory is outside
        // the mount, a safety refusal) is git not being able to answer.
        let answer = 'unknown';
        try {
            execFileSync('git', ['check-ignore', '-q', PHOTO], { cwd: ROOT, stdio: 'ignore', timeout: 15_000 });
            answer = 'ignored';
        } catch (error) {
            answer = error?.status === 1 ? 'not ignored' : 'unknown';
        }
        if (answer === 'unknown') {
            const lines = textOf('.gitignore').split(/\r?\n/).map((line) => line.trim());
            expect(lines.includes('/public/uploads/job-photos/'), 'git cannot answer here, so .gitignore is read: it has the line /public/uploads/job-photos/').toBe(true);
            expect(lines.filter((line) => line.startsWith('!') && line.includes('job-photos')), 'and no line after it takes the rule back').toEqual([]);
            test.info().annotations.push({ type: 'note', description: 'git could not answer here; the rule was read from .gitignore' });
        } else {
            expect(answer, `git check-ignore ${PHOTO}`).toBe('ignored');
        }
    });

    // Mutant that turns this case red: a library, a route or a page calls usePhotoDir, so the directory the photos are kept in can be changed by the
    // running app and not only by a case that restores it.
    test('Pins: usePhotoDir is named in code under src/ by no file but the store', () => {
        const files = filesUnder(path.join(ROOT, 'src')).filter((file) => /\.(js|jsx|mjs|cjs|ts|tsx)$/.test(file));
        const naming = files.filter((file) => textOf(file).includes('usePhotoDir') && codeOf(file).includes('usePhotoDir')).sort();
        expect(naming.includes(STORE), `the walk reaches the store among ${files.length} files under src/`).toBe(true);
        expect(naming.filter((file) => file !== STORE), 'files other than the store that name usePhotoDir in code').toEqual([]);
    });

    // Mutant that turns this case red: an address is drawn from less than 128 random bits (Math.random, a clock, fewer bytes), or the file is written
    // with the default flag, so a photo of a house can be found by guessing or one customer's photo is written over by another's.
    test('Pins: the store draws an address from crypto.randomBytes(16) and writes it with the exclusive flag wx', () => {
        const code = codeOf(STORE);
        expect(callsOf(code, 'randomBytes'), 'every call of randomBytes asks for 16 bytes, 128 bits').toEqual(['16']);
        expect(/\bMath\.random\b/.test(code), 'and Math.random is not used').toBe(false);
        const writes = callsOf(code, 'writeFile');
        expect(writes.length, 'the store writes a file in one place').toBe(1);
        expect(writes[0], 'with the exclusive flag, so a name that exists is never written over').toMatch(/\{[^{}]*\bflag\s*:\s*(['"])wx\1[^{}]*\}/);
    });
});
