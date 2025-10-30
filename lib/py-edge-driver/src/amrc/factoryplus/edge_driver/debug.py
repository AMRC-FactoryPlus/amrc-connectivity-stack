# Copyright (c) University of Sheffield AMRC 2025.

import logging
from typing import Dict, Any, Optional, Callable, Type, Mapping, Set

class Debug:
    def __init__(self, levels: str):
        """
        Initialize Debug class with optional verbosity settings.

        Args:
            levels: Comma-separated string of log levels to enable
        """
        self.levels = set()
        self.suppress = set()
        self.verbose = False

        levels = levels or ""

        for level in levels.split(","):
            if level == "1" or level == "ALL":
                self.verbose = True
            elif level.startswith("!"):
                self.suppress.add(level[1:])
            elif level:
                self.levels.add(level)

    def log(self, level: str, msg: str, *args) -> None:
        """
        Log a message if the level is enabled.

        Args:
            level: Log level name
            msg: Message format string
            *args: Arguments for message formatting
        """
        want = self.verbose or level in self.levels
        if not want or level in self.suppress:
            return

        try:
            out = msg % args if args else msg
        except TypeError:
            out = f"{msg} {' '.join(str(arg) for arg in args)}"

        spc = " " * max(0, 8 - len(level))
        print(f"{level}{spc} : {out}")

    def bound(self, level: str) -> Callable:
        """
        Return a bound logging function for the given level.

        Args:
            level: Log level to bind to

        Returns:
            Callable function that logs at the specified level
        """
        def bound_log(msg, *args):
            self.log(level, msg, *args)
        return bound_log
