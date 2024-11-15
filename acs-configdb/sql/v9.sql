-- Factory+ config DB
-- Database creation/upgrade DDL.
-- Copyright 2023 AMRC.

-- Remove the app table and migrate the config schemas into a normal
-- app entry.
call migrate_to(9, $$
    alter table config
        -- this should have been done before...
        alter column etag set not null,
        drop constraint config_app_fkey,
        add foreign key (app) references object on update cascade;
    
    insert into object (id, uuid)
    values (13, 'dbd8a535-52ba-4f6e-b4f8-9b71aefe09d3')
    on conflict (uuid) do update set id = excluded.id;
    
    insert into membership (class, member)
    values (2, 13)
    on conflict (class, member) do nothing;

    insert into config (app, object, json)
    select 13, a.id, a.schema 
    from app a where a.schema is not null;

    drop table app;
$$);
