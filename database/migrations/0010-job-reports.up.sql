-- 0010-job-reports.up.sql
-- Adds job_reports, for the five on-site reports from the job link and the admin's decision on them (ENG-017). One row is one report: who made it
-- (reporter_kind and reporter_ref, which is a provider_crew_members.id, a service_providers.id or a users.id by kind and so has no foreign key), its
-- type, the note, the one photo (photo_url, NULL once src/lib/job-photo-retention.js has removed the file), how far from the job's address the phone
-- was (distance_m) and whether that is "away" (away; both stay after the event's coordinates are nulled), and the office's decision: status, who
-- decided and when, and, for "Add more items", the priced lines the admin approved (approved_lines, approved_cents) and the state of the second
-- charge that pays for them (charge_status, charge_intent_id, charge_id, charge_reason, charged_at). The charge is a PaymentIntent of its own and
-- is never added to bookings.service_price (ADR-015); charge_intent_id is saved before the intent is confirmed, so a crash between the two is a
-- retry of the same intent and not a second charge. client_token is the page's id for one try: the table is unique on (booking_id, client_token),
-- so a phone that lost the answer to a 200 and sends again gets the same report back. MySQL allows many NULLs in a unique key, so a caller that
-- sent no token is simply not idempotent.
-- The table is new and additive: bookings and job_links are not altered and no existing row changes. Nothing that exists reads or writes it, so this
-- file goes in before the code or with it, and the ENG-017 code must not run without it. A report's photo is a file in the job photo store and is
-- kept for the same PHOTO_DAYS as a job photo; the row, its note and its decision stay as the business record. Rows go only with their booking.
-- Applied to the dev database with: docker exec -i workontap-db mysql -uroot -proot123 workontap_db < database/migrations/0010-job-reports.up.sql
-- (the fixture reset does not build the schema); database/schema.js carries the same table for a fresh install. Undone by 0010-job-reports.down.sql.

CREATE TABLE job_reports (
  id INT NOT NULL AUTO_INCREMENT,
  booking_id INT NOT NULL,
  link_id INT NOT NULL,
  report_type ENUM('no_answer','details_wrong','unhygienic','add_items','cannot_complete') NOT NULL,
  note VARCHAR(1000) NOT NULL,
  photo_url VARCHAR(500) NULL,
  client_token VARCHAR(64) NULL,
  reporter_kind ENUM('cleaner','provider','admin') NOT NULL,
  reporter_ref INT NOT NULL,
  distance_m INT NULL,
  away TINYINT(1) NULL,
  status ENUM('open','handled','approved','declined') NOT NULL DEFAULT 'open',
  decided_by INT NULL,
  decided_at TIMESTAMP NULL,
  decision_note VARCHAR(500) NULL,
  approved_lines TEXT NULL,
  approved_cents INT NULL,
  charge_status ENUM('none','pending','paid','failed') NOT NULL DEFAULT 'none',
  charge_intent_id VARCHAR(255) NULL,
  charge_id VARCHAR(255) NULL,
  charge_reason VARCHAR(24) NULL,
  charged_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_job_reports_client (booking_id, client_token),
  KEY idx_job_reports_status (status, id),
  KEY idx_job_reports_booking (booking_id, id),
  CONSTRAINT fk_job_reports_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_job_reports_link FOREIGN KEY (link_id) REFERENCES job_links(id) ON DELETE CASCADE
);
