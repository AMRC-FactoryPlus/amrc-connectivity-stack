-- ACS Auth component
-- DB and role creation
-- Copyright 2024 University of Sheffield AMRC

-- Check what exists already (\gset selects into psql variables).
select
    exists(select 1 from pg_database where datname = :'db') has_db,
    exists(select 1 from pg_roles where rolname = :'role') has_role
\gset

-- Create the database.
\if :has_db
\else
    \echo Creating database :"db"
    create database :"db" allow_connections false;
    revoke all on database :"db" from public;
    alter database :"db" allow_connections true;
\endif

\if :has_role
\else
    \echo Creating database role :"role"
    create user :"role";
\endif
