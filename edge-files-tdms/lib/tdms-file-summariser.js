import { spawn } from "child_process";
import { isFileExist } from './utils.js';
import { BufferX } from "@amrc-factoryplus/edge-driver";
import fs from 'node:fs'

class TDMSSummariser {
  constructor(opts) {
    this.eventManager = opts.eventManager;
    this.pythonSummariserScript = opts.env.pythonSummariserScript;
    this.driver = opts.driver; // Assuming driver is passed for data upload
  }

  // Method to run the Python script and return the summary
  async run() {
    this.bindToEvents();
  }

  bindToEvents() {
    this.eventManager.on('file:uploaded', this.handleFileSummary.bind(this));
  }

  async handleFileSummary({filePath}) {
    try {
     if (!(await isFileExist(filePath))) {
      console.error(`SUMMARISER: Filepath ${filePath} does not exist.`);
      return;
     }

     let summary;

     const child = spawn("python.exe", [this.pythonSummariserScript, filePath]);
        child.on("error", (err) => {
          console.error(`Error starting Python script: ${err.message}`);
          throw err;
        });

        child.stdout.on("data", function(data){
          console.log('Summary data received from Python script:');
          //summary += JSON.parse(data.toString()); //data.toString();
          //console.log(`SUMMARISER: Python script output - ${data}`);
        });

        child.stderr.on('data', (data) => {
          console.error(`SUMMARISER: python stderr - ${data}`);
        });

        child.on("close", async (code) => {
            if (code === 0) {
              console.log('SUMMARISER: Python script completed successfully.');
              // console.log('Summary:', summary);
              const isSummaryUploaded = await this.uploadToInflux(filePath, summary);
              if(isSummaryUploaded){
                this.eventManager.emit('file:summaryPrepared', {filePath: filePath});
              }else{
                this.eventManager.emit('file:summaryFailed', {filePath, error: new Error(`Python script exited with code ${code}`)});
              }

            } else {
              this.eventManager.emit('file:summaryFailed', {filePath, error: new Error(`Python script exited with code ${code}`)});
            }
        });
    }

    catch (err) {
      console.error(`SUMMARISER: Error summarising ${filePath}`, err);
      // this.eventManager.emit(EVENTS.FILE_SUMMARY_FAILED, {filePath, error: err});
    }
  }

  async uploadToInflux(filePath, summary){
    //check if filePath exists
    // let testState = fs.readFileSync('./testState.json', 'utf8');
    // let testStateJSON = JSON.parse(testState);
    // if(testStateJSON.summaryUploaded){
    //   console.log(`SUMMARISER: Summary for ${filePath} already uploaded.`);
    //   return true; // Indicate successful upload
    // }
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
      let summaryArr =[];
     
      summaryFileJSON.forEach((obj) =>{
        obj.channels.forEach((channel) => {
          channel.forEach((item, index) => {
            // console.log(`Item at index ${index}:`, item.data);

            //get data and timestamps from each item if they exist

            //console.log(`Channel: ${item.name} Data: ${item.data} Timestamp: `, item.timestamps);
            const buffer = {
                      [item.name]: { 
                        //name: item.name, 
                        //timestamp: item.timestamps, 
                        data: item.data },
                      timestamp: item.timestamp
                      //val: item.data,
                     };
            //let bufferStr = JSON.stringify(buffer);
            //this.driver.data(filePath, bufferStr);
             summaryArr.push(buffer);
            
          });
        });
      });

      let summaryArrStr = JSON.stringify(summaryArr);
      this.driver.data(filePath, summaryArrStr);

      //split array in half
      // let midIndex = Math.floor(summaryArr.length / 2);
      // let firstHalf = summaryArr.slice(0, midIndex);
      // let secondHalf = summaryArr.slice(midIndex);

      // let summaryArrStr = JSON.stringify(firstHalf);
      //let summaryArrStr = JSON.stringify(summaryArr);
      //this.driver.data(filePath, summaryArrStr);

      //delay for 30 seconds to ensure data is ready
      // await new Promise(resolve => setTimeout(resolve, 30000));

      // console.log("Posting second half of summary to InfluxDB");
      // summaryArrStr = JSON.stringify(secondHalf);
      // this.driver.data(filePath, summaryArrStr);
     
      //Update testState to indicate summary is uploaded
      // testStateJSON.summaryUploaded = true;
      // fs.writeFileSync('./testState.json', JSON.stringify(testStateJSON, null, 2));
      console.log(`SUMMARISER: Summary for ${filePath} uploaded to InfluxDB.`);
      //this.eventManager.emit(EVENTS.FILE_SUMMARY_PREPARED, {
      
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