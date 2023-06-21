# Factory+ Python client library
# Edge Deployment service interface
# Copyright 2023 AMRC

from    dataclasses         import dataclass, field
import  logging

from .service_interface     import ServiceInterface
from ..                     import uuids

log = logging.getLogger(__name__)

@dataclass
class SecretUrl:
    cluster: str
    namespace: str
    name: str
    key: str
    dryrun: bool = field(default=False)

    @property
    def path (s):
        return f"{s.namespace}/{s.name}/{s.key}"

    @property
    def params (s):
        return {
            "url": f"v1/cluster/{s.cluster}/secret/{s.path}",
            "params": { "dryrun": "true" if s.dryrun else None },
        };

class EdgeDeployment (ServiceInterface):
    def __init__ (self, fplus, **kw):
        super().__init__(fplus, **kw);

        self.service = uuids.Service.EdgeDeployment

    def seal_secret (self, content, **kw):
        url = SecretUrl(**kw)
        st, _ = self.fetch(method="PUT", data=content, **url.params)
        if st != 204:
            self.error(f"Can't seal secret {url.path}", st)

    def delete_secret (self, **kw):
        url = SecretUrl(**kw)
        st, _ = self.fetch(method="DELETE", **url.params)
        if st == 404:
            return False
        if st == 204:
            return True
        self.error(f"Can't delete secret {url.path}", st)
