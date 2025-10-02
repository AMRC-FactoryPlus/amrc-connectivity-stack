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
    
    // console.log(`SUMMARISER: Driver initialised: ${this.driver}`);
  }

  // Method to run the Python script and return the summary
  async run() {
    this.bindToEvents();
  }

  bindToEvents() {
    this.eventManager.on('file:uploaded', this.handleFileSummary.bind(this));
  }

  handleFileSummary = async ({ filePath }) => {
    try {
      //console.log("SUMMARISER: env is ", this.env);
      console.log(`SUMMARISER: Generating summary for ${filePath} using ${this.pythonSummariserScript}`);
      if (!(await isFileExist(filePath))) {
        console.log(`SUMMARISER: Filepath ${filePath} does not exist.`);
        throw new Error(`Filepath ${filePath} does not exist.`);
      }

      let summary;
      const fileState = await this.stateManager.getFileState(filePath);
      let fileUuid = fileState?.uuid;

      const child = spawn("/opt/venv/bin/python3", [this.pythonSummariserScript, filePath, fileUuid]);

      child.on("spawn", () => {
        console.log('SUMMARISER: Python script started successfully.');
      });

      child.stderr.on('data', (data) => {
        console.log(`SUMMARISER: python stderr - ${data}`);
      });

      child.on("close", async (code) => {
        if (code === 0) {
          console.log('SUMMARISER: Python script completed successfully. File exported to summary_' + fileUuid + '.json');
          const isSummaryUploaded = await this.uploadToInflux(filePath, fileUuid);
          if (isSummaryUploaded) {
            this.eventManager.emit('file:summaryPrepared', { filePath: filePath });
          } else {
            this.eventManager.emit('file:summaryFailed');
          }

        } else {
          this.eventManager.emit('file:summaryFailed', { filePath, error: new Error(`Python script exited with code ${code}`) });
        }
      });

      child.on("error", (err) => {
        this.eventManager.emit('file:summaryFailed', { filePath, error: err });
      });
    }

    catch (err) {
      this.eventManager.emit('file:summaryFailed', { filePath, error: err });
      // this.eventManager.emit(EVENTS.FILE_SUMMARY_FAILED, {filePath, error: err});
    }
  }

  async uploadToInflux(filePath, fileUuid) {


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
      let summaryArr, totalSummaryArr = [];

      summaryFileJSON.forEach((obj) => {
        obj.channels.forEach((channel) => {
          let channelName = "";
          summaryArr = [];
          channel.forEach((item, index) => {
            // console.log(`Item at index ${index}:`, item.data);

            //get data and timestamps from each item if they exist

            //console.log(`Channel: ${item.name} Data: ${item.data} Timestamp: `, item.timestamps);
            const buffer = {
              timestamp: item.timestamp,
              value: item.data
            };
            // let bufferStr = BufferX.fromJSON(buffer);
            channelName = item.name;
            // this.driver.data(this.specs, bufferStr);
            summaryArr.push(buffer);
            totalSummaryArr.push(buffer);

          });
          let bufferArr = BufferX.fromJSON(summaryArr);
          this.driver.data(channelName, bufferArr);
        });
      });
      //get earliest timestamp from totalSummaryArr
      let earliestTimestamp = Math.min(...totalSummaryArr.map(o => o.timestamp));
      console.log(`SUMMARISER: Earliest timestamp for ${filePath} is ${earliestTimestamp}`);

      this.driver.data("FileUUID", BufferX.fromJSON([{ timestamp: earliestTimestamp, value: fileUuid }]));

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
