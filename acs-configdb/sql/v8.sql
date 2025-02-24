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
        drop constraint object_class_fkey,
        alter column class drop not null,
        add foreign key (class) references object on update cascade,
        -- An FK to rank would be good, but the topmost rank must reference
        -- a rank which doesn't have an assigned UUID yet.
        add column rank integer not null check(rank >= 0) default 0;
    drop table class;

    -- Create new class structure
    create table rank (
        depth integer primary key check(depth >= 0),
        id integer unique not null references object on update cascade
    );
    create table membership (
        class integer not null references object on update cascade,
        id integer not null references object 
            on update cascade on delete cascade,
        unique(class, id)
    );
    create table subclass (
        class integer not null references object on update cascade,
        id integer not null references object 
            on update cascade on delete cascade,
        unique(class, id)
    );

    insert into object (id, uuid, class, rank) values
        (10, '52b80183-6998-4bf9-9b30-132755e7dede', null, 4),
        (11, '705888ce-53fa-434d-afee-274b331d4642', 10, 3),
        (12, '2494ae9b-cd87-4c01-98db-437a303b43e9', 1, 1);
    insert into config (app, object, json)
        values (7, 1, '{ "name": "Rank 1 class" }'),
            (7, 10, '{ "name": "Rank 3 class" }'),
            (7, 11, '{ "name": "Rank 2 class" }'),
            (7, 12, '{ "name": "Individual" }')
        on conflict (app, object) do update
            set json = excluded.json, etag = default;

    insert into rank (depth, id)
        values (0, 12), (1, 1), (2, 11), (3, 10);

    -- Set rank of existing classes. Other objects will be imported as
    -- individuals. Reset the class of R1Class.
    update object set rank = 1 where class = 1;
    update object set class = 11, rank = 2 where id = 1;

    -- We have one object (R3Class) with no class.
    insert into membership (id, class)
        select id, class from object
        where class is not null;
    -- Make existing classes direct subclasses of Individual.
    insert into subclass (id, class)
        select id, 12 from object
        where rank = 1 and id != 12;

    alter table object
        alter column rank set not null;

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

    -- This is only needed for rank changes
    create view any_child as
    select * from membership
    union select * from subclass;

    -- This is useful when querying directly
    create view names as
    select object as id, json->>'name' as name
    from config c
    where app = 7;
$migrate$);
