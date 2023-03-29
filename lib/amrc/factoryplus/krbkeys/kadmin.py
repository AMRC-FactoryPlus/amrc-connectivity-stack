# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator

# Kerberos admin class

import  logging
from    tempfile    import TemporaryDirectory

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

    def create_keytab (self, princs):
        # Create a temp dir, since ktadd insists on creating the file
        # itself.
        with TemporaryDirectory() as ktdir:
            keytab = f"{ktdir}/keytab"
            for princ in princs:
                kpr = self.kadm.getprinc(princ)
                kpr.ktadd(keytab)
                # Reload because ktadd will update the kvno. kpr.reload
                # doesn't seem to work (??).
                kpr = self.kadm.getprinc(princ)
                self.log(f"Created {princ} kvno {kpr.kvno}")
            with open(keytab, "rb") as fh:
                return fh.read()

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

