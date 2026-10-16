-- 0004-bookings-visit-series.up.sql
-- Adds bookings.series_id, series_visit and series_frequency: the series a visit belongs to (the id of its first visit), its number in
-- the series (1 for the first visit) and how often the series repeats (weekly, every_2_weeks or monthly). NULL on a one-time booking.
-- It changes no existing row, so every booking starts with NULL in all three, and it names no column to follow, so it applies
-- whatever the state of 0003.
-- Applied by hand to an existing database and to the dev database (the fixture reset does not build the schema);
-- database/schema.js carries the same columns and index for a fresh install. Undone by 0004-bookings-visit-series.down.sql.
ALTER TABLE bookings
  ADD COLUMN series_id INT NULL,
  ADD COLUMN series_visit TINYINT UNSIGNED NULL,
  ADD COLUMN series_frequency VARCHAR(20) NULL,
  ADD INDEX idx_series (series_id);
