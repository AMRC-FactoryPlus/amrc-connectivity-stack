-- Factory+ / AMRC Connectivity Stack (ACS) Directory component
-- Database creation/upgrade DDL.
-- Copyright 2024 AMRC

call migrate_to(11, $migrate$
    -- XXX These tables of UUIDs need refactoring. I'm not quite sure of
    -- the best way to do it, though; ideally we need something like the
    -- ConfigDB's classes to tell if a given UUID is OK to use for a
    -- particular purpose. 
    -- create table link_rel (id integer primary key references object) ?
    create table link_rel (
        id serial primary key,
        uuid uuid unique not null
    );

    create table link (
        id serial primary key,
        uuid uuid unique not null,
        stale boolean not null default false,
        -- This is the Device which published this Link. For now we
        -- assume this cannot change.
        device integer not null references device,
        -- XXX This is a UUID field, but often it will reference other
        -- objects we already have (devices, alerts).
        source uuid not null,
        relation integer not null references link_rel,
        target uuid not null
    );

    call setup_mqtt_notify('link');

    alter table alert
    add column stale boolean not null default false;
$migrate$);
