# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator
# Internal spec class
# Copyright 2023 AMRC

import  typing
from    uuid        import UUID

from    amrc.factoryplus    import ServiceError

from    .context    import kk_ctx
from    .util       import fields, log

@fields
class FPAccount:
    principal: str
    uuid: UUID
    klass: UUID
    name: str | None
    groups: list[UUID] | None

    def __init__ (self, spec):
        self.principal = spec["principal"]

        acc = spec["account"]

        self.uuid = acc["uuid"]
        self.klass = acc["class"]
        self.name = acc.get("name", None)

        groups = acc.get("groups", None);
        self.groups = None if groups is None \
            else [UUID(g) for g in groups]

    def reconcile (self):
        log(f"Reconcile account {self}")
        fp = kk_ctx().fplus

        log(f"Creating account object in class {self.klass}")
        fp.configdb.create_object(self.klass, self.uuid)

        # XXX This is not atomic, but this is unavoidable with the
        # current auth service API.
        ids = fp.auth.get_principal(self.uuid)
        if ids is not None and ids["kerberos"] == self.principal:
            log(f"Principal is already correct in auth service")
        else:
            log(f"Updating auth principal mapping for {self.uuid} to {self.principal}")
            if ids is not None:
                fp.auth.delete_principal(self.uuid)
            fp.auth.add_principal({
                "uuid": self.uuid, 
                "kerberos": self.principal,
            })

    def remove (self, new):
        log(f"Maybe remove account: {self} -> {new}")
        if new is not None and self.uuid == new.uuid:
            log("UUIDs match, ignoring")
            return

        fp = kk_ctx().fplus

        log(f"Removing account {self.uuid}")
        try:
            fp.auth.delete_principal(self.uuid)
        except ServiceError as err:
            if err.status != 404:
                raise
