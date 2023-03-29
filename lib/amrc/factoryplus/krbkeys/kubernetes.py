# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator

# Kubernetes interaction

from    base64  import b64decode, b64encode
import  logging
import  random
import  time

import  kubernetes                      as k8s
from    kubernetes.client.exceptions    import ApiException

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
                logging.info("Retrying operation due to 409...")

    def find_secret (self, ns, name):
        cli = k8s.client
        core = cli.CoreV1Api()

        try:
            return core.read_namespaced_secret(namespace=ns, name=name)
        except ApiException as ex:
            if ex.status != 404:
                raise ex

        # XXX This is not really useful. It isn't possible to give the
        # operator permission to create just certain secrets; either you
        # can create (any) secrets or you can't. So precreation is
        # safer.
        secret = cli.V1Secret()
        secret.metadata = cli.V1ObjectMeta()
        secret.metadata.name = name
        logging.info(f"Creating secret {name}")
        core.create_namespaced_secret(namespace=ns, body=secret)
        return secret

    def read_secret (self, ns, name, key):
        secret = self.find_secret(ns, name)
        if secret.data is None or key not in secret.data:
            return None
        return b64decode(secret.data[key])

    def update_secret (self, ns, name, key, value):
        logging.info(f"Updating key {key} in secret {name}")
        core = k8s.client.CoreV1Api()
        # Encode to Base64 bytes, then decode to Base64 string
        b64 = b64encode(value).decode()
        def work ():
            secret = self.find_secret(ns, name)
            if secret.data is None:
                secret.data = { key: b64 }
            else:
                secret.data[key] = b64
            core.patch_namespaced_secret(namespace=ns, name=name, body=secret)
        self.retry(work)

    def remove_secret (self, ns, name, key):
        core = k8s.client.CoreV1Api()
        def work ():
            try:
                secret = core.read_namespaced_secret(namespace=ns, name=name)
            except ApiException as ex:
                if ex.status == 404:
                    secret = None
                else:
                    raise ex
            if secret is None or secret.data is None or key not in secret.data:
                logging.info(f"Can't remove {key} from secret {name}, not found")
                return
            logging.info(f"Removing key {key} in secret {name}")
            # To delete a key we must set to None, not use del().
            secret.data[key] = None
            core.patch_namespaced_secret(namespace=ns, name=name, body=secret)
        self.retry(work)

