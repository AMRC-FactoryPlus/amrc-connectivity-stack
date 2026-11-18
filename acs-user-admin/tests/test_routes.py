# Copyright (c) University of Sheffield AMRC 2026.

import time
from unittest.mock import ANY
from uuid import UUID

import kadmin
import pytest

from amrc.factoryplus.service_client import ServiceError
from amrc.factoryplus.user_admin.app import create_app
from amrc.factoryplus.user_admin.lib.kadmin import PrincipalExists

CALLER = UUID("55555555-5555-5555-5555-555555555555")
NEW_USER = UUID("77777777-7777-7777-7777-777777777777")
TOKEN = "test-token"
REALM = "EXAMPLE.COM"
PRINC = f"alice@{REALM}"

BODY = {"name": "Alice", "principal": "alice", "password": "hunter2"}

@pytest.fixture
def app ():
    app = create_app(env={"REALM": REALM})
    app.auth.tokens[TOKEN] = {"principal": CALLER, "expiry": time.time() + 3600}
    return app

@pytest.fixture
def client (app):
    return app.test_client()

@pytest.fixture
def auth_headers ():
    return {"Authorization": f"Bearer {TOKEN}"}

@pytest.fixture
def permitted (app, mocker):
    """A caller with ManageUsers, and a principal unknown to Auth."""
    mocker.patch.object(app.fplus.auth, "check_acl", return_value=True)
    mocker.patch.object(app.fplus.auth, "find_principal", return_value=None)

@pytest.fixture
def kadm (mocker):
    kadm = mocker.patch("amrc.factoryplus.user_admin.lib.routes.Kadm")
    kadm.return_value.create_princ.return_value = PRINC
    return kadm

@pytest.fixture
def configdb (app, mocker):
    return {
        "create_object": mocker.patch.object(
            app.fplus.configdb, "create_object", return_value=NEW_USER),
        "put_config": mocker.patch.object(app.fplus.configdb, "put_config"),
        "add_identity": mocker.patch.object(app.fplus.auth, "add_identity"),
    }

def test_create_user_forbidden_without_permission (app, client, auth_headers, mocker):
    """A caller without UserAdmin.Perm.ManageUsers gets 403, no further side effects."""
    mocker.patch.object(app.fplus.auth, "check_acl", return_value=False)
    create_object = mocker.patch.object(app.fplus.configdb, "create_object")

    r = client.post("/v1/user", headers=auth_headers, json=BODY)

    assert r.status_code == 403
    create_object.assert_not_called()

def test_create_user_duplicate_principal (app, client, auth_headers, mocker, kadm):
    """A principal Auth already knows returns 409, no ConfigDB/kadmin side effects."""
    mocker.patch.object(app.fplus.auth, "check_acl", return_value=True)
    find_principal = mocker.patch.object(app.fplus.auth, "find_principal",
        return_value=UUID("88888888-8888-8888-8888-888888888888"))
    create_object = mocker.patch.object(app.fplus.configdb, "create_object")

    r = client.post("/v1/user", headers=auth_headers, json=BODY)

    assert r.status_code == 409
    # The lookup uses the qualified name, which is what Auth stores.
    find_principal.assert_called_once_with("kerberos", PRINC)
    create_object.assert_not_called()
    kadm.return_value.create_princ.assert_not_called()

def test_create_user_principal_already_in_kdc (
        client, auth_headers, permitted, kadm, configdb):
    """A principal that is in the KDC but not in Auth returns 409 and is
    left alone: no password change, no ConfigDB object."""
    kadm.return_value.create_princ.side_effect = PrincipalExists(PRINC)

    r = client.post("/v1/user", headers=auth_headers, json=BODY)

    assert r.status_code == 409
    configdb["create_object"].assert_not_called()
    configdb["add_identity"].assert_not_called()

@pytest.mark.parametrize("principal", [
    "krbtgt/EXAMPLE.COM@EXAMPLE.COM",
    "HTTP/auth.example.svc.cluster.local",
    "alice@OTHER.REALM",
    "alice@EXAMPLE.COM@EXAMPLE.COM",
    "@EXAMPLE.COM",
    "alice smith",
])
def test_create_user_rejects_unacceptable_principal (
        client, auth_headers, permitted, kadm, configdb, principal):
    """Only a single-component name in our own realm is accepted."""
    r = client.post("/v1/user", headers=auth_headers,
        json={**BODY, "principal": principal})

    assert r.status_code == 400
    kadm.assert_not_called()
    configdb["create_object"].assert_not_called()

@pytest.mark.parametrize("field,value", [
    ("name", ""), ("name", 5), ("password", 123), ("password", ""),
    ("principal", None), ("principal", ["alice"]),
])
def test_create_user_rejects_bad_field_types (
        client, auth_headers, permitted, kadm, configdb, field, value):
    """Every field must be a non-empty string, checked before anything
    is created."""
    r = client.post("/v1/user", headers=auth_headers,
        json={**BODY, field: value})

    assert r.status_code == 400
    kadm.assert_not_called()
    configdb["create_object"].assert_not_called()

def test_create_user_kadmin_failure (
        client, auth_headers, permitted, kadm, configdb):
    """A kadmin failure, including failing to connect, is a JSON 500
    with nothing created in ConfigDB."""
    kadm.side_effect = kadmin.KAdminError("no credentials cache")

    r = client.post("/v1/user", headers=auth_headers, json=BODY)

    assert r.status_code == 500
    assert "error" in r.get_json()
    configdb["create_object"].assert_not_called()

def test_create_user_provisioning_failure_names_the_principal (
        client, auth_headers, permitted, kadm, configdb):
    """If ConfigDB/Auth fails after the KDC principal exists, the error
    says so, because that principal now needs finishing by hand."""
    configdb["add_identity"].side_effect = ServiceError(
        "nope", service="auth", status=503)

    r = client.post("/v1/user", headers=auth_headers, json=BODY)

    assert r.status_code == 500
    assert PRINC in r.get_json()["error"]

def test_create_user_success (client, auth_headers, permitted, kadm, configdb):
    """A permitted, non-duplicate request creates the KDC principal, then the
    ConfigDB object and its identity link, all under the qualified name."""
    r = client.post("/v1/user", headers=auth_headers, json=BODY)

    assert r.status_code == 201
    assert r.get_json() == {"uuid": str(NEW_USER), "principal": PRINC}
    kadm.return_value.create_princ.assert_called_once_with(PRINC, "hunter2")
    configdb["create_object"].assert_called_once()
    configdb["put_config"].assert_called_once_with(
        ANY, NEW_USER, {"name": "Alice"})
    configdb["add_identity"].assert_called_once_with(NEW_USER, "kerberos", PRINC)

def test_create_user_ignores_groups (client, auth_headers, permitted, kadm, configdb, app, mocker):
    """The service does not put new users in groups: a caller must not
    be able to grant membership through the service account."""
    class_add_member = mocker.patch.object(app.fplus.configdb, "class_add_member")

    r = client.post("/v1/user", headers=auth_headers,
        json={**BODY, "groups": ["66666666-6666-6666-6666-666666666666"]})

    assert r.status_code == 201
    class_add_member.assert_not_called()
