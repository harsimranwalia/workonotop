-- 0011-notice-attempts.up.sql
-- Adds notice_attempts, the record of every text and e-mail the app tries to send about an event (ENG-018, ADR-018). One row is one attempt to tell one
-- person one thing on one channel: the kind of notice (quote_requested, card_link, job_booked, job_assigned, job_claimed, job_link, report_added,
-- job_started, job_finished), the channel, who it is for (recipient_kind and recipient_ref, which is a users.id, a service_providers.id or a
-- provider_crew_members.id by kind, and NULL for a customer with no account, so there is no foreign key), the booking it is about, and how it ended
-- (outcome; settled_at is when). The row is the send-once key as well as the record: src/lib/notices.js INSERTs it with its event_key BEFORE anything
-- is sent, and event_key is unique, so two requests that race for one notice send once. event_key is the SHA-256 of the kind, the subject ids, the
-- recipient and the channel (noticeKey in src/lib/notices.js). It is NULL on a row that holds no key (a refusal, a cap, a missing credential), and
-- MySQL allows any number of NULLs in a unique key, so a notice that was refused can be tried again once the cause is cured.
-- THE ROW HOLDS NO NUMBER, NO ADDRESS, NO NAME, NO BODY AND NO LINK: ids and codes only, like job_link_events. There is no foreign key on booking_id
-- on purpose: a quote request has no booking, and a booking that is deleted must not take its record of what was sent with it. Rows are aged out by
-- pruneNotices (NOTICE_KEEP_DAYS, 180), called from the retention sweep in src/lib/crew-retention.js.
-- The table is new and additive: no existing row or table changes. The ENG-018 code reads it on every notice, so this file goes in before the code or
-- with it. (booking_card_links.setup_intent_id, which the design's last step planned to ADD, has existed since 0006-booking-card-links, so nothing
-- is altered here.)
-- Applied to the dev database with: docker exec -i workontap-db mysql -uroot -proot123 workontap_db < database/migrations/0011-notice-attempts.up.sql
-- (the fixture reset does not build the schema); database/schema.js carries the same table for a fresh install. Undone by 0011-notice-attempts.down.sql.

CREATE TABLE notice_attempts (
  id BIGINT NOT NULL AUTO_INCREMENT,
  event_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  kind VARCHAR(24) NOT NULL,
  channel ENUM('sms','email') NOT NULL,
  recipient_kind ENUM('customer','provider','cleaner','admin') NOT NULL,
  recipient_ref INT NULL,
  booking_id INT NULL,
  outcome VARCHAR(16) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  settled_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_notice_attempts_key (event_key),
  KEY idx_notice_attempts_booking (booking_id, created_at),
  KEY idx_notice_attempts_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
