# Factory+ Python client library
# Service Client
# Copyright 2023 AMRC

from    functools       import cached_property
import  logging

from    .configdb           import ConfigDB
from    .directory          import Directory
from    .discovery          import Discovery
from    .edge_deployment    import EdgeDeployment
from    .http               import HTTP

from    .service_error      import ServiceError

opts_from_env = [
    ("AUTHN_URL",           "authn_url"),
    ("CONFIGDB_URL",        "configdb_url"),
    ("DIRECTORY_URL",       "directory_url"),
    ("MQTT_URL",            "mqtt_url"),
    ("ROOT_PRINCIPAL",      "root_principal"),
    ("SERVICE_USERNAME",    "username"),
    ("SERVICE_PASSWORD",    "password"),
]

class ServiceClient:
    def __init__ (self, **opts):
        env = opts.pop("env", None)
        if env is not None:
            verb = env.get("VERBOSE", "")
            if verb != "":
                logging.getLogger(__name__).setLevel(logging.DEBUG)

            for var, opt in opts_from_env:
                val = env.get(var)
                if val is not None:
                    opts[opt] = val

        self.opts = opts

    @cached_property
    def configdb (self):
        return ConfigDB(self)

    @cached_property
    def directory (self):
        return Directory(self)

    @cached_property
    def discovery (self):
        return Discovery(self)

    @cached_property
    def edge_deployment (self):
        return EdgeDeployment(self)

    @cached_property
    def http (self):
        return HTTP(self)
