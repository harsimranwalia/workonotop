-- 0011-notice-attempts.down.sql
-- Undoes 0011-notice-attempts.up.sql: drops notice_attempts.
--
-- THIS DISCARDS THE RECORD OF EVERY TEXT AND E-MAIL THE APP TRIED TO SEND ABOUT AN EVENT, AND THE KEYS THAT STOP A NOTICE BEING SENT TWICE. The table
-- holds ids and outcome codes and no personal data, so there is nothing to export for privacy. If a record of what was sent is wanted first:
--   SELECT id, kind, channel, recipient_kind, recipient_ref, booking_id, outcome, created_at, settled_at FROM notice_attempts;
-- Texts and e-mails already sent cannot be recalled by running this. Deploy code without the ENG-018 notice path (src/lib/notices.js and the routes that
-- call it) before running this file: every booking, quote request, claim, crew save and report would otherwise try to claim a row in a table that is
-- gone (the notice path never throws, so the request still succeeds, but it logs a Notice error for each notice and sends nothing).
--
-- Applied to the dev database with: docker exec -i workontap-db mysql -uroot -proot123 workontap_db < database/migrations/0011-notice-attempts.down.sql

DROP TABLE notice_attempts;
