# kerlberos (ACS fork)

An in-tree copy of [kerlberos](https://github.com/arekinath/kerlberos), a
pure-Erlang Kerberos 5 and GSS-API library. The Elixir service client
uses it to log in to the ACS KDC and authenticate to services.

## Where it came from

- Version 2.0.3, from the Hex package `kerlberos-2.0.3.tar` (outer
  checksum `5278d7d01b647cdb66d66288787449300edc0e38de1952b34e6de187146b91d2`,
  as published on hex.pm).
- Upstream tag `v2.0.3`, commit `b6a27d1cc6`. The hand-written source in
  the Hex package matches the tag. The package also contains the
  modules the build generates (`src/KRB5.erl`, `src/SPNEGO.erl`,
  `src/krb5conf.erl`, the `.asn1db` files and `include/SPNEGO.hrl`),
  `rebar.lock`, and `src/krbtests.erl`, a manual test module that isn't
  in git. Vendoring the package rather than the tag means the build
  needs no rebar3 plugins.
- Licence: BSD-2-Clause, stated in each source file's header. Upstream
  has no separate licence file.

## Why a fork

Upstream 2.0.3 can't log in as an ACS service:

- The ACS KDC doesn't require pre-authentication, so it answers
  kerlberos's first request with a ticket. kerlberos only expects a
  "pre-authentication required" error there and crashes.
- ACS services log in from keytabs. kerlberos only logs in with a
  password.

The patches below fix both. They are small and could go upstream.

## Using it

```elixir
{:kerlberos, path: "../erl-kerlberos", manager: :rebar3}
```

Mix builds it with rebar3 (install rebar3 for Mix once with
`mix local.rebar`). Don't run `rebar3 compile` in this directory:
upstream's `rebar.config` regenerates the ASN.1 and parser modules with
plugins, from sources that aren't vendored here.

## Patches

Each change is marked `ACS patch` in the source. Apart from these,
this file and `.gitignore`, the copy is unchanged from the Hex package.

1. **Pre-authentication not required** (`src/krb_auth_fsm.erl`,
   `probe/3`). kerlberos first sends a request without
   pre-authentication to learn the etype and salt, and expects
   `KDC_ERR_PREAUTH_REQUIRED`. A KDC that doesn't require
   pre-authentication for the principal answers with a ticket instead,
   which crashed `probe/3`. The new clause takes the etype and salt from
   that reply and carries on to the normal pre-authenticated request.
   The unauthenticated ticket is discarded, so the ticket kerlberos
   returns still has the `pre_auth` flag.
2. **Log in from a keytab** (`src/krb_auth_fsm.erl`,
   `src/krb_realm.erl`). Pass the principal's keytab entries as an
   option; the password argument is then ignored:

   ```erlang
   {ok, KeyTab} = krb_mit_keytab:file("client.keytab"),
   Entries = [E || E = #{principal := ["sv1warehouse"]} <- KeyTab],
   {ok, TGT} = krb_realm:authenticate(Realm, ["sv1warehouse"], <<>>,
                                      #{keytab => Entries}).
   ```

   The keytab's key for the etype the KDC chose is used instead of
   deriving one from a password. If the keytab has no key for that
   etype, the result is `{error, {no_keytab_key, EType}}` rather than a
   crash, because a crash report would include the keytab.

Checked against the `acs-local` KDC and broker on 2026-10-19: password
and keytab logins (the keytab one as `sv1warehouse`), a wrong password
(`{error, bad_secret}`), a keytab without the KDC's etype, and an MQTT 5
GSSAPI connection with mutual authentication.

## Known differences from MIT Kerberos

Not patched, because ACS doesn't need them:

- With no channel bindings, the GSS initiator sends the MD5 hash of an
  empty binding where MIT sends 16 zero bytes. The ACS broker's Java
  acceptor ignores bindings, so this works.
- Logging uses `lager`, which produces deprecation warnings on OTP 29.
  Its crash reports include process state, which holds the password or
  keytab key, so callers must keep those reports out of their logs.

## Updating

Vendor the new Hex package unchanged in one commit, then reapply the
patches listed above in another, so each patch stays visible in the
history.
