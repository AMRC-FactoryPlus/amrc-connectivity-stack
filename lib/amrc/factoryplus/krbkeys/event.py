# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator
# Event class
# Copyright 2023 AMRC

import  logging

from .spec          import InternalSpec
from .util          import Identifiers, dslice, log

FORCE_REKEY = f"{Identifiers.APPID}/force-rekey"

class KrbKeyEvent:
    def __init__ (self, args):
        self.ns, self.name = dslice(args, "namespace", "name")
        self.annot, self.patch = dslice(args, "annotations", "patch")

        old, new, reason = dslice(args, 
            "old", "new", "reason")

        self.old = None if old is None \
            else InternalSpec(event=self, spec=old["spec"])
        self.new = None if new is None or reason == "delete" \
            else InternalSpec(event=self, spec=new["spec"])

    def process (self):
        if self.old is not None:
            self.old.remove(self.new)

        if self.new is None:
            return

        if self.new.disabled:
            log("Key is disabled")
            return
        
        force = FORCE_REKEY in self.annot
        self.new.reconcile_key(force=force)
        self.patch.metadata.annotations[FORCE_REKEY] = None
