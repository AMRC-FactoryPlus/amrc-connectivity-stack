# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator

# Kopf operator handlers

from    contextlib      import contextmanager
import  dataclasses
import  json
import  logging
import  os
import  secrets

import  kopf
from    optional            import Optional

from    amrc.factoryplus    import ServiceClient, uuids

from .              import event
from .context       import Context
from .util          import CRD, Identifiers, log

class KrbKeys:
    def __init__ (self, env, **kw):
        self.default_ns = env.get("DEFAULT_NAMESPACE")
        self.keytabs = env.get("KEYTABS_SECRET")
        self.passwords = env.get("PASSWORDS_SECRET")
        self.presets = env.get("PRESETS_SECRET")
        self.expire_old_keys = int(env.get("EXPIRE_OLD_KEYS", 86400))
        self.kadmin_ccache = env.get("KADMIN_CCNAME", None)

        self.fplus = ServiceClient(env=env)

        self.cluster_group = Optional.of(env.get("CLUSTER_UUID")) \
            .map(lambda cluster: self.fplus.configdb.get_config(
                uuids.App.SparkplugAddress, cluster)) \
            .map(lambda addr: addr["group_id"])

    def kopf_crud (self, crd, id, ev):
        kopf.on.resume(*crd, id=id)(self.process_event(ev))
        kopf.on.create(*crd, id=id)(self.process_event(ev))
        kopf.on.update(*crd, id=id)(self.process_event(ev))
        kopf.on.delete(*crd, id=id)(self.process_event(ev))

    def register_handlers (self):
        log("Registering handlers")
        self.kopf_crud(CRD.krbkey, "rekey", event.Rekey)
        kopf.on.timer(*CRD.krbkey, id="trim_keys",
            interval=self.expire_old_keys/2,
            labels={Identifiers.HAS_OLD_KEYS: "true"}
        )(self.process_event(event.TrimKeys))
        self.kopf_crud(CRD.krbkey, "account_uuid", event.AccUuid)
        self.kopf_crud(CRD.krbkey, "reconcile_account", event.Account)
        self.kopf_crud(CRD.local, "local_secret", event.LocalSecret)

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
