# Factory+ Python client library
# ConfigDB interface
# Copyright 2023 AMRC

import logging

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
            return
        self.error(f"Can't set {app} for {obj}", st)

    def delete_config (self, app, obj):
        st, _ = self.fetch(
            method="DELETE",
            url=f"v1/app/{app}/object/{obj}")
        if st == 204:
            return
        self.error(f"Can't remove {app} for {obj}", st)

    def create_object (klass, obj, excl):
        st, json = self.fetch(
            method="POST",
            url="v1/object",
            json={ "class": klass, "uuid": obj })

        if st == 200 and excl:
            self.error(f"Exclusive create of {obj} failed", st)
        if st == 201 or st == 200:
            return json.uuid
        if obj is None:
            self.error(f"Creating new {klass} failed")
        else:
            self.error(f"Creating {obj} failed")

    def delete_object (obj):
        st, _ = self.fetch(
            method="DELETE",
            url=f"v1/object/{obj}")
        if st == 204:
            return
        self.error(f"Deleting {obj} failed")
