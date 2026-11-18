# acs-user-admin

## Creates Factory+ human-user principals direct-to-KDC.

A Flask HTTP service that creates a Kerberos principal via `kadmin` and
the matching ConfigDB/Auth objects in a single synchronous call, so the
Admin UI can offer a single "Create User" action instead of three manual,
disconnected steps.

See `docs/plans/2026-11-10-admin-ui-create-user-direct-kdc.md` for the
full design.
