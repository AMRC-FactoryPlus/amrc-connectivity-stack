# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator
# Internal spec class
# Copyright 2023 AMRC

import  dataclasses
from    enum            import Enum
import  logging
import  typing

from    .           import keyops
from    .util       import dslice, log, ops

# I would like to use frozen and slots here, but it appears to break
# super() in the __init__ methods.
fields = dataclasses.dataclass()
hidden = dataclasses.field(compare=False, repr=False)

@fields
class SecretWriter:
    secret:     typing.Any
    data:       bytes

    def finish (self):
        secret, data = self.secret, self.data
        if secret.seal:
            ops().kubeseal.create_sealed_secret(secret.seal, *secret.splat, data)
        else:
            ops().k8s.update_secret(*secret.splat, data)

@fields
class SecretRef:
    spec:       typing.Any = hidden
    ns:         str
    name:       str
    key:        str
    seal:       str

    @property
    def splat (self):
        return self.ns, self.name, self.key

    def maybe_read (self):
        if self.seal:
            return None
        
        ns, name, key = self.splat
        return ops().k8s.read_secret(ns, name, key)

    def writer (self, data):
        return SecretWriter(self, data)

    def remove (self):
        ns, name, key = self.splat
        if self.seal:
            log(f"Remove sealed secret {ns}/{name}")
            ops().kubeseal.maybe_delete_secret(ns, name)
        else:
            log(f"Remove key {key} in secret {ns}/{name}")
            ops().k8s.remove_secret(ns, name, key)

@fields
class InternalSpec:
    # These are typed as Any to avoid a circular import.
    event: typing.Any = hidden
    op: typing.Any = hidden
    ns: str
    name: str
    principals: list[str]
    secret: SecretRef
    kind: keyops.KeyOps
    preset: bool
    keep_old: bool

    def __init__ (self, event, spec, **kw):
        self.event = event
        self.op = event.op
        self.ns = event.ns
        self.name = event.name

        self.principals = {spec["principal"]}
        add_princ = spec.get('additionalPrincipals')
        if add_princ is not None:
            self.principals.update(add_princ)

        self.kind, self.preset = keyops.TYPE_MAP[spec['type']]
        self.keep_old = bool(spec.get("keepOldKeys"))

        secret, seal = dslice(spec, "secret", "sealWith")
        if secret is None:
            log("Default secrets are deprecated", level=logging.WARNING)
            _, sec_name, sec_key = self.op.get_secret_for(
                self.ns, self.name, spec)
        else:
            sec_name, sec_key = secret.split("/")
        self.secret = SecretRef(spec=self, ns=self.ns,
            name=sec_name, key=sec_key, seal=seal)

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

    def reconcile_key (self, status):
        mode = self.secret_mode
        kops = self.kind

        current = self.secret.maybe_read()

        if kops.verify_key(self, current):
            log("Current key is still valid")
            return

        if self.preset:
            if current is None:
                raise ValueError("No secret for preset key")
            kops.set_key(self, current)
            return None

        status, data = kops.generate_key(self, current)
        self.secret.writer(data).finish()

        return None
