# Factory+ Python client library
# HTTP client
# Copyright 2023 AMRC

import logging
import urllib.parse     as urls

from requests           import HTTPError
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
            log.info("Using HTTP Basic auth")
            self.basic = HTTPBasicAuth(
                fplus.opts["username"], fplus.opts["password"])
        else:
            log.info("Using HTTP Negotiate auth")
            self.basic = None

    def fetch_with_token (self, host, **opts):
        headers = opts.get("headers", {})

        tok = None
        def try_req ():
            nonlocal tok
            tok = self.service_token(host, tok)
            with_auth = headers | { "Authorization": f"Bearer {tok}" }
            return self._fetch(**opts, headers=with_auth)

        res = try_req()
        if res.status_code == 401:
            res = try_req()

        return res

    def service_token (self, host, bad=None):
        tok = self.tokens.get(host)

        if tok is None or tok == bad:
            tok = self.fetch_token(host)
            self.tokens[host] = tok

        return tok

    def fetch_token (self, host):
        if self.basic is not None:
            auth = self.basic
        else:
            # Our services don't return WWW-Auth: Nego yet as it breaks
            # browser requests.
            auth = HTTPKerberosAuth(force_preemptive=True)

        res = self._fetch(
            url=urls.urljoin(host, "/token"),
            method="POST",
            auth=auth, force_refresh=True)

        if res.ok:
            return res.json()["token"]

        raise HTTPError(
            f"Can't fetch token for {host}: {res.status_code}",
            response=res)

    def _fetch (self, **opts):
        log.debug(f"Fetch: {opts!r}")
        return self.session.request(**opts)
