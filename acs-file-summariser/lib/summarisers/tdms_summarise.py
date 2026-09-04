#!/usr/bin/env python3
#
# ACS File Summariser
# Streams a downsampled summary of a TDMS file to stdout as NDJSON.
# Reads the source file in bounded chunks so memory use stays roughly
# constant regardless of file or channel size.
#
# Copyright 2026 University of Sheffield

import sys
import json

import numpy as np
from nptdms import TdmsFile

# Samples read from disk at a time, per channel. Bounds peak memory
# independently of channel length; only 1-in-`step` of these are kept.
CHUNK_SAMPLES = 1_000_000


def channel_timing(channel):
    """Return (start_ns, increment_ns) as integers, or None if this
    channel has no waveform timing properties (e.g. non-waveform data)."""
    props = channel.properties
    if "wf_start_time" not in props or "wf_increment" not in props:
        return None

    start_time = props["wf_start_time"]
    increment = float(props["wf_increment"])
    start_offset = float(props.get("wf_start_offset", 0.0))

    start_ns = int(start_time.astype("datetime64[ns]").astype("int64"))
    start_ns += round(start_offset * 1e9)
    increment_ns = round(increment * 1e9)

    return start_ns, increment_ns


def jsonable(value):
    if isinstance(value, np.floating):
        return float(value)
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    return value


def summarise_channel(group_name, channel, step, emit):
    num_samples = len(channel)
    if num_samples == 0:
        return

    timing = channel_timing(channel)

    offset = 0
    while offset < num_samples:
        length = min(CHUNK_SAMPLES, num_samples - offset)
        window = channel.read_data(offset, length)

        # First local index in this window that lands on the global
        # step grid (global index = offset + local_idx).
        local_start = (-offset) % step

        for local_idx in range(local_start, length, step):
            abs_idx = offset + local_idx
            if timing is not None:
                start_ns, increment_ns = timing
                timestamp_ns = start_ns + abs_idx * increment_ns
            else:
                timestamp_ns = abs_idx

            row = {
                "group": group_name,
                "channel": channel.name,
                "value": jsonable(window[local_idx]),
                # Emitted as a string: nanosecond epoch timestamps exceed
                # what a JSON/JS float can represent exactly.
                "timestamp_ns": str(timestamp_ns),
            }
            emit(row)

        offset += length


def summarise(file_path, step):
    def emit(row):
        sys.stdout.write(json.dumps(row))
        sys.stdout.write("\n")
        sys.stdout.flush()

    with TdmsFile.open(file_path) as tdms_file:
        for group in tdms_file.groups():
            for channel in group.channels():
                summarise_channel(group.name, channel, step, emit)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("usage: tdms_summarise.py <file> <step>", file=sys.stderr)
        sys.exit(2)

    try:
        summarise(sys.argv[1], max(1, int(sys.argv[2])))
    except Exception as e:
        print(f"Error summarising TDMS file: {e}", file=sys.stderr)
        sys.exit(1)
