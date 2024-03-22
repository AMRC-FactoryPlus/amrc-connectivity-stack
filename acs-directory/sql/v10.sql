-- Factory+ / AMRC Connectivity Stack (ACS) Directory component
-- Database creation/upgrade DDL.
-- Copyright 2023 AMRC.

call migrate_to(10, $migrate$
    -- Copy the data to a temp table and drop the original. Otherwise
    -- all the sequences etc. get weird names because of the conflicts.
    create temporary table old_sp as table service_provider;
    drop table service_provider;

    -- Service adverts are owned by their advertising device
    create table service_provider (
        id serial primary key,

        service integer not null references service,
        device integer not null references device,
        unique(service, device),

        url text null
    );

    -- This will create device records which don't correspond to real
    -- Sparkplug devices. 
    insert into device (uuid)
    select uuid from principal
    on conflict do nothing;

    -- The owner is the correct device UUID to use. No existing owners
    -- register a different device UUID.
    insert into service_provider (service, device, url)
    select s.service, d.id, s.url
    from old_sp s
        join principal p on p.id = s.owner
        join device d on d.uuid = p.uuid;

    drop table principal;
    drop table old_sp;
$migrate$);
