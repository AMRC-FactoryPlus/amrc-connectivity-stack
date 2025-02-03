# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator
# Internal spec class
# Copyright 2023 AMRC

from    datetime    import datetime
import  json
import  krb5
import  secrets
import  time

from    .context    import kk_ctx
from    .util       import KtData, fields, log

@fields
class KeyOpStatus:
    keys:       dict    = None
    secret:     bytes   = None
    has_old:    bool    = False

# XXX It would be good to return the current status of the keys in the
# secret from verify_key. Then we could keep the status part of the K8s
# object up to date, and potentially verify sealed keys we can't read.
# But it seems to be very difficult to extract a kvno from a krb5 creds
# object; I think there is dodgy C casting involved which we can't do
# from Python.

class KeyOps:
    def verify_key (spec, secret):
        raise NotImplementedError()

    def generate_key (spec, current):
        raise NotImplementedError()

    def set_key (spec, secret):
        raise NotImplementedError()

    def trim_keys (spec, secret):
        return KeyOpStatus(secret=None, has_old=False)

class Disabled (KeyOps):
    pass

class Keytab (KeyOps):
    def verify_key (spec, secret):
        kt = KtData(contents=secret)
        ctx = kk_ctx().krb5

        with kt.kt_name() as ktname:
            kth = krb5.kt_resolve(ctx, ktname.encode())

            for princ in spec.principals:
                log(f"Verifying keytab for {princ}")

                gic = krb5.get_init_creds_opt_alloc(ctx)
                try:
                    kpr = krb5.parse_name_flags(ctx, princ.encode(), 0)
                    krb5.get_init_creds_keytab(ctx, kpr, gic, kth)
                except krb5.Krb5Error:
                    return None

        return KeyOpStatus()

    def generate_key (spec, current):
        kt = KtData(contents=current)
        with kt.kt_name() as name:
            keys = kk_ctx().kadm.create_keytab(spec.principals, name)

        return KeyOpStatus(
            secret=kt.contents, 
            keys=keys, 
            has_old=(current is not None))

    def trim_keys (spec, secret):
        kt = KtData(contents=secret)
        ctx = kk_ctx().krb5
        since = time.time() - kk_ctx().operator.expire_old_keys
        log(f"Trimming keytab (since {datetime.fromtimestamp(since)})")

        more = False
        changed = False
        with kt.kt_name() as keytab:
            kth = krb5.kt_resolve(ctx, keytab.encode())
            entries = list(kth)

            principals = set(str(kte.principal) for kte in entries)
            for princ in principals:
                # Find keytab entries for current principle.
                mine   = [kte for kte in entries if str(kte.principal) == princ]
                # Sort entries by KVNO, then timestamp (oldest to newest).
                mine.sort(key=lambda kte: (kte.kvno, kte.timestamp))
                # For each KVNO, find the creation timestamp of the next highest KVNO.
                # If no higher KVNO exists, the key is "active"
                replacement_times = {
                    kte.kvno: min(
                        (next_kte.timestamp for next_kte in mine if next_kte.kvno > kte.kvno),
                        default=float('inf')
                    )
                    for kte in mine
                }
                expired = [kte for kte in mine if replacement_times[kte.kvno] < since]

                for kte in expired:
                    log(f"Removing {kte.principal} kvno {kte.kvno}")
                    krb5.kt_remove_entry(ctx, kth, kte)

                changed |= bool(expired)
                # Set to True if at least one old key exists that has a replacement but isn't expired yet.
                more |= any(
                    float('inf') > replacement_times[kte.kvno] >= since
                    for kte in mine
                )

        return KeyOpStatus(
            secret=kt.contents if changed else None,
            has_old=more)

class Password (KeyOps):
    def verify_key (spec, secret):
        princ = spec.principal
        log(f"Verifying password for {princ}")

        ctx = kk_ctx().krb5
        gic = krb5.get_init_creds_opt_alloc(ctx)
        try:
            kpr = krb5.parse_name_flags(ctx, princ.encode(), 0)
            krb5.get_init_creds_password(ctx, kpr, gic, secret)
        except krb5.Krb5Error:
            return None

        return KeyOpStatus()

    def generate_key (spec, current):
        princ = spec.principal
        log(f"Setting new password for {princ}")

        passwd = secrets.token_urlsafe()
        keys = kk_ctx().kadm.set_password(princ, passwd)

        return KeyOpStatus(
            secret=passwd.encode(),
            keys=keys)

    def set_key (spec, secret):
        princ = spec.principal
        log(f"Setting preset password for {princ}")

        keys = kk_ctx().kadm.set_password(princ, secret.decode())
        return KeyOpStatus(keys=keys)

class Trust (KeyOps):
    def verify_key (spec, secret):
        princ = spec.principal
        trust = json.loads(secret.decode())
        log(f"Verifying trust key for {princ}")

        passwd = trust.pop("password").encode()
        have = kk_ctx().kadm.key_info(princ)
        
        if have == trust:
            return Password.verify_key(spec, passwd)
        else:
            return None

    def generate_key (spec, current):
        princ = spec.principal
        log(f"Creating new trust key for {princ}")

        passwd = secrets.token_urlsafe()
        keys = kk_ctx().kadm.set_password(princ, passwd)
        trust = keys | { "password": passwd }
        
        return KeyOpStatus(
            secret=json.dumps(trust).encode(),
            keys=keys)

    def set_key (spec, secret):
        princ = spec.principal
        log(f"Setting trust key for {princ}")

        trust = json.loads(secret.decode())
        passwd = trust.pop("password")
        kk_ctx().kadm.set_trust_key(princ, trust, passwd)

        return KeyOpStatus(keys=trust)

TYPE_MAP = {
    "Disabled":         (Disabled, False),
    "Random":           (Keytab, False),
    "Password":         (Password, False),
    "PresetPassword":   (Password, True),
    "Trust":            (Trust, False),
    "PresetTrust":      (Trust, True),
}

