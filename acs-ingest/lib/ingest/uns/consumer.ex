# ACS Ingest
# A consumer of UNS messages
# Copyright 2026 University of Sheffield

defmodule Ingest.Uns.Consumer do
  @moduledoc """
  A consumer of UNS messages, such as the UNS historian. It is given to
  `Ingest.Uns` as a `{module, opts}` pair.

  The UNS path's workers call `c:handle_message/5` with every message:
  its topic, its payload, still encoded, its MQTT 5 properties, and when
  it arrived, in nanoseconds since the epoch. Each call runs in the
  worker for the message's topic, so the consumer's work is spread
  across the workers, and a topic's messages come in the order they
  arrived. A call should not block for long, as the worker's next
  messages wait for it. If it raises, the worker crashes, and loses the
  messages waiting for it.
  """

  @callback handle_message(
              topic :: String.t(),
              payload :: binary(),
              properties :: map(),
              received :: integer(),
              opts :: keyword()
            ) :: any()
end
