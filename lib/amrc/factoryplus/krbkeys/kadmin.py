# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator

# Kerberos admin class

import  logging
from    tempfile    import TemporaryDirectory, NamedTemporaryFile
import  time

import  krb5
import  kadmin

class Kadm:
    def __init__ (self, name, kadm=None):
        if kadm is None:
            self.kadm = kadmin.init_with_ccache()
        else:
            self.kadm = kadm

        self.log = lambda m: logging.info(f"{name}: {m}")

    def find_princ (self, princ):
        kadm = self.kadm

        if not kadm.principal_exists(princ):
            self.log(f"Creating principal {princ}")
            kadm.addprinc(princ, None)

        return kadm.getprinc(princ)

    def enable_princ (self, princ):
        kpr = self.find_princ(princ)

        if kadmin.DISALLOW_ALL_TIX in kpr.attributes:
            self.log(f"Enabling principal {princ}")
            # Why this needs to be a tuple I don't know. I suspect it's a
            # bug in python-kadmV.
            kpr.unset_flags((kadmin.DISALLOW_ALL_TIX,))
            kpr.commit()

    def disable_princ (self, princ):
        if not self.kadm.principal_exists(princ):
            self.log(f"Can't disable non-existent principal {princ}!")
            return
        self.log(f"Disabling principal {princ}")
        kpr = self.kadm.getprinc(princ)
        kpr.set_flags(kadmin.DISALLOW_ALL_TIX)
        kpr.commit()

    def create_keytab (self, princs, oldkt):
        # Create a temp dir, since ktadd insists on creating the file
        # itself.
        with TemporaryDirectory() as ktdir:
            keytab = f"{ktdir}/keytab"
            if oldkt:
                with open(keytab, "wb") as fh:
                    fh.write(oldkt)
            for princ in princs:
                kpr = self.kadm.getprinc(princ)
                kpr.ktadd(keytab)
                # Reload because ktadd will update the kvno. kpr.reload
                # doesn't seem to work (??).
                kpr = self.kadm.getprinc(princ)
                self.log(f"Created {princ} kvno {kpr.kvno}")
            with open(keytab, "rb") as fh:
                return fh.read()

    def trim_keytab (self, oldkt):
        with NamedTemporaryFile() as ktf:
            ktf.write(oldkt)
            ktf.seek(0, 0)

            ctx = krb5.init_context()
            kth = krb5.kt_resolve(ctx, f"FILE:{ktf.name}".encode())

            entries = list(kth)
            ckvno   = max((kte.kvno for kte in entries), default=-1)
            atrisk  = [kte for kte in entries if kte.kvno < ckvno]

            since = time.time() - 1800
            expired = [kte for kte in atrisk if kte.timestamp < since]
            more    = len(expired) < len(atrisk)

            for kte in expired:
                log(f"Removing {kte.principal} kvno {kte.kvno}")
                krb5.kt_remove_entry(ctx, kth, kte)
            del kth

            newkt = ktf.read() if expired else None
            return newkt, more

    def princ_in_keytab (self, princ, data):
        # We always do find_princ because we always want the princpal to
        # exist.
        kpr = self.find_princ(princ)

        if data is None:
            return False

        # We ought to be able to use MEMORY keytabs for this but how do we get the address from Python?
        with TemporaryDirectory() as ktdir:
            keytab = f"{ktdir}/keytab"
            with open(keytab, "wb") as fh:
                fh.write(data)
            
            ctx = krb5.init_context()
            kt = krb5.kt_resolve(ctx, f"FILE:{keytab}".encode())
            pr = krb5.parse_name_flags(ctx, kpr.principal.encode(), 0)
            try:
                krb5.kt_get_entry(ctx, kt, pr, kpr.kvno)
                return True
            except:
                return False

    def set_password (self, princ, password):
        kpr = self.kadm.getprinc(princ)
        kpr.change_password(password)

    def create_trust_key (self, princ, password):
        self.set_password(princ, password)
        kpr = self.kadm.getprinc(princ)
        return {
            'password': password,
            'kvno':     kpr.kvno,
            'etypes':   [":".join(et) for et in kpr.keys[kpr.kvno]],
        }

    # For now we cannot set the etype, as kadmV doesn't map the required
    # function. So just check we end up with it right.
    def set_trust_key (self, princ, data):
        kvno = data['kvno']

        kpr = self.kadm.getprinc(princ)
        kpr.change_password(data['password'])
        kpr.kvno = kvno
        kpr.commit()
        self.log(f"Created trust principal {princ} kvno {kvno}")

        kpr = self.kadm.getprinc(princ)
        keys = kpr.keys
        if len(keys) != 1 or kvno not in keys:
            raise RuntimeError(f"Incorrect kvno for trust {princ}")
        want_etypes = sorted(data['etypes'])
        have_etypes = sorted([":".join(et) for et in keys[kvno]])
        if have_etypes != want_etypes:
            raise RuntimeError(f"Incorrect etypes for trust {princ}")

