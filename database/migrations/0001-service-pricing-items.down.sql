-- Undoes 0001-service-pricing-items.up.sql: removes the price breakdown column and the items table. The price and the quoted minutes
-- already recorded on the bookings (service_price, standard_duration_minutes) stay; only the breakdowns go.
--
-- Applied to the dev database with: docker exec -i workontap-db mysql -uroot -proot123 workontap_db < 0001-service-pricing-items.down.sql

ALTER TABLE bookings DROP COLUMN price_breakdown;

DROP TABLE service_pricing_items;
