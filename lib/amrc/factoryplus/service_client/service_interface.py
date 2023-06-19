# Factory+ Python client library
# Service interface
# Copyright 2023 AMRC

from email.message import Message

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

    def fetch (self, url, **opts):
        method = opts.pop("method", "GET")
        body = opts.pop("body", None)

        headers = opts.pop("headers", {})
        headers["Accept"] = "application/json"
        if body is not None:
            headers["Content-Type"] = "application/json"

        res = self.fplus.http.fetch(
            service=self.service,
            url=url, method=method, headers=headers,
            json=body)

        json = None
        if content_type(res) == "application/json":
            json = res.json()

        return (res.status_code, json)

    def ping (self):
        st, ping = self.fetch("ping")
        if st != 200:
            return None
        return ping
