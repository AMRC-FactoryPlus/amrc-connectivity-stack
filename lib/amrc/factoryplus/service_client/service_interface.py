# Factory+ Python client library
# Service interface
# Copyright 2023 AMRC

from email.message  import Message

from .service_error import ServiceError    

# Apparently this is the best way to do this...
def content_type (res):
    m = Message()
    m.set_default_type("application/octet-stream")
    ct = res.headers.get("Content-Type")
    if ct is not None:
        m["content-type"] = ct
    return m.get_content_type()

class ServiceInterface:
    def __init__ (self, fplus, **opts):
        self.fplus = fplus

    def error (self, msg, status=None):
        raise ServiceError(msg, service=self.service, status=status)

    def fetch (self, url, **opts):
        method = opts.pop("method", "GET")

        headers = opts.pop("headers", {})
        headers["Accept"] = "application/json"

        if "json" in opts:
            headers["Content-Type"] = "application/json"
        elif "content_type" in opts:
            headers["Content-Type"] = opts.pop("content_type")
        elif "data" in opts:
            headers["Content-Type"] = "application/octet-stream"

        res = self.fplus.http.fetch(
            service=self.service,
            url=url, method=method, headers=headers,
            **opts)

        json = None
        if content_type(res) == "application/json":
            json = res.json()

        return (res.status_code, json)

    def ping (self):
        st, ping = self.fetch("ping")
        if st != 200:
            return None
        return ping
