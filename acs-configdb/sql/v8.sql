-- Factory+ config DB
-- Database creation/upgrade DDL.
-- Copyright 2023 AMRC.

call migrate_to(8, $migrate$
    -- These should have been done before
    alter table config
        alter column etag set not null;
    alter table object
        alter column uuid set default gen_random_uuid();

    -- FKs to the other tables need moving to object. Make them cascade
    -- so we can move objects to our private ID space.
    alter table app
        drop constraint app_id_fkey,
        add foreign key (id) references object on update cascade;
    alter table config
        drop constraint config_object_fkey,
        add foreign key (object) references object on update cascade;
    alter table object
        -- we are about to remove this column
        drop constraint object_class_fkey,
        alter column class drop not null;

    -- Create new class structure

    create table membership (
        class integer not null references object on update cascade,
        id integer not null references object on update cascade,
        unique(class, id)
    );
    create table subclass (
        class integer not null references object on update cascade,
        id integer not null references object on update cascade,
        unique(class, id)
    );

    create function set_primary_class(xobj integer, xclass integer)
        returns void language sql
        as $$
            insert into membership (id, class)
                values (xobj, xclass)
                on conflict (id, class) do nothing;
            insert into config (app, object, json)
                select 7, xobj, jsonb_build_object(
                        'primaryClass', c.uuid)
                    from object c
                    where c.id = xclass
                on conflict (app, object) do update
                    set json = config.json || excluded.json,
                        etag = default;
        $$;

    insert into object (id, uuid)
    values (0, 'd7445df3-7394-4404-af1d-af287f30a6f2'),
        (10, '1f2ee062-6782-48c8-926b-904f56bd18b1'),
        (11, '33343846-8c14-4cb0-8027-989071a20724'),
        (12, 'e5ba3bd1-2943-4818-84be-5733e865d398');
    insert into config (app, object, json)
        values (7, 0, '{ "name": "Object" }'),
            (7, 10, '{ "name": "Rank of object" }'),
            (7, 11, '{ "name": "Individual" }'),
            (7, 12, '{ "name": "Rank 1 class" }');

    select set_primary_class(11, 10);
    select set_primary_class(12, 10);
    insert into subclass (id, class)
        values (1, 0), (11, 0), (10, 1), (12, 1);

    -- Classify individuals into their correct classes
    select set_primary_class(o.id, o.class)
        from object o
        where o.class != 1;

    -- Existing classes are R1 and subclasses of Individual
    select set_primary_class(c.id, 12)
        from class c
        where c.id != 1;
    insert into subclass (id, class)
        select c.id, 11 from class c
        where c.id != 1;

    drop table class;
    alter table object drop column class;

    -- Create views to simplify querying the class tree. There is a
    -- substantial performance benefit to making all_subclass a
    -- materialized view, but this would mean ensuring it was refreshed
    -- appropriately. It may be better to cache client-side.

    create view all_class as
    select id from subclass
    union select class from subclass
    union select class from membership;

    create view all_subclass as
    with recursive sc as (
        select id class, id from all_class
        union select p.class, c.id
            from sc p join subclass c on c.class = p.id
    )
    select * from sc;

    create view all_membership as
    select c.class, m.id
    from all_subclass c
        join membership m on c.id = m.class;

    -- This is useful when querying directly
    create view names as
    select object as id, json->>'name' as name
    from config c
    where app = 7;
$migrate$);
