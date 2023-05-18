# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator
# Internal spec class
# Copyright 2023 AMRC

from    enum            import Enum
import  logging
import  typing

from    .           import keyops
from    .secrets    import SecretRef
from    .util       import dslice, fields, hidden, log, ops

@fields
class InternalSpec:
    principals: list[str]
    secret: SecretRef
    kind: keyops.KeyOps
    preset: bool
    keep_old: bool

    def __init__ (self, event, spec, **kw):
        ns = event.ns
        name = event.name

        self.principals = {spec["principal"]}
        add_princ = spec.get('additionalPrincipals')
        if add_princ is not None:
            self.principals.update(add_princ)

        self.kind, self.preset = keyops.TYPE_MAP[spec['type']]
        self.keep_old = bool(spec.get("keepOldKeys"))

        secret, seal = dslice(spec, "secret", "sealWith")
        if secret is None:
            log("Default secrets are deprecated", level=logging.WARNING)
            _, sec_name, sec_key = ops().get_secret_for(ns, name, spec)
        else:
            sec_name, sec_key = secret.split("/")
        self.secret = SecretRef(ns=ns, name=sec_name, key=sec_key, seal=seal)

    @property
    def principal (self):
        if len(self.principals) > 1:
            raise ValueError(f"Multiple principals specified for {self.name}")
        for p in self.principals:
            return p

    @property
    def secret_mode (self):
        if self.preset:
            return "r";
        if self.keep_old:
            return "rw";
        return "w";

    @property
    def disabled (self):
        return self.kind == keyops.Disabled

    def sanity_check (self):
        if self.kind == keyops.Keytab:
            if self.preset:
                raise NotImplementedError("Preset keytabs not supported")
        else:
            if self.keep_old:
                raise ValueError("Keeping old keys requires a keytab")
            if len(self.principals) != 1:
                raise ValueError("Multiple principals requires a keytab")

    def remove (self, new):
        nsc = None if new is None else new.secret
        if "w" in self.secret_mode and self.secret != nsc:
            self.secret.remove()

        npr = set() if new is None or new.disabled else new.principals;
        for p in self.principals - npr:
            log(f"Disable principal {p}")

    def reconcile_key (self, force=False):
        mode = self.secret_mode
        kops = self.kind

        current = self.secret.maybe_read()

        if not force \
        and current is not None \
        and kops.verify_key(self, current):
            log("Current key is still valid")
            return

        if self.preset:
            if current is None:
                raise ValueError("No secret for preset key")
            kops.set_key(self, current)
            return None

        # We want to fail, if possible, before we've done a ktadd and
        # have a newly-minted key which we can't put anywhere.
        self.secret.verify_writable()
        oldkey = current if self.keep_old else None
        status, data = kops.generate_key(self, oldkey)
        self.secret.write(data)

        return None
