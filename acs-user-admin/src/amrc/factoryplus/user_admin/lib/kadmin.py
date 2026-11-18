# Factory+ User Admin service
# Kerberos admin class
# Copyright 2026 University of Sheffield

import  logging

import  kadmin

log = logging.getLogger(__name__)

class PrincipalExists (Exception):
    """The principal is already in the KDC database."""

class Kadm:
    """A create-only wrapper around python-kadmV. This service must
    never change a principal that already exists, so there is no
    find-or-create and no change-password here."""

    def __init__ (self, kadm=None, ccache=None):
        if kadm is None:
            self.kadm = kadmin.init_with_ccache(None, ccache)
        else:
            self.kadm = kadm

    def create_princ (self, princ, password):
        """Create a new principal with the given password.

        Raises PrincipalExists if the KDC already has this principal.
        The create is a single kadmin call, so a principal is never
        left behind without its password.

        @returns The principal name as the KDC recorded it.
        """
        kadm = self.kadm

        if kadm.principal_exists(princ):
            raise PrincipalExists(princ)

        log.info(f"Creating principal {princ}")
        try:
            kadm.addprinc(princ, password)
        except kadmin.DuplicateError:
            # Another request created it between the check and the
            # create.
            raise PrincipalExists(princ)

        return kadm.getprinc(princ).principal
