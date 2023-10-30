# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator
# Internal spec class
# Copyright 2023 AMRC

import  typing
from    uuid        import UUID

from    optional    import Optional

from    amrc.factoryplus    import ServiceError, uuids

from    .context    import kk_ctx
from    .util       import fields, immutable, log

@immutable
class ACE:
    permission: UUID
    target: UUID

    @classmethod
    def of (cls, spec):
        return cls(
            permission=UUID(spec["permission"]),
            target=UUID(spec["target"]))

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

        self.klass = Optional.of(spec.get("class")) \
            .map(lambda u: UUID(u)) \
            .get_or_default(None)

        self.name = spec.get("name")

        groups = spec.get("groups", []);
        self.groups = set(UUID(g) for g in groups)

        aces = spec.get("aces", []);
        self.aces = set(ACE.of(a) for a in aces)

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
                { "name": self.name, "deleted": None })

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
            log(f"Adding {self.uuid} to group {grp}")
            auth.add_to_group(grp, self.uuid)

        for ace in self.aces:
            log(f"Granting {self.uuid} ACE {ace}")
            auth.add_ace(self.uuid, ace.permission, ace.target)

    def remove (self, new):
        if new is None:
            new = FPAccount({}, None, None)

        fp = kk_ctx().fplus

        if self.uuid != new.uuid:
            log(f"Removing principal mapping for {self.uuid}")
            ServiceError.catch((404,), lambda:
                fp.auth.delete_principal(self.uuid))

            if self.klass is not None:
                ServiceError.catch((404,), lambda:
                    fp.configdb.patch_config(uuids.App.Info, self.uuid,
                        { "deleted": True }))
            
        for grp in self.groups - new.groups:
            log(f"Removing {self.uuid} from group {grp}")
            fp.auth.remove_from_group(grp, self.uuid)

        for ace in self.aces - new.aces:
            log(f"Revoking {self.uuid} ACE {ace}")
            fp.auth.delete_ace(self.uuid, ace.permission, ace.target)
