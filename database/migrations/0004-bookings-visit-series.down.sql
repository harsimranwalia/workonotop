-- 0004-bookings-visit-series.down.sql
-- Undoes 0004-bookings-visit-series.up.sql: drops the index, then the three columns. Every visit stays a booking of its own; only what
-- ties it to its series goes.
ALTER TABLE bookings
  DROP INDEX idx_series,
  DROP COLUMN series_id,
  DROP COLUMN series_visit,
  DROP COLUMN series_frequency;
