-- Factory+ / AMRC Connectivity Stack (ACS) Directory component.
-- Database permissions.
-- Copyright 2022 AMRC.

-- Revoke some unhelpful default permissions.
revoke all on database :"db" from public;
revoke all on schema public from public;

-- Grant permissions.
grant connect on database :"db" to :"role";
grant usage on schema public to :"role";
grant select on version to :"role";

grant select, insert on
    address, device, missing_uuid,
    schema, service
to :"role";
-- This is because we SELECT FOR UPDATE.
grant update on address to :"role";
grant select, insert, update, delete on
    alert, alert_type,
    session, schema_used, service_provider
to :"role";
grant usage on sequence
    address_id_seq, alert_id_seq, alert_type_id_seq,
    device_id_seq,
    schema_id_seq, schema_used_id_seq, service_id_seq,
    service_provider_id_seq, session_id_seq
to :"role";
grant execute on function
    online, last_change
to :"role";
grant select on
    session_schemas, device_status
to :"role";
