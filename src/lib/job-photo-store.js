// src/lib/job-photo-store.js
//
// Where a job's photos live on disk (ENG-016 design, Interfaces 2). This is the ONLY file that touches the disk for photos: every other file asks
// it to check, clean, save, remove or list, so moving the photos to object storage is a rewrite of this file and of PHOTO_URL_BASE and nothing
// else (ADR-013). A pin in e2e/job-photos.spec.js fails a PR that imports node:fs into any other new file.
//
// A photo's address is a capability: 32 hex characters from crypto.randomBytes(16), 128 random bits, so it cannot be guessed and holds nothing
// about the job, the cleaner or the customer. The name a client sent is never used, not even for its extension: the extension comes from the
// bytes (sniffImage), so PNG bytes sent as image/jpeg with a .jpg name are stored as .png. The files are served by the existing uploads route
// (src/app/uploads/[...file]/route.js), which maps the extension to a type and is unchanged. Nothing here logs: a caller that logs a failure
// logs its code and never an address.
//
// Imports only node:fs/promises, node:path and node:crypto, and no file of this repo, so a spec loads it in plain Node.
//
// Constants (one-line changes, no migration):
//   PHOTO_MAX_BYTES  4000000                   the most a photo may be. Vercel's own limit on a function body is 4.5 MB, so a bigger one would
//                                              fail there without our message. The route stops reading past it and addPhoto refuses a buffer
//                                              over it as well.
//   PHOTO_DIR        'public/uploads/job-photos'  the directory, resolved from process.cwd() when a function runs. .gitignore keeps it out of
//                                              a commit and a pin checks that git agrees.
//   PHOTO_URL_BASE   '/uploads/job-photos/'    what every address starts with.
//
// sniffImage(buffer) -> { ext: 'jpg' | 'png' | 'webp' } | null
//   Decided from the first bytes only, never from a name or a type the client sent: JPEG starts FF D8 FF; PNG starts 89 50 4E 47 0D 0A 1A 0A; WebP
//   is 'RIFF', four bytes, then 'WEBP'. A GIF, an SVG (with or without an XML header), an HTML page, a PDF, an empty file and a two-byte file
//   are all null, and so is anything that is not bytes. An SVG is refused on purpose: it can carry script, and this app serves what it stores.
// stripJpegMetadata(buffer) -> a Buffer | null
//   A JPEG comes back without any APP1 segment whose payload starts 'Exif\0\0' (the camera's metadata, its GPS position included), found by
//   walking the markers from the start of image to the start of scan. A JPEG that does not parse cleanly is refused with null and is not stored
//   as it came: a marker that is not one a JPEG carries before its scan, a segment whose length runs past the end or is under 2, a file with no start
//   of scan, a scan that does not end in FF D9 (a truncated file, or one with bytes after its end), so any non-null answer starts FF D8 and ends
//   FF D9. A JPEG with no Exif segment comes back as the very buffer that came. A PNG or WebP comes back as it came (the page always sends a JPEG,
//   so a client that sends another kind is not a person with the page), and so does nothing else: anything that is not one of the three is null.
//   Only Exif is removed: XMP, IPTC and the other segments stay, as the design says. Removing Exif also removes its orientation tag, and the
//   page bakes the orientation into the pixels when it shrinks a photo.
// savePhoto(buffer, ext) -> { url }
//   Writes the bytes to PHOTO_DIR as {32 lowercase hex}.{ext} with flag 'wx', so a name that exists is never written over, creating the directory
//   when it is missing, and answers PHOTO_URL_BASE + that name. `ext` is one of jpg, png, webp (what sniffImage answered). It throws when the
//   bytes or the extension are wrong and when the disk refuses (the caller turns that into its 'store' answer); a file it began and could not
//   finish is removed before the throw.
// removePhoto(url) -> nothing
//   Deletes the file an address from savePhoto names; a file that is already gone is a success. An address that does not match
//   ^/uploads/job-photos/[0-9a-f]{32}\.(jpg|png|webp)$ throws before any path is built, so a bad row cannot make it delete some other file.
// storedPhotos() -> [{ url, modified_epoch }]
//   Every file in PHOTO_DIR whose name is one savePhoto could have made, with the second it was last written; any other file is left out of the
//   answer and is never touched. [] when the directory does not exist. It lists the whole directory (the retention sweep compares it with the
//   rows once a day), so it is not for a request.
// usePhotoDir(directory) -> the directory it replaced
//   TEST-ONLY. A spec points the store at a scratch directory, or at one that cannot be created to prove the 'store' answer, and puts the directory it replaced
//   back in a finally. Nothing in src/ calls it and a pin fails a PR that does. PHOTO_DIR remains the constant; this changes only where the
//   functions above look.
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const PHOTO_MAX_BYTES = 4000000;
export const PHOTO_DIR = 'public/uploads/job-photos';
export const PHOTO_URL_BASE = '/uploads/job-photos/';

const EXTENSIONS = Object.freeze(['jpg', 'png', 'webp']);
const NAME_PATTERN = /^[0-9a-f]{32}\.(?:jpg|png|webp)$/;

const JPEG_START = Object.freeze([0xff, 0xd8, 0xff]);
const PNG_START = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RIFF = Object.freeze([0x52, 0x49, 0x46, 0x46]);
const WEBP = Object.freeze([0x57, 0x45, 0x42, 0x50]);
const EXIF_HEADER = Buffer.from('Exif\0\0', 'latin1');

