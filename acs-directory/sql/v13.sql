-- Factory+ / AMRC Connectivity Stack (ACS) Directory component
-- Database creation/upgrade DDL.
-- Copyright 2026 University of Sheffield AMRC


call migrate_to(13, $migrate$
    -- everyone loves a double negative
    alter table service_provider alter column device drop not null;
$migrate$);
