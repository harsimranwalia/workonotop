-- 0005-quote-requests.up.sql
-- Adds service_pricing_items.quote_from and the quote_requests table.
-- quote_from marks an item that sends a job to a quote: NULL, which every existing row keeps, never does; a number n >= 1 does when the
-- answers pick the item at a quantity of n or more (a property type or an option is picked once, a unit or an extra by its count).
-- The row keeps its own amount and minutes. A weekend is not a pick, so its row cannot carry one.
-- quote_requests holds a customer's request for a job that cannot be priced from a few taps: who they are and where, what they say about
-- the job, the answers the pricing rule accepted and the picks that sent it to a quote. It holds no money and is never a booking.
-- It inserts no row and changes no row, and a NULL quote_from never sends a job to a quote, so no job goes to a quote until an item is given a quote_from.
--
-- Applied to the dev database with: docker exec -i workontap-db mysql -uroot -proot123 workontap_db < 0005-quote-requests.up.sql
-- (the fixture reset does not build the schema); database/schema.js carries the same column, checks and table for a fresh install.
-- Undone by 0005-quote-requests.down.sql.

ALTER TABLE service_pricing_items
  ADD COLUMN quote_from INT NULL AFTER is_hourly,
  ADD CONSTRAINT chk_service_pricing_items_quote_from CHECK (quote_from IS NULL OR quote_from >= 1),
  ADD CONSTRAINT chk_service_pricing_items_quote_weekend CHECK (kind <> 'weekend' OR quote_from IS NULL);

CREATE TABLE quote_requests (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NULL,
  service_id INT NOT NULL,
  service_name VARCHAR(255) NOT NULL,
  customer_name VARCHAR(120) NOT NULL,
  customer_email VARCHAR(254) NOT NULL,
  customer_phone VARCHAR(40) NULL,
  address VARCHAR(255) NULL,
  message VARCHAR(1000) NOT NULL,
  answers JSON NOT NULL,
  picks JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_customer_email_created (customer_email, created_at),
  INDEX idx_created (created_at),
  CONSTRAINT fk_quote_requests_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_quote_requests_service FOREIGN KEY (service_id) REFERENCES services (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
