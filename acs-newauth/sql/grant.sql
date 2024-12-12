-- ACS Auth component
-- Database permissions
-- Copyright 2024 University of Sheffield AMRC

-- Revoke some unhelpful default permissions.
revoke all on database :"db" from public;
revoke all on schema public from public;

-- If the role exists, drop all its permissions. This will also drop any
-- objects owned by that user, but there should be none.
drop owned by :"role";

-- Grant permissions.
grant connect on database :"db" to :"role";
grant usage on schema public to :"role";
grant select on
    version
to :"role";
grant select, insert, update, delete on
    uuid, ace
to :"role";
grant usage on
    uuid_id_seq, ace_id_seq
to :"role";
