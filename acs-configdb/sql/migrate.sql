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

\ir createdb.sql
\ir migration.sql

-- Version 6 was the first to use this setup.
\ir v6.sql
\ir v7.sql

-- Revoke some unhelpful default permissions.
revoke all on database :"db" from public;
revoke all on schema public from public;

-- Grant permissions.
grant connect on database :"db" to :"role";
grant usage on schema public to :"role";
grant select on
    version
to :"role";
grant select, insert, update, delete on
    object, app, class, config
to :"role";
grant usage on
    object_id_seq, config_id_seq
to :"role";

\echo Migration complete.
