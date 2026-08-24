-- Factory+ config DB
-- DB schema v14: targeted class-relation lookups
-- Copyright 2026 University of Sheffield AMRC

-- The `all_subclass` and `all_membership` views compute the whole class
-- closure. Postgres cannot push a `where class = $1` predicate into a
-- recursive CTE, and the `all_class` seed reads every row of
-- `membership`, so a lookup of one class costs a full scan of
-- `membership` plus a full hash of `object`. That is O(total objects)
-- per lookup, whatever the class.
--
-- These functions walk the class graph from a single starting point
-- instead. Downward for lookups, upward for existence tests. They
-- return exactly the same answers as the views; the views are kept for
-- ad-hoc querying and for callers that want the whole relation.

call migrate_to(14, $$
    -- The unique constraints give us (class, id) indexes. The reverse
    -- direction has no index, so every upward walk and every
    -- `where id = $1` was a sequential scan.
    create index if not exists subclass_id_idx on subclass (id);
    create index if not exists membership_id_idx on membership (id);

    -- `config` has unique (app, object), which cannot answer a lookup
    -- by object alone. `object_delete` and the `config.object` foreign
    -- key both do exactly that, so deleting an object was a sequential
    -- scan of `config`.
    create index if not exists config_object_idx on config (object);

    -- `object.class` and `object.owner` are self-references with no
    -- index, so every object delete scanned `object` twice to check
    -- them.
    create index if not exists object_class_idx on object (class);
    create index if not exists object_owner_idx on object (owner);

    -- Is this object a class? Equivalent to `exists (select 1 from
    -- all_class where id = _obj)`, but index-driven.
    create or replace function is_class (_obj integer)
    returns boolean
    language sql stable
    as $fn$
        select exists (select 1 from subclass s where s.class = _obj)
            or exists (select 1 from subclass s where s.id = _obj)
            or exists (select 1 from membership m where m.class = _obj)
    $fn$;

    -- Equivalent to `select id from all_subclass where class = _class`.
    create or replace function class_subclasses (_class integer)
    returns table (id integer)
    language sql stable
    as $fn$
        with recursive sc as (
            select _class id where is_class(_class)
            union
            select c.id from sc p join subclass c on c.class = p.id)
        select id from sc
    $fn$;

    -- Equivalent to `select id from all_membership where class = _class`.
    -- The seed needs no is_class() guard: if _class is not a class then
    -- it has no members and no subclasses, so the join drops it.
    create or replace function class_members (_class integer)
    returns table (id integer)
    language sql stable
    as $fn$
        with recursive sc as (
            select _class id
            union
            select c.id from sc p join subclass c on c.class = p.id)
        select distinct m.id from sc join membership m on m.class = sc.id
    $fn$;

    -- Equivalent to `exists (select 1 from all_subclass where
    -- class = _class and id = _obj)`. Walks up from _obj, which is
    -- bounded by the depth of the class graph rather than by the
    -- number of objects.
    create or replace function class_has_subclass (_class integer, _obj integer)
    returns boolean
    language sql stable
    as $fn$
        with recursive up as (
            select _obj id where is_class(_obj)
            union
            select s.class from up u join subclass s on s.id = u.id)
        select exists (select 1 from up where id = _class)
    $fn$;

    -- Equivalent to `exists (select 1 from all_membership where
    -- class = _class and id = _obj)`.
    create or replace function class_has_member (_class integer, _obj integer)
    returns boolean
    language sql stable
    as $fn$
        with recursive up as (
            select m.class id from membership m where m.id = _obj
            union
            select s.class from up u join subclass s on s.id = u.id)
        select exists (select 1 from up where id = _class)
    $fn$;
$$);
