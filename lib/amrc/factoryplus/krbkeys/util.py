# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator
# Utilities
# Copyright 2023 AMRC

from    contextlib      import contextmanager
from    contextvars     import ContextVar
import  logging
from    tempfile        import TemporaryDirectory, NamedTemporaryFile

import krb5

class Identifiers:
    DOMAIN = "factoryplus.app.amrc.co.uk"
    APP = "krbkeys"
    CRD_PLURAL = "kerberos-keys"
    CRD_VERSION = "v1"

def dslice (dct, *args):
    if dct is None:
        return None
    return tuple(dct.get(x) for x in args)

operator = ContextVar("operator")
log_tag = ContextVar("log_tag", default=None)

def ops ():
    return operator.get()

def log (msg, level=logging.INFO):
    tag = log_tag.get()
    prefix = "" if tag is None else f"[{tag}] "
    logging.log(level, prefix + msg)

class KtFile:
    def __init__ (contents):
        self.contents = contents

    @contextmanager
    def open ():
        with TemporaryDirectory() as ktdir:
            keytab = f"{ktdir}/keytab"
            if self.contents is not None:
                with open(keytab, "wb") as fh:
                    fh.write(contents)

            ctx = ops().krb5
            kt = krb5.kt_resolve(ctx, f"FILE:{keytab}".encode())
            yield kt

            with open(keytab, "rb") as fh:
                self.contents = fh.read()

