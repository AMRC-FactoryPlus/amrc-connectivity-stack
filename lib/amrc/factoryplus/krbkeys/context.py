# Factory+ / AMRC Connectivity Stack (ACS) KerberosKey management operator
# Event handling context
# Copyright 2023 AMRC

from    contextlib      import contextmanager
from    contextvars     import ContextVar
from    functools       import cached_property
import  logging

import  krb5

from .kadmin        import Kadm
from .kubernetes    import K8s
from .kubeseal      import Kubeseal

current_context = ContextVar("context", default=None)

def kk_ctx ():
    return current_context.get()

def log (msg, level=logging.INFO):
    ctx = kk_ctx()
    logger = logging if ctx is None else ctx.logger
    logger.log(level, msg)

class Context:
    def __init__ (self, operator, kw):
        self.operator = operator
        self.logger = kw["logger"]

    def __enter__ (self):
        self.token = current_context.set(self)

    def __exit__ (self, *args):
        current_context.reset(self.token)
        return False

    @cached_property
    def k8s (self):
        return K8s()

    @cached_property
    def krb5 (self):
        return krb5.init_context()

    @cached_property
    def kadm (self):
        return Kadm(ccache=self.operator.kadmin_ccache)

    @cached_property
    def kubeseal (self):
        return Kubeseal()
