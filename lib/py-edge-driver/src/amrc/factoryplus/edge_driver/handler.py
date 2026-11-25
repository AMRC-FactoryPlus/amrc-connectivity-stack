# Copyright (c) University of Sheffield AMRC 2025.

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, ClassVar, List, Optional, Set, Any, Dict, Callable, Union, Awaitable

from .scout import ReadValue, ScoutEnd, ScoutError, ScoutRequest, ScoutSink

if TYPE_CHECKING:
    from .driver import Driver


class Handler(ABC):
    """
    Abstract base class defining the interface for device handlers.

    Any class implementing this interface can be used as a device handler
    with the Driver class. This class cannot be instantiated directly.
    """

    validAddrs: ClassVar[Optional[Set[Any]]] = None
    """Set of valid addresses that this handler can manage, or None if any address is valid."""

    scouts: ClassVar[bool] = False
    """Set this to True in a handler class that implements scout. The
    driver tells the Edge Agent so in its hello, from the class, so a
    driver whose configuration failed still answers correctly."""

    reads: ClassVar[bool] = False
    """Set this to True in a handler class that implements read_values,
    so the Admin UI can show live values. The hello reports it from the
    class, as for `scouts`."""

    def parseAddr(self, addr: Any) -> Any:
        """
        Parse a device address into a format usable by the handler.

        Args:
            addr: The raw address to parse

        Returns:
            The parsed address, or a falsy value if parsing failed
        """
        return addr

    @abstractmethod
    def close(self, callback: Optional[Callable[[], None]] = None) -> Any:
        """
        Close the handler and clean up any resources.

        Args:
            callback: Optional callback function to call when closing is complete

        Returns:
            An optional result that may be used by the driver
        """
        pass

    @abstractmethod
    def connect(self) -> Union[Awaitable[str], None]:
        """
        Connect to the southbound device.

        Returns:
            A string representing the connection status or None if using callbacks.
        """
        pass

    def cmd(self, command_name: Any, payload: Any) -> None:
        """
        Call a command on the southbound device.

        Args:
            command_name: Name of the command to execute. To be parsed by the handler.
            payload: Payload for the command to use. To be parsed by the handler.
        """
        pass

    @classmethod
    @abstractmethod
    def create(cls, driver, conf: Dict[str, Any]) -> 'Handler':
        """
        Create a new handler instance for the given driver and configuration.

        Args:
            driver: The driver instance that will use this handler
            conf: Configuration data for initializing the handler

        Returns:
            A new handler instance, or None if creation failed
        """
        pass

    def poll(self, spec: Any) -> Union[Any, Awaitable[Any]]:
        """
        Poll data from the southbound device for the given specification.

        This method is optional and only required for handlers used with PolledDriver.

        Args:
            spec: The parsed address specification to poll data from

        Returns:
            The polled data (can be bytes, string, or any serializable data),
            or an awaitable that resolves to the data. Returns None if no data available.
        """
        return None

    async def scout(self, request: ScoutRequest, out: ScoutSink) -> ScoutEnd:
        """
        List the addresses the southbound device offers (Edge Scout).

        This is only called when the handler class sets `scouts = True`.
        Add items with `await out.add(items)`, report how far the scan
        has got with `out.progress(visited=..., note=...)`, wait
        `await out.pace()` between southbound requests, and stop when
        `out.cancelled` is set. `request.limits` holds the caps. The
        library enforces the item cap, the depth cap, the time limit
        and cancel itself, so a handler that misses one still ends the
        scan correctly.

        Args:
            request: Where to start, the options and the limits
            out: Where to send what the scan finds

        Returns:
            A ScoutEnd, a dict with the same keys, or None for a plain
            result. Raise ScoutError with OPTIONS, CONN or AUTH to fail
            the scan with that code. Anything else raised becomes ERR.
        """
        raise ScoutError("UNSUPPORTED", "This driver can't list its addresses")

    async def read_values(self, addresses: List[str]) -> List[ReadValue]:
        """
        Read the current value of each address (Edge Scout live values).

        This is only called when the handler class sets `reads = True`
        and the driver is UP. Read on the connection the handler already
        has: never open a session, a subscription or a client per call.
        A read runs beside a running scan, and is abandoned if it has
        not returned in 4 s.

        Args:
            addresses: 1 to 40 addresses in the driver's canonical form

        Returns:
            One ReadValue, or a dict with the same keys, per address.
            `value` may be any value: the library writes it as text. Put
            a short reason in `error` for an address that can't be read.
            Raise ScoutError("CONN") when the device can't be reached.
            Anything else raised answers the whole read with ERR.
        """
        raise ScoutError("UNSUPPORTED", "This driver can't read values")