const APP1 = 0xe1;
const SOS = 0xda;
const EOI = 0xd9;

let photoDirectory = PHOTO_DIR;

export function usePhotoDir(directory) {
  if (typeof directory !== 'string' || directory === '') throw new Error('usePhotoDir: needs a directory');
  const previous = photoDirectory;
  photoDirectory = directory;
  return previous;
}

const directoryNow = () => path.resolve(process.cwd(), photoDirectory);

// The bytes as a Buffer (a view, not a copy), or null when the value is not bytes.
function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  return value instanceof Uint8Array ? Buffer.from(value.buffer, value.byteOffset, value.byteLength) : null;
}

function startsWith(bytes, at, expected) {
  return bytes.length >= at + expected.length && expected.every((byte, index) => bytes[at + index] === byte);
}

export function sniffImage(buffer) {
  if (!(buffer instanceof Uint8Array)) return null;
  if (startsWith(buffer, 0, JPEG_START)) return { ext: 'jpg' };
  if (startsWith(buffer, 0, PNG_START)) return { ext: 'png' };
  if (startsWith(buffer, 0, RIFF) && startsWith(buffer, 8, WEBP)) return { ext: 'webp' };
  return null;
}

// Whether a marker is one that a JPEG may have, with a length, between its start of image and its start of scan: the frame headers and tables
// (C0 to CF), the start of scan (DA) and everything after it up to FE (tables, application and comment segments). The markers without a length
// (01, D0 to D7, D8, D9) and the reserved ones below C0 are not part of a clean header.
const hasLength = (marker) => (marker >= 0xc0 && marker <= 0xcf) || (marker >= 0xda && marker <= 0xfe);

export function stripJpegMetadata(input) {
  const buffer = asBuffer(input);
  const kind = sniffImage(buffer);
  if (kind === null) return null;
  if (kind.ext !== 'jpg') return buffer;

  // The ranges to leave out, as a flat list of from, to pairs: the answer is built from what lies between them, so a file made of nothing but
  // tiny segments costs a few numbers and not an object each.
  const cuts = [];
  let removed = 0;
  let at = 2;
  for (;;) {
    const segmentStart = at;
    // Any marker may be preceded by fill bytes (FF); they go with the segment they precede.
    while (at + 1 < buffer.length && buffer[at] === 0xff && buffer[at + 1] === 0xff) at += 1;
    if (at + 4 > buffer.length || buffer[at] !== 0xff || !hasLength(buffer[at + 1])) return null;
    const marker = buffer[at + 1];
    const length = buffer.readUInt16BE(at + 2);
    const segmentEnd = at + 2 + length;
    if (length < 2 || segmentEnd > buffer.length) return null;

    if (marker === SOS) {
      // The scan follows its header and must run to the end of the image: nothing is stored that stops short or goes on after FF D9.
      if (segmentEnd + 2 > buffer.length || buffer[buffer.length - 2] !== 0xff || buffer[buffer.length - 1] !== EOI) return null;
      break;
    }
    if (marker === APP1 && length >= 2 + EXIF_HEADER.length && buffer.subarray(at + 4, at + 4 + EXIF_HEADER.length).equals(EXIF_HEADER)) {
      cuts.push(segmentStart, segmentEnd);
      removed += segmentEnd - segmentStart;
    }
    at = segmentEnd;
  }

  if (cuts.length === 0) return buffer;
  const clean = Buffer.alloc(buffer.length - removed);
  let written = 0;
  let from = 0;
  for (let index = 0; index < cuts.length; index += 2) {
    written += buffer.copy(clean, written, from, cuts[index]);
    from = cuts[index + 1];
  }
  buffer.copy(clean, written, from);
  return clean;
}

export async function savePhoto(input, ext) {
  const bytes = asBuffer(input);
  if (bytes === null || !EXTENSIONS.includes(ext)) throw new Error('savePhoto: needs bytes and one of jpg, png, webp');
  const directory = directoryNow();
  await mkdir(directory, { recursive: true });
  const name = `${randomBytes(16).toString('hex')}.${ext}`;
  const file = path.join(directory, name);
  try {
    await writeFile(file, bytes, { flag: 'wx' });
  } catch (error) {
    // A name that exists is somebody else's file: leave it. Anything else may have left half of ours.
    if (error?.code !== 'EEXIST') await unlink(file).catch(() => {});
    throw error;
  }
  return { url: PHOTO_URL_BASE + name };
}

// The file name an address stands for, or null when the address is not one this store gave out.
function nameOf(url) {
  if (typeof url !== 'string' || !url.startsWith(PHOTO_URL_BASE)) return null;
  const name = url.slice(PHOTO_URL_BASE.length);
  return NAME_PATTERN.test(name) ? name : null;
}

export async function removePhoto(url) {
  const name = nameOf(url);
  if (name === null) throw new Error('removePhoto: not an address this store gave out');
  try {
    await unlink(path.join(directoryNow(), name));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

export async function storedPhotos() {
  const directory = directoryNow();
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const found = [];
  for (const name of names) {
    if (!NAME_PATTERN.test(name)) continue;
    try {
      const info = await stat(path.join(directory, name));
      if (info.isFile()) found.push({ url: PHOTO_URL_BASE + name, modified_epoch: Math.floor(info.mtimeMs / 1000) });
    } catch (error) {
      // Removed between the listing and the look: it is not there to list.
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return found;
}
