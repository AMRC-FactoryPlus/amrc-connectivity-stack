/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

////////////////////////////////////////////////////////////////////////////////
// NOTE - This is intended to be replaced by an extended UDP class at some point
// The new class should send the metric config to the revpi, at which point the 
// RevPi sends metric changes via UDP. The RevPi logic will run on the RevPi as
// per https://amrcgithub.shef.ac.uk/IMG/factoryplus-fieldbusgateway-interface
// For now, the RevPi's will run an old version of the translator app natively.
////////////////////////////////////////////////////////////////////////////////


// import { Device, deviceOptions, DeviceConnection } from "../device.js";
// import { log } from "../helpers/log.js";
// import { SparkplugNode } from "../sparkplugNode.js";
// import { sparkplugMetric, parseValFromBuffer, writeValToBuffer, sparkplugDataType, Metrics } from "../helpers/typeHandler.js";
// import * as fs from 'fs';

// interface register {
//   value: string | boolean | number
//   len: number
//   offset: number
//   comment: string
// }

// interface registerGroup {
//   [index: string]: register;
// }

// interface revPiConf {
//   Devices: any
// }

// /**
//  * RevPiFieldbusConnection is an extension of the DeviceConnection class which
//  * handles connection to a fieldbus gateway on a Revolution Pi.
//  */
// export class RevPiFieldbusConnection extends DeviceConnection {

//   #inpOffset: number
//   #outOffset: number
//   _minInAddrOffset: number
//   _minOutAddrOffset: number
//   _registers: registerGroup
//   #revPiConf: revPiConf
//   #buf: Buffer
//   #connHandle: number
//   /**
//    * Class constructor. Only requires device type in order for class to identify
//    * which type of fieldbus gateway to search for in the list of connected gateways.
//    * @param {string} type The type of device connection
//    */
//   constructor(type: string) {
//     super(type);
//     // Declare metric byte offsets within the piControl file for both input and output metrics
//     this.#inpOffset = -1;
//     this.#outOffset = -1;
//     this._minInAddrOffset = Infinity;
//     this._minOutAddrOffset = Infinity;
//     this._registers = {};

//     // Check to see if the Revpi "Pictory" config file exists, if not then we are not on a RevPi!
//     try {
//       this.#revPiConf = JSON.parse(fs.readFileSync('/var/www/pictory/projects/_config.rsc', 'utf-8'));
//     } catch (e) {
//       throw new Error("Not a RevPi!");
//     }
//     // Find the byte offsets in the piControl file where metrics for this gateway are found.
//     for (const dev of this.#revPiConf.Devices) {
//       if (dev.name == this._type) {
//         this.#inpOffset = dev.offset + parseInt(dev.inp['0'][3]);
//         this.#outOffset = dev.offset + parseInt(dev.out['0'][3]);
//         this._registers = {
//           ...this._registers,
//           ...this.parseRows(dev.inp, dev.offset),
//           ...this.parseRows(dev.out, dev.offset),
//           ...this.parseRows(dev.mem, dev.offset),
//         }
//         let reg = (Object.keys(dev.mem).length ? "mem" : "out");
//         // Get last offset (last item in mem register)
//         const lastOffsetKey = Object.keys(dev[reg])[Object.keys(dev[reg]).length - 1];
//         // Calculate overall buffer length by finding the end of the last offset
//         const bufLen = parseInt(dev[reg][lastOffsetKey][3]) + parseInt(dev[reg][lastOffsetKey][2]);
//         // Create a buffer to hold metric values when picontrol file is read.
//         this.#buf = Buffer.alloc(bufLen);
//         break;
//       }
//     }
//     if (this.#inpOffset < 0 || this.#outOffset < 0) {
//       throw new Error("Gateway offsets could not be found. Check Gateway configuration.");
//     }
//     this.emit('ready');
//   }

//   async open() {
//     // Open the picontrol file in read-write mode
//     this.#connHandle = fs.openSync('/dev/piControl0', 'r+');
//     this.emit('open');
//   }

//   readMetrics(metrics: Metrics, payloadFormat?: string, delimiter?: string) {
//     let error = null;
//     let changedMetrics: sparkplugMetric[] = [];
//     // Read picontrol file contents into buffer.
//     fs.readSync(this.#connHandle, this.#buf, 0, this.#buf.length, 0);
//     // Read metric values from the buffer if they are present
//     for (let i = 0; i < metrics.length; i++) {
//       const metric = metrics.array[i];
//       if (metric.properties.address.value) {
//         const type = metric.type;
//         const method = metric.properties.method.value;
//         const address = parseInt(metric.properties.address.value as string) + (method == "GET" ? this.#inpOffset - this._minInAddrOffset : this.#outOffset - this._minOutAddrOffset) as number
//         const path = metric.properties.path.value as number;
//         const endianness = metric.properties.endianness.value as number;
//         if (method && method !== "DELETE" && address) { // Metrics without methods, addresses, or offsets are static properties
//           // Read metric value from buffer
//           const newVal = parseValFromBuffer(type, endianness, address, this.#buf, path);
//           if (newVal != metric.value) {
//             metrics.setValueByIndex(i, newVal);
//             changedMetrics.push(metrics.array[i]);
//           }
//         }
//       };
//     };
//     this.emit('data', changedMetrics);
//   }

