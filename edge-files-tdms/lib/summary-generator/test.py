from nptdms import TdmsFile
import logging
import json
import numpy as np
import sys

#add nptdms to path
sys.path.append("./nptdms")

#Read tdms file from command line argument, variable name is folderPath
#return exception if no file is provided
if len(sys.argv) < 2:
    raise Exception("No TDMS file provided. Please provide a TDMS file as a command line argument.")    
tdms_file = TdmsFile.read(sys.argv[1])
# logging.basicConfig(level=logging.DEBUG)
# logging.debug(f"Groups: {tdms_file.groups()}")
        
groupArr = [] #declare dynamic list to hold group names
    
for group in tdms_file.groups():            
    channelJArr = [] #declare dynamic list to hold channel names
    for channel in group.channels():
        cj_data = []                
        timestamps = np.array(channel.time_track(True, 'ms')) #get the timestamps of the channel
        #show the timestamps of the channel
                
        # set first timestamp in array
        timestamp_start = channel.properties["wf_start_time"]                
                
        #Loop through half of the data in the channel
        for i in range(0, len(channel.data), 1000): #get every 1000th data point                    
            channelJSON = {
                "group": group.name,
                "name": channel.name,
                "data": channel.data[i],
                #"length": len(c_data),
                "timestamps": timestamps[i],
                "timestamp_start": timestamp_start,
                "properties": channel.properties,             
            }
            cj_data.append(channelJSON)
              
        channelJArr.append(cj_data)
    groupJSON = {
        "name": group.name,
        "channels": channelJArr
    }
    groupArr.append(groupJSON)             
            

# convert all groups to json file
testJSON = json.dumps(groupArr, indent=4, sort_keys=True, default=str) #json.dumps(group, indent=4, sort_keys=True, default=str)
print(testJSON)