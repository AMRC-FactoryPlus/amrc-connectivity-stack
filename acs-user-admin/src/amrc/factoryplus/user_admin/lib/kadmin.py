# Factory+ User Admin service
# Kerberos admin class
# Copyright 2026 University of Sheffield

import  logging

import  krb5
import  kadmin

log = logging.getLogger(__name__)

class Kadm:
    def __init__ (self, kadm=None, ccache=None):
        if kadm is None:
            self.kadm = kadmin.init_with_ccache(None, ccache)
        else:
            self.kadm = kadm

    def find_princ (self, princ):
        kadm = self.kadm

        if not kadm.principal_exists(princ):
            log.info(f"Creating principal {princ}")
            kadm.addprinc(princ, None)

        return kadm.getprinc(princ)

    def enable_princ (self, princ):
        kpr = self.find_princ(princ)

        if kadmin.DISALLOW_ALL_TIX in kpr.attributes:
            log.info(f"Enabling principal {princ}")
            # Why this needs to be a tuple I don't know. I suspect it's a
            # bug in python-kadmV.
            kpr.unset_flags((kadmin.DISALLOW_ALL_TIX,))
            kpr.commit()

    def disable_princ (self, princ):
        if not self.kadm.principal_exists(princ):
            log.info(f"Can't disable non-existent principal {princ}!")
            return
        log.info(f"Disabling principal {princ}")
        kpr = self.kadm.getprinc(princ)
        kpr.set_flags(kadmin.DISALLOW_ALL_TIX)
        kpr.commit()

    def create_keytab (self, princs, keytab):
        kvnos = {}
        for princ in princs:
            kpr = self.find_princ(princ)
            kpr.ktadd(keytab)
            # Reload because ktadd will update the kvno. kpr.reload
            # doesn't seem to work (??).
            kpr = self.kadm.getprinc(princ)
            log.info(f"Created {princ} kvno {kpr.kvno}")
            kvnos[princ] = { "kvno": kpr.kvno }

        return kvnos

    def princ_in_keytab (self, princ, keytab):
        # We always do find_princ because we always want the princpal to
        # exist.
        kpr = self.find_princ(princ)
        log.info(f"Searching for {kpr.principal} kvno {kpr.kvno} in {keytab}")

        ctx = krb5.init_context()
        kt = krb5.kt_resolve(ctx, keytab.encode())
        pr = krb5.parse_name_flags(ctx, kpr.principal.encode(), 0)
        try:
            krb5.kt_get_entry(ctx, kt, pr, kpr.kvno)
            log.info("Keytab entry found")
            return True
        except:
            log.info("Keytab entry not found")
            return False

    def key_info (self, princ):
        kpr = self.kadm.getprinc(princ)
        if kpr is None:
            return None

        return {
            'kvno':     kpr.kvno,
            'etypes':   [":".join(et) for et in kpr.keys[kpr.kvno]],
        }

    def set_password (self, princ, password):
        kpr = self.find_princ(princ)
        kpr.change_password(password)
        return self.key_info(princ)

    # For now we cannot set the etype, as kadmV doesn't map the required
    # function. So just check we end up with it right.
    def set_trust_key (self, princ, info, passwd):
        kvno = info['kvno']

        kpr = self.find_princ(princ)
        kpr.change_password(passwd)
        kpr.kvno = kvno
        kpr.commit()
        log.info(f"Created trust principal {princ} kvno {kvno}")

        kpr = self.kadm.getprinc(princ)
        keys = kpr.keys
        if len(keys) != 1 or kvno not in keys:
            raise RuntimeError(f"Incorrect kvno for trust {princ}")

        want_etypes = sorted(info['etypes'])
        have_etypes = sorted([":".join(et) for et in keys[kvno]])
        if have_etypes != want_etypes:
            raise RuntimeError(f"Incorrect etypes for trust {princ}")
