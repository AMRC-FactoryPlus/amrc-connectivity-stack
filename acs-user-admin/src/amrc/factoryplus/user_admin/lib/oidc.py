# Factory+ User Admin service
# Keycloak JWT validation
# Copyright 2026 University of Sheffield

import  base64
import  json
import  logging
import  re
import  threading

import  jwt
import  requests

log = logging.getLogger(__name__)

JWT_DOT_RX = re.compile(r"^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$")

def looks_like_jwt (creds):
    """Bearer credentials arrive on the same header as our opaque
    session tokens. A JWT is three base64url segments joined by dots
    whose first segment decodes to a JSON header with an `alg` field.
    Our own tokens (token_urlsafe) never contain a dot. This is the
    same test as lib/js-service-api/lib/jwt.js."""
    if not JWT_DOT_RX.match(creds):
        return False
    hdr_b64 = creds.split(".")[0]
    try:
        padded = hdr_b64 + "=" * (-len(hdr_b64) % 4)
        hdr = json.loads(base64.urlsafe_b64decode(padded))
    except Exception:
        return False
    return isinstance(hdr, dict) and isinstance(hdr.get("alg"), str)

class AuthUnavailable (Exception):
    """We could not tell whether a credential is good, because
    something we check it against is not answering. The caller may
    well be who they say they are, so this is a server error, not a
    refusal."""

class JwtVerifier:
    """Validate a Keycloak-issued JWT, with the same rules as
    lib/js-service-api/lib/jwt.js:

    - the discovery document at `discovery_url` gives the issuer and
      the JWKS URL, and is fetched on first use;
    - the signature must verify with a key from the JWKS, and the
      issuer must match;
    - the audience is not checked, because Keycloak access tokens for
      the Admin UI carry the realm's audiences, not ours.

    verify() returns the payload, raises jwt.InvalidTokenError for a
    bad token, and raises AuthUnavailable if Keycloak can't be read.
    """

    def __init__ (self, discovery_url, timeout=10):
        self.discovery_url = discovery_url
        self.timeout = timeout

        self._lock = threading.Lock()
        self._issuer = None
        self._jwks = None

    def _discover (self):
        with self._lock:
            if self._jwks is not None:
                return
            log.info(f"Fetching OIDC discovery from {self.discovery_url}")
            try:
                res = requests.get(self.discovery_url, timeout=self.timeout)
            except requests.RequestException as e:
                raise AuthUnavailable(f"OIDC discovery failed: {e}") from e
            if not res.ok:
                raise AuthUnavailable(
                    f"OIDC discovery failed: HTTP {res.status_code}")
            try:
                doc = res.json()
            except ValueError:
                doc = {}
            issuer = doc.get("issuer") if isinstance(doc, dict) else None
            jwks_uri = doc.get("jwks_uri") if isinstance(doc, dict) else None
            if not issuer or not jwks_uri:
                raise AuthUnavailable(
                    "OIDC discovery doc missing issuer/jwks_uri")
            # PyJWKClient caches the key set, and fetches it again when
            # a token names a key it doesn't have (key rotation).
            self._jwks = jwt.PyJWKClient(jwks_uri, timeout=self.timeout)
            self._issuer = issuer

    def verify (self, token):
        self._discover()

        try:
            key = self._jwks.get_signing_key_from_jwt(token)
        except jwt.PyJWKClientConnectionError as e:
            raise AuthUnavailable(f"Can't fetch JWT signing keys: {e}") from e
        except jwt.PyJWKClientError as e:
            # No key matches the token's kid, even after a refetch.
            raise jwt.InvalidTokenError(str(e)) from e

        # The token's alg must be the one its key is for, so a token
        # can't choose a weaker check than the key was issued for.
        return jwt.decode(token, key=key,
            algorithms=[key.algorithm_name],
            issuer=self._issuer,
            options={"verify_aud": False, "require": ["exp", "iss"]})
