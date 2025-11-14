# Copyright (c) University of Sheffield AMRC 2025.

import asyncio
from typing import Any, List, Type

from .driver import Driver
from .handler import Handler

Q_TIMEOUT = 30.0  # 30 seconds
Q_MAX = 20


class PolledDriver(Driver):

    def __init__(self, serial: bool = False, **opts):
        """
        Initialize the Polled Driver with the provided options.

        Args:
            handler: Handler class for device-specific logic
            edge_username: Username to connect to edge MQTT
            edge_mqtt: Edge MQTT host
            edge_password: Password to connect to edge MQTT
            reconnect_delay: Delay in reconnecting to the southbound device
            serial: Whether to use serial polling (queue-based) or parallel
        """
        super().__init__(**opts)
        self.serial_mode = serial

        # For serial mode, we need a queue
        if self.serial_mode:
            self.poll_queue: asyncio.Queue[List[str]] = asyncio.Queue(maxsize=Q_MAX)

    async def run(self) -> None:
        """
        Run the polled driver asynchronously.

        This starts the queue processor for serial mode and then runs the base driver.
        Should be called with asyncio.run(driver.run())
        """
        # Start queue processor if in serial mode
        if self.serial_mode:
            asyncio.create_task(self._process_poll_queue())

        await super().run()

    async def _serial_poller(self, topics: List[str]) -> None:
        """
        Handle serial polling by adding topics to a queue.

        Args:
            topics: List of topic names to poll
        """
        try:
            # Check if queue is too full
            if self.poll_queue.qsize() >= Q_MAX:
                self.poll_err(
                    "Poll queue size exceeded. We're polling too fast for the device!"
                )
                return

            # Add topics to queue (non-blocking with timeout)
            try:
                await asyncio.wait_for(self.poll_queue.put(topics), timeout=1.0)
            except asyncio.TimeoutError:
                self.poll_err("Timeout adding topics to poll queue")

        except Exception as e:
            self.poll_err(e)

    async def _parallel_poller(self, topics: List[str]) -> None:
        """
        Handle parallel polling by directly executing the poll.

        Args:
            topics: List of topic names to poll
        """
        await self._poll_with_timeout(topics)

    async def _process_poll_queue(self) -> None:
        """Process items from the poll queue serially."""
        self.log.info("Starting serial poll queue processor")

        while True:
            try:
                # Get topics from queue with timeout
                topics = await asyncio.wait_for(
                    self.poll_queue.get(), timeout=1.0  # Check periodically
                )

                # Process the poll with timeout
                await self._poll_with_timeout(topics)

                # Mark task as done
                self.poll_queue.task_done()

            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                self.log.info("Poll queue processor cancelled")
                break
            except Exception as e:
                self.poll_err(f"Queue processor error: {e}")

    async def _poll_with_timeout(self, topics: List[str]) -> None:
        """
        Execute poll with timeout handling.

        Args:
            topics: List of topic names to poll
        """
        try:
            await asyncio.wait_for(self.poll(topics), timeout=Q_TIMEOUT)
        except asyncio.TimeoutError:
            self.poll_err(f"Poll timeout after {Q_TIMEOUT}s for topics: {topics}")
        except Exception as e:
            self.poll_err(e)

    def poll_err(self, e) -> None:
        """
        Handle polling errors.

        Args:
            e: The error that occurred during polling
        """
        self.log.error(f"POLL ERR: {e}")

    def setup_message_handlers(self) -> None:
        """Set up message handlers including the poll handler."""
        super().setup_message_handlers()

        def poll_handler(payload, _=None):
            """Handle poll messages."""
            try:
                topics = str(payload).strip().split("\n")
                # Filter out empty topics
                topics = [t.strip() for t in topics if t.strip()]
                self.log.debug(f"POLL {topics}")

                if not topics:
                    self.log.warning("Poll message contained no valid topics")
                    return

                if self._loop:
                    if self.serial_mode:
                        asyncio.run_coroutine_threadsafe(self._serial_poller(topics), self._loop)
                    else:
                        asyncio.run_coroutine_threadsafe(self._parallel_poller(topics), self._loop)

            except Exception as e:
                self.poll_err(f"Error in poll handler: {e}")

        self.message("poll", poll_handler)

    async def poll(self, topics: List[str]) -> None:
        """
        Poll the specified topics and publish the results.

        Args:
            topics: List of topic names to poll
        """
        if not self.addrs:
            self.log.error("Can't poll, no addrs! Is the device config invalid?")
            return

        if not self.handler:
            self.log.error("Can't poll, no handler configured")
            return

        # Build specs for polling
        specs = []
        for topic in topics:
            if topic in self.addrs:
                specs.append(
                    {"data": self.topic("data", topic), "spec": self.addrs[topic]}
                )
            else:
                self.log.warning(f"Topic '{topic}' not found in configured addresses")

        # Poll each spec
        for spec_info in specs:
            data_topic = spec_info["data"]
            spec = spec_info["spec"]

            try:
                self.log.debug(f"READ {spec}")

                poll_result = self.handler.poll(spec)

                # Handle both sync and async poll methods
                buf: Any = None
                if hasattr(poll_result, "__await__"):
                    buf = await poll_result
                else:
                    buf = poll_result

                self.log.debug(f"DATA {buf}")

                # Publish data if we got something
                if buf is not None:
                    if self.mqtt.is_connected():
                        self.mqtt.publish(data_topic, buf)
                    else:
                        self.log.warning("MQTT not connected, skipping publish")

            except Exception as e:
                self.log.error(f"Error polling spec {spec}: {e}")
