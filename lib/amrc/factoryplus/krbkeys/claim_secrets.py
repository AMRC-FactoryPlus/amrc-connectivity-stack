# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator
# Claim our secrets (upgrade script)
# Copyright 2023 AMRC

import  logging
import  os

import  kubernetes      as k8s
from    kubernetes.client.exceptions    import ApiException

from .          import KrbKeys, util
from .spec      import InternalSpec
from .util      import Identifiers, log

@util.fields
class FakeEvent:
    ns: str
    name: str

if __name__ == "__main__":
    logging.getLogger().setLevel("INFO")

    k8s.config.load_config()
    core = k8s.client.CoreV1Api()
    cust = k8s.client.CustomObjectsApi()

    oper = KrbKeys(os.environ)
    util.operator.set(oper)
    util.log_tag.set("CLAIM SECRETS")

    patch = {
        "metadata": {
            "labels": {
                Identifiers.MANAGED_BY: Identifiers.APPID,
            } } }

    for ns in os.environ["WATCH_NAMESPACES"].split(","):
        log(f"Looking for KerberosKeys in {ns}")

        kks = cust.list_namespaced_custom_object(
            group=Identifiers.DOMAIN, version=Identifiers.CRD_VERSION,
            plural=Identifiers.CRD_PLURAL,
            namespace=ns)

        for kk in kks["items"]:
            name = kk["metadata"]["name"]
            util.log_tag.set(f"{ns}/{name}")

            ev = FakeEvent(ns=ns, name=name)
            spec = InternalSpec(ev, kk["spec"])

            if spec.preset:
                log("Preset secret, skipping")
                continue

            try:
                name = spec.secret.name
                core.patch_namespaced_secret(namespace=ns, name=name, body=patch)
                log(f"Claimed secret {ns}/{name}")
            except ApiException as ex:
                if ex.status != 404:
                    raise ex
