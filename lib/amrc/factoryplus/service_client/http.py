# Factory+ Python client library
# HTTP client
# Copyright 2023 AMRC

import logging

import requests
from requests_kerberos import HTTPKerberosAuth

from .service_interface     import ServiceInterface

log = logging.getLogger(__name__)

class HTTP (ServiceInterface):
    def __init__ (self, fplus, **kw):
        super().__init__(fplus, **kw);

        # Our services don't return WWW-Auth: Nego yet as it breaks
        # browser requesets.
        self.krb = HTTPKerberosAuth(force_preemptive=True)
        self.tokens = {}
        self.cache = "default"

    def gss_fetch (self, **opts):
        return requests.request(**opts)
