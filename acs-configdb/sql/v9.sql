-- Factory+ config DB
-- Database creation/upgrade DDL.
-- Copyright 2023 AMRC.

-- Remove the app table and migrate the config schemas into a normal
-- app entry. Add owner and deleted to object table.
call migrate_to(9, $$
    -- Migrate Wildcard, Special and ConfigSchema to private IDs. Create
    -- a new Special, Unowned. For now consider Specials to be
    -- individuals; I'm not sure this is strictly correct.
    insert into object (id, uuid, rank, class)
    values (13, 'ddb132e4-5cdd-49c8-b9b1-2f35879eab6d', 1, 1),
        (14, '00000000-0000-0000-0000-000000000000', 0, 13),
        (15, '091e796a-65c0-4080-adff-c3ce01a65b2e', 0, 13),
        (16, 'dbd8a535-52ba-4f6e-b4f8-9b71aefe09d3', 0, 2)
    on conflict (uuid) do update set 
        id = excluded.id, rank = excluded.rank, class = excluded.class;

    insert into config (app, object, json)
    values (7, 13, '{ "name": "Special UUIDs" }'),
        (7, 14, '{ "name": "Wildcard" }'),
        (7, 15, '{ "name": "Unowned" }'),
        (7, 16, '{ "name": "Application config schema" }')
    on conflict (app, object) do update
        set json = excluded.json, etag = default;

    insert into membership (id, class)
        values (13, 1), (14, 13), (15, 13), (16, 2)
        on conflict (id, class) do nothing;

    insert into subclass (id, class) values (13, 12)
        on conflict (id, class) do nothing;

    -- Migrate config schemas into plain config entries
    alter table config
        drop constraint config_app_fkey,
        add foreign key (app) references object on update cascade;
    
    insert into config (app, object, json)
    select 16, a.id, a.schema 
    from app a where a.schema is not null;

    drop table app;

    -- Add owner information and move deletion into `object`
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

    -- Create Object Registration config entries. This procedure needs
    -- to be called whenever the object table is changed directly.
    create or replace procedure update_registration(_obj integer)
    language sql
    begin atomic
        insert into config (app, object, json)
        select 6, o.id, jsonb_build_object(
            'uuid', o.uuid,
            'class', c.uuid,
            'rank', o.rank,
            'owner', p.uuid,
            'deleted', o.deleted) json
        from object o
            left join object c on c.id = o.class
            join object p on p.id = o.owner
        where _obj is null or o.id = _obj
        on conflict (app, object) do update
            set json = excluded.json, etag = default
            where config.json != excluded.json;
    end;
    call update_registration(null);

    -- Add a config schema for Registration
    insert into config (app, object, json)
    values (16, 6, '{
        "type": "object",
        "additionalProperties": false,
        "required": ["uuid", "rank", "class", "deleted", "owner"],
        "properties": {
            "uuid": { "type": "string", "format": "uuid" },
            "rank": { "type": "integer", "minimum": 0 },
            "class": { "type": "string", "format": "uuid" },
            "deleted": { "type": "boolean" },
            "owner": { "type": "string", "format": "uuid" }
        }
    }')
    on conflict (app, object) do update
        set json = excluded.json, etag = default;
$$);
