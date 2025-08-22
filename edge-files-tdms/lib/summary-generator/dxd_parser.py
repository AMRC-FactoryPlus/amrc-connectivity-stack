import json
from textwrap import indent

from dwdat2py import wrappers as dw
from datetime import datetime, timedelta
import tracemalloc

# Parses the DXD file and creates a subsampled dataset of all channels in the file
def parse_dxd(file_path, sub_sample_percentage):
    tracemalloc.start()
    dw.init()
    dh = dw.open_data_file(file_path.encode())
    # Memory after opening (mostly header + metadata)
    current, peak = tracemalloc.get_traced_memory()
    print(f"After open_data_file: Current={current / 1024:.1f} KB, Peak={peak / 1024:.1f} KB")
    print(dh)
    # Get list of channels
    ch_list = dw.get_channel_list()
    file_start = convert_start_time(dh.start_store_time)
    print("Start Time:", file_start)
    print("Channels found:", [ch.name for ch in ch_list])

    samples = int(dh.sample_rate * dh.duration)
    summary_data = []
    sample_factor = int(100 / sub_sample_percentage)
    with open("data.json", "w") as file:
        file.write('[')
        for ch in ch_list:
            for i in range(0, samples, sample_factor):
                scaled = dw.get_scaled_samples(ch.index, i, 1)
                current, peak = tracemalloc.get_traced_memory()
                print(f"After reading samples: Current={current / 1024:.1f} KB, Peak={peak / 1024:.1f} KB")
                timestamp = scaled[0][0]
                value = scaled[1][0]
                entry = {
                    "timestamp": timestamp,
                    "value": value,
                    "channel": ch.name,
                }
                file.write(json.dumps(entry))
                if i + sample_factor >= samples and ch.index == len(ch_list) -1:
                    file.write("\n")
                else:
                    file.write(",\n")
        file.write(']' + "\n")
    dw.close_data_file()
    dw.de_init()

    print("Finished")

# Creates a subsample of the original dataset
def sub_sample(file_start, values, timestamps, sub_sample_percentage):
    sub_sampled_values = []
    sample_factor = int(100/sub_sample_percentage)
    for i in range(0, len(values), sample_factor):
        sub_sampled_values.append({
            "value": values[i],
            "timestamp": timestamps[i] + file_start.timestamp(),
        })
    return sub_sampled_values

# converts an OLE timestamp to a unix timestamp
def convert_start_time(ole_datetime):
    # Dewesoft/OLE epoch starts on Dec 30, 1899
    dewesoft_epoch = datetime(1899, 12, 30)
    # Convert days to datetime
    return dewesoft_epoch + timedelta(days=ole_datetime)

try:
    parse_dxd("C:\\Users\\me1djn\\Downloads\\Test.dxd" ,1)
    exit(0)
except Exception as e:
    print(f"Error parsing file: {e}")
    exit(1)