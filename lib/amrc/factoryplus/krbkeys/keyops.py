# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator
# Internal spec class
# Copyright 2023 AMRC

import  krb5
import  secrets

from    .util       import log, ops

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
    pass

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
            return False
        return True

    def generate_key (spec, current):
        princ = spec.principal
        log(f"Setting new password for {princ}")

        passwd = secrets.token_urlsafe()
        kpr = ops().kadm.set_password(princ, passwd)
        status = { princ: { "kvno": kpr.kvno } }

        return status, passwd.encode()

    def set_key (spec, secret):
        princ = spec.principal
        log(f"Setting preset password for {princ}")

        ops().kadm.set_password(princ, secret.decode())

class Trust (KeyOps):
    pass

TYPE_MAP = {
    "Disabled":         (Disabled, False),
    "Random":           (Keytab, False),
    "Password":         (Password, False),
    "PresetPassword":   (Password, True),
    "Trust":            (Trust, False),
    "PresetTrust":      (Trust, True),
}

