# Factory+ Python client library
# Service exceptions
# Copyright 2023 AMRC

from .. import uuids

names = {}
for name, uuid in uuids.Service.__dict__.items():
    names[uuid] = name

class ServiceError (Exception):
    def __init__ (self, *args, **kw):
        self.service = kw.pop("service") 
        self.status = kw.get("status")
        super().__init__(*args)

    def __str__ (self):
        srv = self.service
        if srv in names:
            srv = names[srv]
        msg = super().__str__()
        st = f": {self.status}" if self.status is not None else ""
        return f"{srv}: {msg}{st}"
