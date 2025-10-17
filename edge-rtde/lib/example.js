import net from "net";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

// Import ur.js from node_modules using require since it's CommonJS
const urPath = join(__dirname, "..", "node_modules", "ur-rtde", "ur.js");
const rtde = require(urPath);

var host = "192.168.56.140";
var port = 30001;
var samples = 5;

var tmp = 0;

var client = new net.Socket();
client.connect(port, host, function () {
  console.log("Connected to robot on " + host + ":" + port);
});

client.on("data", function (data) {
  var res = new rtde().onData(data);
  if (res !== undefined) {
    console.log(JSON.stringify(res, null, 2));
  }
  if (tmp >= samples) {
    client.destroy();
  }
  tmp++;
});

client.on("close", function () {
  console.log("Connection closed");
});
