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
            self.basic = HTTPBasicAuth(
                fplus.opts["username"], fplus.opts["password"])
        else:
            self.basic = None

    def fetch_with_creds (self, **opts):
        if self.basic is not None:
            auth = self.basic
        else:
            # Our services don't return WWW-Auth: Nego yet as it breaks
            # browser requests.
            auth = HTTPKerberosAuth(force_preemptive=True)

        return self.session.request(**opts, auth=auth)
