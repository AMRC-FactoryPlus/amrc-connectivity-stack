# Factory+ User Admin service
# Keycloak JWT validation
# Copyright 2026 University of Sheffield

import  base64
import  json
import  logging

import  jwt
import  requests

log = logging.getLogger(__name__)

class AuthUnavailable (Exception):
    """Raised when a JWT could not be checked because Keycloak itself
    is unreachable. The caller may well be who they say they are, so
    this must be reported as a server error, not a refusal."""

def _b64url_decode (segment):
    return base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4))

def looks_like_jwt (creds):
    """Bearer credentials arrive on the same wire as our opaque session
    tokens (66 random bytes, base64 of the alphabet A-Za-z0-9+/=, no
    dots). A JWT is three base64url segments joined by dots whose
    first segment decodes to a JSON header with an `alg` field.
    Disambiguate by structure so we don't change behaviour for
    existing callers."""
    parts = creds.split(".")
    if len(parts) != 3:
        return False
    try:
        header = json.loads(_b64url_decode(parts[0]))
        return isinstance(header.get("alg"), str)
    except Exception:
        return False

class JwtVerifier:
    """Validate a Keycloak-issued JWT against a configured discovery
    URL. Discovery is fetched lazily on first verify(), then the
    resulting jwks_uri is handed to PyJWT's PyJWKClient, which handles
    JWKS caching and kid rotation internally."""

    def __init__ (self, discovery_url):
        self.discovery_url = discovery_url
        self._issuer = None
        self._jwks_client = None

    def _discover (self):
        if self._jwks_client is not None:
            return
        try:
            res = requests.get(self.discovery_url, timeout=5)
            res.raise_for_status()
            doc = res.json()
        except Exception as e:
            raise AuthUnavailable(f"OIDC discovery failed: {e}") from e

        issuer = doc.get("issuer")
        jwks_uri = doc.get("jwks_uri")
        if not issuer or not jwks_uri:
            raise AuthUnavailable(
                "OIDC discovery doc missing issuer/jwks_uri")

        self._issuer = issuer
        self._jwks_client = jwt.PyJWKClient(jwks_uri)

    def verify (self, token):
        self._discover()
        try:
            signing_key = self._jwks_client.get_signing_key_from_jwt(token)
        except jwt.exceptions.PyJWKClientError as e:
            raise AuthUnavailable(f"Can't fetch JWT signing keys: {e}") from e

        return jwt.decode(
            token, signing_key.key,
            algorithms=["RS256"],
            issuer=self._issuer,
            options={"verify_aud": False},
        )
