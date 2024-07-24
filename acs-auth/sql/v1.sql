-- Factory+ / AMRC Connectivity Stack (ACS) Authorisation component
-- DB schema version 1.
-- Copyright 2022 AMRC.

call migrate_to(1, $migrate$
    -- The DB design here is evolutionary and not correct; it needs
    -- refactoring into a table of UUIDs which is FK'd to from
    -- everywhere else.

    create table ace (
        id serial primary key,
        principal uuid not null,
        permission uuid not null,
        target uuid not null,
        unique(principal, permission, target)
    );
    create table principal (
        uuid uuid primary key,
        kerberos text unique not null
    );
    create table member (
        parent uuid,
        child uuid,
        primary key (parent, child)
    );

    -- Recursively resolve groups
    create view group_members as
        with recursive grp as (
            select m.parent, m.parent child
                from member m
            union select g.parent, m.child
                from grp g
                    join member m on m.parent = g.child
        )
        select grp.parent, grp.child
        from grp;

    -- Resolve groups in ACEs
    create view resolved_ace as
        select coalesce(princ.child, a.principal) principal,
            coalesce(perm.child, a.permission) permission,
            coalesce(targ.child, a.target) target
        from ace a
            left join group_members princ on princ.parent = a.principal
            left join group_members perm on perm.parent = a.permission
            left join group_members targ on targ.parent = a.target;

    create function members_of (g uuid)
        returns setof uuid
        language sql
        as $$
            select g 
            union select child 
                from group_members
                where parent = g;
        $$;
$migrate$);
