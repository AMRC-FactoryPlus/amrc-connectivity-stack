# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator

# Kopf operator handlers

from    contextlib      import contextmanager
import  dataclasses
import  json
import  logging
import  os
import  secrets

import  kopf

from    amrc.factoryplus    import ServiceClient

from .context       import Context
from .event         import RekeyEvent, TrimKeysEvent
from .util          import Identifiers, log

CRD = (Identifiers.DOMAIN, Identifiers.CRD_VERSION, Identifiers.CRD_PLURAL)

class KrbKeys:
    def __init__ (self, env, **kw):
        self.default_ns = env.get("DEFAULT_NAMESPACE")
        self.keytabs = env.get("KEYTABS_SECRET")
        self.passwords = env.get("PASSWORDS_SECRET")
        self.presets = env.get("PRESETS_SECRET")
        self.expire_old_keys = int(env.get("EXPIRE_OLD_KEYS", 86400))
        self.kadmin_ccache = env.get("KADMIN_CCNAME", None)
        self.fplus = ServiceClient(env=env)

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
        self.register_handlers()

    def maybe_rekey (self, **kw):
        with Context(self, kw):
            handler = RekeyEvent(kw)
            return handler.process()

    def trim_keys (self, **kw):
        with Context(self, kw):
            handler = TrimKeysEvent(kw)
            return handler.process()

    # XXX This needs removing. These default secrets were not a good
    # idea.
    def get_secret_for (self, ns, name, spec):
        if "secret" in spec:
            secret, key = spec["secret"].split("/")
        else:
            match (spec['type']):
                case "Random":
                    secret = self.keytabs
                case "Password":
                    secret = self.passwords
                case "PresetPassword":
                    secret = self.presets
                case _ as typ:
                    secret = None

            if ns != self.default_ns:
                secret = None

            if secret is None:
                raise ValueError(f"Must specify secret for {spec['type']} {ns}/{name}")
            key = name

        return (ns, secret, key)

@kopf.on.startup()
def run (**kw):
    krbkeys = KrbKeys(env=os.environ)
    krbkeys.run()
