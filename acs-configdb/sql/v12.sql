-- Factory+ config DB
-- DB schema v12: remove ownership on dump load
-- Copyright 2025 University of Sheffield AMRC

call migrate_to(10, $dump$
    -- Annoyingly we have to replace this function wholesale.
    create or replace function _load_dump_set_ranks ()
    returns void
    language plpgsql
    as $function$
        declare
            unranked integer;
            bad uuid;
        begin
            -- This is a hack. Rank is not-null, and we can't defer a
            -- not-null constraint. So use top-rank + 1 to mark
            -- temporarily unranked objects.
            select rank + 1 into unranked
            from object
            where class is null;

            -- Insert new objects without class, as the FK may not validate.
            -- Explicitly reset rank on objects we will insert, they will
            -- all need recalculating. All objects created by a dump are
            -- unowned; dumps do not support setting ownership yet.
            insert into object (uuid, rank)
            select obj, unranked from n_obj
            on conflict (uuid) do update
                set class = null, rank = unranked, 
                    deleted = false, owner = 15;

            -- Update the classes
            update object o
            set class = c.id
            from object c, n_obj n
            where o.uuid = n.obj
                and c.uuid = n.class;

            -- Clear ranks on all primary members, recursively
            loop
                update object o
                set rank = unranked
                from object c
                where c.id = o.class
                    and c.rank = unranked
                    and o.rank != unranked;

                exit when not found;
            end loop;

            -- Record all existing individuals which might get promoted
            -- by the rank updates. We may need to give them a rank
            -- superclass. Existing classes must be subclasses only of
            -- classes which will be modified, or the dump will fail.
            create temporary table was_individual
            on commit drop
            as select o.id
            from object o
            where o.rank = unranked
                and o.id not in (select id from subclass)
                and o.uuid not in (select obj from n_obj);

            -- Update ranks based on primary class
            loop
                update object o
                set rank = c.rank - 1
                from object c
                where c.id = o.class
                    and o.rank = unranked
                    and c.rank != unranked;

                exit when not found;
            end loop;

            -- Verify we have set all ranks
            for bad in select uuid from object where rank = unranked
            loop
                raise notice 'Rank not set for %', bad;
            end loop;
            if found then raise 'Ranks not all set'; end if;
        end;
    $function$;

