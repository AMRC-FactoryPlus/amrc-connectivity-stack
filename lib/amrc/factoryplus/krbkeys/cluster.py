import getpass
import os
import secrets

import kadmin
import kubernetes as k8s

from .kadmin import Kadm
from .kubernetes import K8s
from .util import KtData

cluster = os.environ["CLUSTER_NAME"]
realm = os.environ["REALM"]
namespace = os.environ["NAMESPACE"]

input("Press Return to continue...")

print(f"Enrolling cluster {cluster} in {realm}")
user = input("ACS admin user: ")
passwd = getpass.getpass(prompt="Password: ")
kadm_h = kadmin.init_with_password(user, passwd)
kadm = Kadm(kadm=kadm_h)

k8s.config.load_incluster_config()
k8o = K8s()

kkusr = f"op1krbkeys/{cluster}@{realm}"
kt = KtData(contents=None)
with kt.kt_name() as ktname:
    kadm.create_keytab([kkusr], ktname)
k8o.update_secret(ns=namespace, name="krb-keys-keytabs",
    key="client", value=kt.contents)
kadm.enable_princ(kkusr)
print(f"Created krbkeys account {kkusr}")

fluxusr = f"op1flux/{cluster}@{realm}"
fluxpw = secrets.token_urlsafe()
kadm.set_password(fluxusr, fluxpw)
k8o.update_secret(ns=namespace, name="flux-secrets", key="password", 
    value=fluxpw.encode())
k8o.update_secret(ns=namespace, name="flux-secrets", key="username",
    value=fluxusr.encode())
kadm.enable_princ(fluxusr)
print(f"Created flux account {fluxusr}")
