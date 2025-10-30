# Copyright (c) University of Sheffield AMRC 2025.

import logging

from typing import Dict, Any, Union

from .driver import Driver

class AsyncDriver(Driver):
    def __init__(self, opts: Dict[str, Any]):
        """
        Initialize the Async Driver with the provided options.

        Args:
            opts: Configuration options including:
                - handler: Handler class for device-specific logic
                - env: Environment configuration
        """
        super().__init__(opts)

    async def data(self, spec, buf):
        self.log.debug(f"DATA {buf}")
        dtopic = self.topics.get(spec) if self.topics else None
        if not dtopic:
            return

        mtopic = self.topic("data", dtopic)
        return self.publish_async(mtopic, buf)

    def publish_async(self, topic: str, payload: Union[str, bytes, bytearray, int, float, None]):
        return self.mqtt.publish(topic, payload)
