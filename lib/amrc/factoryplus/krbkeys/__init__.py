# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator

# Kopf operator handlers

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
from .event         import KrbKeyEvent
from .util          import Identifiers, log, log_tag, operator

CRD = (Identifiers.DOMAIN, Identifiers.CRD_VERSION, Identifiers.CRD_PLURAL)

class KrbKeys:
    def __init__ (self, default_ns, keytabs, passwords, presets, **kw):
        # There must be a better way to do this...
        self.default_ns = default_ns
        self.keytabs = keytabs
        self.passwords = passwords
        self.presets = presets

        self.k8s = K8s()
        self.krb5 = krb5.init_context()
        self.kadm = Kadm()
        self.kubeseal = Kubeseal()

    def register_handlers (self):
        log("Registering handlers")
        kopf.on.resume(*CRD)(self.handle_event)
        kopf.on.create(*CRD)(self.handle_event)
        kopf.on.update(*CRD)(self.handle_event)
        kopf.on.delete(*CRD)(self.handle_event)
        #kopf.on.timer(*CRD, interval=10.0,
        #    annotations={"has-old-keys": "keytab"}
        #)(self.trim_keys)

    def run (self):
        self.register_handlers()

    def handle_event (self, **kw):
        tag = f"{kw['namespace']}/{kw['name']}"
        lt_tok = log_tag.set(tag)
        op_tok = operator.set(self)
        try:
            handler = KrbKeyEvent(kw)
            return handler.process()
        finally:
            operator.reset(op_tok)
            log_tag.reset(lt_tok)

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

    def trim_keys (self, spec, namespace, name, patch, **kw):
        log(f"Trim keys: {spec!r}")

        def clear ():
            log(f"Clearing has-old-keys")
            patch.metadata.annotations["has-old-keys"] = None

        if spec["type"] != "Random" or "sealWith" in spec:
            log(f"Disabling trim for invalid object")
            clear()
            return

        secret = self.get_secret_for(namespace, name, spec)
        oldkt = self.k8s.read_secret(*secret)
        if oldkt is None:
            clear()
            return

        kadm = Kadm(name)

        newkt, more = kadm.trim_keytab(oldkt)
        if newkt is not None:
            self.update_secret(secret, newkt, None)
        if not more:
            clear()

@kopf.on.startup()
def run (**kw):
    krbkeys = KrbKeys(
        default_ns=os.environ["DEFAULT_NAMESPACE"],
        keytabs=os.environ["KEYTABS_SECRET"],
        passwords=os.environ["PASSWORDS_SECRET"],
        presets=os.environ["PRESETS_SECRET"],
    )
    krbkeys.run()
