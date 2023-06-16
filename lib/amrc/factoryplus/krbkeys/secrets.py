# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator
# Secret handling
# Copyright 2023 AMRC

import  typing

from    .context    import kk_ctx
from    .util       import fields, hidden, log

@fields
class SecretRef:
    ns:         str
    name:       str
    key:        str
    seal:       str
    cert:       bytes = hidden

    @property
    def splat (self):
        return self.ns, self.name, self.key

    def can_read (self):
        return not self.seal

    def maybe_read (self):
        if self.seal:
            return None
        
        ns, name, key = self.splat
        return kk_ctx().k8s.read_secret(ns, name, key)

    def verify_writable (self):
        if self.seal:
            ks = kk_ctx().kubeseal
            self.cert = ks.fetch_cert(self.ns, self.seal)
            ks.find_sealed_secret(self.ns, self.name, create=False, mine=True)
        else:
            kk_ctx().k8s.find_secret(self.ns, self.name, create=False, mine=True)

    def write (self, data):
        if self.seal:
            kk_ctx().kubeseal.create_sealed_secret(self.cert, *self.splat, data)
        else:
            kk_ctx().k8s.update_secret(*self.splat, data)

    def remove (self):
        ns, name, key = self.splat
        if self.seal:
            kk_ctx().kubeseal.maybe_delete_sealed_secret(ns, name, key)
        else:
            kk_ctx().k8s.remove_secret(ns, name, key)

