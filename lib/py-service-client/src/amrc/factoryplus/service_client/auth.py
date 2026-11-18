# Factory+ Python client library
# Auth interface
# Copyright 2023 AMRC

import  logging
from    uuid                import UUID
from    urllib.parse        import quote as urlquote

from .service_interface     import ServiceInterface
from ..                     import uuids

log = logging.getLogger(__name__)

class Auth (ServiceInterface):
    def __init__ (self, fplus, **kw):
        super().__init__(fplus, **kw);

        self.service = uuids.Service.Authentication

    def get_principal (self, uuid):
        st, json = self.fetch(f"v2/principal/{uuid}")
        if st == 404:
            return
        if st != 200:
            self.error(f"Can't fetch principal {uuid}", st)
        return json

    def find_principal (self, kind, name):
        quoted = urlquote(name, safe="")
        st, uuid = self.fetch(f"v2/identity/{kind}/{quoted}")
        if st == 200:
            return UUID(uuid)
        if st == 404:
            return None
        self.error(f"Can't search for {kind} identity {name}", st)

    def fetch_acl (self, type, principal):
        """Fetch the ACL for a principal.

        @param type The identity type, `kerberos` or `uuid`.
        @param principal The principal identity.
        @returns A list of {permission, target} dicts.
        """
        url = f"v2/acl/{principal}" if type == "uuid" \
            else f"v2/acl/{type}/{urlquote(principal, safe='')}"
        st, acl = self.fetch(url)
        if st != 200:
            self.error(f"Can't fetch ACL for {type} {principal}", st)
        return [
            {"permission": UUID(ace["permission"]), "target": UUID(ace["target"])}
            for ace in acl
        ]

    def check_acl (self, principal, permission, target, wild):
        """Check whether a principal has a given permission.

        @param principal The principal UUID to check.
        @param permission The permission UUID to check.
        @param target The target UUID to check.
        @param wild Whether to accept Wildcard targets.
        @returns A boolean: permitted or not.
        """
        acl = self.fetch_acl("uuid", principal)
        return any(
            ace["permission"] == permission
            and (ace["target"] == target
                or (wild and ace["target"] == uuids.Null))
            for ace in acl)

    def add_identity (self, uuid, kind, name):
        st, _ = self.fetch(
            method="PUT",
            url=f"v2/principal/{uuid}/{kind}",
            json=name)
        if st == 204:
            return
        self.error(f"Can't set {kind} identity for {uuid}", st)

    def delete_identity (self, uuid, kind):
        st, _ = self.fetch(
            method="DELETE",
            url=f"v2/principal/{uuid}/{kind}")
        if st == 204:
            return
        self.error(f"Can't delete {kind} identity for {uuid}", st)
