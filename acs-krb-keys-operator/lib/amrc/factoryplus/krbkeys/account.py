# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator
# Internal spec class
# Copyright 2023 AMRC

import  logging
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

@immutable
class SparkplugAddress:
    group: Optional
    node: str

    @classmethod
    def of (cls, spec):
        if spec is None:
            return None
        return cls(
            group=Optional.of(spec.get("group")),
            node=spec["node"])

@fields
class FPAccount:
    principal: str
    uuid: UUID
    klass: UUID
    name: str | None
    groups: set[UUID]
    sparkplug: SparkplugAddress

    def __init__ (self, spec, uuid, principal):
        self.uuid = uuid
        self.principal = principal

        self.klass = Optional.of(spec.get("class")) \
            .map(lambda u: UUID(u)) \
            .get_or_default(None)

        self.name = spec.get("name")

        groups = spec.get("groups", []);
        self.groups = set(UUID(g) for g in groups)

        #aces = spec.get("aces", [])
        #self.aces = set(ACE.of(a) for a in aces)
        self.aces = "aces" in spec

        self.sparkplug = SparkplugAddress.of(spec.get("sparkplug", None))

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

        # Always set the object live
        cdb.patch_config(uuids.App.Registration, self.uuid,
            { "deleted": False });

        # We set whatever information we are given.
        if self.name is not None:
            cdb.patch_config(uuids.App.Info, self.uuid,
                { "name": self.name, "deleted": None })

        # We are always managing the Sparkplug address if it's requested
        if self.sparkplug is not None:
            group = self.sparkplug.group \
                .or_else(lambda: kk_ctx().operator.cluster_group \
                    # Grr, Python's Optional doesn't have .or
                    .get_or_default(None)) \
                .get_or_raise(ValueError(f"No cluster group for {self.uuid}"))
            addr = { "group_id": group, "node_id": self.sparkplug.node }

            log(f"Giving {self.uuid} address {addr}")
            cdb.put_config(uuids.App.SparkplugAddress, self.uuid, addr);

        # Groups are now ConfigDB class memberships.
        for grp in self.groups:
            log(f"Adding {self.uuid} to class {grp}")
            cdb.class_add_member(grp, self.uuid)

    def reconcile_auth (self):
        auth = kk_ctx().fplus.auth

        # This will silently succeed if the identity is already correct.
        # If there is a conflict we will throw 409 (and kopf will
        # retry). I think this is the best behaviour...
        auth.add_identity(self.uuid, "kerberos", self.principal)

        # I don't want to allow this; it will be much better to use
        # group membership and appropriate grants. But some explicit
        # grants are still necessary, so this may need reintroducing in
        # the future.
        if self.aces:
            log(f"Granting explicit ACEs is no longer supported",
                level=logging.WARNING)

        #for ace in self.aces:
        #    log(f"Granting {self.uuid} ACE {ace}")
        #    auth.add_ace(self.uuid, ace.permission, ace.target)

    def remove (self, new):
        if new is None:
            new = FPAccount({}, None, None)

        fp = kk_ctx().fplus

        if self.uuid != new.uuid:
            log(f"Removing principal mapping for {self.uuid}")
            ServiceError.catch((404,), lambda:
                fp.auth.delete_identity(self.uuid, "kerberos"))

            if self.klass is not None:
                ServiceError.catch((404,), lambda:
                    fp.configdb.patch_config(uuids.App.Registration, self.uuid,
                        { "deleted": True }))
            
        # This does not guarantee the account is no longer a member of
        # these groups; it may have derived membership. But that's not
        # our business.
        for grp in self.groups - new.groups:
            log(f"Removing {self.uuid} from group {grp}")
            fp.configdb.class_remove_member(grp, self.uuid)

#        for ace in self.aces - new.aces:
#            log(f"Revoking {self.uuid} ACE {ace}")
#            fp.auth.delete_ace(self.uuid, ace.permission, ace.target)

        if self.sparkplug != new.sparkplug:
            log(f"Removing {self.uuid} address {self.sparkplug}")
            ServiceError.catch((404,), lambda:
                fp.configdb.delete_config(uuids.App.SparkplugAddress, self.uuid))
