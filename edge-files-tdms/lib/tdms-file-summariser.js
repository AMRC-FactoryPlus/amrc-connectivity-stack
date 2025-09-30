import { spawn } from "child_process";
import { isFileExist } from './utils.js';
import { BufferX } from "@amrc-factoryplus/edge-driver";
import fs from 'node:fs'

class TDMSSummariser {
  constructor(opts) {
    this.eventManager = opts.eventManager;
    this.stateManager = opts.stateManager;
    //this.env = opts.env;
    this.pythonSummariserScript = opts.env.PYTHON_SUMMARISER_SCRIPT;
    this.driver = opts.driver; // Assuming driver is passed for data upload
    this.specs = null;
    
    // console.log(`SUMMARISER: Driver initialised: ${this.driver}`);
  }

  // Method to run the Python script and return the summary
  async run() {
    this.bindToEvents();
  }

  bindToEvents() {
    // this.eventManager.on('driver:ready', this.handleDriverReady.bind(this));
    this.eventManager.on('file:uploaded', this.handleFileSummary.bind(this));
  }

  // handleDriverReady = async (specs) => {
  //   console.log(`SUMMARISER: Driver is ready with specs: ${JSON.stringify(specs)}`);
  //   this.specs = specs;
    
  // }

  handleFileSummary = async ({filePath}) => {
    try {
      //console.log("SUMMARISER: env is ", this.env);
      console.log(`SUMMARISER: Generating summary for ${filePath} using ${this.pythonSummariserScript}`);
     if (!(await isFileExist(filePath))) {
      console.log(`SUMMARISER: Filepath ${filePath} does not exist.`);
      console.error(`SUMMARISER: Filepath ${filePath} does not exist.`);
      return;
     }

     let summary;
     const fileState = await this.stateManager.getFileState(filePath);
     let fileUuid = fileState?.uuid;

     const child = spawn("/opt/venv/bin/python3", [this.pythonSummariserScript, filePath, fileUuid]);
        child.on("error", (err) => {
          console.log(`SUMMARISER: Error starting Python script: ${err.message}`);
          console.error(`SUMMARISER: Error starting Python script: ${err.message}`);
          throw err;
        });

        child.on("spawn", () => {
          console.log('SUMMARISER: Python script started successfully.');
        });

        child.stdout.on("data", function(data){
          console.log('SUMMARISER: Summary data received from Python script: \n', data.toString());
          // summary += JSON.parse(data.toString()); //data.toString();
          //console.log(`SUMMARISER: Python script output - ${data}`);
        });

        child.stderr.on('data', (data) => {
          console.log(`SUMMARISER: python stderr - ${data}`);
          console.error(`SUMMARISER: python stderr - ${data}`);
        });

        child.stdout.on('end', () => {
          console.log('SUMMARISER: Python script stdout stream ended.');
        }); 

        child.stdout.on('exit', (code) => {
          console.log(`SUMMARISER: Python script stdout stream exited with code ${code}.`);
        });

        child.on("close", async (code) => {
            if (code === 0) {
              console.log('SUMMARISER: Python script completed successfully. File exported to summary_' + fileUuid + '.json');
              console.log('Summary:', summary);
              const isSummaryUploaded = await this.uploadToInflux(filePath, fileUuid);
              if(isSummaryUploaded){
                this.eventManager.emit('file:summaryPrepared', {filePath: filePath});
              }else{
                this.eventManager.emit('file:summaryFailed', {filePath, error: new Error(`Python script exited with code ${code}`)});
              }

            } else {
              this.eventManager.emit('file:summaryFailed', {filePath, error: new Error(`Python script exited with code ${code}`)});
            }
        });

        child.on("error", (err) => {
          console.log(`SUMMARISER: Error during Python script execution: ${err.message}`);
          console.error(`SUMMARISER: Error during Python script execution: ${err.message}`);
          this.eventManager.emit('file:summaryFailed', {filePath, error: err});
        });
    }

    catch (err) {
      console.log(`SUMMARISER: Error summarising ${filePath}`, err);
      console.error(`SUMMARISER: Error summarising ${filePath}`, err);
      // this.eventManager.emit(EVENTS.FILE_SUMMARY_FAILED, {filePath, error: err});
    }
  }

  async uploadToInflux(filePath, fileUuid){
    
    
    // Handle summary data (upload to influxDB?)
    
    let file = fs.readFileSync('./summary_' + fileUuid + '.json', 'utf8');
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

      if(this.specs == null){
        console.log("SUMMARISER: Specs not set, cannot upload summary.");
        return false;
      }
     
      summaryFileJSON.forEach((obj) =>{
        obj.channels.forEach((channel) => {
          let channelName = "";
          summaryArr = [];
          channel.forEach((item, index) => {
            // console.log(`Item at index ${index}:`, item.data);

            //get data and timestamps from each item if they exist

            //console.log(`Channel: ${item.name} Data: ${item.data} Timestamp: `, item.timestamps);
            const buffer = {
                      //[item.name]: 
                      //{ 
                        //name: item.name, 
                        //timestamp: item.timestamp, 
                      //  data: item.data },
                      timestamp: item.timestamp,
                      //data: item.data
                      value: item.data,
                     };
            let bufferStr = BufferX.fromJSON(buffer);
            channelName = item.name;
            // this.driver.data(this.specs, bufferStr);
            summaryArr.push(buffer);
            
          });
          let bufferArr = BufferX.fromJSON(summaryArr);
          this.driver.data(channelName, bufferArr);
        });
      });

      const buffer ={
        "Ambient - RTD":{
          "name": "Ambient - RTD"
        },
        "data": 999,
        "timestamp": 1663338093
      };

      const buffer2 ={
        channel:{
          data: 899,
        },
        timestamp: 1663338093
      };

      const buffer3 ={
        channel:{
          data: 799,
          timestamp: 1663338093
        },
      };

      const buffer4 ={
        channel:{
          data: 1699
        },
      };

      //upload a few test points
      this.driver.data(this.specs, JSON.stringify(buffer));
      this.driver.data(this.specs, JSON.stringify(buffer2));
      this.driver.data(this.specs, JSON.stringify(buffer3));
      this.driver.data(this.specs, JSON.stringify(buffer4));
      
      // let bufferStr = JSON.stringify(buffer);
      // this.driver.data(this.specs, bufferStr);

      // let summaryArrStr = JSON.stringify(summaryArr);
      // this.driver.data(this.specs, summaryArrStr);
      // console.log(`SUMMARISER: Posting summary - ${summaryArrStr}`);

      console.log("SUMMARISER: specs are ", this.specs);
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
