-- Factory+ config DB
-- Database creation/upgrade DDL.
-- Copyright 2023 AMRC.

call migrate_to(8, $$
    -- XXX We want to create a new Special, Unowned. Special and
    -- Wildcard should have both been in our private id space from the
    -- start, so we need to move them there now.
    
    alter table app
        drop constraint app_id_fkey,
        add foreign key (id) references object on update cascade;
    alter table config
        drop constraint config_object_fkey,
        add foreign key (object) references object on update cascade;
    alter table class
        drop constraint class_id_fkey,
        add foreign key (id) references object on update cascade;
    alter table object
        drop constraint object_class_fkey,
        add foreign key (class) references class on update cascade;

    insert into object (id, uuid, class)
    values (10, 'ddb132e4-5cdd-49c8-b9b1-2f35879eab6d', 1), 
        (11, '00000000-0000-0000-0000-000000000000', 10), 
        (12, '091e796a-65c0-4080-adff-c3ce01a65b2e', 10)
    on conflict (uuid) do update set id = excluded.id, class = excluded.class;

    -- GI entries can be more easily updated by service-setup.
    -- Subclass relationships ditto.
 
    -- Create new class structure

    create table member (
        class integer not null references class,
        member integer not null references object,
        unique(class, member)
    );
    create table subclass (
        parent integer not null references class,
        child integer not null references class,
        unique(parent, child)
    );

    -- We exclude id 1 _Class definition_ here. This will become
    -- _Well-founded set_, the proper class of all sets; as a proper
    -- class it cannot itself be a member of any other class.

    insert into member (class, member)
    select o.class, o.id from object o
    where o.id != 1;

    insert into config (app, object, json)
    select 7, o.id, jsonb_build_object('primaryClass', c.uuid)
    from object o
        join object c on c.id = o.class
        where o.id != 1
    on conflict (app, object) do update
        set json = config.json || excluded.json,
            etag = default;

    alter table object drop column class,
        add column owner integer not null references object default 12,
        add column deleted boolean not null default false;

    update object o set deleted = true
    from config c
    where o.id = c.object
        and c.app = 7
        and c.json->'deleted' = 'true';

    update config set json = json #- '{deleted}'
    where app = 7 and json ? 'deleted';
$$);
