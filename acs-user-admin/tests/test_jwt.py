# Copyright (c) University of Sheffield AMRC 2026.

import base64
import json

import pytest

from amrc.factoryplus.user_admin.lib.jwt import (
    AuthUnavailable, JwtVerifier, looks_like_jwt,
)

def b64url (data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

def test_looks_like_jwt_true_for_three_segments_with_alg_header ():
    header = b64url(json.dumps({"alg": "RS256"}).encode())
    assert looks_like_jwt(f"{header}.payload.sig")

def test_looks_like_jwt_false_for_opaque_token ():
    """Our own opaque session tokens (66 random bytes, base64) have no
    dots and must never be misrouted into JWT verification."""
    assert not looks_like_jwt("YWJjZGVmZ2hpamtsbW5vcA==")

def test_looks_like_jwt_false_for_wrong_segment_count ():
    assert not looks_like_jwt("a.b")
    assert not looks_like_jwt("a.b.c.d")

def test_looks_like_jwt_false_when_header_not_json ():
    assert not looks_like_jwt("not-json-at-all.payload.sig")

def test_looks_like_jwt_false_when_header_missing_alg ():
    header = b64url(json.dumps({"typ": "JWT"}).encode())
    assert not looks_like_jwt(f"{header}.payload.sig")

def test_verify_discovers_then_decodes (mocker):
    requests_mod = mocker.patch("amrc.factoryplus.user_admin.lib.jwt.requests")
    requests_mod.get.return_value.json.return_value = {
        "issuer": "https://keycloak.example/realms/x",
        "jwks_uri": "https://keycloak.example/realms/x/protocol/openid-connect/certs",
    }
    jwt_mod = mocker.patch("amrc.factoryplus.user_admin.lib.jwt.jwt")
    jwt_mod.decode.return_value = {"fp_principal_uuid": "abc"}

    verifier = JwtVerifier(
        "https://keycloak.example/realms/x/.well-known/openid-configuration")
    payload = verifier.verify("a.b.c")

    assert payload == {"fp_principal_uuid": "abc"}
    jwt_mod.PyJWKClient.assert_called_once_with(
        "https://keycloak.example/realms/x/protocol/openid-connect/certs")
    assert jwt_mod.decode.call_args.kwargs["issuer"] \
        == "https://keycloak.example/realms/x"

def test_verify_only_fetches_discovery_once (mocker):
    requests_mod = mocker.patch("amrc.factoryplus.user_admin.lib.jwt.requests")
    requests_mod.get.return_value.json.return_value = {
        "issuer": "iss", "jwks_uri": "https://x/certs",
    }
    mocker.patch("amrc.factoryplus.user_admin.lib.jwt.jwt")

    verifier = JwtVerifier("https://x/.well-known/openid-configuration")
    verifier.verify("a.b.c")
    verifier.verify("a.b.c")

    requests_mod.get.assert_called_once()

def test_discovery_network_failure_raises_auth_unavailable (mocker):
    requests_mod = mocker.patch("amrc.factoryplus.user_admin.lib.jwt.requests")
    requests_mod.get.side_effect = Exception("network down")

    verifier = JwtVerifier("https://x/.well-known/openid-configuration")
    with pytest.raises(AuthUnavailable):
        verifier.verify("a.b.c")

def test_discovery_missing_fields_raises_auth_unavailable (mocker):
    requests_mod = mocker.patch("amrc.factoryplus.user_admin.lib.jwt.requests")
    requests_mod.get.return_value.json.return_value = {"issuer": "iss"}

    verifier = JwtVerifier("https://x/.well-known/openid-configuration")
    with pytest.raises(AuthUnavailable):
        verifier.verify("a.b.c")

def test_jwks_fetch_failure_raises_auth_unavailable (mocker):
    requests_mod = mocker.patch("amrc.factoryplus.user_admin.lib.jwt.requests")
    requests_mod.get.return_value.json.return_value = {
        "issuer": "iss", "jwks_uri": "https://x/certs",
    }
    jwt_mod = mocker.patch("amrc.factoryplus.user_admin.lib.jwt.jwt")
    jwt_mod.exceptions.PyJWKClientError = type(
        "PyJWKClientError", (Exception,), {})
    jwt_mod.PyJWKClient.return_value.get_signing_key_from_jwt.side_effect = \
        jwt_mod.exceptions.PyJWKClientError("no keys")

    verifier = JwtVerifier("https://x/.well-known/openid-configuration")
    with pytest.raises(AuthUnavailable):
        verifier.verify("a.b.c")
