-- 0002-bookings-payment-intent-unique.up.sql
-- Makes payment_intent_id unique across bookings, so one payment pays for one booking.
-- It stops with no change if two bookings share an id; list them first with:
--   SELECT payment_intent_id, COUNT(*) FROM bookings WHERE payment_intent_id IS NOT NULL GROUP BY payment_intent_id HAVING COUNT(*) > 1;
-- Applied by hand to an existing database and to the dev database (the fixture reset does not build the schema);
-- database/schema.js carries the same index for a fresh install. Undone by 0002-bookings-payment-intent-unique.down.sql.
ALTER TABLE bookings ADD UNIQUE INDEX uq_bookings_payment_intent (payment_intent_id);
