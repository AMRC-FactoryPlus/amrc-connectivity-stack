# Copyright (c) University of Sheffield AMRC 2025.

import logging

from typing import Dict, Union, Type

from .driver import Driver

from .handler_protocol import HandlerProtocol


class AsyncDriver(Driver):
    def __init__(
        self,
        handler: Type[HandlerProtocol],
        edge_username: str,
        edge_mqtt: str,
        edge_password: str,
        reconnect_delay: int = 500,
    ):
        """
        Initialize the Async Driver with the provided options.

        Args:

            handler: Handler class for device-specific logic
            edge_username: Username to connect to edge MQTT
            edge_mqtt: Edge MQTT host
            edge_password: Password to connect to edge MQTT
            reconnect_delay: Delay in reconnecting to the southbound device
        """
        super().__init__(handler, edge_username, edge_mqtt, edge_password, reconnect_delay)

    async def data(self, spec, buf):
        self.log.debug(f"DATA {buf}")
        dtopic = self.topics.get(spec) if self.topics else None
        if not dtopic:
            return

        mtopic = self.topic("data", dtopic)
        return self.publish_async(mtopic, buf)

    def publish_async(
        self, topic: str, payload: Union[str, bytes, bytearray, int, float, None]
    ):
        return self.mqtt.publish(topic, payload)
