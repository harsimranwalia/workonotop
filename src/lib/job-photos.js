// src/lib/job-photos.js
//
// A job's before and after photos, taken from the job link (ENG-016 design, Interfaces 3). They go in job_photos, the table the provider's own page
// already writes, so every reader that exists (the provider's photo list, has_before_photos) sees a photo taken here. Besides
// src/lib/job-photo-retention.js this is the only new file that names job_photos (a pin in e2e/job-photos.spec.js). The bytes are checked, cleaned
// and written by src/lib/job-photo-store.js, the only file that touches the disk; this file never does.
//
// A row says who took the photo in taken_by_kind ('cleaner' | 'provider' | 'admin') and taken_by_ref (a crew member's id, a provider's id or a
// users.id, which is why it has no foreign key). Both are NULL on every photo the provider's page took, and that NULL is how a photo is told from
// a link photo, by the retention sweep as well. uploaded_by is the booking's provider, so its foreign key holds. captured_at stays NULL: a
// stored photo has no metadata left to read it from. Where the phone was when a photo was taken goes in the event and not in the row, so the
// positions of a job are kept and erased by one rule (src/lib/crew-retention.js).
//
// addPhoto() runs in ONE transaction that first locks the booking row, as checkIn() in src/lib/job-checkin.js does, and then reads everything
// again inside the lock: the status, the link, the crew and who is here. A start, a reassign, a check-out or a close that races a photo therefore
// happens wholly before it (and the photo is refused) or wholly after it (and the photo was true when taken). The file is written inside the lock,
// after every check has passed, and is removed again if anything after it throws, a failed commit included, so a refusal or a failure leaves no
// file behind that a row does not name.
//
// The libraries here take `withConnection` (src/lib/db.js) and use the connection's own execute, which does not log. The one thing logged is
// the code of a disk failure, as a fixed line: addPhoto turns it into the 'store' answer, so the route has no error left to log.
//
// PHOTOS_MAX_PER_TYPE -> 20, the before photos and the after photos a job may hold, counted over every taker.
// PHOTO_MESSAGES -> the sentences a route sends. The key for a reason is the reason in camel case: type, image, tooBig (too_big), notHere
//   (not_here), started, notStarted (not_started), tooMany (too_many) and store. 'closed' and 'access' have no sentence here: the route answers
//   them as the check-in route does (the 404 of a link that is not valid, and the sign-in message).
// addPhoto({ withConnection, link, access, type, bytes, location }) -> one of
//   { ok: true, photo }               photo is { id, type, url, taken_by: { kind, name }, taken_at (ISO) }, as photosFor shows it
//   { ok: false, reason }             reason is one of the ten below, in the order they are judged
//   type       type is not 'before' or 'after'
//   too_big    bytes is more than PHOTO_MAX_BYTES (the route has stopped reading by then; this is the second line)
//   image      bytes is not a JPEG, PNG or WebP by its first bytes, or is a JPEG that does not parse cleanly (src/lib/job-photo-store.js)
//              The three above are judged before a connection is taken. The rest are judged inside the lock, in this order:
//   closed     the booking is gone or has no provider, its status is not one of JOB_LINK_OPEN_STATUSES, or the link was switched off or reissued
//   access     the caller is not the one the route found (a cleaner off the job, a provider it was taken from), by stillAllowed()
//   not_here   a cleaner who is not checked in now: a photo of a house by someone who is not there is not evidence. A provider and an admin need
//              not be checked in
//   started    a 'before' photo on a job whose status is not 'confirmed': it has started (in_progress) or is not yet one a crew is at
//   not_started  an 'after' photo on a job whose status is not 'in_progress': it has not started
//   too_many   the job already holds PHOTOS_MAX_PER_TYPE photos of that type
//   store      the disk refused the file; nothing was written to the database
//   `link` is { id, booking_id, generation }. `access` is { kind: 'cleaner' | 'provider' | 'admin', ref, epoch? }, as resolveAccess answers it.
//   `bytes` is a Buffer; it is cleaned of its Exif segment before it is stored. `location` is the body's { latitude, longitude, accuracy } as
//   sent; a position that is missing or not usable is left out of the event and never refuses the photo.
// photosFor(execute, bookingId) -> [{ id, type, url, taken_by: { kind, name } | null, taken_at (ISO) }], oldest first, of the job's newest 100
//   photos (link photos are capped at 20 a type; the provider's own page has no cap, so the read has one), less every one whose address is not an
//   isShownAddress. The 100 are read first and the rest are left out of them, so a row that is left out uses up one of the 100 and no older photo
//   takes its place. A photo the provider's page took has taken_by null. Names are read now, through the ids, with namesFor(): a cleaner who has
//   been erased shows as 'A former cleaner'. A row that is left out stays in the table (security gate round 1, F1): every answer that lists photos
//   is built here, and both screens put the address of what it lists in an <a href> and an <img src>.
// photoCounts(execute, bookingId) -> { before, after }: the rows the job holds of each type, whoever took them and whatever their address, which is
//   the number addPhoto's limit judges. It is not the length of what photosFor lists, because a row that is left out of the list still counts.
// isShownAddress(url) -> boolean: whether the page may link an address. True for a photo of the store (isStoredAddress, src/lib/job-photo-store.js) and
//   for an older raster upload, /uploads/{digits}-{letters, digits, dots, underscores}.{jpg, jpeg, png, webp, gif} in any case, which is the shape
//   src/app/api/upload/route.js gave a file before this feature. Anything else is false: an SVG or a PDF (the uploads route serves them inline), an
//   address with a host or a scheme, a path with a second segment or a dot-dot, and a value that is not a string. The older routes keep what they are
//   sent, so the rows can hold any string.
// beforePhotoCount(execute, bookingId) -> a whole number: the before photos the job has, whoever took them and wherever (the provider's page or
//   a link). It is what the provider's start asks before it lets a job begin.
import { assignedCrew, inTransaction } from './booking-crew.js';
import { checkinsFor, stillAllowed } from './job-checkin.js';
import { JOB_LINK_OPEN_STATUSES, executeOn, namesFor, nameOf, recordEvent } from './job-link-base.js';
import { PHOTO_MAX_BYTES, isStoredAddress, removePhoto, savePhoto, sniffImage, stripJpegMetadata } from './job-photo-store.js';
import { readLocation } from './job-window.js';

