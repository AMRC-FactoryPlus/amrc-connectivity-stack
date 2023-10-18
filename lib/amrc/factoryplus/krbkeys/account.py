# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator
# Internal spec class
# Copyright 2023 AMRC

import  typing
from    uuid        import UUID

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

    def remove (self, new):
        log(f"Maybe remove account: {self} -> {new}")
        if new is not None and self.uuid == new.uuid:
            log("UUIDs match, ignoring")
            return
        log(f"Removing account {self.uuid}")
