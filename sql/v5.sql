-- Factory+ / AMRC Connectivity Stack (ACS) Directory component
-- Database creation/upgrade DDL.
-- Copyright 2021 AMRC.

call migrate_to(5, $migrate$
    -- All the devices we have ever seen
    create table device (
        id serial primary key,
        uuid uuid unique not null
    );

    -- All the Sparkplug addresses we have ever seen
    create table address (
        id serial primary key,
        group_id text not null,
        node_id text not null,
        -- device_id is the empty string for a node address
        device_id text not null,
        unique(group_id, node_id, device_id)
    );

    -- All the schemas we have ever seen.
    create table schema (
        id serial primary key,
        uuid uuid unique not null
    );

    -- This holds generated UUIDs for devices that don't provide one.
    create table missing_uuid (
        address integer primary key
            references address,
        uuid uuid unique not null
            default gen_random_uuid()
    );

    -- A session runs from BIRTH to DEATH.
    create table session (
        id serial primary key,
        device integer unique not null
            references device,
        address integer unique not null
            references address,

        -- The top-level schema (if any)
        top_schema integer references schema,

        -- Session start timestamp
        start timestamp not null,
        -- Null if we have an active session.
        finish timestamp
    );

    -- Link table between schema and session.
    create table schema_used (
        session integer not null
            references session on delete cascade,
        schema integer not null
            references schema,
        unique (session, schema)
    );

    -- Services
    create table service (
        device integer unique not null
            references device on delete cascade,
        uuid uuid not null,
        url text not null
    );

    -- Calculated columns
    create function online (sess session)
        returns bool
        language sql
        as $$ select sess.finish is null $$;

    create function last_change (sess session)
        returns timestamp
        language sql
        as $$ select coalesce(sess.finish, sess.start) $$;

    -- Which schemas are used by a session?
    -- This view avoids needing to GROUP BY all the columns below.
    create view session_schemas as
        select u.session, array_agg(sch.uuid) schemas
        from schema sch
            join schema_used u on u.schema = sch.id
        group by u.session;

    -- All devices with status
    create view device_status as 
        select dev.uuid, adr.group_id, adr.node_id, adr.device_id,
            ses.online, ses.last_change, tsch.uuid top_schema,
            coalesce(scs.schemas, '{}') schemas
        from device dev
            join session ses on ses.device = dev.id
            join address adr on adr.id = ses.address
            left join schema tsch on tsch.id = ses.top_schema
            left join session_schemas scs on scs.session = ses.id;
$migrate$);
