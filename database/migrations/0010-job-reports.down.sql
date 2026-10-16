-- 0010-job-reports.down.sql
-- Undoes 0010-job-reports.up.sql: drops job_reports.
--
-- THIS DISCARDS EVERY REPORT, EVERY DECISION ON IT AND EVERY REFERENCE FROM A CHARGE BACK TO ITS REPORT. The PaymentIntents of the added-items charges
-- stay in Stripe, each with metadata.report_id, but nothing here will say which report one paid for. Before running it, export what a refund or a
-- dispute would need:
--   SELECT id, booking_id, charge_intent_id, charge_id, approved_cents, approved_lines, decided_by, decided_at
--     FROM job_reports WHERE charge_status = 'paid';
-- The report photos under public/uploads/job-photos/ stay on disk and are swept as orphans within 24 hours (ORPHAN_GRACE_HOURS) once no row names them.
-- Deploy code without the ENG-017 routes, the admin's queue and the photo-retention step for reports before running this file: they fail for every
-- request once the table is gone.
--
-- Applied to the dev database with: docker exec -i workontap-db mysql -uroot -proot123 workontap_db < database/migrations/0010-job-reports.down.sql

DROP TABLE job_reports;
