from nptdms import TdmsFile, TdmsWriter, ChannelObject, GroupObject, RootObject
import logging
import json
import numpy as np
import datetime 
import sys

#add nptdms to path
sys.path.append("./nptdms")

#Read tdms file from command line argument, variable name is folderPath
tdms_file = TdmsFile.read(sys.argv[1])
#tdms_file = TdmsFile.read("../../TDMS Examples/Fingerprint_2023-05-09-02-14-34.tdms")


logging.basicConfig(level=logging.DEBUG)
logging.debug(f"Groups: {tdms_file.groups()}")

with TdmsWriter("testSummaryEvery1500.tdms") as tdms_writer:
        parentArr = []
        groupArr = [] #declare dynamic list to hold group names
    
        for group in tdms_file.groups():
            #group = tdms_file["Log 63"]
            groupObj = GroupObject(group.name, group.properties)
            channelArr = [] #declare dynamic list to hold channel names
            channelJArr = [] #declare dynamic list to hold channel names
            for channel in group.channels():
                c_data = [] #declare dynamic list to hold half the data
                cj_data = [] 
                #print(f"Channel: {channel.name}, Properties: {channel.properties}") #show the channel properties
                timestamps = np.array(channel.time_track(True, 'ms')) #get the timestamps of the channel
                #show the timestamps of the channel
                #print(f"Channel: {channel.name}, Timestamps: {timestamps} Timestamp Length: {len(timestamps)} Timestamp unit: {channel.properties['wf_xunit_string']}") #show the timestamps of the channel
                
                #delta_t = np.mean(np.diff(timestamps)) #calculate the difference between each timestamp
                #frequency = 1/delta_t #calculate the frequency of the channel
                #print(f"Frequency of {channel.name}: {frequency} Hz")
                
                #Get frequency of the channel
                # freq = channel.properties["Frequency"]
                
                # set first timestamp in array
                timestamp_start = channel.properties["wf_start_time"]
                #timestamp_end = timestamp_start + datetime.timedelta(0, 2) #2 seconds later
                #30 milliseconds later
                timestamp_end = timestamp_start + datetime.timedelta(0, 1) #10 milliseconds later
                #print(f"Timestamp Start: {timestamp_start}")
                #print(f"Timestamp length: {len(timestamps)}")
                #print(f"Channel length: {len(channel.data)}")
                
                #Loop through half of the data in the channel
                for i in range(0, len(channel.data), 1500): #get every 1000th data point
                #for i in range(0, len(channel.data)): 
                    #Append if the timestamp is between the start and end time
                    #if timestamps[i] >= timestamp_start and timestamps[i] <= timestamp_end:
                    #create a new array with third the data
                    c_data.append(channel.data[i])
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
                #channelObj = ChannelObject(group.name, channel.name, channel.data, channel.properties)
                #slice timestamps array to match the data array
                #timestamps = timestamps[(timestamps >= timestamp_start) & (timestamps <= timestamp_end)]
                #separate the timestamps data by commas
                timestamps = [str(i) for i in timestamps]
                channelObj = ChannelObject(group.name, channel.name, c_data, channel.properties)
                channelJSON = {
                    "group": group.name,
                    "name": channel.name,
                    "data": c_data,
                    #"length": len(c_data),
                    "timestamps": timestamps,
                    "timestamp_start": timestamp_start,
                    "timestamp_end": timestamp_end,
                    "properties": channel.properties,             
                }
                rootObj = RootObject(properties={
                                        "prop1": "foo",
                                            "prop2": 2,
                                    })
                # tdms_writer.write_segment([rootObj, groupObj, channelObj])
                channelArr.append(channelJSON)
                channelJArr.append(cj_data)
            groupJSON = {
                "name": group.name,
                "channels": channelJArr
            }
            groupArr.append(groupJSON)
                
            
            parentArr.append(groupArr)

#testData = group.channels()

# convert all groups to json file
testJSON = json.dumps(groupArr, indent=4, sort_keys=True, default=str) #json.dumps(group, indent=4, sort_keys=True, default=str)
# with open("jsonEvery1500Complete.json", "w") as outfile:
#     outfile.write(testJSON)

print(testJSON)