-- Factory+ / AMRC Connectivity Stack (ACS) Directory component
-- Database creation/upgrade DDL.
-- Copyright 2021 AMRC.

call migrate_to(7, $migrate$
    -- Copy the data to a temp table and drop the original. Otherwise
    -- all the sequences etc. get weird names because of the conflicts.
    create temporary table old_sp as table service_provider;
    drop table service_provider;

    alter table schema_used 
        add id serial primary key;

    create table principal (
        id serial primary key,
        uuid uuid unique not null
    );

    create table service_provider (
        id serial primary key,

        service integer not null references service,
        owner integer not null references principal,
        unique(service, owner),

        device integer null references device,
        url text null
    );

    create function mqtt_notify () returns trigger language plpgsql as $$
        declare
            row record;
        begin
            row := coalesce(old, new);
            perform pg_notify('mqtt', tg_table_name || ':' || row.id::text);
            return null;
        end;
    $$;
    create procedure setup_mqtt_notify (tab text) language plpgsql as $proc$
        begin
            execute format($$
                create trigger mqtt_notify
                    after insert or update or delete on %I
                    for each row execute function mqtt_notify()
            $$, tab);
            -- Set triggers to ENABLE ALWAYS so they are also called
            -- on replicas.
            execute format($$
                alter table %I enable always trigger mqtt_notify
            $$, tab);
        end;
    $proc$;

    insert into principal (uuid)
        select distinct owner
        from old_sp;
    insert into service_provider (service, owner, device, url)
        select sp.service, pr.id, sp.device, sp.url
        from old_sp sp
            join principal pr on pr.uuid = sp.owner;
    drop table old_sp;

    -- Create triggers after performing migration.
    call setup_mqtt_notify('session');
    call setup_mqtt_notify('schema_used');
    call setup_mqtt_notify('service_provider');
$migrate$);
