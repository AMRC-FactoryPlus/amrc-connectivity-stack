# Copyright (c) University of Sheffield AMRC 2026.

import sys
import types
from unittest.mock import MagicMock

# kadmin and krb5 are native extensions (python-kadmV, python-krb5) built
# against libkrb5-dev. They aren't installable in a plain test environment,
# so stub them out - lib/kadmin.py only needs the names to exist at import
# time, and individual tests mock the behaviour they need.
if "kadmin" not in sys.modules:
    fake_kadmin = types.ModuleType("kadmin")
    fake_kadmin.init_with_ccache = MagicMock()
    fake_kadmin.DISALLOW_ALL_TIX = object()
    sys.modules["kadmin"] = fake_kadmin

if "krb5" not in sys.modules:
    sys.modules["krb5"] = types.ModuleType("krb5")
