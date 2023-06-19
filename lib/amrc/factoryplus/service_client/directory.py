# Factory+ Python client library
# Directory interface
# Copyright 2023 AMRC

import logging

from .service_interface     import ServiceInterface
from ..                     import uuids

log = logging.getLogger(__name__)

class Directory (ServiceInterface):
    def __init__ (self, fplus, **kw):
        super().__init__(fplus, **kw);

        self.service = uuids.Service.Directory