export const PHOTOS_MAX_PER_TYPE = 20;

export const PHOTO_MESSAGES = Object.freeze({
  type: 'Pick before or after.',
  image: 'That file is not a photo we can use. Take it again.',
  tooBig: 'That photo is too big. Take it again.',
  notHere: 'Check in first, then add a photo.',
  started: 'The job has started, so more "before" photos can not be added.',
  notStarted: 'Start the job before adding "after" photos.',
  tooMany: 'This job has all the photos it can hold.',
  store: 'Photos can not be saved right now. Try again in a minute.',
});

const TYPES = Object.freeze(['before', 'after']);
const LIST_LIMIT = 100;
const PHOTO_COLUMNS = 'id, photo_url, photo_type, taken_by_kind, taken_by_ref, UNIX_TIMESTAMP(uploaded_at) AS taken_epoch';

// The address /api/upload gave out before this feature: /uploads/, the time in milliseconds, a dash, and the name the file had with every character that is
// not a letter, a digit or a dot turned into an underscore. Raster kinds only: the uploads route serves an SVG or a PDF inline, so a row that names one is
// not shown. The extension is matched in any case because the uploads route reads it in lower case.
const OLDER_UPLOAD = /^\/uploads\/[0-9]+-[A-Za-z0-9._]+\.(?:jpe?g|png|webp|gif)$/i;

export const isShownAddress = (url) => isStoredAddress(url) || (typeof url === 'string' && OLDER_UPLOAD.test(url));

const refuse = (reason) => ({ ok: false, reason });
const toIso = (epoch) => (epoch === null || epoch === undefined ? null : new Date(Number(epoch) * 1000).toISOString());

// Photo rows as the page and the panels show them, with the names of the people who took them read now. A row whose address the page may not link is not shown.
async function shown(execute, allRows) {
  const rows = allRows.filter((row) => isShownAddress(row.photo_url));
  const takenBy = (kind) => rows.filter((row) => row.taken_by_kind === kind).map((row) => row.taken_by_ref);
  const names = await namesFor(execute, { providers: takenBy('provider'), admins: takenBy('admin'), cleaners: takenBy('cleaner') });
  return rows.map((row) => ({
    id: Number(row.id),
    type: row.photo_type,
    url: row.photo_url,
    taken_by: row.taken_by_kind === null ? null : { kind: row.taken_by_kind, name: nameOf(names, row.taken_by_kind, row.taken_by_ref) },
    taken_at: toIso(row.taken_epoch),
  }));
}

