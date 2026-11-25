# Copyright (c) University of Sheffield AMRC 2026.

import json
import time
from uuid import UUID

import jwt
import pytest
import requests
from cryptography.hazmat.primitives.asymmetric import rsa

from amrc.factoryplus.user_admin.app import create_app
from amrc.factoryplus.user_admin.lib.oidc import looks_like_jwt

DISCOVERY = "https://openid.example.test/realms/test/.well-known/openid-configuration"
ISSUER = "https://openid.example.test/realms/test"
JWKS_URI = "https://openid.example.test/realms/test/protocol/openid-connect/certs"
CALLER = UUID("fa45e723-1076-4d2b-99aa-95f7f0208a31")

def new_key ():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)

KEY = new_key()
OTHER_KEY = new_key()

def jwk (key, kid):
    d = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()))
    d.update(kid=kid, alg="RS256", use="sig")
    return d

def make_token (key=KEY, kid="k1", **claims):
    payload = {
        "iss": ISSUER,
        "aud": "account",
        "exp": int(time.time()) + 300,
        "iat": int(time.time()),
        "fp_principal_uuid": str(CALLER),
    }
    payload.update(claims)
    payload = {k: v for k, v in payload.items() if v is not None}
    return jwt.encode(payload, key, algorithm="RS256", headers={"kid": kid})

class FakeResponse:
    def __init__ (self, status, body):
        self.status_code = status
        self.ok = status < 400
        self._body = body
    def json (self):
        return self._body

@pytest.fixture
def keycloak (mocker):
    """A fake Keycloak: discovery over requests, the JWKS over
    PyJWKClient's own fetch. Tests change `state` to break it."""
    state = {"discovery": True, "jwks": {"keys": [jwk(KEY, "k1")]},
        "discovery_calls": 0}

    def get (url, timeout=None):
        assert url == DISCOVERY
        state["discovery_calls"] += 1
        if state["discovery"] is True:
            return FakeResponse(200, {"issuer": ISSUER, "jwks_uri": JWKS_URI})
        if state["discovery"] == "down":
            raise requests.ConnectionError("connection refused")
        return FakeResponse(503, {})

    def fetch_data (self):
        assert self.uri == JWKS_URI
        if state["jwks"] is None:
            raise jwt.PyJWKClientConnectionError("connection refused")
        return state["jwks"]

    mocker.patch("amrc.factoryplus.user_admin.lib.oidc.requests.get",
        side_effect=get)
    mocker.patch.object(jwt.PyJWKClient, "fetch_data", fetch_data)
    return state

@pytest.fixture
def app ():
    return create_app(env={
        "REALM": "EXAMPLE.TEST",
        "OIDC_DISCOVERY_URL": DISCOVERY,
    })

@pytest.fixture
def client (app):
    return app.test_client()

def bearer (token):
    return {"Authorization": f"Bearer {token}"}

def create_user (client, token):
    return client.post("/v1/user", headers=bearer(token), json={})

def test_a_keycloak_jwt_is_accepted_as_its_principal_uuid (app, client, keycloak, mocker):
    """A valid JWT gets the caller's fp_principal_uuid as g.auth, so
    the ACL check is made for that principal."""
    check = mocker.patch.object(app.fplus.auth, "check_acl", return_value=False)

    r = create_user(client, make_token())

    # 403, not 401: auth succeeded and the ACL said no.
    assert r.status_code == 403
    assert check.call_args.args[0] == CALLER

def test_a_jwt_can_be_exchanged_for_a_session_token (client, keycloak):
    r = client.post("/token", headers=bearer(make_token()))
    assert r.status_code == 200
    assert "token" in r.get_json()

def test_the_audience_is_not_checked (app, client, keycloak, mocker):
    mocker.patch.object(app.fplus.auth, "check_acl", return_value=False)
    r = create_user(client, make_token(aud="somebody-else"))
    assert r.status_code == 403

@pytest.mark.parametrize("token", [
    pytest.param(lambda: make_token(key=OTHER_KEY), id="wrong signing key"),
    pytest.param(lambda: make_token(kid="unknown"), id="unknown key id"),
    pytest.param(lambda: make_token(iss="https://evil.example.test/realms/test"),
        id="wrong issuer"),
    pytest.param(lambda: make_token(exp=int(time.time()) - 60), id="expired"),
    pytest.param(lambda: make_token(exp=None), id="no expiry"),
    pytest.param(lambda: make_token(fp_principal_uuid=None), id="no principal claim"),
    pytest.param(lambda: make_token(fp_principal_uuid="admin@EXAMPLE.TEST"),
        id="principal claim not a UUID"),
    pytest.param(lambda: jwt.encode(
        {"iss": ISSUER, "exp": int(time.time()) + 300,
            "fp_principal_uuid": str(CALLER)},
        "a-secret-anyone-could-guess-0123456789", algorithm="HS256", headers={"kid": "k1"}),
        id="HMAC token signed with a guessable secret"),
])
def test_a_bad_jwt_is_refused_with_401 (app, client, keycloak, mocker, token):
    check = mocker.patch.object(app.fplus.auth, "check_acl", return_value=True)
    r = create_user(client, token())
    assert r.status_code == 401
    check.assert_not_called()

@pytest.mark.parametrize("breakage", ["discovery down", "discovery 503", "jwks down"])
def test_keycloak_unreachable_is_503_not_401 (client, keycloak, breakage):
    """If we can't check the token, say so: a 401 would make the Admin
    UI throw away a good token."""
    if breakage == "discovery down":
        keycloak["discovery"] = "down"
    elif breakage == "discovery 503":
        keycloak["discovery"] = "error"
    else:
        keycloak["jwks"] = None

    r = create_user(client, make_token())
    assert r.status_code == 503

def test_discovery_is_retried_after_a_failure (app, client, keycloak, mocker):
    mocker.patch.object(app.fplus.auth, "check_acl", return_value=False)
    keycloak["discovery"] = "down"
    assert create_user(client, make_token()).status_code == 503

    keycloak["discovery"] = True
    assert create_user(client, make_token()).status_code == 403
    assert create_user(client, make_token()).status_code == 403
    # Fetched once more after the failure, then remembered.
    assert keycloak["discovery_calls"] == 2

def test_without_a_discovery_url_a_jwt_is_just_a_bad_token (mocker):
    app = create_app(env={"REALM": "EXAMPLE.TEST", "OIDC_DISCOVERY_URL": ""})
    get = mocker.patch("amrc.factoryplus.user_admin.lib.oidc.requests.get")
    r = app.test_client().post("/v1/user",
        headers=bearer(make_token()), json={})
    assert r.status_code == 401
    get.assert_not_called()

def test_session_tokens_still_work_with_jwt_enabled (app, client, keycloak, mocker):
    """An opaque token minted from a JWT is accepted later, and is not
    mistaken for a JWT."""
    mocker.patch.object(app.fplus.auth, "check_acl", return_value=False)
    token = client.post("/token", headers=bearer(make_token())).get_json()["token"]
    assert not looks_like_jwt(token)
    assert create_user(client, token).status_code == 403

@pytest.mark.parametrize("creds, expected", [
    (make_token(), True),
    ("abc.def.ghi", False),
    ("a" * 88, False),
    ("not a token", False),
])
def test_looks_like_jwt (creds, expected):
    assert looks_like_jwt(creds) is expected
