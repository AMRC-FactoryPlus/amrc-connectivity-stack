# Factory+ Python client library
# Edge Deployment service interface
# Copyright 2023 AMRC

import logging

from .service_error         import ServiceError
from .service_interface     import ServiceInterface
from ..                     import uuids

log = logging.getLogger(__name__)

class EdgeDeployment (ServiceInterface):
    def __init__ (self, fplus, **kw):
        super().__init__(fplus, **kw);

        self.service = uuids.Service.EdgeDeployment

    def seal_secret (self, cluster, namespace, name, key, content):
        st = self.fetch(method="PUT",
            url=f"v1/cluster/{cluster}/secret/{namespace}/{name}/{key}",
            data=content)
        if st != 204:
            raise ServiceError(f"Can't seal secret {namespace}/{name}/{key}",
                service=self.service, status=st)

    def delete_secret (self, cluster, namespace, name, key):
        st, _ = self.fetch(method="DELETE",
            url=f"v1/cluster/{cluster}/secret/{namespace}/{name}/{key}")
        if st != 204:
            raise ServiceError(f"Can't delete secret {namespace}/{name}/{key}",
                service=self.service, status=st)
