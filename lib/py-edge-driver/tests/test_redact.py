# Copyright (c) University of Sheffield AMRC 2026.

import copy

from amrc.factoryplus.edge_driver.redact import redact


def test_masks_sensitive_keys():
    conf = {"host": "10.0.0.1", "port": 502,
            "username": "operator", "password": "not-a-real-password"}
    assert redact(conf) == {"host": "10.0.0.1", "port": 502,
                            "username": "operator", "password": "***"}


def test_matches_case_insensitively():
    out = redact({"Password": "x", "clientSecret": "x", "API_TOKEN": "x",
                  "apiKey": "x", "credentials": "x", "passwd": "x", "pwd": "x"})
    assert set(out.values()) == {"***"}


def test_recurses_and_masks_subtrees():
    out = redact({
        "auth": {"user": "u", "password": "x"},
        "servers": [{"host": "a", "token": "x"}, {"host": "b"}],
        "credentials": {"user": "u", "pass": "x"},
    })
    assert out == {
        "auth": {"user": "u", "password": "***"},
        "servers": [{"host": "a", "token": "***"}, {"host": "b"}],
        "credentials": "***",
    }


def test_leaves_empty_values_visible():
    assert redact({"password": "", "secret": None}) == \
        {"password": "", "secret": None}


def test_masks_url_credentials():
    out = redact({"url": "mqtt://user:pa@ss@broker:1883/path",
                  "plain": "http://broker:8080/a@b"})
    assert out["url"] == "mqtt://user:***@broker:1883/path"
    assert out["plain"] == "http://broker:8080/a@b"


def test_does_not_modify_original():
    conf = {"password": "x", "nested": {"token": "y"}}
    before = copy.deepcopy(conf)
    redact(conf)
    assert conf == before


def test_passes_non_objects_through():
    assert redact(None) is None
    assert redact(42) == 42
    assert redact("plain") == "plain"
