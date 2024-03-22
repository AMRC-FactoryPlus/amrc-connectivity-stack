# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator
# Secret handling
# Copyright 2023 AMRC

from    functools       import cached_property
import  logging
import  typing
from    uuid            import UUID

from    amrc.factoryplus    import uuids

from    .context    import kk_ctx
from    .util       import dslice, fields, hidden, log

@fields
class SecretRef:
    ns:         str
    name:       str
    key:        str

    @property
    def splat (self):
        return self.ns, self.name, self.key

    def can_read (self):
        return False

    def maybe_read (self):
        return None

    def verify_writable (self):
        raise NotImplementedError()

    def write (self, data):
        raise NotImplementedError()

    def remove (self):
        raise NotImplementedError()

    @staticmethod
    def from_spec (ns, name, spec):
        secret = spec.get("secret")
        if secret is None:
            log("Default secrets are deprecated", level=logging.WARNING)
            oper = kk_ctx().operator
            _, sec_name, sec_key = oper.get_secret_for(ns, name, spec)
        else:
            sec_name, sec_key = secret.split("/")
        splat = { "ns": ns, "name": sec_name, "key": sec_key }

        seal = spec.get("sealWith")
        if seal is not None:
            return SealedSecret(**splat, seal=seal)

        cluster = spec.get("cluster")
        if cluster is not None:
            uuid = UUID(cluster["uuid"])
            splat["ns"] = cluster.get("namespace")
            return ClusterSecret(**splat, uuid=uuid)

        return LocalSecret(**splat)

class LocalSecret (SecretRef):
    def can_read (self):
        return True

    def maybe_read (self):
        ns, name, key = self.splat
        return kk_ctx().k8s.read_secret(ns, name, key)

    def verify_writable (self):
        kk_ctx().k8s.find_secret(self.ns, self.name, create=False, mine=True)

    def write (self, data):
        kk_ctx().k8s.update_secret(*self.splat, data)

    def remove (self):
        ns, name, key = self.splat
        kk_ctx().k8s.remove_secret(ns, name, key)

@fields
class SealedSecret (SecretRef):
    seal:       str
    cert:       bytes = hidden

    def verify_writable (self):
        ks = kk_ctx().kubeseal
        self.cert = ks.fetch_cert(self.ns, self.seal)
        ks.find_sealed_secret(self.ns, self.name, create=False, mine=True)

    def write (self, data):
        kk_ctx().kubeseal.create_sealed_secret(self.cert, *self.splat, data)

    def remove (self):
        ns, name, key = self.splat
        kk_ctx().kubeseal.maybe_delete_sealed_secret(ns, name, key)

@fields
class ClusterSecret (SecretRef):
    uuid:       UUID

    @cached_property
    def params (self):
        uuid = self.uuid
        ns = self.ns

        if ns is None:
            conf = kk_ctx().fplus.configdb \
                .get_config(uuids.App.EdgeCluster, uuid)
            if conf is None:
                raise RuntimeError(f"No config for cluster {uuid}")
            ns = conf.get("namespace")
            if ns is None:
                raise RuntimeError(f"No default namespace for cluster {uuid}")

        return {
            "cluster":      uuid,
            "namespace":    ns,
            "name":         self.name,
            "key":          self.key,
        }

    def verify_writable (self):
        kk_ctx().fplus.edge_deployment \
            .seal_secret(**self.params, content=b"", dryrun=True)

    def write (self, data):
        kk_ctx().fplus.edge_deployment \
            .seal_secret(**self.params, content=data)

    def remove (self):
        kk_ctx().fplus.edge_deployment \
            .delete_secret(**self.params)
