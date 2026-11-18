# Factory+ User Admin service
# UUID constants pending the Factory+ bootstrap for this service
# Copyright 2026 University of Sheffield

from uuid import UUID

class Perm:
    # Minted here first; carry this exact value over to
    # UserAdmin.Perm.ManageUsers in acs-service-setup/lib/uuids.js when
    # the Factory+ bootstrap for this service is wired up.
    ManageUsers = UUID("d4a080f8-eca7-4063-b22a-a6f14a4721eb")
