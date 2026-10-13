-- 0003-bookings-marketplace-pushed-at.down.sql
-- Undoes 0003-bookings-marketplace-pushed-at.up.sql.
ALTER TABLE bookings DROP COLUMN marketplace_pushed_at;
