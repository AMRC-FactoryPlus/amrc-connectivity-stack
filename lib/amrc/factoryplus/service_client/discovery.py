# Factory+ Python client library
# Service discovery
# Copyright 2023 AMRC

import logging

from .service_interface     import ServiceInterface
from ..                     import uuids

log = logging.getLogger(__name__)

presets = [
    ("directory_url",       uuids.Service.Directory),
    ("configdb_url",        uuids.Service.ConfigDB),
    ("authn_url",           uuids.Service.Authentication),
];

class Discovery:
    def __init__ (self, fplus):
        self.fplus = fplus

        self.urls = {}
        for key, srv in presets:
            if key in fplus.opts:
                self.set_service_url(srv, fplus.opts[key])
        
    def set_service_url (self, service, url):
        log.info(f"Preset URL for {service}: {url}")
        self.urls[service] = url

    def service_url (self, service):
        return self.urls.get(service)
