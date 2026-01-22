-- ACS Auth service
-- Database schema version 3
-- Copyright 2026 University of Sheffield AMRC

select version < 3 need_update from version \gset
\if :need_update
    \echo Migrating to version 3

    -- The plurality should have been included in the unique key here. There
    -- are occasions where a permission needs granting both singular and
    -- plural.
    alter table ace
        drop constraint ace_principal_permission_target_key,
        add constraint ace_unique
            unique(principal, permission, target, plural);

    update version set version = 3;
\endif

