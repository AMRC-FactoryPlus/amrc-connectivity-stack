# ACS Ingest
# Build-time configuration
# Copyright 2026 University of Sheffield

import Config

# One line per log message, as the JS services write, without the
# blank line the default format puts before each.
config :logger, :default_formatter, format: "$time $metadata[$level] $message\n"
