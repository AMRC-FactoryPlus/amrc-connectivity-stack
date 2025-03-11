-- Factory+ / AMRC Connectivity Stack (ACS) Authorisation component
-- DB migration logic.
-- Copyright 2022 AMRC.

do language plpgsql $do$
    declare
        v_rows integer;
    begin
        -- Create the version table.
        create table if not exists version (
            version integer not null
        );

        select count(*) into v_rows from version;

        if v_rows = 0 then
            insert into version (version) values (0);
        elsif v_rows > 1 then
            raise exception 'Version table has % rows', v_rows;
        end if;
    end;
$do$;
