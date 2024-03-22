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

    def add_principal (self, uuid, kerberos=None):
        json = { "uuid": str(uuid) }
        if kerberos is not None:
            json["kerberos"] = str(kerberos)

        st, _ = self.fetch(
            method="POST",
            url=f"authz/principal",
            json=json)
        if st == 204:
            return
        self.error(f"Can't create principal {json}", st)

    def delete_principal (self, uuid):
        st, _ = self.fetch(
            method="DELETE",
            url=f"authz/principal/{uuid}")
        if st == 204:
            return
        self.error(f"Can't delete principal {uuid}", st)

    def add_to_group (self, group, member):
        st, _ = self.fetch(
            method="PUT",
            url=f"authz/group/{group}/{member}")
        if st == 204:
            return
        self.error(f"Can't add {member} to {group}", st)

    def remove_from_group (self, group, member):
        st, _ = self.fetch(
            method="DELETE",
            url=f"authz/group/{group}/{member}")
        if st == 204:
            return
        self.error(f"Can't remove {member} from {group}", st)

    # This API endpoint is awful.
    
    def add_ace (self, principal, permission, target):
        st, _ = self.fetch(
            method="POST",
            url=f"authz/ace",
            json={
                "action": "add",
                "principal": str(principal),
                "permission": str(permission),
                "target": str(target),
            })
        if st == 204:
            return
        self.error(f"Can't add ACE {principal},{permission},{target}", st)
    
    def delete_ace (self, principal, permission, target):
        st, _ = self.fetch(
            method="POST",
            url=f"authz/ace",
            json={
                "action": "delete",
                "principal": str(principal),
                "permission": str(permission),
                "target": str(target),
            })
        if st == 204:
            return
        self.error(f"Can't add ACE {principal},{permission},{target}", st)
