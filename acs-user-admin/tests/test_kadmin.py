# Copyright (c) University of Sheffield AMRC 2026.

import kadmin
import pytest

from amrc.factoryplus.user_admin.lib.kadmin import Kadm, PrincipalExists

PRINC = "alice@EXAMPLE.COM"

@pytest.fixture
def mock_kadm (mocker):
    return mocker.MagicMock()

@pytest.fixture
def kadm (mock_kadm):
    return Kadm(kadm=mock_kadm)

def test_create_princ_creates_with_password (kadm, mock_kadm):
    """create_princ creates the principal and its password in one kadmin
    call, and returns the name the KDC recorded."""
    mock_kadm.principal_exists.return_value = False
    mock_kadm.getprinc.return_value.principal = PRINC

    assert kadm.create_princ(PRINC, "hunter2") == PRINC

    mock_kadm.addprinc.assert_called_once_with(PRINC, "hunter2")

def test_create_princ_refuses_existing (kadm, mock_kadm):
    """create_princ never touches a principal that already exists."""
    mock_kadm.principal_exists.return_value = True

    with pytest.raises(PrincipalExists):
        kadm.create_princ(PRINC, "hunter2")

    mock_kadm.addprinc.assert_not_called()
    mock_kadm.getprinc.assert_not_called()

def test_create_princ_refuses_when_created_concurrently (kadm, mock_kadm):
    """A principal created between the check and the create is reported
    as existing, not as a kadmin failure."""
    mock_kadm.principal_exists.return_value = False
    mock_kadm.addprinc.side_effect = kadmin.DuplicateError()

    with pytest.raises(PrincipalExists):
        kadm.create_princ(PRINC, "hunter2")
