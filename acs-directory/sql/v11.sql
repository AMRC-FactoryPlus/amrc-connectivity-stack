-- Factory+ / AMRC Connectivity Stack (ACS) Directory component
-- Database creation/upgrade DDL.
-- Copyright 2024 AMRC

call migrate_to(11, $migrate$
    create table link_rel (
        id serial primary key,
        uuid uuid unique not null
    );

    create table link (
        id serial primary key,
        uuid uuid unique not null,
        device integer not null references device,
        relation integer not null references link_rel,
        target uuid not null
    );

    create table alert_link (
        alert integer not null references alert,
        link integer not null references link,
        unique (alert, link)
    );

    call setup_mqtt_notify('link');
$migrate$);
