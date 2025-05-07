-- Factory+ / AMRC Connectivity Stack (ACS) Directory component
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

BEGIN;

-- Version 5 was the first to use this setup.
\ir v5.sql
\ir v6.sql
\ir v7.sql
\ir v8.sql
\ir v9.sql
\ir v10.sql
\ir v11.sql
\ir v12.sql

\ir permissions.sql

COMMIT;

\echo Migration complete.
