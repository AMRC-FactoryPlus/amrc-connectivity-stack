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

4. **Secrets kept out of crash reports** (`src/krb_redact.erl`, which is
   new, and `format_status/1` in `src/krb_auth_fsm.erl`,
   `src/krb_tkt_grant_fsm.erl` and `src/krb_realm.erl`). These processes
   hold passwords, keytabs, keys and tickets in their state, and
   `krb_realm` receives them in its `authenticate` and `obtain_ticket`
   calls. OTP prints a process's state, last message and exit reason in
   its crash report, and a `function_clause` exit reason carries the
   crashed function's arguments, which can be the whole state.
   `format_status/1` now blanks out the secrets, and reduces an exit
   reason to the kind of error and where it happened (module, function,
   arity and line). The same applies to `sys:get_status/1`. The service
   client's `test/kerlberos_fork_test.exs` checks each process, and
   crashes a live `krb_realm` to check its report.

5. **Mutual authentication checks the reply's time** (`src/gss_krb5.erl`).
   The initiator only checked that the acceptor's reply (AP-REP)
   decrypted with the ticket's session key. It didn't check that the
   reply echoes the time (`ctime`, `cusec`) of the authenticator it sent,
   as RFC 4120 section 3.2.5 asks and MIT Kerberos does. Without that,
   any reply made with the same ticket passed, so someone who recorded
   the broker's reply to one connection could replay it to pass as the
   broker on a later one that reused the ticket, and tickets are cached
   for hours. `initiate/1` now keeps the authenticator's time in its
   state, and the reply handling, moved into `initiator_ap_rep/2`, returns
   `{error, mutual_failed}` when the reply doesn't echo it. The service
   client's `test/fplus/credentials_acs_local_test.exs` checks both cases
   against the `acs-local` broker.

6. **`KRB5_CONFIG`** (`src/krb_realm_conf.erl`, `config_paths/0`).
   kerlberos only read fixed paths such as `/etc/krb5.conf`. As MIT
   Kerberos does, it now reads the colon-separated files in
   `KRB5_CONFIG` instead when that is set, skipping any that are
   missing. ACS pods keep their `krb5.conf` under `/config` and point
   `KRB5_CONFIG` at it.
7. **An empty DNS answer for KDCs** (`src/krb_realm_conf.erl`,
   `lookup_kdcs/3`). Unless `krb5.conf` sets `dns_lookup_kdc = false`,
   which ACS's doesn't, kerlberos also looks up `_kerberos._udp.<realm>`
   in DNS. An answer with no SRV records (NODATA) crashed it in
   `lists:min/1`. It now adds no KDCs from DNS in that case. The service
   client's `test/kerlberos_fork_config_test.exs` checks both patches,
   including with a `krb5.conf` as ACS's Helm template renders it.

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
- When a call to `krb_realm` fails, the exit the caller receives
  includes the request, so a password or ticket. Patch 4 can't change
  that: callers must catch these exits and not log them as they are.
- `krb_mit_keytab:file/1` matches `{err, _}` where it means
  `{error, _}`, so it crashes on any read error. The service client
  reads keytabs itself and calls `krb_mit_keytab:parse/1`.
- kerlberos ignores two settings in ACS's `krb5.conf`.
  `udp_preference_limit = 1` tells MIT clients to use TCP, but kerlberos
  tries UDP first, which only costs time where UDP isn't reachable.
  `disable_encrypted_timestamp = true` tells MIT clients to use SPAKE
  pre-authentication, but kerlberos only has encrypted timestamps, which
  the KDC still accepts.
- On OTP 29 kerlberos compiles with 23 warnings, mostly the deprecated
  `catch` expression. A later OTP may turn these into errors.

## Updating

Vendor the new Hex package unchanged in one commit, then reapply the
patches listed above in another, so each patch stays visible in the
history.
