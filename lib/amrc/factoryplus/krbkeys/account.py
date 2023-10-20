# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator
# Internal spec class
# Copyright 2023 AMRC

import  typing
from    uuid        import UUID

from    optional    import Optional

from    amrc.factoryplus    import ServiceError, uuids

from    .context    import kk_ctx
from    .util       import fields, log

@fields
class FPAccount:
    principal: str
    uuid: UUID
    klass: UUID
    name: str | None
    groups: set[UUID]

    def __init__ (self, spec, uuid, principal):
        self.uuid = uuid
        self.principal = principal

        self.klass = Optional.of(acc.get("class")) \
            .map(lambda u: UUID(u)) \
            .get_or_default(None)

        self.name = acc.get("name")

        groups = acc.get("groups", []);
        self.groups = set(UUID(g) for g in groups)

    @classmethod
    def fromSpec (cls, spec, uuid):
        if uuid is None or spec is None:
            return None
        acc = spec.get("account")
        if acc is None:
            return None

        return cls(acc, uuid, spec["principal"])

    def reconcile (self):
        log(f"Reconcile account {self}")
        self.reconcile_configdb()
        self.reconcile_auth()

    def reconcile_configdb (self):
        cdb = kk_ctx().fplus.configdb

        # If we don't have a class we aren't managing this object in the
        # ConfigDB. Someone else (the manager perhaps) is doing that.
        if self.klass is None:
            return

        if self.name is not None:
            cdb.patch_config(uuids.App.Info, self.uuid,
                { "name": self.name })

    def reconcile_auth (self):
        auth = kk_ctx().fplus.auth

        # XXX This is not atomic, but this is unavoidable with the
        # current auth service API.
        ids = auth.get_principal(self.uuid)
        if ids is not None and ids["kerberos"] == self.principal:
            log(f"Principal is already correct in auth service")
        else:
            log(f"Updating auth principal mapping for {self.uuid} to {self.principal}")
            if ids is not None:
                auth.delete_principal(self.uuid)
            auth.add_principal(self.uuid, kerberos=self.principal)

        for grp in self.groups:
            log(f"Adding {self.uuid} to {grp}")
            auth.add_to_group(grp, self.uuid)

    def remove (self, new):
        log(f"Maybe remove account: {self} -> {new}")
        fp = kk_ctx().fplus

        if new is None or self.uuid != new.uuid:
            log(f"Removing principal mapping for {self.uuid}")
            try:
                fp.auth.delete_principal(self.uuid)
            except ServiceError as err:
                if err.status != 404:
                    raise

            for grp in self.groups:
                log(f"Removing {self.uuid} from {grp}")
                fp.auth.remove_from_group(grp, self.uuid)
        else:
            for grp in self.groups - new.groups:
                log(f"Removing {self.uuid} from {grp}")
                fp.auth.remove_from_group(grp, self.uuid)

