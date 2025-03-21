# Factory+ Python client library
# ConfigDB interface
# Copyright 2023 AMRC

import  logging
from    uuid                import UUID

from .service_interface     import ServiceInterface
from ..                     import uuids

log = logging.getLogger(__name__)

class ConfigDB (ServiceInterface):
    def __init__ (self, fplus, **kw):
        super().__init__(fplus, **kw);

        self.service = uuids.Service.ConfigDB

    def get_config (self, app, obj):
        st, json = self.fetch(f"v1/app/{app}/object/{obj}")
        if st == 404:
            return
        if st != 200:
            self.error(f"Can't get {app} for {obj}", st)
        return json

    def put_config (self, app, obj, json):
        st, _ = self.fetch(
            method="PUT",
            url=f"v1/app/{app}/object/{obj}",
            json=json)
        if st == 204:
            return False
        if st == 201:
            return True
        self.error(f"Can't set {app} for {obj}", st)

    def patch_config (self, app, obj, patch):
        st, _ = self.fetch(
            method="PATCH",
            url=f"v1/app/{app}/object/{obj}",
            content_type="application/merge-patch+json",
            json=patch)
        if st == 204:
            return
        self.error(f"Can't patch {app} for {obj}", st)

    def delete_config (self, app, obj):
        st, _ = self.fetch(
            method="DELETE",
            url=f"v1/app/{app}/object/{obj}")
        if st == 204:
            return
        self.error(f"Can't remove {app} for {obj}", st)

    def create_object (self, klass, obj=None, excl=False):
        req = { "class": str(klass) }
        if obj is not None:
            req["uuid"] = str(obj)

        st, json = self.fetch(
            method="POST",
            url="v1/object",
            json=req)

        if st == 200 and excl:
            self.error(f"Exclusive create of {obj} failed", st)
        if st == 201 or st == 200:
            return UUID(json["uuid"])
        if obj is None:
            self.error(f"Creating new {klass} failed", st)
        else:
            self.error(f"Creating {obj} of {klass} failed", st)

    def _class_list (self, rel, klass):
        url = f"v2/class/{klass}/{rel}"
        st, uuids = self.fetch(url)
        if st == 200:
            return [UUID(u) for u in uuids]
        self.error(f"Can't list {rel} for {klass}", st)

    def class_members (self, klass):
        return self._class_list("member", klass)
    def class_subclasses (self, klass):
        return self._class_list("subclass", klass)
    def class_direct_members (self, klass):
        return self._class_list("direct/member", klass)
    def class_direct_subclasses (self, klass):
        return self._class_list("direct/subclass", klass)

    def _class_has (self, rel, klass, obj):
        url = f"v2/class/{klass}/{rel}/{obj}"
        st, _ = self.fetch(url)
        if st == 204:
            return True
        if st == 404:
            return False
        self.error(f"Can't check {rel} for {klass}", st)

    def class_has_member (self, klass, obj):
        return self._class_has("member", klass, obj)
    def class_has_subclass (self, klass, obj):
        return self._class_has("subclass", klass, obj)
    def class_has_direct_member (self, klass, obj):
        return self._class_has("direct/member", klass, obj)
    def class_has_direct_subclass (self, klass, obj):
        return self._class_has("direct/subclass", klass, obj)

    def _class_op (self, method, rel, klass, obj):
        url = f"v2/class/{klass}/direct/{rel}/{obj}"
        st, _ = self.fetch(method=method, url=url)
        if st == 204:
            return
        if method == "PUT":
            self.error(f"Adding {rel} {obj} to {klass} failed", st)
        else:
            self.error(f"Removing {rel} {obj} from {klass} failed", st)

    def class_add_member (self, klass, obj):
        return self._class_op("PUT", "member", klass, obj)
    def class_remove_member (self, klass, obj):
        return self._class_op("DELETE", "member", klass, obj)
    def class_add_subclass (self, klass, obj):
        return self._class_op("PUT", "subclass", klass, obj)
    def class_remove_subclass (self, klass, obj):
        return self._class_op("DELETE", klass, obj)

