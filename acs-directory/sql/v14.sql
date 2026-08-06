-- Factory+ / AMRC Connectivity Stack (ACS) Directory component
-- Database creation/upgrade DDL.
-- Copyright 2026 University of Sheffield AMRC


call migrate_to(14, $migrate$
    -- Nothing has ever deleted from session, so an install which has
    -- been running for a while arrives here with a row per birth for
    -- its whole history. We prune that down here and keep it pruned
    -- from now on (see Queries.prune_device_sessions).
    --
    -- Take the notify trigger off for the duration. Everything below
    -- is storage bookkeeping and none of it is a change any client
    -- should be told about; the sessions still exist as far as the
    -- outside world is concerned. It goes back on at the end, without
    -- the DELETE, because a notification naming a pruned session
    -- refers to a row which can no longer be looked up.
    drop trigger if exists mqtt_notify on session;

    -- What to keep: for each device, and for each address, the current
    -- session and the one before it. The predecessor is load bearing -
    -- on_session_notify reads it to work out which schemas have been
    -- added and removed, and without it every birth would republish
    -- every schema.
    --
    -- Sessions are chained twice over, by next_for_device and by
    -- next_for_address, and both are foreign keys back into session.
    -- An address may be reused by a different device, so the chains
    -- interleave: a session belonging to one device can be referenced
    -- by a session belonging to another. A row is kept if either chain
    -- still wants it. Pruning along the device chain alone is what
    -- caused the foreign key errors that got #614 reverted.
    create temporary table session_keep on commit drop as
        select id
        from (
            select id,
                row_number() over (partition by device  order by id desc) rn_dev,
                row_number() over (partition by address order by id desc) rn_adr
            from session
        ) ranked
        where rn_dev <= 2 or rn_adr <= 2;
    create unique index on session_keep (id);

    -- Close the gaps: point each surviving session at the next session
    -- which also survives. Sessions which are current in a chain have
    -- a null pointer and are skipped, so this cannot manufacture a
    -- second current session for a device or an address, which would
    -- break device_status, is_addr_online and addr_uuid.
    update session s
    set next_for_device = (
            select k.id
            from session k
                join session_keep sk on sk.id = k.id
            where k.device = s.device
              and k.id > s.id
            order by k.id
            limit 1)
    from session_keep sk
    where sk.id = s.id
      and s.next_for_device is not null;

    update session s
    set next_for_address = (
            select k.id
            from session k
                join session_keep sk on sk.id = k.id
            where k.address = s.address
              and k.id > s.id
            order by k.id
            limit 1)
    from session_keep sk
    where sk.id = s.id
      and s.next_for_address is not null;

    -- Everything else goes, and takes its schema_used rows with it.
    -- Every surviving session now points only at other survivors, so
    -- there is nothing left to violate the foreign keys.
    delete from session
    where id not in (select id from session_keep);

    -- Version 8 dropped the session_device_key and session_address_key
    -- unique constraints, and with them the only indexes on these
    -- columns. Nothing replaced them, so finding the current session
    -- for a device or an address has been a sequential scan ever
    -- since. That is the join device_status makes, and on a large
    -- session table it dominates the cost of every device query.
    --
    -- Built after the prune, so they are built against the pruned
    -- table rather than the full history.
    --
    -- Named explicitly and guarded, because an operator who noticed
    -- device queries crawling may well have added one of these by
    -- hand already. An unnamed CREATE INDEX picks the same name
    -- Postgres would have generated, collides, and takes the whole
    -- migration - prune included - down with it. IF NOT EXISTS needs
    -- the name to have something to test, so the two go together.
    create index if not exists session_device_idx  on session (device);
    create index if not exists session_address_idx on session (address);

    create trigger mqtt_notify
        after insert or update on session
        for each row execute function mqtt_notify();
    -- ENABLE ALWAYS so it is also called on replicas, matching
    -- setup_mqtt_notify.
    alter table session enable always trigger mqtt_notify;
$migrate$);
