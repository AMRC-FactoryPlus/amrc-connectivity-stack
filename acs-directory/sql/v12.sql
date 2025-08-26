-- Factory+ / AMRC Connectivity Stack (ACS) Directory component
-- Database creation/upgrade DDL.
-- Copyright 2025 AMRC


call migrate_to(12, $migrate$

    -- We have to drop existing entries which will violate the unique
    -- constraint. We don't know which was valid so we have to assume
    -- that valid entries will be re-registered. It's not worth trying
    -- to only delete the duplicate entries so just delete them all.
    delete from service_provider;

    -- Drop the existing unique constraint
    ALTER TABLE service_provider DROP CONSTRAINT service_provider_service_device_key;


    -- Add the new unique constraint
    ALTER TABLE service_provider ADD CONSTRAINT service_provider_service_key UNIQUE (service);

$migrate$);
