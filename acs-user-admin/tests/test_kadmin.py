# Copyright (c) University of Sheffield AMRC 2026.

import pytest

from amrc.factoryplus.user_admin.lib.kadmin import Kadm

PRINC = "alice@EXAMPLE.COM"

@pytest.fixture
def mock_kadm (mocker):
    return mocker.MagicMock()

@pytest.fixture
def kadm (mock_kadm):
    return Kadm(kadm=mock_kadm)

def test_find_princ_creates_if_absent (kadm, mock_kadm):
    """find_princ creates the principal via addprinc if it doesn't exist yet."""
    mock_kadm.principal_exists.return_value = False

    kadm.find_princ(PRINC)

    mock_kadm.addprinc.assert_called_once_with(PRINC, None)
    mock_kadm.getprinc.assert_called_once_with(PRINC)

def test_find_princ_does_not_recreate_existing (kadm, mock_kadm):
    """find_princ does not call addprinc for a principal that already exists."""
    mock_kadm.principal_exists.return_value = True

    kadm.find_princ(PRINC)

    mock_kadm.addprinc.assert_not_called()
    mock_kadm.getprinc.assert_called_once_with(PRINC)

def test_set_password_creates_principal_and_sets_password (kadm, mock_kadm):
    """set_password creates the principal (if absent) and sets its password
    in one call, returning the resulting key info."""
    mock_kadm.principal_exists.return_value = False
    kpr = mock_kadm.getprinc.return_value
    kpr.kvno = 1
    kpr.keys = {1: [("aes256-cts-hmac-sha1-96", "normal")]}

    info = kadm.set_password(PRINC, "hunter2")

    mock_kadm.addprinc.assert_called_once_with(PRINC, None)
    kpr.change_password.assert_called_once_with("hunter2")
    assert info == {"kvno": 1, "etypes": ["aes256-cts-hmac-sha1-96:normal"]}
