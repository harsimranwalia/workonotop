-- 0005-quote-requests.down.sql
-- Undoes 0005-quote-requests.up.sql: drops the quote_requests table, then the two checks, then the quote_from column they name.
-- The table goes first and with IF EXISTS, so the file also cleans up an up that stopped after its ALTER.
--
-- THIS DISCARDS EVERY CUSTOMER'S QUOTE REQUEST: run it only on an empty quote_requests, or after exporting the table.
-- The items stay. One that quote_from kept out of the price (the dev property types commercial and post_construction, amount 0)
-- is an ordinary pick once the column is gone and books at the rest of its answers, so delete those rows first, or reload the
-- fixtures of the branch you go back to.
--
-- Applied to the dev database with: docker exec -i workontap-db mysql -uroot -proot123 workontap_db < 0005-quote-requests.down.sql

DROP TABLE IF EXISTS quote_requests;

ALTER TABLE service_pricing_items
  DROP CHECK chk_service_pricing_items_quote_weekend,
  DROP CHECK chk_service_pricing_items_quote_from;

ALTER TABLE service_pricing_items DROP COLUMN quote_from;
