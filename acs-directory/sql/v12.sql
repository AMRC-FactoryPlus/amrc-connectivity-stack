-- Factory+ / AMRC Connectivity Stack (ACS) Directory component
-- Database creation/upgrade DDL.
-- Copyright 2025 AMRC


call migrate_to(12, $migrate$

    -- Drop the existing unique constraint
    ALTER TABLE service_provider DROP CONSTRAINT service_provider_service_device_key;

    -- Add the new unique constraint
    ALTER TABLE service_provider ADD CONSTRAINT service_provider_service_key UNIQUE (service);

$migrate$);