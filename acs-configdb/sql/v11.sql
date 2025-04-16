-- Factory+ config DB
-- Database creation/upgrade DDL.
-- Copyright 2023 AMRC.

-- Extend Object Registration with a `strict: true` field. This is
-- constant currently and not backed by the DB. This is to allow for
-- mixed-rank classes in the future.
call migrate_to(11, $$
    -- Update config schema for Registration
    insert into config (app, object, json)
    values (16, 6, '{
        "type": "object",
        "additionalProperties": false,
        "required": ["uuid", "rank", "class", "deleted", "owner"],
        "properties": {
            "uuid": { "type": "string", "format": "uuid" },
            "rank": { "type": "integer", "minimum": 0 },
            "class": { "type": "string", "format": "uuid" },
            "deleted": { "type": "boolean" },
            "owner": { "type": "string", "format": "uuid" },
            "strict": { "type": "boolean", "const": true }
        }
    }')
    on conflict (app, object) do update
        set json = excluded.json, etag = default;

    -- Create Object Registration config entries. This procedure needs
    -- to be called whenever the object table is changed directly.
    create or replace procedure update_registration(_obj integer)
    language sql
    begin atomic
        insert into config (app, object, json)
        select 6, o.id, jsonb_build_object(
            'uuid', o.uuid,
            'class', c.uuid,
            'rank', o.rank,
            'owner', p.uuid,
            'deleted', o.deleted,
            'strict', true) json
        from object o
            left join object c on c.id = o.class
            join object p on p.id = o.owner
        where _obj is null or o.id = _obj
        on conflict (app, object) do update
            set json = excluded.json, etag = default
            where config.json != excluded.json;
    end;

    call update_registration(null);
$$);
