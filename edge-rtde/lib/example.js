var net = require("net");
var rtde = require("./ur.js");

var host = "192.168.2.38";
var port = 30001;
var samples = 5;

var tmp = 0;

var client = new net.Socket();
client.connect(port, host, function () {
  console.log("Connected to RTDE on " + host + ":" + port);
});

client.on("data", function (data) {
  var res = new rtde().onData(data);
  if (res !== undefined) {
    console.log(JSON.stringify(res));
  }
  if (tmp >= samples) {
    client.destroy();
  }
  tmp++;
});

client.on("close", function () {
  console.log("Connection closed");
});
