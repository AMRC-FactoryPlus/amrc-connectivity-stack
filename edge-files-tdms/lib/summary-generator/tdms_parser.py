print("TDMS_PARSER: starting script")
from nptdms import TdmsFile
print("TDMS_PARSER: imported nptdms successfully")
import logging
import json
import numpy as np
import sys
from datetime import datetime
# import os

print("TDMS_PARSER: imported libraries successfully")
# cwd = os.getcwd()

# print("Current Working Directory:", cwd)

#Read tdms file from command line argument, variable name is folderPath
#return exception to stdio if no file is provided
if len(sys.argv) < 2:
   print("No TDMS file provided. Please provide a TDMS file as a command line argument.")
    #raise Exception("No TDMS file provided. Please provide a TDMS file as a command line argument.")    

#try/catch block to handle errors in reading the TDMS file
try:
    tdms_file = TdmsFile.read(sys.argv[1])
    print("TDMS_PARSER: read TDMS file successfully")
    #tdms_file = TdmsFile.read("./edge-files-tdms/dest/Fingerprint_2023-09-08-06-50-40.tdms")  # For testing purposes, replace with sys.argv[1] when running in production
    # logging.basicConfig(level=logging.DEBUG)
    # logging.debug(f"Groups: {tdms_file.groups()}")

        
    # groupArr = [] #declare dynamic list to hold group names
        
    # for group in tdms_file.groups():            
    #     channelJArr = [] #declare dynamic list to hold channel names
    #     for channel in group.channels():
    #         cj_data = []                
    #         timestamps = np.array(channel.time_track(True, 's')) #get the timestamps of the channel
    #         datetime_timestamps = timestamps.astype('datetime64[s]').astype(datetime)  # Convert numpy array to datetime objects
    #         unix_timestamps = np.array([dt.timestamp() for dt in datetime_timestamps])
    #         #turn each timestamp into an integer
    #         #if timestamps.size == 0:
    #         #timestamps = np.array([0])  
    #         #:
    #         #timestamps = np.array(timestamps, dtype=int)
    #         #convert to seconds
            
            
                    
    #         # set first timestamp in array
    #         timestamp_start = channel.properties["wf_start_time"]                
                    
    #         #Loop through the channel
    #         for i in range(0, len(channel.data), 1000): #get every 1000th data point                  
    #             channelJSON = {
    #                 "group": group.name,
    #                 "name": channel.name,
    #                 "data": channel.data[i],
    #                 #"length": len(c_data),
    #                 "timestamps": unix_timestamps[i], #.tolist(),  # Convert numpy int64 to Python int
    #                 "timestamp_start": timestamp_start,
    #                 #"properties": channel.properties,             
    #             }
    #             cj_data.append(channelJSON)
                
    #         channelJArr.append(cj_data)
    #     groupJSON = {
    #         "name": group.name,
    #         "channels": channelJArr
    #     }
    #     groupArr.append(groupJSON)             
                

    # # convert all groups to json file
    # testJSON = json.dumps(groupArr, indent=4, sort_keys=True, default=str) #json.dumps(group, indent=4, sort_keys=True, default=str)



    #testJSON = json.dumps(groupArr, default=str)
    # with open("./finalSummary.json", "w") as outfile:
    #     outfile.write(testJSON)
    #print(testJSON)
    print("TDMS_PARSER: script completed successfully")

except Exception as e:
    print(f"Error parsing TDMS file: {e}")
    #raise Exception(f"Error parsing TDMS file: {e}")