# Copyright (c) University of Sheffield AMRC 2025.

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, ClassVar, Optional, Set, Any, Dict, Callable, Union, Awaitable

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
