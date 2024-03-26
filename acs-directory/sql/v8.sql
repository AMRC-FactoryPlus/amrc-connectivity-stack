-- Factory+ / AMRC Connectivity Stack (ACS) Directory component
-- Database creation/upgrade DDL.
-- Copyright 2021 AMRC.

call migrate_to(8, $migrate$
    -- Change the database to keep a complete record of historical
    -- sessions. Link historical sessions to the next session per device
    -- and per address; this is more reliable and more performant than
    -- relying on the timestamps.
    alter table session
        add column next_for_device integer null references session,
        add column next_for_address integer null references session,
        drop constraint session_address_key,
        drop constraint session_device_key;
    create index on session (next_for_device);
    create index on session (next_for_address);

    drop trigger mqtt_notify on schema_used;

    create or replace view device_status as
        select dev.uuid, adr.group_id, adr.node_id, adr.device_id,
            ses.finish is null as online,
            coalesce(ses.finish, ses.start) last_change,
            tsch.uuid top_schema,
            coalesce(scs.schemas, '{}') schemas
        from device dev
            join session ses on ses.device = dev.id
            join address adr on adr.id = ses.address
            left join schema tsch on tsch.id = ses.top_schema
            left join session_schemas scs on scs.session = ses.id
        where ses.next_for_device is null;
$migrate$);
