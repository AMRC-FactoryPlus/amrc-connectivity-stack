# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator

# Kopf operator handlers

import  kopf
import  logging
import  os
import  secrets

from .kadmin        import Kadm
from .kubernetes    import K8s
from .kubeseal      import Kubeseal

crd = ("factoryplus.app.amrc.co.uk", "v1", "kerberos-keys")

class KrbKeys:
    def __init__ (self, default_ns, keytabs, passwords, presets, **kw):
        # There must be a better way to do this...
        self.default_ns = default_ns
        self.keytabs = keytabs
        self.passwords = passwords
        self.presets = presets

        self.k8s = K8s()
        self.kubeseal = Kubeseal()

    def register_handlers (self):
        logging.info("Registering handlers")
        kopf.on.create(*crd)(self.create_key)
        kopf.on.update(*crd)(self.update_key)
        kopf.on.delete(*crd)(self.delete_key)

    def run (self):
        self.register_handlers()

    def get_princs_for (self, name, spec):
        princ = spec['principal']
        add = spec.get('additionalPrincipals', [])
        multiple = spec['type'] == "Random"

        if multiple:
            return [princ, *add]
        else:
            if len(add) != 0:
                logging.warning(f"Additional principals ignored for {name}")
            return [princ]

    # XXX The principal-type handling code needs to be refactored into
    # a set of classes.

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
                    raise ValueError(f"Unimplemented type {typ}")
            key = name

        return (ns, secret, key)

    def update_secret (self, secret, value, seal_with):
        if seal_with is None:
            self.k8s.update_secret(*secret, value)
        else:
            self.kubeseal.create_sealed_secret(seal_with, *secret, value)
        
    def create_key (self, namespace, name, spec, **kw):
        kadm = Kadm(name)
        secret = self.get_secret_for(namespace, name, spec)
        princs = self.get_princs_for(name, spec)
        seal_with = spec.get("sealWith")

        for p in princs:
            kadm.enable_princ(p)

        match (spec['type']):
            case "Random":
                keytab = kadm.create_keytab(princs)
                self.update_secret(secret, keytab, seal_with)
            case "Password":
                passwd = secrets.token_urlsafe()
                kadm.set_password(princs[0], passwd)
                self.update_secret(secret, passwd.encode(), seal_with)
            case "PresetPassword":
                if seal_with is not None:
                    raise RuntimeError(f"Can't seal PresetPassword {name}")
                passwd = self.k8s.read_secret(*secret)
                if passwd is None:
                    raise RuntimeError(f"No preset password for {name}")
                kadm.set_password(princs[0], passwd.decode())
            case _ as typ:
                raise ValueError(f"Unimplemented type {typ}")

    def update_key (self, namespace, name, old, new, **kw):
        logging.info(f"Update {name}: old {old!r}, new {new!r}");

        # XXX This is not the best thing to do here; it will generate a
        # whole lot of unnecessary kvnos. We should work out what has
        # changed and only update the secrets if necessary. (Though, a
        # 'force new key' field might be good...).
        self.delete_key(namespace, name, old["spec"])
        self.create_key(namespace, name, new["spec"])

    def remove_secret (self, secret, sealed):
        if (sealed):
            ns, name, _ = secret
            self.kubeseal.maybe_delete_sealed_secret(ns, name)
        else:
            self.k8s.remove_secret(*secret)

    def delete_key (self, namespace, name, spec, **kw):
        secret = self.get_secret_for(namespace, name, spec)
        princs = self.get_princs_for(name, spec)
        sealed = "sealWith" in spec

        kadm = Kadm(name)
        for p in princs:
            kadm.disable_princ(p)

        match (spec['type']):
            case "Random":
                self.remove_secret(secret, sealed)
            case "Password":
                self.remove_secret(secret, sealed)
            case "PresetPassword":
                pass
            case _ as typ:
                logging.warning(f"Attempt to remove unimplemeted type {typ}")

@kopf.on.startup()
def run (**kw):
    krbkeys = KrbKeys(
        default_ns=os.environ["DEFAULT_NAMESPACE"],
        keytabs=os.environ["KEYTABS_SECRET"],
        passwords=os.environ["PASSWORDS_SECRET"],
        presets=os.environ["PRESETS_SECRET"],
    )
    krbkeys.run()
