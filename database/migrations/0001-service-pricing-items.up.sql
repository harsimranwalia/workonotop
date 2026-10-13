-- Adds the items of each service's pricing rule, and the price breakdown a booking is recorded with.
--
-- A service's rule is its catalog row (services.base_price and services.duration_minutes) plus its rows here. Each row is one part of
-- the rule: an amount per unit, an option (a tier, or an amount an hour), a property type, the weekend, or an extra by quantity.
-- Every row has an amount and the minutes it adds, neither below 0. This migration inserts no rows and changes no service and no
-- booking: with no rows, every service books at its catalog price and duration.
--
-- Applied to the dev database with: docker exec -i workontap-db mysql -uroot -proot123 workontap_db < 0001-service-pricing-items.up.sql
-- Undone by 0001-service-pricing-items.down.sql.

CREATE TABLE service_pricing_items (
  id INT NOT NULL AUTO_INCREMENT,
  service_id INT NOT NULL,
  kind ENUM('unit', 'option', 'property_type', 'weekend', 'extra') NOT NULL,
  code VARCHAR(40) NOT NULL,
  label VARCHAR(255) NOT NULL,
  amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  minutes INT NOT NULL DEFAULT 0,
  is_hourly TINYINT(1) NOT NULL DEFAULT 0,
  is_placeholder TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_service_pricing_items_code (service_id, kind, code),
  CONSTRAINT fk_service_pricing_items_service FOREIGN KEY (service_id) REFERENCES services (id) ON DELETE CASCADE,
  CONSTRAINT chk_service_pricing_items_code CHECK (code REGEXP '^[a-z0-9_]{1,40}$'),
  CONSTRAINT chk_service_pricing_items_amount CHECK (amount >= 0),
  CONSTRAINT chk_service_pricing_items_minutes CHECK (minutes >= 0),
  CONSTRAINT chk_service_pricing_items_hourly CHECK (is_hourly = 0 OR kind = 'option'),
  CONSTRAINT chk_service_pricing_items_weekend CHECK (kind <> 'weekend' OR code = 'weekend')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- The lines a booking was priced with (kind, code, label, quantity, amount, minutes), written once when the booking is made.
-- NULL on a booking made before this column existed.
ALTER TABLE bookings ADD COLUMN price_breakdown JSON NULL AFTER standard_duration_minutes;
