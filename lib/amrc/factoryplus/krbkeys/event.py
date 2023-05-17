# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator
# Event class
# Copyright 2023 AMRC

import  logging

from .spec          import InternalSpec
from .util          import dslice, log

class KrbKeyEvent:
    def __init__ (self, op, args):
        self.op = op
        self.args = args
        self.rekey = False

        self.ns, self.name = dslice(args, "namespace", "name")

        old, new, reason, status = dslice(args, 
            "old", "new", "reason", "status")
        self.reason = reason
        self.status = status.get("handle_event")

        self.old = None if old is None \
            else InternalSpec(event=self, spec=old["spec"])
        self.new = None if new is None or reason == "delete" \
            else InternalSpec(event=self, spec=new["spec"])

    def process (self):
        log("Event: reason %r, old %r, new %r" %
            (self.reason, self.old, self.new))

        if self.old == self.new:
            log("No change")
            return

        if self.old is not None:
            self.old.remove(self.new)

        if self.new is None:
            return

        if self.new.disabled:
            log("Key is disabled")
            return

        return self.new.reconcile_key(self.status)
