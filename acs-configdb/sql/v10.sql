-- Factory+ config DB
-- DB schema v10: SQL functions to load object dumps
-- Copyright 2024 University of Sheffield AMRC

call migrate_to(10, $dump$
    create or replace function verify_invariants ()
    returns void
    language plpgsql
    as $fn$
        declare
            top_rank integer;
            obj uuid;
            cls uuid;
        begin
            -- Every object except top_rank must have a primary class
            select id into top_rank
            from object
            where class is null;
            if not found then
                raise 'Top rank object should have no class';
            end if;

            for obj in select uuid from object
                where class is null and id != top_rank
            loop
                raise warning 'No class for %', obj;
            end loop;
            if found then
                raise 'All objects except top rank should have a class';
            end if;

            for obj in select uuid from object
                where rank not in (select depth from rank)
                    and id != top_rank
            loop
                raise warning 'Invalid rank for %', obj;
            end loop;
            if found then
                raise 'All object except top rank should have a valid rank';
            end if;

            -- Verify subclass and membership ranks
            for cls, obj in select c.uuid, o.uuid
                from membership m
                    join object c on c.id = m.class
                    join object o on o.id = m.id
                where c.rank != o.rank + 1
            loop
                raise warning 'Bad ranks: % memberOf %', obj, cls;
            end loop;
            if found then
                raise 'Membership rank inconsistency';    
            end if;

            for cls, obj in select c.uuid, o.uuid
                from subclass s
                    join object c on c.id = s.class
                    join object o on o.id = s.id
                where c.rank != o.rank
            loop
                raise warning 'Bad ranks: % subclassOf %', obj, cls;
            end loop;
            if found then
                raise 'Subclass rank inconsistency';
            end if;

            -- Every object except top_rank should be a member of its primary class
            for obj in select o.uuid
                from object o
                    left join membership m on m.class = o.class and m.id = o.id
                where m.id is null
                    and o.id != top_rank
            loop
                raise warning 'Missing primary membership: %', obj;
            end loop;
            if found then
                raise 'Primary class membership missing';
            end if;

            -- Every class should be a subclass of its rank root.
            -- This could probably be done more efficiently?
            for obj in select o.uuid
                from object o
                    join rank r on r.depth = o.rank - 1
                    left join all_subclass s 
                        on s.class = r.id and s.id = o.id
                where s.id is null
            loop
                raise warning 'Missing rank superclass: %', obj;
            end loop;
            if found then
                raise 'Rank superclass missing';
            end if;

            -- Individuals cannot be subclasses.
            for obj in select o.uuid
                from object o
                    join subclass s on s.id = o.id
                where o.rank = 0
            loop
                raise warning 'Individual as subclass: %', obj;
            end loop;
            if found then
                raise 'Individual cannot be a subclass';
            end if;
        end
    $fn$;

    create or replace function load_dump(dump jsonb)
    returns void
    language plpgsql
    as $function$
        declare
            bad uuid;
        begin
            -- Pull the objects into a temporary table
            create temporary table n_obj
            on commit drop
            as select row_number() over () id,
                c.key::uuid class,
                o.key::uuid obj,
                o.value spec
            from jsonb_each(dump) c,
                lateral jsonb_each(c.value) o;

            -- Allow rank to be unspecified, temporarily
            alter table object
                alter column rank drop not null;

            -- Insert new objects without class, as the FK may not validate.
            -- Explicitly reset rank on objects we will insert, they will
            -- all need recalculating.
            insert into object (uuid, rank)
            select obj, null from n_obj
            on conflict (uuid) do update
                set class = null, rank = null, deleted = false;

            -- Update the classes
            update object o
            set class = c.id
            from object c, n_obj n
            where o.uuid = n.obj
                and c.uuid = n.class;

            -- Update ranks based on primary class
            loop
                update object o
                set rank = c.rank - 1
                from object c
                where c.id = o.class
                    and o.rank is null
                    and c.rank is not null;

                exit when not found;
            end loop;

            -- Verify we have set all ranks and reset constraint
            for bad in select uuid from object where rank is null
            loop
                raise notice 'Rank not set for %', bad;
            end loop;
            if found then raise 'Ranks not all set'; end if;

            -- Dumps are authoritative about membership and superclass
            -- information for the objects they contain.
            delete from membership m
            using object o, n_obj n
            where o.uuid = n.obj
                and m.id = o.id;

            delete from subclass s
            using object o, n_obj n
            where o.uuid = n.obj
                and s.id = o.id;

            insert into membership (class, id)
            select o.class, o.id
            from n_obj n
                join object o on o.uuid = n.obj;

            insert into membership (class, id)
            select c.id, o.id
            from n_obj n
                cross join lateral
                    jsonb_array_elements_text(n.spec->'memberOf') m(class)
                join object o on o.uuid = n.obj
                join object c on c.uuid = m.class::uuid;

            insert into subclass (class, id)
            select r.id, o.id
            from n_obj n
                join object o on o.uuid = n.obj
                join rank r on r.depth = o.rank - 1;

            insert into subclass (class, id)
            select c.id, o.id
            from n_obj n
                cross join lateral
                    jsonb_array_elements_text(n.spec->'subclassOf') m(class)
                join object o on o.uuid = n.obj
                join object c on c.uuid = m.class::uuid;

            perform verify_invariants();
        end
    $function$;
$dump$);