-- ACS Auth component
-- Database schema version 2
-- Copyright 2024 University of Sheffield AMRC

select schema_version() < 2 need_update \gset
\if :need_update
    create table uuid (
        id serial primary key,
        uuid uuid unique not null
    );
    create table ace (
        id serial primary key,
        uuid integer unique not null references uuid,
        principal integer not null references uuid,
        permission integer not null references uuid,
        args jsonb[] not null
    );

    select set_schema_version(2);
\endif