export async function addPhoto({ withConnection, link, access, type, bytes, location }) {
  if (!TYPES.includes(type)) return refuse('type');
  if (bytes instanceof Uint8Array && bytes.length > PHOTO_MAX_BYTES) return refuse('too_big');
  const kind = sniffImage(bytes);
  const clean = kind === null ? null : stripJpegMetadata(bytes);
  if (clean === null) return refuse('image');

  let saved = null;
  try {
    return await withConnection((connection) =>
      inTransaction(connection, async () => {
        const run = executeOn(connection);

        const [booking] = await run('SELECT status, provider_id FROM bookings WHERE id = ? FOR UPDATE', [link.booking_id]);
        const live = booking
          ? await run('SELECT id FROM job_links WHERE id = ? AND booking_id = ? AND generation = ? AND off_at IS NULL', [link.id, link.booking_id, link.generation])
          : [];
        if (!booking || live.length === 0 || booking.provider_id === null || !JOB_LINK_OPEN_STATUSES.includes(booking.status)) return refuse('closed');

        const crew = await assignedCrew(run, link.booking_id, { withAssignedAt: true });
        if (!access || !stillAllowed(access, booking, crew)) return refuse('access');

        if (access.kind === 'cleaner') {
          const here = await checkinsFor(run, link.booking_id, crew.filter((member) => !member.removed));
          if (!here.some((tick) => tick.crew_member_id === access.ref)) return refuse('not_here');
        }

        if (type === 'before' && booking.status !== 'confirmed') return refuse('started');
        if (type === 'after' && booking.status !== 'in_progress') return refuse('not_started');

        const [{ n }] = await run('SELECT COUNT(*) AS n FROM job_photos WHERE booking_id = ? AND photo_type = ?', [link.booking_id, type]);
        if (Number(n) >= PHOTOS_MAX_PER_TYPE) return refuse('too_many');

        try {
          saved = await savePhoto(clean, kind.ext);
        } catch (error) {
          console.error('Error storing a job photo:', error?.code || error?.name);
          return refuse('store');
        }

        const inserted = await run(
          `INSERT INTO job_photos (booking_id, photo_url, photo_type, uploaded_by, taken_by_kind, taken_by_ref)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [link.booking_id, saved.url, type, booking.provider_id, access.kind, access.ref]
        );

        const where = readLocation(location);
        await recordEvent(run, link, {
          kind: 'photo_added',
          actor: { kind: access.kind, ref: access.ref },
          crewMemberId: access.kind === 'cleaner' ? access.ref : null,
          location: where.ok ? { latitude: where.latitude, longitude: where.longitude, accuracy_m: where.accuracy_m } : null,
          detail: type,
        });

        const rows = await run(`SELECT ${PHOTO_COLUMNS} FROM job_photos WHERE id = ?`, [inserted.insertId]);
        const [photo] = await shown(run, rows);
        return { ok: true, photo };
      })
    );
  } catch (error) {
    // The file was written and the transaction did not finish: the row it would have named is not there, so neither should the file be.
    // A remove that fails leaves a file no row names, which the orphan sweep takes after 24 hours; its code alone is logged so that it is known.
    if (saved !== null) await removePhoto(saved.url).catch((failed) => console.error('Error removing a job photo whose row was not saved:', failed?.code || failed?.name));
    throw error;
  }
}

export async function photosFor(execute, bookingId) {
  const rows = await execute(
    `SELECT ${PHOTO_COLUMNS} FROM job_photos WHERE booking_id = ? ORDER BY uploaded_at DESC, id DESC LIMIT ${LIST_LIMIT}`,
    [bookingId]
  );
  return shown(execute, rows.reverse());
}

export async function photoCounts(execute, bookingId) {
  const rows = await execute('SELECT photo_type, COUNT(*) AS n FROM job_photos WHERE booking_id = ? GROUP BY photo_type', [bookingId]);
  const counts = { before: 0, after: 0 };
  for (const row of rows) counts[row.photo_type] = Number(row.n);
  return counts;
}

export async function beforePhotoCount(execute, bookingId) {
  const [row] = await execute("SELECT COUNT(*) AS n FROM job_photos WHERE booking_id = ? AND photo_type = 'before'", [bookingId]);
  return Number(row.n);
}
