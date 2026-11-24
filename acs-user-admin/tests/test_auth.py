# Copyright (c) University of Sheffield AMRC 2026.

import base64
import time
from uuid import UUID

import pytest

from amrc.factoryplus.user_admin.app import create_app

CALLER = UUID("55555555-5555-5555-5555-555555555555")

@pytest.fixture
def app ():
    return create_app(env={"REALM": "EXAMPLE.COM"})

@pytest.fixture
def client (app):
    return app.test_client()

def basic_header (user, password):
    creds = base64.b64encode(f"{user}:{password}".encode()).decode()
    return {"Authorization": f"Basic {creds}"}

def test_basic_auth_qualifies_bare_username_with_realm (app, client, mocker):
    """A bare username gets the configured realm appended before being
    looked up, and verified against the KDC via get_init_creds_password."""
    krb5 = mocker.patch("amrc.factoryplus.user_admin.lib.auth.krb5")
    mocker.patch.object(app.fplus.auth, "find_principal", return_value=CALLER)

    r = client.post("/token", headers=basic_header("admin", "hunter2"))

    assert r.status_code == 200
    krb5.get_init_creds_password.assert_called_once()
    assert krb5.get_init_creds_password.call_args.kwargs["password"] == b"hunter2"
    app.fplus.auth.find_principal.assert_called_once_with(
        "kerberos", "admin@EXAMPLE.COM")

def test_basic_auth_accepts_an_already_qualified_principal (app, client, mocker):
    """A username that already includes a realm is used as-is, not
    double-qualified with the configured realm."""
    mocker.patch("amrc.factoryplus.user_admin.lib.auth.krb5")
    mocker.patch.object(app.fplus.auth, "find_principal", return_value=CALLER)

    client.post("/token", headers=basic_header("admin@OTHER.REALM", "hunter2"))

    app.fplus.auth.find_principal.assert_called_once_with(
        "kerberos", "admin@OTHER.REALM")

def test_basic_auth_wrong_password_rejected (app, client, mocker):
    """A password the KDC rejects results in 401, not a 500."""
    krb5 = mocker.patch("amrc.factoryplus.user_admin.lib.auth.krb5")
    krb5.get_init_creds_password.side_effect = Exception("bad password")

    r = client.post("/token", headers=basic_header("admin", "wrong"))

    assert r.status_code == 401

def test_basic_auth_unknown_principal_rejected (app, client, mocker):
    """A password the KDC accepts, but with no Factory+ identity mapped,
    still results in 401."""
    mocker.patch("amrc.factoryplus.user_admin.lib.auth.krb5")
    mocker.patch.object(app.fplus.auth, "find_principal", return_value=None)

    r = client.post("/token", headers=basic_header("admin", "hunter2"))

    assert r.status_code == 401

def test_bearer_token_from_basic_auth_is_accepted_later (app, client, mocker):
    """The token minted from a Basic-authenticated request is itself
    accepted as a Bearer credential on a later call."""
    mocker.patch("amrc.factoryplus.user_admin.lib.auth.krb5")
    mocker.patch.object(app.fplus.auth, "find_principal", return_value=CALLER)
    mocker.patch.object(app.fplus.auth, "check_acl", return_value=False)

    token = client.post("/token", headers=basic_header("admin", "hunter2")).get_json()["token"]

    r = client.post("/v1/user", headers={"Authorization": f"Bearer {token}"}, json={})
    # check_acl returning False -> 403, not 401 - proves the Bearer
    # token was accepted, not rejected as bad auth.
    assert r.status_code == 403

def fake_jwt ():
    """A credential shaped like a JWT (three dot-separated base64url
    segments, header has an `alg`) but with no real signature - good
    enough to route through auth_bearer's looks_like_jwt() check, since
    JwtVerifier.verify is mocked in the tests below rather than really
    checking the signature."""
    header = base64.urlsafe_b64encode(b'{"alg":"RS256"}').rstrip(b"=").decode()
    return f"{header}.payload.sig"

@pytest.fixture
def oidc_app ():
    return create_app(env={
        "REALM": "EXAMPLE.COM",
        "OIDC_DISCOVERY_URL": "https://keycloak.example/realms/x/.well-known/openid-configuration",
    })

@pytest.fixture
def oidc_client (oidc_app):
    return oidc_app.test_client()

def test_bearer_jwt_is_accepted_when_oidc_configured (oidc_app, oidc_client, mocker):
    """A Keycloak-issued JWT - the admin UI's OIDC switch sends these
    directly as Bearer credentials, bypassing the opaque /token
    exchange entirely - is routed to JWT verification and accepted."""
    mocker.patch.object(oidc_app.auth.jwt, "verify",
        return_value={"fp_principal_uuid": str(CALLER)})
    mocker.patch.object(oidc_app.fplus.auth, "check_acl", return_value=False)

    r = oidc_client.post("/v1/user",
        headers={"Authorization": f"Bearer {fake_jwt()}"}, json={})
    # check_acl returning False -> 403, not 401 - proves the JWT was
    # accepted, not rejected as bad auth.
    assert r.status_code == 403

def test_bearer_jwt_missing_principal_claim_rejected (oidc_app, oidc_client, mocker):
    """A validly-signed JWT lacking fp_principal_uuid isn't one of ours
    and must not be treated as an authenticated Factory+ identity."""
    mocker.patch.object(oidc_app.auth.jwt, "verify", return_value={})

    r = oidc_client.post("/v1/user",
        headers={"Authorization": f"Bearer {fake_jwt()}"}, json={})
    assert r.status_code == 401

def test_bearer_jwt_unavailable_returns_503_not_401 (oidc_app, oidc_client, mocker):
    """When Keycloak can't be reached to check the JWT, that's our
    failure, not the caller's - a 503 tells the client to retry rather
    than throw away a token that may still be perfectly good."""
    from amrc.factoryplus.user_admin.lib.jwt import AuthUnavailable
    mocker.patch.object(oidc_app.auth.jwt, "verify",
        side_effect=AuthUnavailable("boom"))

    r = oidc_client.post("/v1/user",
        headers={"Authorization": f"Bearer {fake_jwt()}"}, json={})
    assert r.status_code == 503

def test_opaque_bearer_token_unaffected_by_oidc_configuration (oidc_app, oidc_client, mocker):
    """Opaque session tokens (not JWT-shaped) keep working unchanged
    even when OIDC is configured."""
    mocker.patch.object(oidc_app.fplus.auth, "check_acl", return_value=False)
    oidc_app.auth.tokens["opaque-token"] = {
        "principal": CALLER, "expiry": time.time() + 3600,
    }

    r = oidc_client.post("/v1/user",
        headers={"Authorization": "Bearer opaque-token"}, json={})
    assert r.status_code == 403
