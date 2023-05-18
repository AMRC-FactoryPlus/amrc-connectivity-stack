# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator
# Internal spec class
# Copyright 2023 AMRC

import  json
import  krb5
import  secrets

from    .util       import KtData, fields, log, ops

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

class Disabled (KeyOps):
    pass

class Keytab (KeyOps):
    def verify_key (spec, secret):
        kt = KtData(contents=secret)
        ctx = ops().krb5

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
            keys = ops().kadm.create_keytab(spec.principals, name)

        return KeyOpStatus(
            secret=kt.contents, 
            keys=keys, 
            has_old=(current is not None))

class Password (KeyOps):
    def verify_key (spec, secret):
        princ = spec.principal
        log(f"Verifying password for {princ}")

        ctx = ops().krb5
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
        keys = ops().kadm.set_password(princ, passwd)

        return KeyOpStatus(
            secret=passwd.encode(),
            keys=keys)

    def set_key (spec, secret):
        princ = spec.principal
        log(f"Setting preset password for {princ}")

        keys = ops().kadm.set_password(princ, secret.decode())
        return KeyOpStatus(keys=keys)

class Trust (KeyOps):
    def verify_key (spec, secret):
        princ = spec.principal
        trust = json.loads(secret.decode())
        log(f"Verifying trust key for {princ}")

        passwd = trust.pop("password").encode()
        have = ops().kadm.key_info(princ)
        
        if have == trust:
            return Password.verify_key(spec, passwd)
        else:
            return None

    def generate_key (spec, current):
        princ = spec.principal
        log(f"Creating new trust key for {princ}")

        passwd = secrets.token_urlsafe()
        keys = ops().kadm.set_password(princ, passwd)
        trust = keys | { "password": passwd }
        
        return KeyOpStatus(
            secret=json.dumps(trust).encode(),
            keys=keys)

    def set_key (spec, secret):
        princ = spec.principal
        log(f"Setting trust key for {princ}")

        trust = json.loads(secret.decode())
        passwd = trust.pop("password")
        ops().kadm.set_trust_key(princ, trust, passwd)

        return KeyOpStatus(keys=trust)

TYPE_MAP = {
    "Disabled":         (Disabled, False),
    "Random":           (Keytab, False),
    "Password":         (Password, False),
    "PresetPassword":   (Password, True),
    "Trust":            (Trust, False),
    "PresetTrust":      (Trust, True),
}

