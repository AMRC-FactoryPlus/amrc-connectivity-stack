-- Factory+ config DB
-- Database creation/upgrade DDL.
-- Copyright 2023 AMRC.

-- Remove the app table and migrate the config schemas into a normal
-- app entry. Add owner and deleted to object table.
call migrate_to(9, $$
    -- Migrate Wildcard, Special and ConfigSchema to private IDs. Create
    -- a new Special, Unowned.
    insert into object (id, uuid)
    values (13, 'ddb132e4-5cdd-49c8-b9b1-2f35879eab6d'),    -- Special
        (14, '00000000-0000-0000-0000-000000000000'),       -- Wildcard 
        (15, '091e796a-65c0-4080-adff-c3ce01a65b2e'),       -- Unowned
        (16, 'dbd8a535-52ba-4f6e-b4f8-9b71aefe09d3')        -- ConfigSchema
    on conflict (uuid) do update set id = excluded.id;

    insert into config (app, object, json)
    values (7, 13, '{ "name": "Special UUIDs" }'),
        (7, 14, '{ "name": "Wildcard" }'),
        (7, 15, '{ "name": "Unowned" }'),
        (7, 16, '{ "name": "Application config schema" }')
    on conflict (app, object) do update
        set json = excluded.json, etag = default;
    
    select set_primary_class(id, class)
    from (values (13, 12), (14, 13), (15, 13), (16, 2)) p(id, class);

    insert into subclass (id, class) values (13, 11);

    alter table config
        drop constraint config_app_fkey,
        add foreign key (app) references object on update cascade;
    
    insert into config (app, object, json)
    select 13, a.id, a.schema 
    from app a where a.schema is not null;

    drop table app;

    alter table object
        add column owner integer not null references object default 15,
        add column deleted boolean not null default false;

    update object o set deleted = true
    from config c
    where o.id = c.object
        and c.app = 7
        and c.json->'deleted' = 'true';

    update config set json = json #- '{deleted}'
    where app = 7 and json ? 'deleted';
$$);
