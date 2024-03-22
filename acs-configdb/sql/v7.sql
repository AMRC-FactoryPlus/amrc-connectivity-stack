-- Factory+ config DB
-- Database creation/upgrade DDL.
-- Copyright 2023 AMRC.

call migrate_to(7, $$
    alter table config
    add column etag uuid default gen_random_uuid();
$$);
