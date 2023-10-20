# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator
# Event class
# Copyright 2023 AMRC

import  logging

from .spec          import InternalSpec
from .util          import Identifiers, dslice, log

class KrbKeyEvent:
    def __init__ (self, args):
        self.ns, self.name, self.reason = dslice(args, "namespace", "name", "reason")
        self.annotations, self.patch = dslice(args, "annotations", "patch")

    def process (self):
        raise NotImplementedError()

class RekeyEvent (KrbKeyEvent):
    def __init__ (self, args):
        super().__init__(args)

        old, new = dslice(args, "old", "new")

        self.old = None if old is None \
            else InternalSpec(event=self, spec=old["spec"])
        self.new = None if new is None or self.reason == "delete" \
            else InternalSpec(event=self, spec=new["spec"])

    def rekey_needed (self):
        if self.new != self.old:
            return True

        if self.reason != "resume":
            log("No change")
            return False

        if not self.new.can_verify():
            log("Cannot verify current key")
            return False

        return True

    def process (self):
        force = Identifiers.FORCE_REKEY in self.annotations

        if not force and not self.rekey_needed():
            return

        if self.old is not None:
            self.old.remove(self.new)

        if self.new is None or self.new.disabled:
            return
        
        status = self.new.reconcile(force=force)

        p_meta = self.patch.metadata
        p_meta.annotations[Identifiers.FORCE_REKEY] = None
        if status.has_old_keys:
            p_meta.labels[Identifiers.HAS_OLD_KEYS] = "true"
        if status.account_uuid is not None:
            p_meta.annotations[Identifiers.ACCOUNT_UUID] = str(status.account_uuid)

class TrimKeysEvent (KrbKeyEvent):
    def __init__ (self, args):
        super().__init__(args)
        self.spec = InternalSpec(event=self, spec=args["spec"])

    def process (self):
        status = self.spec.trim_keys()

        if not status.has_old:
            self.patch.metadata.labels[Identifiers.HAS_OLD_KEYS] = None
