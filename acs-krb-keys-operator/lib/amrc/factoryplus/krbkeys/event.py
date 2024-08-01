# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator
# Event class
# Copyright 2023 AMRC

import  logging

from    optional    import Optional

from .account       import FPAccount
from .context       import kk_ctx
from .spec          import InternalSpec, LocalSpec
from .util          import Identifiers, dslice, log

class KrbKeyEvent:
    def __init__ (self, args):
        self.ns, self.name, self.reason = dslice(args, "namespace", "name", "reason")
        self.annotations, self.patch = dslice(args, "annotations", "patch")

    def process (self):
        raise NotImplementedError()

class Rekey (KrbKeyEvent):
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
        if status.has_old:
            p_meta.labels[Identifiers.HAS_OLD_KEYS] = "true"

class TrimKeys (KrbKeyEvent):
    def __init__ (self, args):
        super().__init__(args)
        self.spec = InternalSpec(event=self, spec=args["spec"])

    def process (self):
        status = self.spec.trim_keys()

        if not status.has_old:
            self.patch.metadata.labels[Identifiers.HAS_OLD_KEYS] = None

# This class handles UUIDs as strings throughout. This makes the
# annotation handling easier.
class AccUuid (KrbKeyEvent):
    def __init__ (self, args):
        super().__init__(args)

        self.account = args["spec"].get("account")

    def process (self):
        if self.reason == "delete":
            return
        if self.account is None:
            log("No account")
            return

        key = Identifiers.ACCOUNT_UUID
        p_annot = self.patch.metadata.annotations

        annot = self.annotations.get(key)
        spec = self.account.get("uuid")
        klass = self.account.get("class")

        # If you do this it's your problem to sort out the mess.
        if annot is not None and spec is not None and annot != spec:
            log(f"Account UUID has changed: {annot} -> {spec}",
                level=logging.WARNING)

        if klass is None:
            # We are not managing this object.
            log(f"Account is unmanaged. Using UUID {spec}.")
            p_annot[key] = spec
        elif annot is None:
            # We are managing this object. We need to make sure that if
            # the object creation succeeds, the annotation will be
            # recorded. Otherwise we keep creating ConfigDB objects.
            log(f"Creating new account in class {klass}")
            cdb = kk_ctx().fplus.configdb
            uuid = cdb.create_object(klass, spec)
            log(f"Created new account {uuid}")
            p_annot[key] = str(uuid)
        elif spec is not None and annot != spec:
            # This should not normally happen. Probably someone has
            # added an explicit uuid field to an object with a class.
            # Perhaps I should just forbid explicit uuids if we are
            # managing the object?
            log(f"Annotation exists but is overridden to {spec}")
            p_annot[key] = spec
        else:
            log(f"Annotation should be correct: {annot}")

class Account (KrbKeyEvent):
    def __init__ (self, args):
        super().__init__(args)

        deleting = self.reason == "delete"

        uuid = self.annotations.get(Identifiers.ACCOUNT_UUID)
        def mkacc (key):
            return Optional.of(args.get(key)) \
                .map(lambda ob: ob.get("spec")) \
                .map(lambda spec: FPAccount.fromSpec(spec, uuid)) \
                .get_or_default(None)

        # When we are resuming, old and new will usually be identical,
        # unless a previous reconciliation has failed. When we are
        # deleting we are passed the deleted object as both old and new
        # (unhelpful...).
        self.old = mkacc("old")
        self.new = None if deleting else mkacc("new")

        if uuid is None and self.new is not None:
            raise ValueError(f"Account UUID is not set yet")

    def process (self):
        log(f"Process account reconciliation {self.old} -> {self.new}")

        if self.old is not None:
            self.old.remove(self.new)

        if self.new is not None:
            self.new.reconcile()

class LocalSecret (KrbKeyEvent):
    def __init__ (self, args):
        super().__init__(args)

        self.old = LocalSpec.of(self.ns, args.get("old"))
        self.new = Optional.of(self.reason) \
            .map(lambda r: None if r == "delete" else args.get("new")) \
            .flat_map(lambda a: LocalSpec.of(self.ns, a))

    def process (self):
        log(f"Process LocalSecret {self.old} -> {self.new}")

        self.old.if_present(lambda s: s.remove())
        self.new.if_present(lambda s: s.update())

