# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator
# Event class
# Copyright 2023 AMRC

import  logging

from .spec          import InternalSpec
from .util          import Identifiers, dslice, log

class KrbKeyEvent:
    def __init__ (self, args):
        self.ns, self.name = dslice(args, "namespace", "name")
        self.annotations, self.patch = dslice(args, "annotations", "patch")

        old, new, reason = dslice(args, "old", "new", "reason")

        self.reason = reason
        self.old = None if old is None \
            else InternalSpec(event=self, spec=old["spec"])
        self.new = None if new is None or reason == "delete" \
            else InternalSpec(event=self, spec=new["spec"])

    def process (self):
        force = Identifiers.FORCE_REKEY in self.annotations

        if not force and self.new == self.old:
            if self.reason != "resume":
                log("No change")
                return
            if not self.new.can_verify():
                log("Cannot verify current key")
                return

        if self.old is not None:
            self.old.remove(self.new)

        if self.new is None or self.new.disabled:
            return
        
        status = self.new.reconcile_key(force=force)

        p_meta = self.patch.metadata
        p_meta.annotations[Identifiers.FORCE_REKEY] = None
        if status.has_old:
            p_meta.labels[Identifiers.HAS_OLD_KEYS] = "true"
