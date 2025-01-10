-- ACS Auth service
-- Database schema version 2
-- Copyright 2025 University of Sheffield AMRC

-- The `member` table from v1 is no longer needed at this schema
-- version, however we don't delete it here. The data in it needs
-- migrating to the ConfigDB.

\set id_Kerberos        1
\set id_Sparkplug       2

select version < 2 need_update from version \gset
\if :need_update
    -- We can't just rename ace, the sequence name will conflict with
    -- the new table.
    create temporary table old_ace
    on commit drop
    as select principal, permission, target
    from ace;

    drop function members_of;
    drop view resolved_ace;
    drop view group_members;

    drop table ace;
    alter table member rename to old_member;

    create table uuid (
        id serial primary key,
        uuid uuid unique not null
    );
    create table identity (
        id serial primary key,
        principal integer not null references uuid on update cascade,
        kind integer not null references uuid on update cascade,
        name text,
        unique (principal, kind),
        unique (kind, name)
    );
    create table ace (
        id serial primary key,
        -- This is definitly incorrect but will have to do for now.
        -- I am assigning individual grants UUIDs, but these will not be
        -- registered in the ConfigDB or otherwise accessible. As a
        -- result this cannot reference the `uuid` table which is a list
        -- of objects mastered in the ConfigDB.
        uuid uuid unique not null default gen_random_uuid(),
        principal integer not null references uuid on update cascade,
        permission integer not null references uuid on update cascade,
        target integer not null references uuid on update cascade,
        plural boolean not null,
        unique (principal, permission, target)
    );
    create table member (
        parent integer not null references uuid on update cascade,
        child integer not null references uuid on update cascade,
        unique (parent, child)
    );

    -- Reserve some IDs
    alter sequence uuid_id_seq restart with 100;

    insert into uuid (id, uuid)
    values 
        (:id_Kerberos,          '75556036-ce98-11ef-9534-637ef5d37456'),
        (:id_Sparkplug,         '7c51a61a-ce98-11ef-834a-976fb7c5dd4c');

    insert into uuid (uuid)
    select uuid from principal
        union select principal from old_ace
        union select permission from old_ace
        union select target from old_ace
        union select parent from old_member
        union select child from old_member
    on conflict (uuid) do nothing;

    -- XXX Should these move over to the ConfigDB?
    insert into identity (principal, kind, name)
    select u.id, :id_Kerberos, p.kerberos
    from principal p
        join uuid u on u.uuid = p.uuid;

    drop table principal;

    insert into ace (principal, permission, target, plural)
    select u.id, p.id, t.id, false
    from old_ace e
        join uuid u on u.uuid = e.principal
        join uuid p on p.uuid = e.permission
        join uuid t on t.uuid = e.target;

    -- XXX Migrate group members directly for now.
    insert into member (parent, child)
    select c.id, o.id
    from old_member m
        join uuid c on c.uuid = m.parent
        join uuid o on o.uuid = m.child;

    update version set version = 2;
\endif
