-- 0009-job-photos-and-timer.down.sql
-- Undoes 0009-job-photos-and-timer.up.sql: drops bookings.over_quote_at, job_checkins.checked_out_at, then job_photos.idx_job_photos_uploaded,
-- taken_by_ref and taken_by_kind.
--
-- THIS DISCARDS WHO TOOK EACH PHOTO, EVERY CHECK-OUT AND EVERY OVER-QUOTE FLAG. The photo rows and the files under public/uploads/job-photos/ stay
-- where they are (the rows lose only the two columns); a job's check-ins read as "here" again, so a timer worked out from them would count a
-- cleaner who left as being here, and a job that went over its quote reads as one that did not. Nothing else holds those values, so run it only
-- after exporting them. Deploy code without the ENG-016 routes and the photo-retention cron before running this file: they fail for every request
-- once the columns are gone.
--
-- Applied to the dev database with: docker exec -i workontap-db mysql -uroot -proot123 workontap_db < 0009-job-photos-and-timer.down.sql

ALTER TABLE bookings
  DROP COLUMN over_quote_at;

ALTER TABLE job_checkins
  DROP COLUMN checked_out_at;

ALTER TABLE job_photos
  DROP INDEX idx_job_photos_uploaded,
  DROP COLUMN taken_by_ref,
  DROP COLUMN taken_by_kind;
