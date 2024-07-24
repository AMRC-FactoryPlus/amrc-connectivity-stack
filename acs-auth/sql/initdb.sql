-- Factory+ / AMRC Connectivity Stack (ACS) Authorisation component
-- Database migration script.
-- Copyright 2022 AMRC.
--
-- This needs to run as a database superuser. It sets up the database,
-- creating or migrating as necessary. It should be run connected to
-- template1 in case our database doesn't exist yet; it will create the
-- database if necessary and reconnect.

\set ON_ERROR_STOP

-- Read our config from the environment.
\set db `echo $SRV_DATABASE`
\set role `echo $SRV_DBUSER`

\ir createdb.sql
\ir migration.sql

\ir v1.sql

-- Grant permissions as needed
grant select on 
    version, group_members, resolved_ace
to :"role";
grant select, insert, update, delete on
    ace, member, principal
to :"role";
grant usage on
    ace_id_seq
to :"role";
