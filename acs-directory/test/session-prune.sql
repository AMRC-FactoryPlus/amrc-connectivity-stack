-- Factory+ / AMRC Connectivity Stack (ACS) Directory component
-- Integrity test for session pruning.
-- Copyright 2026 University of Sheffield AMRC
--
-- PR #614 pruned the session table and was reverted by #617 because it
-- caused foreign key errors: sessions are chained both by device and by
-- address, an address may be reused by a different device, and deleting
-- along the device chain alone leaves a surviving session of one device
-- pointing at a deleted session of another. This builds exactly that
-- shape and asserts the prune leaves the table consistent.
--
-- Seed a pre-v14 database, then apply v14 and re-run to assert the
-- migration left the table consistent:
--
--     docker run -d --name dirtest -e POSTGRES_PASSWORD=test \
--         -e POSTGRES_DB=directory postgres:16
--     docker cp acs-directory/sql dirtest:/sql
--     docker cp acs-directory/test/session-prune.sql dirtest:/t.sql
--     # migrate to v13 only, then seed history
--     docker exec dirtest sh -c 'cd /sql && psql -U postgres -d directory \
--         -f migration.sql && for v in 5 6 7 8 9 10 11 12 13; do \
--         psql -U postgres -d directory -f v$v.sql; done'
--     docker exec dirtest psql -U postgres -d directory -f /t.sql
--     # now apply the migration under test
--     docker exec dirtest psql -U postgres -d directory -f /sql/v14.sql
--     docker exec dirtest psql -U postgres -d directory -f /t.sql
--
-- The first run seeds and records the expected device_status; the run
-- after v14 re-checks it and asserts the invariants.

\set ON_ERROR_STOP

-- Replicates Queries.record_birth.
create or replace function mk_birth (p_dev integer, p_adr integer, p_t timestamp)
    returns integer language plpgsql as $$
    declare
        sess integer;
    begin
        insert into session (device, address, start)
            values (p_dev, p_adr, p_t) returning id into sess;
        update session set next_for_device = sess,
                finish = coalesce(finish, p_t)
            where device = p_dev and next_for_device is null and id != sess;
        update session set next_for_address = sess,
                finish = coalesce(finish, p_t)
            where address = p_adr and next_for_address is null and id != sess;
        return sess;
    end;
$$;

-- Seed once only, so the file can be re-run after pruning to re-check.
do $seed$
    declare
        t timestamp := '2024-01-01'::timestamp;
        i integer;
    begin
        if exists (select 1 from session) then
            raise notice 'Already seeded, checking only.';
            return;
        end if;

        insert into device (uuid)
            select gen_random_uuid() from generate_series(1, 6);
        insert into address (group_id, node_id, device_id)
            select 'G', 'N', 'D' || g from generate_series(1, 4) g;
        insert into schema (uuid)
            select gen_random_uuid() from generate_series(1, 3);

        -- Address 1 runs device 1 then device 2. This is the case that
        -- broke #614.
        for i in 1..50 loop
            perform mk_birth(1, 1, t); t := t + interval '1 hour';
        end loop;
        for i in 1..50 loop
            perform mk_birth(2, 1, t); t := t + interval '1 hour';
        end loop;

        -- Two devices swapping between two addresses.
        for i in 1..30 loop
            perform mk_birth(3, 2, t); t := t + interval '1 hour';
            perform mk_birth(4, 3, t); t := t + interval '1 hour';
            perform mk_birth(3, 3, t); t := t + interval '1 hour';
            perform mk_birth(4, 2, t); t := t + interval '1 hour';
        end loop;

        -- A device that never moves, and one with a single session.
        for i in 1..40 loop
            perform mk_birth(5, 4, t); t := t + interval '1 hour';
        end loop;
        perform mk_birth(6, 4, t);

        insert into schema_used (session, schema)
            select s.id, sc.id from session s cross join schema sc
            where s.id % 3 = 0
            on conflict do nothing;

        -- Record what clients can see, so we can prove pruning does not
        -- change it. Schemas are a set, so store them sorted.
        create table expected_status as
            select uuid, group_id, node_id, device_id, online, last_change,
                (select array_agg(x order by x) from unnest(schemas) x) schemas
            from device_status;
    end
$seed$;

-- Assertions. Every one of these must report 0.
select 'devices with != 1 current session' check_name,
        count(*) bad from (
            select device from session where next_for_device is null
            group by device having count(*) <> 1) x
union all
select 'addresses with != 1 current session', count(*) from (
            select address from session where next_for_address is null
            group by address having count(*) <> 1) y
union all
select 'dangling next_for_device', count(*) from session s
    where s.next_for_device is not null
      and not exists (select 1 from session t where t.id = s.next_for_device)
union all
select 'dangling next_for_address', count(*) from session s
    where s.next_for_address is not null
      and not exists (select 1 from session t where t.id = s.next_for_address)
union all
select 'orphaned schema_used', count(*) from schema_used su
    where not exists (select 1 from session s where s.id = su.session)
union all
select 'device_status rows changed', count(*) from (
        select uuid, group_id, node_id, device_id, online, last_change,
            (select array_agg(x order by x) from unnest(schemas) x) schemas
        from device_status
        except select * from expected_status) d
union all
select 'device_status rows missing', count(*) from (
        select * from expected_status
        except select uuid, group_id, node_id, device_id, online, last_change,
            (select array_agg(x order by x) from unnest(schemas) x) schemas
        from device_status) e;
