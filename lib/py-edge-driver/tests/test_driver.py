# Copyright (c) University of Sheffield AMRC 2025.

from typing import assert_type
import pytest
from unittest.mock import MagicMock, AsyncMock

import paho.mqtt.client

from amrc.factoryplus.edge_driver.driver import Driver
from amrc.factoryplus.edge_driver.handler_protocol import HandlerProtocol

@pytest.fixture
def mock_handler_class(mocker):
    return mocker.MagicMock(spec=HandlerProtocol)

@pytest.fixture
def basic_driver_instance(mock_handler_class):
    return Driver(
        mock_handler_class,
        "test_user",
        "mqtt://localhost:1883",
        "test_password",
    )

def test_driver_init(basic_driver_instance, mock_handler_class):
    """
    Test that the driver instance is initialized correctly with basic properties.
    """
    assert basic_driver_instance.HandlerClass == mock_handler_class
    assert basic_driver_instance.id == "test_user"
    assert basic_driver_instance.mqtt_host == "localhost"
    assert basic_driver_instance.mqtt_port == 1883
    assert basic_driver_instance.mqtt.username == "test_user"
    assert basic_driver_instance.mqtt.password == "test_password"
    assert basic_driver_instance.status == "DOWN"
    assert basic_driver_instance.addrs == {}
    assert basic_driver_instance.topics == {}

def test_driver_topic(basic_driver_instance):
    """
    Test that the driver can construct topics.
    """
    assert basic_driver_instance.topic("status") == f"fpEdge1/test_user/status"
    assert basic_driver_instance.topic("status", "DOWN") == f"fpEdge1/test_user/status/DOWN"

def test_driver_json(basic_driver_instance):
    """
    Test that the driver can decode JSON data.
    """
    json_data1 = '{"key1": "value1", "key2": "value2"}'
    decoded_data1 = basic_driver_instance.json(json_data1)
    assert decoded_data1 == {"key1": "value1", "key2": "value2"}

    json_data2 = '{"bool1": true, "bool2": false}'
    decoded_data2 = basic_driver_instance.json(json_data2)
    assert decoded_data2 == {"bool1": True, "bool2": False}
