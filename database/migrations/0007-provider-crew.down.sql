-- 0007-provider-crew.down.sql
-- Undoes 0007-provider-crew.up.sql: drops booking_crew, then provider_crew_members (the first holds a foreign key to the second). Both go with
-- IF EXISTS, so the file also cleans up an up that stopped after its first CREATE.
--
-- THIS DISCARDS EVERY CREW LIST AND EVERY CREW ASSIGNMENT: the name and mobile number of each cleaner a provider has listed, and which of them
-- were put on which job. Nothing else holds them, so run it only on empty tables or after exporting both. Deploy code without the crew routes
-- before running this file: the admin reassign and restart routes and the clear path of PUT /api/bookings delete from booking_crew, so
-- they fail for every job once the table is gone.
--
-- Applied to the dev database with: docker exec -i workontap-db mysql -uroot -proot123 workontap_db < 0007-provider-crew.down.sql

DROP TABLE IF EXISTS booking_crew;

DROP TABLE IF EXISTS provider_crew_members;
