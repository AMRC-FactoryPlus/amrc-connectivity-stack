# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator

# Kubeseal interaction

import  subprocess
import  tempfile

import  kubernetes                      as k8s
from    kubernetes.client.exceptions    import ApiException

from    .util           import Identifiers, log

class SealedSecrets:
    CRD = {
        "group": "bitnami.com",
        "version": "v1alpha1",
        "plural": "sealedsecrets",
    }
    API_VERSION = f"{CRD['group']}/{CRD['version']}"

# This is annoyingly different from the version in .kubernetes
def is_mine (obj):
    meta = obj.get("metadata")
    labels = None if meta is None else meta.get("labels")
    if labels is None:
        return False
    return labels[Identifiers.MANAGED_BY] == Identifiers.APPID
    # Please Guido, *pretty* please, can I haz
    #   obj?["metadata"]?["labels"]?[Id.M_B] ?? None

class Kubeseal:
    def fetch_cert (self, ns, seal_with):
        log(f"Fetching sealing cert from {seal_with}")
        name, key = seal_with.split("/")

        core = k8s.client.CoreV1Api()
        config = core.read_namespaced_config_map(namespace=ns, name=name)
        pem = config.data[key]

        tmp = tempfile.NamedTemporaryFile(mode="w+")
        tmp.write(pem)
        tmp.flush()

        return tmp

    def find_sealed_secret (self, ns, name, create=False, mine=None):
        api = k8s.client.CustomObjectsApi()

        if mine is None:
            mine = create

        try:
            secret = api.get_namespaced_custom_object(
                **SealedSecrets.CRD, namespace=ns, name=name)
            if mine and not is_mine(secret):
                raise ValueError(f"Can't edit sealed secret {name}, it isn't mine")
            return secret
        except ApiException as ex:
            if ex.status != 404:
                raise ex

        if not create:
            return None

        sealed = {
            "apiVersion": SealedSecrets.API_VERSION,
            "kind": "SealedSecret",
            "metadata": {
                "namespace": ns,
                "name": name,
                "labels": {
                    Identifiers.MANAGED_BY: Identifiers.APPID,
                } },
            "spec": {
                "encryptedData": {},
                "template": {
                    "metadata": {
                        "namespace": ns,
                        "name": name,
                    } } } }
        
        log(f"Creating sealed secret {ns}/{name}")
        api.create_namespaced_custom_object(
            **SealedSecrets.CRD, namespace=ns, body=sealed)
        return sealed

    def create_sealed_secret (self, cert, ns, name, key, value):
        desc = f"key {key} in sealed secret {ns}/{name}"

        api = k8s.client.CustomObjectsApi()
        secret = self.find_sealed_secret(ns, name, create=True)
        if not is_mine(secret):
            raise ValueError(f"Can't add {desc}: not mine")

        res = subprocess.run(
            ["kubeseal", "--cert", cert.name, "--raw",
                "--namespace", ns, "--name", name],
            input=value, stdout=subprocess.PIPE,
            check=True)

        patch = { 
            "spec": {
                "encryptedData": { 
                    key: res.stdout.decode(),
                } } }

        api.patch_namespaced_custom_object(
            **SealedSecrets.CRD, namespace=ns, name=name, body=patch)
        log(f"Created {desc}")

    def maybe_delete_sealed_secret (self, ns, name, key):
        api = k8s.client.CustomObjectsApi()

        desc = f"key {key} from sealed secret {ns}/{name}"
        secret = self.find_sealed_secret(ns, name, create=False, mine=True)

        if secret is None:
            log(f"Cannot remove {desc}: not found")
            return
        if not is_mine(secret):
            raise ValueError(f"Cannot remove {desc}: not mine")

        patch = {
            "spec": {
                "encryptedData": { key: None }
            } }

        try:
            api.patch_namespaced_custom_object(
                **SealedSecrets.CRD, namespace=ns, name=name, body=patch)
        except ApiException as ex:
            if ex.status == 404:
                log(f"Cannot remove {desc}: not found")
            else:
                raise ex
        log(f"Removed {desc}")
