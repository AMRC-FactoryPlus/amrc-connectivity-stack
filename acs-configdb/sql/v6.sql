-- Factory+ config DB
-- Database creation/upgrade DDL.
-- Copyright 2021 AMRC.

call migrate_to(6, $$
    create table object (
        id serial primary key,
        uuid uuid unique not null,
        class integer not null 
    );
    create table class (
        id integer primary key references object,
        notify text unique
    );
    create table app (
        id integer primary key references object,
        schema jsonb
    );

    create table config (
        id serial primary key,
        app integer not null references app,
        object integer not null references object,
        json jsonb not null,

        unique (app, object)
    );

    -- Reserve some object IDs
    alter sequence object_id_seq restart with 100;

    -- Register the objects
    insert into object (id, uuid, class)
        values (1, '04a1c90d-2295-4cbe-b33a-74eded62cbf1', 1),
            (2, 'd319bd87-f42b-4b66-be4f-f82ff48b93f0', 1),
            (3, '18773d6d-a70d-443a-b29a-3f1583195290', 1),
            (4, '83ee28d4-023e-4c2c-ab86-12c24e86372c', 1),
            (5, '265d481f-87a7-4f93-8fc6-53fa64dc11bb', 1),
            (6, 'cb40bed5-49ad-4443-a7f5-08c75009da8f', 2),
            (7, '64a8bfa9-7772-45c4-9d1a-9e6290690957', 2),
            (8, '05688a03-730e-4cda-9932-172e2c62e45c', 4),
            (9, 'af15f175-78a0-4e05-97c0-2a0bb82b9f3b', 5);
    insert into class (id)
        select id from object where class = 1;
    insert into app (id)
        select id from object where class = 2;
    insert into config (app, object, json)
        values (7, 1, '{"name":"Class definition"}'),
            (7, 2, '{"name":"Application"}'),
            (7, 3, '{"name":"Sparkplug device"}'),
            (7, 4, '{"name":"Metric schema"}'),
            (7, 5, '{"name":"F+ service function"}'),
            (7, 6, '{"name":"Object registration"}'),
            (7, 7, '{"name":"General object information"}'),
            (7, 8, '{"name":"F+ Service"}'),
            (7, 9, '{"name":"Object Registry service"}');

    -- Create the class FK last
    alter table object
        add foreign key (class) references class;
$$);
