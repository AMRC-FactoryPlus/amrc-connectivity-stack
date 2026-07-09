# @amrc-factoryplus/gssapi

GSSAPI bindings for Node.js.

This is a fork of [gssapi.js](https://www.npmjs.com/package/gssapi.js)
2.0.1 (upstream: `bitbucket:karoshealth/node-gssapi`, MIT licence).

The JS API is identical to upstream. There is one behavioural change:

## No credential delegation

Upstream passes `GSS_C_DELEG_FLAG` unconditionally to
`gss_init_sec_context`. That makes libkrb5 request a forwarded TGT
from the KDC on *every* client context creation, i.e. on every
Factory+ HTTP token fetch and MQTT connection. When the client's TGT
is not forwardable (the normal case for ACS service principals, whose
TGTs come straight from a keytab) the KDC refuses the request:

    TGS_REQ ... TGT NOT FORWARDABLE: authtime ...,
        sv1xxx@REALM for krbtgt/REALM@REALM,
        KDC can't fulfill requested option

libkrb5 then silently drops the flag and carries on without
delegation, so the only effects are a wasted KDC round trip per token
and a KDC log line per request. Under load (service reconnect storms)
this multiplies into significant KDC noise and traffic.

Nothing in Factory+ consumes delegated credentials - the server side
(`acceptSecContext`) discards them - so this fork simply does not
request delegation. If a future service genuinely needs delegation it
should be added as an explicit per-context option, not a global
default.

## Building

Native module built with cmake-js at install time; requires cmake and
MIT Kerberos headers/libraries (`libkrb5-dev` on Debian). Unchanged
from upstream.
