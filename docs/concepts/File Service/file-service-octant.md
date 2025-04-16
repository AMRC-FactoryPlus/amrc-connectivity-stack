
# File Service Octant

## Objective

- Define process for automatic ingestion of large TDMS files (>100MB) from the local file system directory into
the ACS File Service storage:
  - Option 1: Store files as a blob in Kubernetes volume. 
  - Option 2: Parse the TDMS file and store them in a database which can handle time series data (InfluxDB?). 

- Investigate if ACS can extract context from the TDMS files:
  - Option 1: Parse the TDMS file and extract the data summary/partial representation of the data. 
  - Option 2: Query the time series database for a summary/partial representation of the data.

The data from the sensors is written to the TDMS at high frequency (1MHz) but the files are produced at a rate ranging
from 1-10(s) of minutes.
 
## Solution 

### Component 1: Folder Watcher
- Implement a new feature within the File Service that watches a folder where .tdms files are being generated. Use a Node.js 
tool such as chokidar for monitoring file changes.
- The watcher must run in a separate process to ensure it does not block the File Service's web server. This can be done 
using Node's child_process module, which also allows us to run Python scripts if needed for TDMS parsing.
- The watcher must emit an event when new files have been fully written to disk and can be uploaded. This could involve checking for file 
size stability.
- Add an option for deleting local TDMS files after successfully uploading to free up disk space.
- Include basic logging and metrics to monitor the number of files processed, upload success or failure, and available disk space.
- Implementing a retry mechanism for failed uploads and (optionally) move failed files to a separate folder for inspection.
- Add a simple status endpoint or CLI command within the File Service to report ingestion progress and any backlog of unprocessed files.

### Component 2: Uploader
#### Option 1
 - On an event from the folder watcher, the uploader will post the TDMS file to the ACS File Service to store in the Kubernetes volume. 

#### Option 2
- Parse the TDMS file and insert the data into a time series database local to ACS File Service. 

### Component 3: Summary Generator
- A data summary is generated when an ACS File Service endpoint is called for a given file UUID.
  `GET /v1/file/summary/:uuid`

#### Option 1
- `GET /v1/file/summary/:uuid` is called, the file from the kubernetes volume is parsed and a summary is generated and returned. 
#### Option 2
- `GET /v1/file/summary/:uuid` is called and the file service queries the time series database for the summary which is returned. 

### Component 4: Storage

#### Option 1 
- Kubernetes volume.
#### Option 2 
- Time series database. 
- Do we want to store the raw file anyway in Kubernetes volume? 

## Testing
- Request a large volume of sample TDMS files from James to simulate real-world usage scenarios.
- Create a script within the /tests directory of the File Service that mimics file generation and high frequency data writing. 
- This script should copy or write files into the watched folder at a rate comparable to the expected production load (1MHz).
- Validate the behavior of the watcher with a focus on the following points:
  - It accurately detects new files once they are fully written.
  - It uploads files consistently and reliably, even large files under high load.
  - It avoids uploading files prematurely, before they are fully written.
  - It only deletes files that have been successfully uploaded and the option is enabled.
  - It does not miss or duplicate file uploads.

## Questions: 
 - Will this be part of an ACS edge deployment or will it be a separate application which interacts with ACS? 
 - What does the physical architecture of this look like? 
 - Should we also create metadata for TDMS files in ConfigDB?

