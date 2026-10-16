-- 0009-job-photos-and-timer.up.sql
-- Adds, for the photos and the countdown timer on the job link (ENG-016): job_photos.taken_by_kind and taken_by_ref (who took a photo; a cleaner is
-- not a service_providers row, so uploaded_by cannot say) with idx_job_photos_uploaded (the retention sweep reads by upload time),
-- job_checkins.checked_out_at (when a cleaner left the job; NULL means here) and bookings.over_quote_at (the first look that saw the quote used up).
-- taken_by_ref is a provider_crew_members.id, a service_providers.id or a users.id by taken_by_kind and has no foreign key, because it is one of three.
-- It changes no existing row: every photo already there keeps NULL in both new columns, and NULL is how src/lib/job-photo-retention.js knows a photo
-- is not a link photo and leaves it alone. Nothing that exists reads or writes the new columns, so the file goes in before the code or with it, and
-- the ENG-016 code must not run without it. A nullable column added last is instant in MySQL 8.4.
-- Applied by hand to an existing database and to the dev database (the fixture reset does not build the schema); database/schema.js carries the same
-- columns and index for a fresh install and for the column runner. Undone by 0009-job-photos-and-timer.down.sql.
ALTER TABLE job_photos
  ADD COLUMN taken_by_kind ENUM('cleaner','provider','admin') NULL AFTER uploaded_by,
  ADD COLUMN taken_by_ref INT NULL AFTER taken_by_kind,
  ADD INDEX idx_job_photos_uploaded (uploaded_at);

ALTER TABLE job_checkins
  ADD COLUMN checked_out_at DATETIME NULL AFTER checked_in_at;

ALTER TABLE bookings
  ADD COLUMN over_quote_at DATETIME NULL AFTER job_timer_status;
