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

from .              import event
from .context       import Context
from .util          import Identifiers, log

CRD = (Identifiers.DOMAIN, Identifiers.CRD_VERSION, Identifiers.CRD_PLURAL)

def kopf_crud (id, handler):
    kopf.on.resume(*CRD, id=id)(handler)
    kopf.on.create(*CRD, id=id)(handler)
    kopf.on.update(*CRD, id=id)(handler)
    kopf.on.delete(*CRD, id=id)(handler)

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
        kopf_crud("rekey", self.process_event(event.Rekey))
        kopf.on.timer(*CRD,
            id="trim_keys",
            interval=self.expire_old_keys/2,
            labels={Identifiers.HAS_OLD_KEYS: "true"}
        )(self.process_event(event.TrimKeys))
        kopf_crud("account_uuid", self.process_event(event.AccUuid))
        kopf_crud("reconcile_account", self.process_event(event.Account))

    def run (self):
        self.register_handlers()

    def process_event (self, event):
        def handler (**kw):
            with Context(self, kw):
                ev = event(kw)
                return ev.process()
        return handler

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
