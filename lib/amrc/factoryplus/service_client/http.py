# Factory+ Python client library
# HTTP client
# Copyright 2023 AMRC

import logging

from requests.auth      import HTTPBasicAuth
from requests_cache     import CachedSession
from requests_kerberos  import HTTPKerberosAuth

from .service_interface     import ServiceInterface

log = logging.getLogger(__name__)

class HTTP (ServiceInterface):
    def __init__ (self, fplus, **kw):
        super().__init__(fplus, **kw);

        self.session = CachedSession(backend="memory", cache_control=True)
        self.tokens = {}
        self.cache = "default"

        if "username" in fplus.opts:
            self.auth = HTTPBasicAuth(
                fplus.opts["username"], fplus.opts["password"])
        else:
            # Our services don't return WWW-Auth: Nego yet as it breaks
            # browser requesets.
            self.auth = HTTPKerberosAuth(force_preemptive=True)

    def gss_fetch (self, **opts):
        return self.session.request(**opts, auth=self.auth)
