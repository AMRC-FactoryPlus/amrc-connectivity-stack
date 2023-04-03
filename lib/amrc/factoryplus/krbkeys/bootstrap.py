# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator

# Krb-keys bootstrap module.
# This needs to be run from an initContainer on the KDC pod, to set up
# the initial operator principal we will use to do our work.

from base64 import b64decode
import os
import logging
from tempfile import TemporaryDirectory

import kubernetes as k8s
import kadmin_local as kadmin

from .kadmin import Kadm
from .kubernetes import K8s


class KrbKeysBs:
    def __init__(self, namespace, keytabs, secrets, principal, ktname):
        self.keytabs = keytabs
        self.namespace = namespace
        self.secrets = secrets
        self.principal = principal
        self.ktname = ktname

        kadm = kadmin.local()
        self.kadm = Kadm("bootstrap", kadm=kadm)

        k8s.config.load_incluster_config()
        self.k8s = K8s()

    def ensure_keytab(self):
        op = self.principal
        kt = self.k8s.read_secret(ns=self.namespace, name=self.keytabs, key=self.ktname)

        if self.kadm.princ_in_keytab(op, kt):
            logging.info(f"Keytab for {op} already exists.")
            return

        logging.info(f"Creating keytab for {op}")
        kt = self.kadm.create_keytab([op])
        self.k8s.update_secret(ns=self.namespace, name=self.keytabs, key=self.ktname, value=kt)

    def run(self):
        for s in self.secrets:
            self.k8s.find_secret(name=s, ns=self.namespace)

        self.ensure_keytab()


if __name__ == "__main__":
    logging.getLogger().setLevel("INFO")

    app = KrbKeysBs(
        namespace=os.environ["NAMESPACE"],
        keytabs=os.environ["KEYTABS_SECRET"],
        secrets=[os.environ["PASSWORDS_SECRET"]],
        principal=os.environ["OP_PRINCIPAL"],
        ktname=os.environ["OP_KEYTAB"])

    app.run()