//   writeMetrics(metrics: Metrics, writeCallback: Function, payloadFormat?: string, delimiter?: string) {
//     let error = null;
//     metrics.array.forEach((metric) => {
//       // Get metric address and offset to find where to write to in picontrol file
//       const address = metric.properties.path.value as number + this.#outOffset - this._minOutAddrOffset;
//       const type = metric.type;
//       if (type !== sparkplugDataType.boolean) { // Write bytes to file if not a boolean
//         const buf = writeValToBuffer(metric);
//         try {
//           fs.writeSync(this.#connHandle, buf, 0, buf.length, Math.floor(address));
//           log(`Wrote ${metric.value} to ${metric.name}`);
//         } catch (e) {
//           error = e;
//         }

//       } else { // Boolean special case
//         const byteAddr = Math.floor(address);
//         const bitAddr = (address - byteAddr) * 10;
//         // Read current byte
//         let byte = fs.readSync(this.#connHandle, this.#buf, 0, 1, byteAddr);
//         // Set or clear bit based on new value
//         byte = (metric.value ? byte | (1 << bitAddr) : byte & ~(1 << bitAddr));
//         try {
//           // Write the new byte
//           fs.writeSync(this.#connHandle, Buffer.alloc(1, byte), 0, 1, byteAddr);
//           log(`Wrote bool ${metric.value} to ${metric.name}`);
//         } catch (e) {
//           error = e;
//         }
//       }
//     });
//     writeCallback(error);
//   }

//   /* #######################################
//   Subscriptions inherit from parent class
//   ##########################################*/
//   //startSubscription(metrics, interval) {}
//   //stopSubscription(intHandle){}
//   //##########################################

//   async close() {
//     // Stop all metric change subscriptions
//     // this.stopSubscription();
//     // Close Picontrol file
//     fs.close(this.#connHandle, () => { });
//     this.emit('close');
//   }



//   /**
//    * Parse metric objects from array definitions
//    * @param {array} rows List of metrics specifications to inspect
//    * @param {int} devOffset Byte offset of this revpi device
//    * @returns {object} Parsed metric object
//    */
//   parseRows(rows: (string | number | boolean)[][], devOffset = 0) {
//     let registers: registerGroup = {};
//     Object.values(rows).forEach((row) => {
//       const register: register = this.parseRow(row, devOffset);
//       registers[row[0] as string] = register;
//     });
//     return registers
//   }

//   /**
//    * Parse a metric object from an array definition
//    * @param {object} row The metric specification to parse
//    * @param {int} devOffset Byte offset of this revpi device. Applied as constant offset to all parsed metrics
//    * @returns {object} Parsed metric
//    */
//   parseRow(row: (string | number | boolean)[], devOffset = 0) {
//     // See https://revolution.kunbus.com/tutorials/was-ist-pictory-2/tabellarische-auflistung-aller-json-attribute-einer-rsc-datei-compact/
//     // Row indices:
//     // 0 Name
//     // 1 Default value
//     // 2 Bit length of the value
//     // 3 Offset compared to device offset
//     // 4 Is the value exported?
//     // 5 Sort sequence (for display)
//     // 6 Comment
//     // 7 Contains the bit position for booleans

//     let obj = {                                     // Metric name
//       value: parseInt(row[1] as string).toString() == row[1] ? parseInt(row[1] as string) : row[1],                    // Metric value
//       len: parseInt(row[2] as string),                      // Metric length (datatype)
//       offset: devOffset + parseInt(row[3] as string),       // Metric offset (where metric lives in /dev/piControl0)
//       comment: row[6] as string                            // User comment for metric
//     };

//     if (row[7]) { // If a bit position is specified (boolean metric)
//       // Read the byte offset by doing a floor divide by 8
//       // Add the bit offset using modulo divide by 8, dividing by 10 and adding to the byte offset
//       // Boolean offsets are of the form "m.n" where m is byte number and n is bit number
//       obj.offset += ~~(parseInt(row[7] as string) / 8) + (parseInt(row[7] as string) % 8) / 10;
//     }
//     return obj;
//   }

// }

// export class RevPiFieldbusDevice extends (
//   Device
// ) {
//   #devConn: RevPiFieldbusConnection

//   constructor(spClient: SparkplugNode, devConn: RevPiFieldbusConnection, options: deviceOptions) {
//     super(spClient, devConn, options);
//     this.#devConn = devConn;

//     // Get minimum metric offsets for inputs and outputs. Assumption is metrics start
//     //from memory location 0 on gateway (+ gateway offset below)
//     options.metrics.forEach((metric) => {
//       if (metric.properties.address.value) {
//         // If metric address is a named register in Pictory, find the byte offset
//         // in the control file
//         if ((metric.properties.address.value as string) in this.#devConn._registers) {
//           metric.properties.path.value = this.#devConn._registers[metric.properties.address.value as string].offset
//           metric.value = this.#devConn._registers[metric.properties.address.value as string].value
//         } else {
//           // Otherwise, get numeric part of metric address as it specifies the 
//           // byte offset directly
//           let addrSplit = (metric.properties.address.value as string).match(/(\d+)/g);
//           metric.properties.address.value = addrSplit[0] || null;
//           metric.properties.path.value = addrSplit[1] || null;
//         }

//         if (metric.properties.address.value !== null || undefined) {
//           // If a numeric part was found
//           if (metric.properties.method.value == "GET") {
//             // If metric is "read only", find minimum input offset
//             this.#devConn._minInAddrOffset = Math.floor(
//               Math.min(this.#devConn._minInAddrOffset as number, metric.properties.address.value as number)
//             );
//           } else {
//             // Otherwise find minimum output offset
//             this.#devConn._minOutAddrOffset = Math.floor(
//               Math.min(this.#devConn._minOutAddrOffset, metric.properties.address.value as number)
//             );
//           }
//         }
//       }
//     });
//     this._metrics.add(options.metrics);
//     this._isConnected = true;
//     log(`${this._name} ready`);
//   }
// };
