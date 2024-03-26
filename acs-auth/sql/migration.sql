-- Factory+ / AMRC Connectivity Stack (ACS) Authorisation component
-- DB migration logic.
-- Copyright 2022 AMRC.

-- Create the version table.
create table if not exists version (
    version integer not null
);

-- Create a procedure to perform a migration.
create or replace procedure migrate_to (newvers integer, sql text)
    language plpgsql
    as $$
        declare
            curvers integer;
        begin
            select version into curvers from version;
            if curvers is null or curvers < newvers then
                raise notice 'Migrating database schema to version %', newvers;
                execute sql;
            end if;
            if curvers is null then
                insert into version (version) values (newvers);
            else
                update version set version = newvers;
            end if;
        end;
    $$;
