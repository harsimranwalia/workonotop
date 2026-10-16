-- 0007-provider-crew.up.sql
-- Adds provider_crew_members and booking_crew.
-- provider_crew_members is the list of cleaners a provider keeps: a name and a mobile number, stored in E.164 (+14035550123) by
-- src/lib/phone.js and never in any other form. A member is removed by setting removed_at, not by deleting the row, so that "who was on that
-- job" stays answerable after a cleaner leaves the list and later tickets have a stable person id to hang records on. The unique key on
-- (provider_id, phone) counts removed rows too: adding a number that is on the list is refused, and adding one that is on a removed row
-- brings that row back. The rows hold the name and number of people who are not users of the app, so they are written and read only by the
-- routes under src/app/api/provider/ and are never put in a URL.
-- booking_crew says which members are on which job. It says nothing about which provider: that is the member's, reached through the join in
-- src/lib/booking-crew.js on the booking's current provider_id, so a row made under one provider is invisible once the job is another's.
-- Both tables are new and additive: bookings and service_providers are not altered and no existing row changes. Nothing reads them until the code
-- of ENG-014 runs, and the three admin routes that reset a job (reassign, restart, and the clear path of PUT /api/bookings) delete from
-- booking_crew, so this file goes before that code.
--
-- Applied to the dev database with: docker exec -i workontap-db mysql -uroot -proot123 workontap_db < 0007-provider-crew.up.sql
-- (the fixture reset does not build the schema); database/schema.js carries the same tables, keys and indexes for a fresh install.
-- Undone by 0007-provider-crew.down.sql.

CREATE TABLE provider_crew_members (
  id INT NOT NULL AUTO_INCREMENT,
  provider_id INT NOT NULL,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  removed_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_provider_crew_members_phone (provider_id, phone),
  KEY idx_provider_crew_members_active (provider_id, removed_at),
  CONSTRAINT fk_provider_crew_members_provider FOREIGN KEY (provider_id) REFERENCES service_providers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE booking_crew (
  booking_id INT NOT NULL,
  crew_member_id INT NOT NULL,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (booking_id, crew_member_id),
  KEY idx_booking_crew_member (crew_member_id),
  CONSTRAINT fk_booking_crew_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE,
  CONSTRAINT fk_booking_crew_member FOREIGN KEY (crew_member_id) REFERENCES provider_crew_members (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
