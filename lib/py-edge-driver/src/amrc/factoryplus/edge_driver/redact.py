# Copyright (c) University of Sheffield AMRC 2026.

"""
Redact secrets from values before they are logged.

The Edge Agent substitutes secrets into the driver config before sending
it, so the config we receive can contain plaintext credentials. We can't
know every driver's field names, so match on the key instead. This errs
towards masking too much; it only affects what is logged.
"""

import re
from typing import Any

SENSITIVE = re.compile(r"pass|pwd|secret|token|key|cred", re.IGNORECASE)
MASK = "***"

# Credentials embedded in a URL, e.g. mqtt://user:pass@host.
URL_USERINFO = re.compile(r"(//[^/:@\s]*):[^/\s]*@")


def redact(value: Any) -> Any:
    """
    Return a copy of `value` that is safe to log.

    Values under sensitive keys are masked, recursively, but the keys
    themselves are kept so the log still shows the config's shape. The
    original value is not modified.
    """
    if isinstance(value, str):
        return URL_USERINFO.sub(rf"\1:{MASK}@", value)
    if isinstance(value, list):
        return [redact(v) for v in value]
    if isinstance(value, dict):
        return {
            k: MASK if SENSITIVE.search(str(k)) and v not in (None, "")
            else redact(v)
            for k, v in value.items()
        }
    return value
