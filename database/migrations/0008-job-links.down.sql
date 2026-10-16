-- 0008-job-links.down.sql
-- Undoes 0008-job-links.up.sql: drops job_link_events, job_checkins, job_link_codes and crew_number_checks, then job_links (the first three hold a
-- foreign key to it), then sms_budget, which holds none. Every table goes with IF EXISTS, so the file also cleans up an up that stopped part way.
--
-- THIS DISCARDS EVERY JOB LINK, SIGN-IN CODE AND SESSION, EVERY CHECK-IN AND ITS POSITION, THE WHOLE RECORD OF WHO DID WHAT AT A LINK, EVERY SMS
-- COUNTER AND EVERY NUMBER CHECK. Nothing else holds them, so run it only on empty tables or after exporting them. Providers would have to check
-- their cleaners' numbers again, and every job would need a new link. Deploy code without the job-link routes and the crew-retention cron before
-- running this file: they fail for every request once the tables are gone.
--
-- Applied to the dev database with: docker exec -i workontap-db mysql -uroot -proot123 workontap_db < 0008-job-links.down.sql

DROP TABLE IF EXISTS job_link_events;

DROP TABLE IF EXISTS job_checkins;

DROP TABLE IF EXISTS job_link_codes;

DROP TABLE IF EXISTS crew_number_checks;

DROP TABLE IF EXISTS job_links;

DROP TABLE IF EXISTS sms_budget;
