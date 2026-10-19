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
3. **OTP's logger instead of lager** (10 files under `src/`,
   `src/kerlberos.app.src`, `rebar.config`, `rebar.lock`). kerlberos
   only used lager for debug messages. Starting kerlberos started lager,
   which wrote `log/console.log`, `log/error.log` and `log/crash.log`
   into the working directory of whatever application started it. By
   default it also captured OTP's crash reports into `crash.log`, which
   could put passwords or keys on disk. Each `lager:debug` call is now
   `?LOG_DEBUG` (44 calls), so messages go to the application's own
   logger and only appear at debug level. `lager` and `goldrush` are no
   longer dependencies. One acceptor-side message logged the keytab's
   keys when no key matched a ticket; it now logs only the ticket.

Patches 1 and 2 were checked against the `acs-local` KDC and broker on
2026-10-19: password and keytab logins (the keytab one as
`sv1warehouse`), a wrong password (`{error, bad_secret}`), a keytab
without the KDC's etype, and an MQTT 5 GSSAPI connection with mutual
authentication. After patch 3, login and the MQTT connection work as
before, debug messages arrive through Elixir's `Logger`, nothing is
written to `log/`, and the compiler warnings are the same 23 upstream
ones as before.

## Known issues

Not patched:

- With no channel bindings, the GSS initiator sends the MD5 hash of an
  empty binding where MIT sends 16 zero bytes. The ACS broker's Java
  acceptor ignores bindings, so this works.
- Crash reports from kerlberos's processes include their state, which
  holds the password or keytab key. Callers must keep those reports out
  of their logs.
- On OTP 29 kerlberos compiles with 23 warnings, mostly the deprecated
  `catch` expression. A later OTP may turn these into errors.

## Updating

Vendor the new Hex package unchanged in one commit, then reapply the
patches listed above in another, so each patch stays visible in the
history.
