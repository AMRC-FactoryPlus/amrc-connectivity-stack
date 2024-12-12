-- ACS Auth service
-- Schema version management
-- Copyright 2024 University of Sheffield AMRC

create or replace function set_schema_version (_ver integer)
    returns integer
    language plpgsql
    as $set$
        begin
            execute format($def$
                create or replace function schema_version ()
                returns integer
                language sql
                begin atomic
                    select %L::integer;
                end
            $def$, _ver);
            return _ver;
        end
    $set$;

select
    exists(select 1 from pg_proc where proname = 'schema_version') has_ver_func,
    exists(select 1 from pg_class where relname = 'version') has_ver_table
\gset

\if :has_ver_func
\else
    \if :has_ver_table
        select set_schema_version(version)
        from version;
    \else
        select set_schema_version(0);
    \endif
\endif
