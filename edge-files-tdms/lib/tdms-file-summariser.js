import { spawn } from "child_process";
import fs from "fs";

class TDMSSummariser {
  constructor(opts) {
    this.folderPath = opts.folderPath;
    this.eventManager = opts.eventManager;
    this.retryCounts = new Map();
    this.targetFile = ".\\summary-generator\\test.py";
  }

  async run() {
    child = spawn("python.exe", [this.targetFile, this.folderPath], {
      cwd: ".\\summary-generator",
      shell: true,
      stdio: "inherit",
    });
    child.on("error", (err) => {
      console.error(`Error starting Python script: ${err.message}`);
      this.eventManager.emit("error", { error: err });
    });
  }
}

console.log("TDMSSummariser: Initializing...");
let folderPath = '../../../../TDMS_Examples/Fingerprint_2023-05-09-02-14-34.tdms';
var summary;
let child = spawn("python.exe", [".\\summary-generator\\test.py", folderPath]/*, {
      cwd: ".",
      shell: true,
      stdio: "pipe",
    }*/);
    child.on("error", (err) => {
      console.error(`Error starting Python script: ${err.message}`);
      //this.eventManager.emit("error", { error: err });
    });
    
    child.stdout.on("data", function(data){
      console.log('Summary data received from Python script:');
      //Get json data from Python script
      // const dataString = data.toString();
      // //console.log(dataString);
      // try {
      //   const jsonData = JSON.parse(dataString);
      //   console.log('Parsed JSON data:', jsonData);
      //   // Process the JSON data as needed
      //   summary = jsonData;
      // } catch (error) {
      //   console.error('Error parsing JSON data:', error);
      // }
      summary = data;
      //Export as json file
      fs.writeFileSync('summary.json', JSON.stringify(summary, null, 2));
      //console.log(`Summary: ${summary}`);
      //console.log(summary[0]);
    });
  

export default TDMSSummariser;
