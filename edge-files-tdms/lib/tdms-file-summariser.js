import { spawn } from "child_process";
import { EVENTS } from './tdms-file-events.js';
import { isFileExist } from './utils.js';

class TDMSSummariser {
  constructor(opts) {
    this.eventManager = opts.eventManager;
    this.targetPythonFile = ".\\lib\\summary-generator\\tdms_parser.py";
  }

  // Method to run the Python script and return the summary
  async run() {
    this.bindToEvents();
  }

  bindToEvents() {
    this.eventManager.on(EVENTS.FILE_UPLOADED, this.handleFile.bind(this));
    console.log('SUMMARISER: Preparing summary...');
  }

  async handleFile({filePath}) {
    try {
     if (!(await isFileExist(filePath))) {
      console.error(`SUMMARISER: Filepath ${filePath} does not exist.`);
      return;
     }    

     var summary;

     const child = spawn("python.exe", [this.targetPythonFile, filePath]);
        child.on("error", (err) => {
          console.error(`Error starting Python script: ${err.message}`);
          throw err;
        });

        child.stdout.on("data", function(data){
          console.log('Summary data received from Python script:'); 
          summary += data.toString();  
        });

        child.stderr.on('data', (data) => {
          console.error(`SUMMARISER: python stderr - ${data}`);
        });

        // When child process exits, return summary json
        return new Promise((resolve, reject) => {
          child.on("close", (code) => {
            if (code === 0) {
              console.log('SUMMARISER: Python script completed successfully.');
              // console.log('Summary:', summary);
              resolve(summary);
            } else {
              reject(new Error(`SUMMARISER: Python script exited with code ${code}`));
            }
          });
        });
    }

    catch (err) {
      console.error(`SUMMARISER: Error summarising ${filePath}`, err);
      this.eventManager.emit(EVENTS.FILE_UPLOAD_FAILED, {filePath, error: err});
    }

   
  }

 
}   
 


export default TDMSSummariser;

// for testing 
// const tdmsSummariser = new TDMSSummariser({
//   filePath: '../../../../TDMS_Examples/Fingerprint_2023-05-09-02-14-34.tdms'
// });

// let summary = await tdmsSummariser.run();
// console.log('Summary length:', summary.length);