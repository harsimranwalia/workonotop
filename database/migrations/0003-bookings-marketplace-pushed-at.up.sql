-- 0003-bookings-marketplace-pushed-at.up.sql
-- Adds bookings.marketplace_pushed_at: when an admin offered the job to providers (NULL: not offered).
-- Jobs open to providers when this is applied keep being offered: they are stamped with the time it runs.
-- Applied by hand to an existing database and to the dev database (the fixture reset does not build the schema);
-- database/schema.js carries the same column for a fresh install. Undone by 0003-bookings-marketplace-pushed-at.down.sql.
ALTER TABLE bookings ADD COLUMN marketplace_pushed_at DATETIME NULL AFTER accepted_at;
UPDATE bookings SET marketplace_pushed_at = NOW() WHERE provider_id IS NULL AND status IN ('pending', 'matching');
