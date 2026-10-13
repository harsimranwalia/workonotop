-- 0002-bookings-payment-intent-unique.down.sql
-- Undoes 0002-bookings-payment-intent-unique.up.sql.
ALTER TABLE bookings DROP INDEX uq_bookings_payment_intent;
