import { spawn } from "child_process";
import { EVENTS } from './tdms-file-events.js';
import { isFileExist } from './utils.js';
import fs from 'node:fs'

class TDMSSummariser {
  constructor(opts) {
    // this.eventManager = opts.eventManager;
    // this.pythonSummariserScript = opts.pythonSummariserScript;
    this.driver = opts.driver; // Assuming driver is passed for data upload
  }

  // Method to run the Python script and return the summary
  // async run() {
  //   this.bindToEvents();
  // }

  // bindToEvents() {
  //   this.eventManager.on(EVENTS.FILE_UPLOADED, this.handleFileSummary.bind(this));
  // }

  // async handleFileSummary({filePath}) {
  //   try {
  //    if (!(await isFileExist(filePath))) {
  //     console.error(`SUMMARISER: Filepath ${filePath} does not exist.`);
  //     return;
  //    }

  //    let summary;

  //    const child = spawn("python.exe", [this.pythonSummariserScript, filePath]);
  //       child.on("error", (err) => {
  //         console.error(`Error starting Python script: ${err.message}`);
  //         throw err;
  //       });

  //       child.stdout.on("data", function(data){
  //         console.log('Summary data received from Python script:');
  //         //summary += JSON.parse(data.toString()); //data.toString();
  //         //console.log(`SUMMARISER: Python script output - ${data}`);
  //       });

  //       child.stderr.on('data', (data) => {
  //         console.error(`SUMMARISER: python stderr - ${data}`);
  //       });

  //       child.on("close", async (code) => {
  //           if (code === 0) {
  //             console.log('SUMMARISER: Python script completed successfully.');
  //             // console.log('Summary:', summary);
  //             const isSummaryUploaded = await this.uploadToInflux(filePath, summary);
  //             if(isSummaryUploaded){
  //               this.eventManager.emit(EVENTS.FILE_SUMMARY_PREPARED, {filePath: filePath});
  //             }else{
  //               this.eventManager.emit(EVENTS.FILE_SUMMARY_FAILED, {filePath, error: new Error(`Python script exited with code ${code}`)});
  //             }

  //           } else {
  //             this.eventManager.emit(EVENTS.FILE_SUMMARY_FAILED, {filePath, error: new Error(`Python script exited with code ${code}`)});
  //           }
  //       });
  //   }

  //   catch (err) {
  //     console.error(`SUMMARISER: Error summarising ${filePath}`, err);
  //     // this.eventManager.emit(EVENTS.FILE_SUMMARY_FAILED, {filePath, error: err});
  //   }
  // }

  async uploadToInflux(filePath, summary){
    // Handle summary data (upload to influxDB?)
    let file = fs.readFileSync('./finalSummary.json', 'utf8');
    //let summaryStr = Buffer.from(summary, "utf8");
    //console.log(`Summary for ${filePath} is uploaded to InfluxDB.`);
    
    //turn summary into JSON object
    let summaryJSON;
    let summaryFileJSON;

    try {
      //summaryJSON = JSON.stringify(summary);
     
      summaryFileJSON = JSON.parse(file);
      
      //loop through the summaryJSON and log each key-value pair
     
      summaryFileJSON.forEach((obj) =>{
        obj.channels.forEach((channel) => {
          channel.forEach((item, index) => {
            // console.log(`Item at index ${index}:`, item.data);

            //get data and timestamps from each item if they exist

            //console.log(`Channel: ${item.name} Data: ${item.data} Timestamp: `, item.timestamps);
            const buffer = JSON.stringify({
                      channel: { 
                        name: item.name, 
                        timestamp: item.timestamps, 
                        data: item.data }
                      //val: item.data,
                    });
            this.driver.data(filePath, buffer);
          });
        });
      });
      // this.driver.data(filePath, JSON.stringify({timestamp: "2025-01-01T00:00:00Z", tsint: 1704067200000, val: 600.00})); //timestamp: "2025-01-01T00:00:00Z",
      // this.driver.data(filePath, JSON.stringify({timestamp: "2025-07-16T00:00:00Z", tsint: 1710393600000, val: 200.00}));
      // this.driver.data(filePath, JSON.stringify({val: 723.00})); //timestamp: "2025-01-01T00:00:00Z",
      // this.driver.data(filePath, JSON.stringify({val: 550.00})); //timestamp: "2025-01-01T00:00:00Z",
      // this.driver.data(filePath, JSON.stringify({"Data":{"val": 323.00}})); //timestamp: "2025-01-01T00:00:00Z",
      // this.driver.data(filePath, JSON.stringify({"Data":{"TDMSTest": 423.00}})); //timestamp: "2025-01-01T00:00:00Z",
      
      return true; // Indicate successful upload
    } catch (e) {
      //console.error(`SUMMARISER: Error parsing summary JSON for ${filePath}:`, e);
      console.error(`SUMMARISER: Error parsing summary JSON for ${filePath}:`, e);
      return false;
    }
    //return true;
  }
}

export default TDMSSummariser;