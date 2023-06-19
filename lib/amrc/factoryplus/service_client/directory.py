# Factory+ Python client library
# Directory interface
# Copyright 2023 AMRC

import logging

from .service_error         import ServiceError
from .service_interface     import ServiceInterface
from ..                     import uuids

log = logging.getLogger(__name__)

class Directory (ServiceInterface):
    def __init__ (self, fplus, **kw):
        super().__init__(fplus, **kw);

        self.service = uuids.Service.Directory

    def get_service_urls (self, service):
        st, specs = self.fetch(f"v1/service/{service}")
        if st == 404:
            log.warning(f"Can't find service {service}: {st}")
            return []
        if st != 200:
            raise ServiceError(f"Can't get service records for {service}",
                service=self.service, status=st)
        return [s["url"] for s in specs if s["url"] is not None];

    def register_service_url (self, service, url):
        st, _ = self.fetch(method="POST",
            url=f"v1/service/{service}/advertisment",
            json={ url: url })
        if st != 204:
            raise ServiceError(f"Can't register service {service}",
                service=self.service, status=st)
        log.info("Registered {url} for {service}")
