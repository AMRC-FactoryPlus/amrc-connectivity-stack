# Copyright (c) University of Sheffield AMRC 2026.

from uuid import UUID

import pytest

from amrc.factoryplus.service_client.auth import Auth

PERM = UUID("11111111-1111-1111-1111-111111111111")
TARGET = UUID("22222222-2222-2222-2222-222222222222")
OTHER_TARGET = UUID("33333333-3333-3333-3333-333333333333")
PRINCIPAL = UUID("44444444-4444-4444-4444-444444444444")
NULL = UUID("00000000-0000-0000-0000-000000000000")

@pytest.fixture
def auth ():
    return Auth(fplus=None)

def test_fetch_acl_fetches_by_uuid (auth, mocker):
    """fetch_acl requests v2/acl/{uuid} for a uuid principal and parses the ACEs."""
    mock_fetch = mocker.patch.object(auth, "fetch", return_value=(200, [
        {"permission": str(PERM), "target": str(TARGET)},
    ]))

    acl = auth.fetch_acl("uuid", str(PRINCIPAL))

    mock_fetch.assert_called_once_with(f"v2/acl/{PRINCIPAL}")
    assert acl == [{"permission": PERM, "target": TARGET}]

def test_fetch_acl_fetches_by_type (auth, mocker):
    """fetch_acl requests v2/acl/{type}/{principal} for a non-uuid identity type."""
    mock_fetch = mocker.patch.object(auth, "fetch", return_value=(200, []))

    auth.fetch_acl("kerberos", "alice@REALM")

    mock_fetch.assert_called_once_with("v2/acl/kerberos/alice%40REALM")

def test_fetch_acl_raises_on_error_status (auth, mocker):
    """fetch_acl raises a ServiceError if the request does not return 200."""
    mocker.patch.object(auth, "fetch", return_value=(403, None))

    with pytest.raises(Exception):
        auth.fetch_acl("uuid", str(PRINCIPAL))

def test_check_acl_true_on_matching_ace (auth, mocker):
    """check_acl returns True when an ACE matches permission and target exactly."""
    mocker.patch.object(auth, "fetch_acl", return_value=[
        {"permission": PERM, "target": TARGET},
    ])

    assert auth.check_acl(PRINCIPAL, PERM, TARGET, False) is True

def test_check_acl_false_on_no_matching_ace (auth, mocker):
    """check_acl returns False when no ACE matches."""
    mocker.patch.object(auth, "fetch_acl", return_value=[
        {"permission": PERM, "target": OTHER_TARGET},
    ])

    assert auth.check_acl(PRINCIPAL, PERM, TARGET, False) is False

def test_check_acl_wildcard (auth, mocker):
    """check_acl accepts a wildcard (Null) target only when wild is True."""
    mocker.patch.object(auth, "fetch_acl", return_value=[
        {"permission": PERM, "target": NULL},
    ])

    assert auth.check_acl(PRINCIPAL, PERM, TARGET, True) is True
    assert auth.check_acl(PRINCIPAL, PERM, TARGET, False) is False
