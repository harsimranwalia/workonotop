-- 0008-job-links.up.sql
-- Adds job_links, job_link_codes, job_checkins, job_link_events, sms_budget and crew_number_checks (ENG-015).
-- job_links holds one row per booking that has a link: the token that is in the address of /job/{token}, a generation that goes up each time the
-- link is reissued, and off_at for a link that is switched off. The token is a locator and not a credential: it opens no field of the job by
-- itself (a cleaner needs a texted code, the job's provider and an admin their own sign-in), so it is stored as it is. It is CHAR(43) in ascii_bin
-- because base64url is case-sensitive and the table's default collation is not: with the default two tokens that differ only in case would match
-- one row.
-- job_link_codes is a sign-in code and, once it is used, the session it bought: one table, so a session is ended by the row that made it. It keeps
-- only the SHA-256 of the code and of the cookie, never either value, and the number the code went to, because a session holds only while that is
-- still the crew member's number. job_checkins is one row per cleaner per assignment, with the position the phone reported (nulled after a year).
-- job_link_events is the record of who did what at a link; it holds ids and never a name or a number. sms_budget is counters keyed by the SHA-256
-- of what is being counted, so no number is stored there. crew_number_checks is a code the provider asks for to prove that a number is the
-- cleaner's and, once used_at is set, the proof: a number is checked while a used row exists for the member and the member's current phone.
-- The rows of job_link_codes, job_checkins, job_link_events and crew_number_checks concern people who are not users of the app. They are written
-- only through prepared statements by the libraries under src/lib/, are never put in a URL or a log line, and are covered by
-- src/lib/crew-retention.js.
-- All six tables are new and additive: bookings, service_providers, provider_crew_members and booking_crew are not altered and no existing row
-- changes. No existing route reads or writes them, so this file goes before or with the code of ENG-015 and there is no ordering hazard with
-- the code that is already running.
--
-- Applied to the dev database with: docker exec -i workontap-db mysql -uroot -proot123 workontap_db < 0008-job-links.up.sql
-- (the fixture reset does not build the schema); database/schema.js carries the same tables, keys and indexes for a fresh install.
-- Undone by 0008-job-links.down.sql.

CREATE TABLE job_links (
  id INT NOT NULL AUTO_INCREMENT,
  booking_id INT NOT NULL,
  token CHAR(43) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  generation INT NOT NULL DEFAULT 1,
  off_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_job_links_booking (booking_id),
  UNIQUE KEY uq_job_links_token (token),
  CONSTRAINT fk_job_links_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE job_link_codes (
  id INT NOT NULL AUTO_INCREMENT,
  link_id INT NOT NULL,
  generation INT NOT NULL,
  crew_member_id INT NOT NULL,
  assignment_epoch BIGINT NOT NULL,
  phone VARCHAR(20) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  used_at DATETIME NULL,
  session_hash CHAR(64) NULL,
  session_expires_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_job_link_codes_session (session_hash),
  KEY idx_job_link_codes_live (link_id, crew_member_id, created_at),
  KEY idx_job_link_codes_member (crew_member_id),
  KEY idx_job_link_codes_expires (expires_at),
  CONSTRAINT fk_job_link_codes_link FOREIGN KEY (link_id) REFERENCES job_links (id) ON DELETE CASCADE,
  CONSTRAINT fk_job_link_codes_member FOREIGN KEY (crew_member_id) REFERENCES provider_crew_members (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE job_checkins (
  id INT NOT NULL AUTO_INCREMENT,
  booking_id INT NOT NULL,
  crew_member_id INT NOT NULL,
  assignment_epoch BIGINT NOT NULL,
  checked_in_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  by_kind ENUM('cleaner','provider','admin') NOT NULL,
  by_ref INT NOT NULL,
  latitude DECIMAL(10,8) NULL,
  longitude DECIMAL(11,8) NULL,
  accuracy_m INT NULL,
  distance_m INT NULL,
  away TINYINT(1) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_job_checkins_assignment (booking_id, crew_member_id, assignment_epoch),
  KEY idx_job_checkins_member (crew_member_id),
  KEY idx_job_checkins_at (checked_in_at),
  CONSTRAINT fk_job_checkins_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE,
  CONSTRAINT fk_job_checkins_member FOREIGN KEY (crew_member_id) REFERENCES provider_crew_members (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE job_link_events (
  id BIGINT NOT NULL AUTO_INCREMENT,
  link_id INT NOT NULL,
  booking_id INT NOT NULL,
  kind VARCHAR(24) NOT NULL,
  actor_kind ENUM('cleaner','provider','admin','visitor') NOT NULL,
  actor_ref INT NULL,
  crew_member_id INT NULL,
  latitude DECIMAL(10,8) NULL,
  longitude DECIMAL(11,8) NULL,
  accuracy_m INT NULL,
  detail VARCHAR(40) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_job_link_events_link (link_id, created_at),
  KEY idx_job_link_events_booking (booking_id, created_at),
  KEY idx_job_link_events_created (created_at),
  KEY idx_job_link_events_member (crew_member_id),
  CONSTRAINT fk_job_link_events_link FOREIGN KEY (link_id) REFERENCES job_links (id) ON DELETE CASCADE,
  CONSTRAINT fk_job_link_events_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE,
  CONSTRAINT fk_job_link_events_member FOREIGN KEY (crew_member_id) REFERENCES provider_crew_members (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE sms_budget (
  scope CHAR(64) NOT NULL,
  window_started_at DATETIME NOT NULL,
  used INT NOT NULL,
  PRIMARY KEY (scope),
  KEY idx_sms_budget_window (window_started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE crew_number_checks (
  id INT NOT NULL AUTO_INCREMENT,
  crew_member_id INT NOT NULL,
  phone VARCHAR(20) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  used_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_crew_number_checks_member (crew_member_id, phone),
  KEY idx_crew_number_checks_expires (expires_at),
  CONSTRAINT fk_crew_number_checks_member FOREIGN KEY (crew_member_id) REFERENCES provider_crew_members (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
