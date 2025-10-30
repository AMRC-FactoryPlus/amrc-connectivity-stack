# Copyright (c) University of Sheffield AMRC 2025.

import logging
import json
from typing import Dict, Any, Optional, Callable, Type, Mapping, Set, Tuple, List
import paho.mqtt.client as mqtt # type: ignore
from paho.mqtt.enums import CallbackAPIVersion
import asyncio

from .handler_protocol import HandlerProtocol

# Permitted status returns from Handler.connect.
CONNECT_STATUS: Set[str] = {"UP", "CONN", "AUTH"}

class Driver:
    def __init__(self, opts: Dict[str, Any]):
        """
        Initialize the Driver with the provided options.

        Args:
            opts: Configuration options including:
                - handler: Handler class for device-specific logic
                - env: Environment configuration
        """
        self.HandlerClass: Type[HandlerProtocol] | None = opts.get("handler")

        self.status = "DOWN"
        self.clear_addrs()

        env = opts.get("env", {})
        self.log = logging.getLogger("driver")

        self.id = env.get("EDGE_USERNAME")

        self.mqtt_host, self.mqtt_port = self.get_mqtt_details(env.get("EDGE_MQTT"))
        self.mqtt = self.create_mqtt_client(env.get("EDGE_PASSWORD"))

        self.message_handlers: Dict[str, Callable] = {}
        self.setup_message_handlers()

        self.reconnect = 5000
        self.reconnecting = False

        # Create an asyncio event loop for running async tasks in sync contexts
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)

        # Create event loop executor
        self._background_tasks = set()

    def run(self) -> None:
        """Run the driver. This connects to the MQTT broker and starts the
        MQTT loop."""
        self.mqtt.connect_async(self.mqtt_host, self.mqtt_port)
        self.mqtt.loop_start()

        try:
            self.loop.run_until_complete(self.connect_handler())
            self.loop.run_forever()
        except KeyboardInterrupt:
            pass
        finally:
            self.loop.run_until_complete(self._async_cleanup())
            self.loop.close()

    def topic(self, msg, data=None) -> str:
        """Construct a topic string for the given message and data."""
        return f"fpEdge1/{self.id}/{msg}" + (f"/{data}" if data else "")

    def json(self, buf: str|bytes|bytearray) -> Optional[dict]:
        """
        Parse a JSON string or buffer into a Python dictionary.

        Attempts to convert the input buffer to a string and parse it as JSON.
        If parsing fails, logs the error and returns None.

        Args:
            buf: The input to parse, can be a string, bytes, or bytearray

        Returns:
            Dict containing the parsed JSON data, or None if parsing failed
        """
        try:
            return json.loads(str(buf))
        except Exception as e:
            self.log.error("JSON parse error: %s", e)
            return None

    def create_mqtt_client(self, password: str) -> mqtt.Client:
        """
        Create and configure MQTT client.

        Args:
            password: Authentication password

        Returns:
            Configured MQTT client. This should be used to connect when running
            the driver.
        """
        client = mqtt.Client(
            client_id=self.id,
            reconnect_on_failure=False,
            callback_api_version=CallbackAPIVersion.VERSION2,
        )
        client.username_pw_set(self.id, password)
        client.on_connect = self.connected
        client.on_message = self.handle_message
        client.will_set(self.topic("status"), payload="DOWN")

        return client

    def setup_handler(self, conf: Optional[dict] = None) -> bool:
        """
        Set up a new device handler based on the provided configuration.

        This method creates a new handler instance using the configured HandlerClass
        and initializes address handling functionality. It extracts the address
        validation and parsing logic from the handler and creates a helper function
        to process address configurations.

        Args:
            conf: Configuration dictionary for the handler

        Returns:
            True if the handler was successfully set up, False otherwise
        """
        if not conf:
            return False

        if not self.HandlerClass:
            return False

        self.handler = self.HandlerClass.create(self, conf)

        valid = getattr(self.handler.__class__, 'validAddrs', None)
        parse = getattr(self.handler, 'parseAddr', lambda a: a)

        def handle_addrs(addrs):
                entries = list(addrs.items())

                if valid:
                    bad_entries = [(t, a) for t, a in entries if a not in valid]
                    if bad_entries:
                        self.log.error(f"Invalid addresses: {bad_entries}")
                        return False

                parsed_entries = [(t, parse(a)) for t, a in entries]

                bad_addresses = [addrs[t] for t, s in parsed_entries if not s]
                if bad_addresses:
                    self.log.error(f"Invalid addresses: {bad_addresses}")
                    return False

                return parsed_entries

        self.handle_addrs = handle_addrs

        return True

    def set_status(self, status: str) -> None:
        """
        Set the driver's status and publish it via MQTT.

        This method updates the internal status property and, if connected to
        the MQTT broker, publishes the status to the appropriate topic.

        Args:
            status: The new status string to set
        """
        self.status = status
        if self.mqtt.is_connected:
            self.mqtt.publish(self.topic("status"), status)

    async def connect_handler(self) -> None:
        """
        Asynchronously attempts to connect the handler to its underlying device.

        This method calls the handler's connect method which may return:
        - An awaitable object that resolves to a connection status string
        - None if the handler is using callbacks for connection management

        If a status is returned, it's validated against the CONNECT_STATUS set.
        Valid statuses will update the driver's status. If the status is not "UP",
        a reconnection attempt will be scheduled.

        After successful connection, this method subscribes to relevant topics.
        """
        self.log.info("Connecting handler")
        if not self.handler:
            return

        result = self.handler.connect()

        # If this is None, the handler is using callbacks.
        if not result:
            return

        status = await result
        if status in CONNECT_STATUS:
            self.set_status(status)
        else:
            self.log.error(f"Handler.connect returned invalid value: {status}")

        if status != "UP":
            self._run_async(self.reconnect_handler())

        self._run_async(self.subscribe())

    def conn_up(self) -> None:
        """
        Set the handler status to UP.
        Used by the handler to notify the driver.
        """
        self.set_status("UP")
        self._run_async(self.subscribe())

    def conn_failed(self) -> None:
        """
        Set the handler status to CONN.
        Used by the handler to notify the driver.
        """
        self.set_status("CONN")
        self._run_async(self.reconnect_handler())

    def conn_unauth(self) -> None:
        """
        Set the handler status to AUTH.
        Used by the handler to notify the driver.
        """
        self.set_status("AUTH")
        self._run_async(self.reconnect_handler())

    async def reconnect_handler(self) -> None:
        """
        Attempt to reconnect the handler to the southbound device.
        """
        if self.reconnecting:
            self.log.warning("Handler already reconnecting")
            return

        self.reconnecting = True
        self.log.info("Handler disconnected")
        await asyncio.sleep(self.reconnect)
        self.reconnecting = False
        self._run_async(self.connect_handler())


    def clear_addrs(self) -> None:
        """Reset device addresses and topics to an empty state."""
        self.addrs = {}
        self.topics = {}

    async def set_addrs(self, pkt: dict) -> bool:
        """
        Set device addresses from a configuration packet.

        Args:
            pkt: Configuration packet with version and address mapping

        Returns:
            True if addresses were successfully set, False otherwise
        """
        if not self.handler:
            self.log.error("Received addrs without handler")
            return False

        self.clear_addrs()

        if pkt.get("version") != 1:
            self.log.error(f"Bad ddr config version: {pkt.get('version')}")
            return False

        parsed = self.handle_addrs(pkt.get("addrs", {}))
        if not parsed:
            return False

        self.addrs = dict(parsed)
        self.topics = {addr: topic for topic, addr in parsed}
        self.log.info(f"Set addrs: {self.addrs}")

        self._run_async(self.subscribe())

        return True

    async def subscribe(self) -> bool:
        """
        Subscribe the handler to the configured addresses.

        This method checks if the handler is in UP status and has configured
        addresses, then calls the handler's subscribe method if available.

        Returns:
            True if subscription was successful, False otherwise
        """
        if not self.handler:
            return False

        if self.status != "UP":
            self.log.error("Handler not UP")
            return False

        if not self.addrs:
            self.log.error("Addresses not configured or none available")
            return False

        specs = list(self.addrs.values())

        subscribe_method = getattr(self.handler, "subscribe", None)
        if subscribe_method:
            try:
                result = subscribe_method(specs)
                if hasattr(result, "__await__"):
                    success = await result
                else:
                    success = result

                if not success:
                    self.log.error("Handler subscription failed")
                    return False
            except Exception as e:
                self.log.error(f"Handler subscription error: {e}")
                return False

        return True

    def connected(self, *args, **kwargs) -> None:
        """Subscribe to topics and set ready status."""
        topics = [(self.topic(t), 0) for t in self.message_handlers.keys()]

        if topics:
            result, mid = self.mqtt.subscribe(topics)
            if result != mqtt.MQTT_ERR_SUCCESS:
                self.log.error(f"Failed to subscribe to topics: {result}")

        self.set_status("READY")

    def handle_message(self, client, userdata, message) -> None:
        """
        Handle incoming MQTT messages.

        This method is called by the MQTT client when a message is received.
        It extracts the message parts from the topic, finds the appropriate
        handler, and invokes it with the payload and optional data parameter.

        Args:
            client: The MQTT client instance
            userdata: User data as set in Client() or user_data_set()
            message: An object containing topic and payload
        """
        topic = message.topic
        payload = message.payload

        topic_parts = topic.split("/")
        if len(topic_parts) < 3:
            self.log.error(f"Invalid topic format: {topic}")
            return

        msg = topic_parts[2]
        data = topic_parts[3] if len(topic_parts) > 3 else None

        # If the message is a command, add a trailing slash to make sure that
        # we get the correct handler.
        handler_key = msg
        if msg == "cmd":
            handler_key = msg + "/#"

        handler = self.message_handlers.get(handler_key)
        if not handler:
            self.log.warning(f"Unhandled driver message: {msg}")
            return

        try:
            if isinstance(payload, bytes):
                payload = payload.decode('utf-8')
            handler(payload, data)
        except Exception as e:
            self.log.error(f"Error handling message {msg}: {e}")

    def message(self, msg: str, handler: Callable) -> None:
        """
        Register a handler function for a specific message.

        Args:
            msg: The message identifier to associate with the handler
            handler: A callback function that will be called when the specified
                    message is received
        """
        self.message_handlers[msg] = handler

    def setup_message_handlers(self) -> None:
        """Set up handlers for different message types."""
        def active_handler(payload, _=None):
            if str(payload) == "ONLINE":
                self.set_status("READY")

        def conf_handler(payload, _=None):
            conf = self.json(payload)
            self.log.debug(f"CONF: {conf}")

            self.clear_addrs()
            old = getattr(self, 'handler', None)

            if self.setup_handler(conf):
                if old and hasattr(old, 'close'):
                    self._run_async(self._handle_close(old))
                else:
                    self._run_async(self.connect_handler())
            else:
                self.log.error("Handler rejected driver configuration!")
                self.set_status("CONF")

        def addr_handler(payload, _=None):
            addr_config = self.json(payload)
            if not addr_config:
                self.set_status("ADDR")
                return

            async def process_addrs():
                if not await self.set_addrs(addr_config):
                    self.set_status("ADDR")

            self._run_async(process_addrs())

        def cmd_handler(payload, command_name=None):
            if hasattr(self, 'handler') and hasattr(self.handler, 'cmd') and self.handler:
                self.handler.cmd(command_name, payload)
            else:
                self.log.error(f"Command handler for '{command_name}' does not exist.")

        self.message("active", active_handler)
        self.message("conf", conf_handler)
        self.message("addr", addr_handler)
        self.message("cmd/#", cmd_handler)

    def get_mqtt_details(self, broker: str) -> Tuple[str, int]:
        """
        Parse the MQTT broker URL to extract host and port.

        Args:
            broker: MQTT broker URL in format "mqtt://host:port" or "host:port"

        Returns:
            A tuple containing (host, port) as strings
        """
        if broker.startswith("mqtt://"):
            broker = broker[7:]

        host_and_port = broker.split(":")
        return host_and_port[0], int(host_and_port[1])

    async def _async_cleanup(self):
        """Cleanup async resources when shutting down"""
        for task in self._background_tasks:
            task.cancel()
            if self._background_tasks:
                await asyncio.gather(*self._background_tasks, return_exceptions=True)

    def _run_async(self, coro):
        """Run a coroutine from a synchronous context, tracking the task"""
        task = self.loop.create_task(coro)
        self._background_tasks.add(task)
        task.add_done_callback(self._background_tasks.discard)

    async def _handle_close(self, old_handler):
        """Handle closing the old handler and connect the new one."""
        close_method = old_handler.close

        # Support both Promise and callback APIs
        result = None
        close_event = asyncio.Event()

        # Callback for when close is complete
        def on_close():
            close_event.set()

        # Call the close method with our callback
        result = close_method(on_close)

        # If it returned a result, it might be awaitable
        if result is not None:
            if hasattr(result, '__await__'):
                await result
            close_event.set()
        else:
            # Wait for the callback to be called
            await close_event.wait()

        # Now connect the new handler
        await self.connect_handler()
