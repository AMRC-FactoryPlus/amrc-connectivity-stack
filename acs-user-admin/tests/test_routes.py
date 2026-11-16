# Copyright (c) University of Sheffield AMRC 2026.

import time
from uuid import UUID

import pytest

from amrc.factoryplus.user_admin.app import create_app

CALLER = UUID("55555555-5555-5555-5555-555555555555")
NEW_USER = UUID("77777777-7777-7777-7777-777777777777")
TOKEN = "test-token"

BODY = {"name": "Alice", "principal": "alice", "password": "hunter2"}

@pytest.fixture
def app ():
    app = create_app(env={})
    app.auth.tokens[TOKEN] = {"principal": CALLER, "expiry": time.time() + 3600}
    return app

@pytest.fixture
def client (app):
    return app.test_client()

@pytest.fixture
def auth_headers ():
    return {"Authorization": f"Bearer {TOKEN}"}

def test_create_user_forbidden_without_permission (app, client, auth_headers, mocker):
    """A caller without UserAdmin.Perm.ManageUsers gets 403, no further side effects."""
    mocker.patch.object(app.fplus.auth, "check_acl", return_value=False)
    create_object = mocker.patch.object(app.fplus.configdb, "create_object")

    r = client.post("/v1/user", headers=auth_headers, json=BODY)

    assert r.status_code == 403
    create_object.assert_not_called()

def test_create_user_duplicate_principal (app, client, auth_headers, mocker):
    """An existing Kerberos principal returns 409, no ConfigDB/kadmin side effects."""
    mocker.patch.object(app.fplus.auth, "check_acl", return_value=True)
    mocker.patch.object(app.fplus.auth, "find_principal",
        return_value=UUID("88888888-8888-8888-8888-888888888888"))
    create_object = mocker.patch.object(app.fplus.configdb, "create_object")
    kadm = mocker.patch("amrc.factoryplus.user_admin.lib.routes.Kadm")

    r = client.post("/v1/user", headers=auth_headers, json=BODY)

    assert r.status_code == 409
    create_object.assert_not_called()
    kadm.return_value.set_password.assert_not_called()

def test_create_user_success (app, client, auth_headers, mocker):
    """A permitted, non-duplicate request creates the KDC principal, then the
    ConfigDB object and its group/identity links, in that order."""
    mocker.patch.object(app.fplus.auth, "check_acl", return_value=True)
    mocker.patch.object(app.fplus.auth, "find_principal", return_value=None)
    add_identity = mocker.patch.object(app.fplus.auth, "add_identity")
    create_object = mocker.patch.object(
        app.fplus.configdb, "create_object", return_value=NEW_USER)
    put_config = mocker.patch.object(app.fplus.configdb, "put_config")
    class_add_member = mocker.patch.object(app.fplus.configdb, "class_add_member")
    kadm = mocker.patch("amrc.factoryplus.user_admin.lib.routes.Kadm")
    kadm.return_value.set_password.return_value = {"kvno": 1}

    group = "66666666-6666-6666-6666-666666666666"
    r = client.post("/v1/user", headers=auth_headers,
        json={**BODY, "groups": [group]})

    assert r.status_code == 201
    assert r.get_json() == {"uuid": str(NEW_USER)}
    kadm.return_value.set_password.assert_called_once_with("alice", "hunter2")
    create_object.assert_called_once()
    put_config.assert_called_once_with(mocker.ANY, NEW_USER, {"name": "Alice"})
    class_add_member.assert_called_once_with(group, NEW_USER)
    add_identity.assert_called_once_with(NEW_USER, "kerberos", "alice")
