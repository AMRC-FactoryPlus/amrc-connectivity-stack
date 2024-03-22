-- Factory+ / AMRC Connectivity Stack (ACS) Directory component
-- Database creation/upgrade DDL.
-- Copyright 2021 AMRC.

call migrate_to(6, $migrate$
    alter table service rename to old_service;

    create table service (
        id serial primary key,
        uuid uuid unique not null
    );

    -- XXX I don't like these nullable fields; Date would not approve.
    -- But normalising to a set of linked tables would just mean a left
    -- join back to a relation full of nulls, so what's the point.
    create table service_provider (
        service integer not null references service,
        -- owner may be a device, but does not have to be, so record as
        -- a UUID. Maybe a separate table of known principals?
        owner uuid not null,
        unique(service, owner),

        device integer null references device,
        url text null
    );

    insert into service (uuid)
    select distinct uuid from old_service;

    -- Services advertised over MQTT are owned by the advertising device
    -- (for now...).
    insert into service_provider (service, owner, device, url)
    select s.id, d.uuid, o.device, o.url
    from old_service o
        join service s on s.uuid = o.uuid
        join device d on d.id = o.device;

    drop table old_service;
$migrate$);
