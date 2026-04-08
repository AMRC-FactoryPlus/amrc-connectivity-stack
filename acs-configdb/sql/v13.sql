-- Factory+ config DB
-- DB schema v13: align Sparkplug Device UUIDs with Instance_UUIDs
-- Copyright 2026 University of Sheffield AMRC

-- When Sparkplug Device objects were registered in ConfigDB their UUIDs
-- were generated independently from the Instance_UUID recorded in their
-- DeviceInformation origin map. InfluxDB historian data is already
-- tagged with the Instance_UUID, so we change the ConfigDB object UUID
-- to match the Instance_UUID (not the reverse).

call migrate_to(13, $$
    do $body$
        declare
            -- Sparkplug Device class UUID
            sparkplug_device_class uuid
                := '18773d6d-a70d-443a-b29a-3f1583195290';
            -- DeviceInformation app UUID
            device_info_app uuid
                := 'a98ffed5-c613-4e70-bfd3-efeee250ade5';

            dup_instance_uuid uuid;
            obj_id integer;
            obj_uuid uuid;
            instance_uuid uuid;
        begin
            -- Pre-flight: check for duplicate Instance_UUIDs among
            -- Sparkplug Device objects that have an origin map.
            select (c.json->>'Instance_UUID')::uuid
            into dup_instance_uuid
            from all_membership m
                join object o on o.id = m.id
                join object app on app.uuid = device_info_app
                join config c
                    on c.object = m.id
                    and c.app = app.id
            where m.class = (
                    select id from object
                    where uuid = sparkplug_device_class)
                and c.json ? 'Instance_UUID'
            group by (c.json->>'Instance_UUID')::uuid
            having count(*) > 1
            limit 1;

            if found then
                raise exception
                    'Duplicate Instance_UUID % found among Sparkplug Device '
                    'objects — cannot safely align UUIDs; resolve duplicates '
                    'before running this migration.',
                    dup_instance_uuid;
            end if;

            -- Iterate over each Sparkplug Device whose object UUID does
            -- not already match its Instance_UUID.
            for obj_id, obj_uuid, instance_uuid in
                select o.id, o.uuid, (c.json->>'Instance_UUID')::uuid
                from all_membership m
                    join object o on o.id = m.id
                    join object app on app.uuid = device_info_app
                    join config c
                        on c.object = m.id
                        and c.app = app.id
                where m.class = (
                        select id from object
                        where uuid = sparkplug_device_class)
                    and c.json ? 'Instance_UUID'
                    and o.uuid != (c.json->>'Instance_UUID')::uuid
            loop
                raise notice 'Aligning Device %: object UUID % -> Instance_UUID %',
                    obj_id, obj_uuid, instance_uuid;

                -- Replace all occurrences of the old object UUID with the
                -- Instance_UUID across the entire config table. This handles
                -- JSON blobs that cross-reference this device's UUID.
                update config
                set json = replace(
                        json::text,
                        obj_uuid::text,
                        instance_uuid::text)::jsonb
                where json::text like '%' || obj_uuid::text || '%';

                -- Update the object UUID itself. The on-update-cascade FKs
                -- in membership, subclass, and config.object propagate
                -- this change automatically.
                update object
                set uuid = instance_uuid
                where id = obj_id;
            end loop;

            -- Rebuild all Object Registration config entries to reflect
            -- the updated UUIDs.
            call update_registration(null);

            raise notice 'v13 migration complete: Sparkplug Device UUIDs aligned with Instance_UUIDs.';
        end;
    $body$;
$$);
