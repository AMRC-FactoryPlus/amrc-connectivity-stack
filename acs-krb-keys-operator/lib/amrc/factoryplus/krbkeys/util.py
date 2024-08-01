# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator
# Utilities
# Copyright 2023 AMRC

from    contextlib      import contextmanager
from    contextvars     import ContextVar
import  dataclasses
import  logging
from    tempfile        import TemporaryDirectory, NamedTemporaryFile

import krb5

# Don't make a circular import
from    .       import context

class Identifiers:
    DOMAIN = "factoryplus.app.amrc.co.uk"
    APP = "krbkeys"
    APPID = f"{APP}.{DOMAIN}"

    FORCE_REKEY = f"{APPID}/force-rekey"
    HAS_OLD_KEYS = f"{APPID}/has-old-keys"
    ACCOUNT_UUID = f"{APPID}/account-uuid"

    MANAGED_BY = "app.kubernetes.io/managed-by"

class CRD:
    krbkey = (Identifiers.DOMAIN, "v1", "kerberos-keys")
    local = (Identifiers.DOMAIN, "v1", "localsecrets")

def dslice (dct, *args):
    if dct is None:
        return None
    return tuple(dct.get(x) for x in args)

def log (*args, **kw):
    context.log(*args, **kw)

# I would like to use frozen and slots here, but it appears to break
# super() in the __init__ methods.
fields = dataclasses.dataclass()
immutable = dataclasses.dataclass(frozen=True)
hidden = dataclasses.field(init=False, default=None, compare=False, repr=False)

class KtData:
    def __init__ (self, contents):
        self.contents = contents

    @contextmanager
    def kt_name (self):
        """Context manager to write the keytab to a file. Yields a
        string holding the keytab name, i.e. "FILE:foo". Reads the file
        back into the object when the context finishes."""
        with TemporaryDirectory() as ktdir:
            keytab = f"{ktdir}/keytab"
            if self.contents is not None:
                with open(keytab, "wb") as fh:
                    fh.write(self.contents)

            yield f"FILE:{keytab}"

            try:
                with open(keytab, "rb") as fh:
                    self.contents = fh.read()
            except FileNotFoundError:
                self.contents = None
