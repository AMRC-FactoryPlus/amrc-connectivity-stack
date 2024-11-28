-- Factory+ / AMRC Connectivity Stack (ACS) Config Store component
-- Database migration script.
-- Copyright 2022 AMRC.
--
-- This script needs to be run as a database superuser. It creates the
-- database if it doesn't exist, so start it connected to the
-- 'postgres' database.

\set ON_ERROR_STOP

-- Read our config from the environment
\set db `echo $SRV_DATABASE`
\set role `echo $SRV_USER`

\echo Starting migration...

-- Check what exists already (\gset selects into psql variables).
select
    exists(select 1 from pg_database where datname = :'db') has_db,
    exists(select 1 from pg_roles where rolname = :'role') has_role
\gset

-- Create and connect to the database.
\if :has_db
\else
    \echo Creating database :"db"
    create database :"db" allow_connections false;
    revoke all on database :"db" from public;
    alter database :"db" allow_connections true;
\endif
\c :"db"

BEGIN;

-- If the role exists, drop all its permissions. This will also drop any
-- objects owned by that user, but there should be none.
\if :has_role
    \echo Dropping existing permissions for :"role"
    drop owned by :"role";
\else
    \echo Creating database role :"role"
    create user :"role";
\endif

\ir migration.sql

-- Version 6 was the first to use this setup.
\ir v6.sql
\ir v7.sql
\ir v8.sql
\ir v9.sql

\ir grant.sql

COMMIT;

\echo Migration complete.
