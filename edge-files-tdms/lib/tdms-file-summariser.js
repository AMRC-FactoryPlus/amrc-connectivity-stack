import { spawn } from "child_process";

class TDMSSummariser {
  constructor(opts) {
    this.folderPath = opts.folderPath;
    this.eventManager = opts.eventManager;
    this.targetFile = ".\\summary-generator\\test.py";
  }

  async run() {
  var summary = "";
  let child = spawn("python.exe", [this.targetFile, this.folderPath]);
    child.on("error", (err) => { 
      this.eventManager.emit("error", { error: err });
    });

    child.stdout.on("data", function(data){     
      summary += data.toString();  
    });

    // When child process exits, write summary to file
    child.on("exit", function(code, signal) {
      return summary;
    });

  }
}


export default TDMSSummariser;
