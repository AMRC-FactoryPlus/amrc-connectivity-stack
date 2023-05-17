# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator

# Kubernetes interaction

from    base64  import b64decode, b64encode
import  logging
import  random
import  time

import  kubernetes                      as k8s
from    kubernetes.client.exceptions    import ApiException

from .util          import Identifiers, log

MANAGED_BY = "app.kubernetes.io/managed-by"

def is_mine (obj):
    return obj.metadata.labels is not None \
        and obj.metadata.labels[MANAGED_BY] == Identifiers.APPID

class K8s:
    def __init__ (self, **kw):
        pass

    def retry (self, work):
        i = 100
        while True:
            i -= 1
            try:
                return work()
            except ApiException as ex:
                if i <= 0 or ex.status != 409:
                    raise ex
                # We are running in a thread, so time.sleep is correct
                time.sleep(random.uniform(0.1, 0.6))
                log("Retrying operation due to 409...")

    def find_secret (self, ns, name, create):
        cli = k8s.client
        core = cli.CoreV1Api()

        try:
            return core.read_namespaced_secret(namespace=ns, name=name)
        except ApiException as ex:
            if ex.status != 404:
                raise ex

        if not create:
            return None

        secret = cli.V1Secret()
        meta = cli.V1ObjectMeta()

        secret.metadata = meta
        meta.name = name
        meta.labels = { MANAGED_BY: Identifiers.APPID }
        
        log(f"Creating secret {name}")
        core.create_namespaced_secret(namespace=ns, body=secret)
        return secret

    def read_secret (self, ns, name, key):
        secret = self.find_secret(ns, name, False)
        if secret is None or secret.data is None or key not in secret.data:
            return None
        return b64decode(secret.data[key])

    def update_secret (self, ns, name, key, value):
        log(f"Updating key {key} in secret {name}")
        core = k8s.client.CoreV1Api()
        # Encode to Base64 bytes, then decode to Base64 string
        b64 = b64encode(value).decode()
        def work ():
            secret = self.find_secret(ns, name, True)

            if not is_mine(secret):
                raise ValueError(f"Can't edit secret {name}, it isn't mine")

            if secret.data is None:
                secret.data = { key: b64 }
            else:
                secret.data[key] = b64
            core.patch_namespaced_secret(namespace=ns, name=name, body=secret)
        self.retry(work)

    def remove_secret (self, ns, name, key):
        core = k8s.client.CoreV1Api()
        def work ():
            secret = self.find_secret(ns, name, False)

            if secret is None or secret.data is None or key not in secret.data:
                log(f"Can't remove {key} from secret {name}, not found")
                return
            if not is_mine(secret):
                raise ValueError(f"Can't edit secret {name}, it isn't mine")

            log(f"Removing key {key} in secret {name}")
            # To delete a key we must set to None, not use del().
            secret.data[key] = None
            core.patch_namespaced_secret(namespace=ns, name=name, body=secret)
        self.retry(work)

