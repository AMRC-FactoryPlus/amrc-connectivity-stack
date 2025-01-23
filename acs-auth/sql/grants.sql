-- ACS Auth service
-- DB permission grants
-- Copyright 2025 University of Sheffield AMRD

-- Revoke default permissions
revoke all on database :"db" from public;
revoke all on schema public from public;

-- Grant permissions
grant connect on database :"db" to :"role";
grant usage on schema public to :"role";
grant select on
    version
to :"role";
grant select, insert, update, delete on
    ace, identity, member, uuid
to :"role";
grant select, delete on
    old_member
to :"role";
grant usage on
    ace_id_seq, identity_id_seq, uuid_id_seq
to :"role";
