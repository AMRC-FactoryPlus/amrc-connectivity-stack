-- ACS Auth component
-- Database migration script.
-- Copyright 2024 University of Sheffield AMRC
--
-- This script needs to be run as a database superuser. It creates the
-- database if it doesn't exist, so start it connected to the
-- 'postgres' database.

\set ON_ERROR_STOP

-- Read our config from the environment
\set db `echo $SRV_DATABASE`
\set role `echo $SRV_USER`

\echo Starting migration...

\ir createdb.sql
\c :"db"

BEGIN;

\ir version.sql

-- Start with v2 to avoid conflict with the old auth service
\ir v2.sql

-- For now create the version table for compat with the DB library.
-- Probably the library should be updated use the function instead.
drop table if exists version;
create table version (version integer);
insert into version (version) values (schema_version());

\ir grant.sql

COMMIT;

\echo Migration complete.