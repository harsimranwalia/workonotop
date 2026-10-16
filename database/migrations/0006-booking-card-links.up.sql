-- 0006-booking-card-links.up.sql
-- Adds the booking_card_links table and quote_requests.booking_id.
-- booking_card_links holds one row for each booking an admin made on a customer's behalf, so "made on behalf" is the existence of the row.
-- The row is the link the customer opens to add a card (the SHA-256 of its token, never the token, with an expiry, a count of the setup
-- calls made on it and the time a card was saved) and, once one is added, the card: the Stripe customer, the SetupIntent, the payment
-- method, and its brand and last four digits for display. It holds no name, email, phone or address, because the customer is the
-- booking's, and it goes with its booking.
-- quote_requests.booking_id is the booking a quote request was turned into: NULL, which every existing row keeps, is a request nobody has booked.
-- It changes no existing row, and a booking with no row in booking_card_links is charged by the path every booking takes, so no booking changes until an
-- admin makes one on a customer's behalf.
--
-- Applied to the dev database with: docker exec -i workontap-db mysql -uroot -proot123 workontap_db < 0006-booking-card-links.up.sql
-- (the fixture reset does not build the schema); database/schema.js carries the same table, column, index and key for a fresh install.
-- Undone by 0006-booking-card-links.down.sql.

CREATE TABLE booking_card_links (
  id INT NOT NULL AUTO_INCREMENT,
  booking_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  used_at DATETIME NULL,
  issued_by INT NULL,
  stripe_customer_id VARCHAR(255) NULL,
  setup_intent_id VARCHAR(255) NULL,
  payment_method_id VARCHAR(255) NULL,
  card_brand VARCHAR(30) NULL,
  card_last4 CHAR(4) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_booking_card_links_booking (booking_id),
  UNIQUE KEY uq_booking_card_links_token (token_hash),
  CONSTRAINT fk_booking_card_links_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE,
  CONSTRAINT fk_booking_card_links_issued_by FOREIGN KEY (issued_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE quote_requests
  ADD COLUMN booking_id INT NULL AFTER picks,
  ADD INDEX idx_booking (booking_id),
  ADD CONSTRAINT fk_quote_requests_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE SET NULL;
