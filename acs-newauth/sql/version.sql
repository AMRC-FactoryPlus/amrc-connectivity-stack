-- ACS Auth service
-- Schema version management
-- Copyright 2024 University of Sheffield AMRC

create or replace procedure set_schema_version (_ver integer)
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
        end
    $set$;

select exists(select 1 from pg_proc where proname = 'schema_version') has_ver \gset

\if :has_ver
\else
    call set_schema_version(0);
\endif
