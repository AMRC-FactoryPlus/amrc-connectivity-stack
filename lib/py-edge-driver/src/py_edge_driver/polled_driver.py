import asyncio
import logging
from typing import Dict, Any, Optional, Callable, List
from concurrent.futures import Future
import time

from .driver import Driver

Q_TIMEOUT = 30.0  # 30 seconds
Q_MAX = 20

class PolledDriver(Driver):
    def __init__(self, opts: Dict[str, Any]):
        """
        Initialize the PolledDriver with the provided options.

        Args:
            opts: Configuration options including:
                - handler: Handler class for device-specific logic
                - env: Environment configuration
                - serial: Whether to use serial polling (queue-based) or parallel
        """
        super().__init__(opts)

        self.serial_mode = opts.get("serial", False)
        self.poller = self.create_poller()

        # For serial mode, we need a queue
        if self.serial_mode:
            self.poll_queue = asyncio.Queue(maxsize=Q_MAX)
            self.queue_processor_task: Optional[asyncio.Task] = None

    def create_poller(self) -> Callable:
        """
        Create the polling function based on configuration.

        Returns:
            A callable that handles polling either serially or in parallel
        """
        if self.serial_mode:
            return self._serial_poller
        else:
            return self._parallel_poller

    def _serial_poller(self, topics: List[str]) -> None:
        """
        Handle serial polling by adding topics to a queue.

        Args:
            topics: List of topic names to poll
        """
        try:
            # Check if queue is too full
            if self.poll_queue.qsize() >= Q_MAX:
                self.poll_err("Poll queue size exceeded. We're polling too fast for the device!")
                return

            # Start queue processor if not running
            if not self.queue_processor_task or self.queue_processor_task.done():
                self.queue_processor_task = self._run_async(self._process_poll_queue())

            # Add topics to queue (non-blocking)
            self._run_async(self._add_to_queue(topics))

        except Exception as e:
            self.poll_err(e)

    def _parallel_poller(self, topics: List[str]) -> None:
        """
        Handle parallel polling by directly executing the poll.

        Args:
            topics: List of topic names to poll
        """
        # Create a task with timeout and error handling
        self._run_async(self._poll_with_timeout(topics))

    async def _add_to_queue(self, topics: List[str]) -> None:
        """Add topics to the poll queue."""
        try:
            await self.poll_queue.put(topics)
        except asyncio.QueueFull:
            self.poll_err("Poll queue is full")

    async def _process_poll_queue(self) -> None:
        """Process items from the poll queue serially."""
        while True:
            try:
                # Get topics from queue with timeout
                topics = await asyncio.wait_for(
                    self.poll_queue.get(),
                    timeout=1.0  # Check periodically if we should continue
                )

                # Process the poll with timeout
                await self._poll_with_timeout(topics)

                # Mark task as done
                self.poll_queue.task_done()

            except asyncio.TimeoutError:
                # No items in queue, continue waiting
                continue
            except Exception as e:
                self.poll_err(f"Queue processor error: {e}")
                # Continue processing even if one item fails

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
        self.log(f"POLL ERR: {e}")

    def setup_message_handlers(self) -> None:
        """Set up message handlers including the poll handler."""
        super().setup_message_handlers()

        def poll_handler(payload, _=None):
            """Handle poll messages."""
            try:
                topics = str(payload).strip().split('\n')
                # Filter out empty topics
                topics = [t.strip() for t in topics if t.strip()]
                self.log(f"POLL {topics}")

                if not self.poller:
                    self.log("Can't poll, no poller!")
                    return

                self.poller(topics)

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
            self.log("Can't poll, no addrs! Is the device config invalid?")
            return

        # Build specs for polling
        specs = []
        for topic in topics:
            if topic in self.addrs:
                specs.append({
                    'data': self.topic("data", topic),
                    'spec': self.addrs[topic]
                })

        # Poll each spec
        for spec_info in specs:
            data_topic = spec_info['data']
            spec = spec_info['spec']

            try:
                self.log(f"READ {spec}")

                # Call handler's poll method
                if not self.handler or not hasattr(self.handler, 'poll'):
                    self.log("Handler doesn't support polling")
                    continue

                poll_result = self.handler.poll(spec)

                # Handle both sync and async poll methods
                buf: Any = None
                if hasattr(poll_result, '__await__'):
                    buf = await poll_result
                else:
                    buf = poll_result

                self.log(f"DATA {buf}")

                # Publish data if we got something
                if buf is not None:
                    if self.mqtt.is_connected():
                        self.mqtt.publish(data_topic, buf)
                    else:
                        self.log("MQTT not connected, skipping publish")

            except Exception as e:
                self.log(f"Error polling spec {spec}: {e}")

    async def _async_cleanup(self):
        """Override cleanup to handle queue processor task."""
        # Cancel queue processor if running
        if self.queue_processor_task is not None and not self.queue_processor_task.done():
            self.queue_processor_task.cancel()
            try:
                await self.queue_processor_task
            except asyncio.CancelledError:
                pass

        # Call parent cleanup
        await super()._async_cleanup()