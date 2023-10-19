# Factory+ Python client library
# Auth interface
# Copyright 2023 AMRC

import  logging
from    uuid                import UUID

from .service_interface     import ServiceInterface
from ..                     import uuids

log = logging.getLogger(__name__)

class Auth (ServiceInterface):
    def __init__ (self, fplus, **kw):
        super().__init__(fplus, **kw);

        self.service = uuids.Service.Authentication

    def get_principal (self, uuid):
        st, json = self.fetch(f"authz/principal/{uuid}")
        if st == 404:
            return
        if st != 200:
            self.error(f"Can't fetch principal {uuid}", st)
        return json

    def add_principal (self, identities):
        st, _ = self.fetch(
            method="POST",
            url=f"authz/principal",
            json=identities)
        if st == 204:
            return
        self.error(f"Can't create principal {identities}", st)

    def delete_principal (self, uuid):
        st, _ = self.fetch(
            method="DELETE",
            url=f"authz/principal/{uuid}")
        if st == 204:
            return
        self.error(f"Can't delete principal {uuid}", st)
