-- Factory+ / AMRC Connectivity Stack (ACS) Directory component
-- Database creation/upgrade DDL.
-- Copyright 2021 AMRC.

call migrate_to(9, $migrate$
    create table alert_type (
        id serial primary key,
        uuid uuid unique not null
    );

    create table alert (
        id serial primary key,
        uuid uuid unique not null,
        device integer not null references device,
        atype integer not null references alert_type,
        metric text not null,
        active boolean not null
    );

    call setup_mqtt_notify('alert');
$migrate$);
