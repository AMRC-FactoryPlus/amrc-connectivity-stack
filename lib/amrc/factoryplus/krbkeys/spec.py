# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator
# Internal spec class
# Copyright 2023 AMRC

from    enum            import Enum
import  logging
import  typing

from    .           import keyops
from    .context    import kk_ctx
from    .secrets    import SecretRef
from    .util       import dslice, fields, hidden, log

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

        self.secret = SecretRef.from_spec(ns, name, spec)

    @property
    def principal (self):
        if len(self.principals) > 1:
            raise ValueError(f"Multiple principals specified for {self.name}")
        for p in self.principals:
            return p

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

    def can_verify (self):
        return self.secret.can_read()

    def remove (self, new):
        nsc = None if new is None else new.secret
        if not self.preset and self.secret != nsc:
            self.secret.remove()

        npr = set() if new is None or new.disabled else new.principals;
        kadm = kk_ctx().kadm
        for p in self.principals - npr:
            kadm.disable_princ(p)

    def reconcile_key (self, force=False):
        kops = self.kind
        current = self.secret.maybe_read()

        kadm = kk_ctx().kadm
        for p in self.principals:
            kadm.enable_princ(p)

        if not force and current is not None:
            valid = kops.verify_key(self, current)
            if valid:
                log("Current key is still valid")
                return valid

        if self.preset:
            if current is None:
                raise ValueError("No secret for preset key")
            return kops.set_key(self, current)

        # We want to fail, if possible, before we've done a ktadd and
        # have a newly-minted key which we can't put anywhere.
        self.secret.verify_writable()
        oldkey = current if self.keep_old else None

        status = kops.generate_key(self, oldkey)
        self.secret.write(status.secret)
        return status

    def trim_keys (self):
        self.secret.verify_writable()

        current = self.secret.maybe_read()
        if current is None:
            log(f"Can't trim key, secret is not readable")
            return keyops.KeyOpStatus(has_old=False)
            
        status = self.kind.trim_keys(self, current)

        if status.secret is not None:
            self.secret.write(status.secret)

        return status
