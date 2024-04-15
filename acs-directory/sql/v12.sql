-- Factory+ / AMRC Connectivity Stack (ACS) Directory component
-- Database creation/upgrade DDL.
-- Copyright 2024 AMRC.

call migrate_to(12, $migrate$
    alter table alert
    add column stale boolean not null default false;

    alter table link
    add column stale boolean not null default false;
$migrate$);
