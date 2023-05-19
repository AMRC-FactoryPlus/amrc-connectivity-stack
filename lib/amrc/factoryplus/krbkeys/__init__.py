# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator

# Kopf operator handlers

from    contextlib      import contextmanager
import  dataclasses
import  json
import  logging
import  os
import  secrets

import  kopf
import  krb5

from .kadmin        import Kadm
from .kubernetes    import K8s
from .kubeseal      import Kubeseal
from .event         import RekeyEvent, TrimKeysEvent
from .util          import Identifiers, log, log_tag, operator

CRD = (Identifiers.DOMAIN, Identifiers.CRD_VERSION, Identifiers.CRD_PLURAL)

class KrbKeys:
    def __init__ (self, env, **kw):
        self.default_ns = env["DEFAULT_NAMESPACE"]
        self.keytabs = env["KEYTABS_SECRET"]
        self.passwords = env["PASSWORDS_SECRET"]
        self.presets = env["PRESETS_SECRET"]
        self.expire_old_keys = int(env.get("EXPIRE_OLD_KEYS", 86400))

        self.k8s = K8s()
        self.krb5 = krb5.init_context()
        self.kadm = Kadm()
        self.kubeseal = Kubeseal()

    def register_handlers (self):
        log("Registering handlers")
        kopf.on.resume(*CRD)(self.maybe_rekey)
        kopf.on.create(*CRD)(self.maybe_rekey)
        kopf.on.update(*CRD)(self.maybe_rekey)
        kopf.on.delete(*CRD)(self.maybe_rekey)
        kopf.on.timer(*CRD,
            interval=self.expire_old_keys/2,
            labels={Identifiers.HAS_OLD_KEYS: "true"}
        )(self.trim_keys)

    def run (self):
        self.kadm.start()
        self.register_handlers()

    @contextmanager
    def context (self, kw):
        tag = f"{kw['namespace']}/{kw['name']}"
        lt_tok = log_tag.set(tag)
        op_tok = operator.set(self)
        yield None
        operator.reset(op_tok)
        log_tag.reset(lt_tok)

    def maybe_rekey (self, **kw):
        with self.context(kw):
            handler = RekeyEvent(kw)
            return handler.process()

    def trim_keys (self, **kw):
        with self.context(kw):
            handler = TrimKeysEvent(kw)
            return handler.process()

    # XXX This needs removing. These default secrets were not a good
    # idea.
    def get_secret_for (self, ns, name, spec):
        if "secret" in spec:
            secret, key = spec["secret"].split("/")
        else:
            if ns != self.default_ns:
                raise ValueError(f"Must specify secret for {ns}/{name}")
            match (spec['type']):
                case "Random":
                    secret = self.keytabs
                case "Password":
                    secret = self.passwords
                case "PresetPassword":
                    secret = self.presets
                case _ as typ:
                    raise ValueError(f"Must specify secret for {spec['type']} {ns}/{name}")
            key = name

        return (ns, secret, key)

@kopf.on.startup()
def run (**kw):
    krbkeys = KrbKeys(env=os.environ)
    krbkeys.run()
