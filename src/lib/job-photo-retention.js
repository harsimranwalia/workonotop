// src/lib/job-photo-retention.js
//
// How long the job link keeps a photo of a home (ENG-016 design, Named values; ADR-013). A link photo is a file whose name is its only lock and a
// job_photos row that says whose job it was, and neither is meant to outlive the time in which a dispute can come. GET /api/cron/job-photos runs
// this once a day behind the cron secret, as crew-retention runs.
//
// runJobPhotoRetention(execute) -> { deleted_photos, orphan_files, skipped }; it logs nothing and every statement is prepared. The steps, in this order:
//   (a) deleted_photos   every LINK photo uploaded more than PHOTO_DAYS ago has its file deleted and then its row, unless its booking is
//                        'disputed' (a dispute can come months later; the photos wait until the status moves on). A link photo is a row whose
//                        taken_by_kind is set: the NULL of every photo the provider's own page took is how this file knows a row is not one, and
//                        those are never touched. A row whose file is already gone is deleted all the same (removePhoto counts a missing file
//                        as removed), so a run that stopped between the file and the row is finished by the next one;
//   (b) orphan_files     every file in the store older than ORPHAN_GRACE_HOURS that no job_photos row names, of any kind, is deleted: a booking,
//                        a provider or a customer that was deleted leaves its files behind, because the deletes that exist remove rows only. A
//                        younger file may be one that addPhoto has written and not yet committed a row for, and is left alone.
// skipped counts what the store would not remove: a row whose photo_url is not an address it keeps (removePhoto throws on one, so that a bad row
// cannot make it delete another path) or a file it failed to delete. A row so skipped stays, a file stays, the run goes on, and the next run counts them again.
// Work is bounded: at most MAX_BATCHES batches of BATCH_SIZE rows, then as many batches of files, and what is left waits for the next day.
import { removePhoto, storedPhotos } from './job-photo-store.js';

export const PHOTO_DAYS = 365;
export const ORPHAN_GRACE_HOURS = 24;

const BATCH_SIZE = 200;
const MAX_BATCHES = 50;

async function removed(url) {
  try {
    await removePhoto(url);
    return true;
  } catch {
    return false;
  }
}

const marks = (list) => list.map(() => '?').join(', ');

async function deleteOldPhotos(execute) {
  let deleted = 0;
  let skipped = 0;
  let after = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const rows = await execute(
      `SELECT p.id, p.photo_url FROM job_photos p
       WHERE p.id > ? AND p.taken_by_kind IS NOT NULL AND p.uploaded_at < NOW() - INTERVAL ? DAY
         AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.id = p.booking_id AND b.status = 'disputed')
       ORDER BY p.id LIMIT ${BATCH_SIZE}`,
      [after, PHOTO_DAYS]
    );
    if (rows.length === 0) break;
    after = rows[rows.length - 1].id;

    const gone = [];
    for (const row of rows) {
      if (await removed(row.photo_url)) gone.push(row.id);
    }
    skipped += rows.length - gone.length;
    if (gone.length > 0) {
      deleted += (await execute(`DELETE FROM job_photos WHERE taken_by_kind IS NOT NULL AND id IN (${marks(gone)})`, gone)).affectedRows;
    }
    if (rows.length < BATCH_SIZE) break;
  }
  return { deleted, skipped };
}

async function deleteOrphans(execute) {
  const [{ cutoff }] = await execute('SELECT UNIX_TIMESTAMP(NOW() - INTERVAL ? HOUR) AS cutoff', [ORPHAN_GRACE_HOURS]);
  const aged = (await storedPhotos()).filter((file) => file.modified_epoch < Number(cutoff));
  let deleted = 0;
  let skipped = 0;
  for (let start = 0; start < aged.length && start < BATCH_SIZE * MAX_BATCHES; start += BATCH_SIZE) {
    const batch = aged.slice(start, start + BATCH_SIZE);
    const named = await execute(`SELECT photo_url FROM job_photos WHERE photo_url IN (${marks(batch)})`, batch.map((file) => file.url));
    const kept = new Set(named.map((row) => row.photo_url));
    for (const file of batch.filter((one) => !kept.has(one.url))) {
      if (await removed(file.url)) deleted += 1;
      else skipped += 1;
    }
  }
  return { deleted, skipped };
}

export async function runJobPhotoRetention(execute) {
  const photos = await deleteOldPhotos(execute);
  const orphans = await deleteOrphans(execute);
  return { deleted_photos: photos.deleted, orphan_files: orphans.deleted, skipped: photos.skipped + orphans.skipped };
}
