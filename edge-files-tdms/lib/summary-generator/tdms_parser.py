from nptdms import TdmsFile
import logging
import json
import numpy as np
import sys
from datetime import datetime
import tracemalloc
# import os

# cwd = os.getcwd()

# print("Current Working Directory:", cwd)

#Read tdms file from command line argument, variable name is folderPath
#return exception to stdio if no file is provided
#if len(sys.argv) < 2:
#    print("No TDMS file provided. Please provide a TDMS file as a command line argument.")
#     #raise Exception("No TDMS file provided. Please provide a TDMS file as a command line argument.")    

def summarise(file_path, step):
    #try/catch block to handle errors in reading the TDMS file
    try:
        #tdms_file = TdmsFile.read(sys.argv[1])
        # logging.basicConfig(level=logging.DEBUG)
        # logging.debug(f"Groups: {tdms_file.groups()}")
        with TdmsFile.open(file_path) as tdms_file, open("summary.json", "w") as outfile:
            outfile.write("[\n")
            for groupIndex, group in enumerate(tdms_file.groups()):
                channelJArr = [] #declare dynamic list to hold channel names
                for channel in group.channels():
                    cj_data = []
                    # set first timestamp in array
                    timestamp_start = channel.properties["wf_start_time"]
                    increment = channel.properties["wf_increment"]
                    start_offset = channel.properties["wf_start_offset"]
                    num_samples = len(channel[:])
                    start_time_seconds = timestamp_start.astype('datetime64[s]').astype(float)
                    timestamps = start_time_seconds + start_offset + np.arange(num_samples) * increment
                    timestamps_sub_sample = timestamps[::step]
                    channel_sub_sample = channel[::step]
                    #Loop through the channel
                    for i in range(0, len(channel_sub_sample)):
                        channelJSON = {
                            "group": group.name,
                            "name": channel.name,
                            "data": channel[i],
                            "timestamp": timestamps_sub_sample[i],
                            "timestamp_start": str(timestamp_start),
                        }
                        cj_data.append(channelJSON)
                    channelJArr.append(cj_data)
                groupJSON = {
                    "name": group.name,
                    "channels": channelJArr
                }
                outfile.write(json.dumps(groupJSON))
                if groupIndex < len(tdms_file.groups()) - 1:
                    outfile.write(",\n")
                else:
                    outfile.write("\n")
            outfile.write("]\n")

            # convert all groups to json file
            #testJSON = json.dumps(groupArr, indent=4, sort_keys=True, default=str) #json.dumps(group, indent=4, sort_keys=True, default=str)
            #testJSON = json.dumps(groupArr, default=str)
            #with open("finalSummary.json", "w") as outfile:
            #    #outfile.write(testJSON)
            #    json.dump(groupArr, outfile)
            #print(testJSON)

    except Exception as e:
        print(f"Error parsing TDMS file: {e}")
        #raise Exception(f"Error parsing TDMS file: {e}")

tracemalloc.start()
summarise("C:\\Users\\me1djn\\Documents\\octent\\TDMS examples\\Fingerprint_2023-09-08-06-50-40.tdms", 1000)
current, peak = tracemalloc.get_traced_memory()
print(f"\nMemory usage:")
print(f"  Current: {current / 1024 / 1024:.2f} MB")
print(f"  Peak:    {peak / 1024 / 1024:.2f} MB")