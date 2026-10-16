-- 0006-booking-card-links.down.sql
-- Undoes 0006-booking-card-links.up.sql: drops the booking_card_links table, then the foreign key, the index and the column
-- quote_requests.booking_id. The table goes first and with IF EXISTS, so the file also cleans up an up that stopped after its CREATE: the
-- two ALTERs then report that the foreign key does not exist, and the table, which was all there was to undo, is already gone.
--
-- THIS DISCARDS EVERY CARD REFERENCE: the Stripe customer, SetupIntent and payment method that each booking made on a customer's behalf
-- holds, and the link its customer was given to add one. Stripe keeps the cards, but this database does not know which card is whose,
-- so run it only on an empty booking_card_links, or after exporting the table. It also drops the record of which booking each quote request became.
-- The bookings stay, with no payment attached, and code without the card links can neither approve nor release them, so settle or cancel
-- them first. Deploy code without the card links before running this file: the auto-release sweep of this code reads the table on every run, so it fails
-- for every booking once the table is gone.
--
-- Applied to the dev database with: docker exec -i workontap-db mysql -uroot -proot123 workontap_db < 0006-booking-card-links.down.sql

DROP TABLE IF EXISTS booking_card_links;

ALTER TABLE quote_requests DROP FOREIGN KEY fk_quote_requests_booking;

ALTER TABLE quote_requests
  DROP INDEX idx_booking,
  DROP COLUMN booking_id;
