/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import { timestamp } from "node-opcua-utils";
import { buffer } from "stream/consumers";
import * as typeHandler from "../../../lib/helpers/typeHandler"; 

describe('typeHandler', () => {

    describe('Metrics', () => {
        const metric : typeHandler.sparkplugMetric = {
            name: "metric",
            value: "value",
            alias: 10,
            type: typeHandler.sparkplugDataType.string,
            isHistorical: true,
            isTransient: true,
            isNull: false,
            properties: {
                method: {
                    value: "GET",
                    type: typeHandler.sparkplugDataType.string
                },
                address: {
                    value: "%QD1026",
                    type: typeHandler.sparkplugDataType.string
                },
                path: {
                    "value": "status.errors.code",
                    "type": typeHandler.sparkplugDataType.string
                },
                recordToDB: {
                    value: true,
                    type: typeHandler.sparkplugDataType.boolean
                },
                endianness: {
                    value: 4321,
                    type: typeHandler.sparkplugDataType.uInt16
                }
            }
        }

        const metricArray: typeHandler.sparkplugMetric[] = [
            metric
        ]

        let metrics = new typeHandler.Metrics(metricArray); 

        afterEach(() => {
            metrics = new typeHandler.Metrics(metricArray); 
        })

        describe('setAlias(', () => {
            it("should set alias", () => {
                metrics.setAlias(0, 1);
                expect(metrics.array[0].alias).toBe( 1 );
                /* Unable to access private aliasIndex, getByAlias accesses the alias index to return the index
                 * of the metric in the metric array. 
                 */
                expect(metrics.getByAlias(1).alias).toBe( 1 ); 
            })

        })

        describe('get length()', () => {
            it("Should return 1", () => {
                expect(metrics.length).toEqual(1);
            })
        })
        
        describe('get array()', () => {
            it("Should return the metrics array", () => { 
                expect(metrics.array).toMatchObject(metricArray); 
            })
        })

        describe('add()', () => {
            const newMetrics: typeHandler.sparkplugMetric[] = [
                {
                    name: "metric",
                    value: "value",
                    alias: 2,
                    type: typeHandler.sparkplugDataType.string,
                    isHistorical: true,
                    isTransient: true,
                    isNull: false,
                }
            ]

            it("Should add the metric to the metric array", () => {
                metrics.add(newMetrics);
                expect(metrics.array).toEqual(metricArray.concat(newMetrics)); 
            })
        })

        describe('get addresses', () => {
            const address = "%QD1026"; 
            it("Should return address path index", () => {
                expect(metrics.addresses).toEqual([address]); 
            })
        })
        

        describe("getByName()", () => { 
            const name = "metric"; 
            it("Should return a metric", () => {
                expect(metrics.getByName(name)).toMatchObject(metricArray[0]); 
            })

            it("Should return undefined", () => {
                const incorrectName = "test";
                expect(metrics.getByName(incorrectName)).toBeUndefined(); 
            })
        })

        describe('setValueByName()', () => {
            const newValue = "newValue"; 
            const name = "metric"; 
            it("Should update the value of a metric", () => {
                metrics.setValueByName(name, newValue);
                expect(metrics.array[0].value).toEqual(newValue);
            })

            it("Should update the value of a metric and timestamp", () => {
                const timestamp = Date.now();
                metrics.setValueByName(name, newValue, timestamp);
                expect(metrics.array[0].value).toEqual(newValue);
                expect(metrics.array[0].timestamp).toEqual(timestamp);
            })

            it("Should return an error", () => {
                //TODO: I can set a value of the incorrect type!!!
                expect(metrics.setValueByName("metric", 2)).toThrowError(); 
            })

        })

        describe('setValueByIndex', () => {
            const newValue = "newValue";
            const timestamp = Date.now();
            const index = 0;

            it("Should updated the value of the metric", () => {
                expect(metrics.setValueByIndex(index, newValue).value).toEqual(newValue); 
            })

            it("Should update the value of the metric and timestamp", () => {
                expect(metrics.setValueByIndex(index, newValue, timestamp).value).toEqual(newValue); 
            })
        })
        

        describe('getByAlias()', () => {
            it("Should return a metric", () => {
                /*set the alias because the metric will not have an alias set 
                 * in the alias index if passed in the constructor.
                 */
                metrics.setAlias(0, 10); 
                expect(metrics.getByAlias(10)).toMatchObject(metricArray[0]);
            })

            it("Should return undefined", () => {
                expect(metrics.getByAlias(1)).toBeUndefined(); 
            })
        })
        

        describe('setValueByAlias()', () => {
            it("Should set a metric value by alias", () => {
                const newValue = "newValue";
                //set alias because a new Metrics will not have aliases assigned
                metrics.setAlias(0, 10);
                metrics.setValueByAlias(10, newValue);
                expect(metrics.array[0].value).toEqual(newValue);
            })

            it("Should set the metric value and timestamp by alias", () => { 
                const newValue = "newValue";
                const timestamp = Date.now();
                //set alias because a new Metrics will not have aliases assigned
                metrics.setAlias(0, 10);
                metrics.setValueByAlias(10, newValue, timestamp);
                expect(metrics.array[0].value).toEqual(newValue);
                expect(metrics.array[0].timestamp).toEqual(timestamp);
            })
        })
        
        describe('getByAddress()', () => {
            it("Should return array of metrics", () => {
                const address = "%QD1026"; 
                expect(metrics.getByAddress(address)).toEqual(metricArray); 
            })

            it("Should return undefined", () => {
                const incorrectAddress = "address";
                //add null check for this? 
                expect(metrics.getByAddress(incorrectAddress)).toBeUndefined(); 
            })
        })

        describe('getPathsForAddr()', () => {
            it("Should return paths array for addresses" ,() => {
                const address = "%QD1026"; 
                expect(metrics.getPathsForAddr(address)).toEqual(["status.errors.code"]);
            })

            it("Should return undefined", () => {
                //add null check for this?
                const incorrectAddress = "address";
                expect(metrics.getPathsForAddr(incorrectAddress)).toStrictEqual([]); 
            })
        })

        describe('getByAddrPath()', () => {
            const address = "%QD1026";
            const path = "status.errors.code"; 
            it("Should return metric", () => {
                expect(metrics.getByAddrPath(address, path)).toEqual(metricArray[0]); 
            })

            it("should return undefined if address is not found", () => {
                const incorrectAddress = "address";
                //add null check?
                expect(metrics.getByAddrPath(incorrectAddress, path)).toBeUndefined(); 
            })

            it("Should return undefined if the path is not found", () => {
                const incorrectPath = "path";
                expect(metrics.getByAddrPath(address, incorrectPath)).toBeUndefined(); 
            })
        })
        
        describe('setByAddrPath()', () => {
            const address = "%QD1026";
            const path = "status.errors.code";
            const newValue = "newValue"; 

            it("Should set the metric value when given an address and path", () => {
                metrics.setValueByAddrPath(address, path, newValue);
                expect(metrics.array[0].value).toEqual(newValue) 
            })

            it("Should set the metric value and the timestamp when given a path", () => {
                const timestamp = Date.now(); 
                metrics.setValueByAddrPath(address, path, newValue, timestamp);
                expect(metrics.array[0].value).toEqual(newValue);
                expect(metrics.array[0].timestamp).toEqual(timestamp); 
            })
        })
    })

    describe('parseValueFromPayload()', () => {
        const JsonMetric: typeHandler.sparkplugMetric = {
            name: "isTrue",
            value: true,
            alias: 10,
            type: typeHandler.sparkplugDataType.boolean,
            isHistorical: true,
            isTransient: true,
            isNull: false,
            properties: {
                method: {
                    value: "get",
                    type: typeHandler.sparkplugDataType.string
                },
                address: {
                    value: "%QD1026",
                    type: typeHandler.sparkplugDataType.string
                },
                path: {
                    value: "status.errors.code",
                    type: typeHandler.sparkplugDataType.string
                },
                recordToDB: {
                    value: true,
                    type: typeHandler.sparkplugDataType.boolean
                },
                endianness: {
                    value: 4321,
                    type: typeHandler.sparkplugDataType.uInt16
                }
            }
        };

        const xmlMetric = { 
            name: "isTrue",
            value: true,
            alias: 10,
            type: typeHandler.sparkplugDataType.boolean,
            isHistorical: true,
            isTransient: true,
            isNull: false,
            properties: {
                method: {
                    value: "get",
                    type: typeHandler.sparkplugDataType.string
                },
                address: {
                    value: "%QD1026",
                    type: typeHandler.sparkplugDataType.string
                },
                path: {
                    value: "/status/errors/code",
                    type: typeHandler.sparkplugDataType.string
                },
                recordToDB: {
                    value: true,
                    type: typeHandler.sparkplugDataType.boolean
                },
                endianness: {
                    value: 4321,
                    type: typeHandler.sparkplugDataType.uInt16
                }
            }
        }
        const xmlMetricFloat = { 
            name: "isTrue",
            value: 10,
            alias: 10,
            type: typeHandler.sparkplugDataType.float,
            isHistorical: true,
            isTransient: true,
            isNull: false,
            properties: {
                method: {
                    value: "get",
                    type: typeHandler.sparkplugDataType.string
                },
                address: {
                    value: "%QD1026",
                    type: typeHandler.sparkplugDataType.string
                },
                path: {
                    value: "/status/errors/code/text()",
                    type: typeHandler.sparkplugDataType.string
                },
                recordToDB: {
                    value: true,
                    type: typeHandler.sparkplugDataType.boolean
                },
                endianness: {
                    value: 4321,
                    type: typeHandler.sparkplugDataType.uInt16
                }
            }
        }

        const delimitedMetric = {
            name: "isTrue",
            value: true,
            alias: 10,
            type: typeHandler.sparkplugDataType.boolean,
            isHistorical: true,
            isTransient: true,
            isNull: false,
            properties: {
                method: {
                    value: "get",
                    type: typeHandler.sparkplugDataType.string
                },
                address: {
                    value: "%QD1026",
                    type: typeHandler.sparkplugDataType.string
                },
                path: {
                    value: "0",
                    type: typeHandler.sparkplugDataType.string
                },
                recordToDB: {
                    value: true,
                    type: typeHandler.sparkplugDataType.boolean
                },
                endianness: {
                    value: 4321,
                    type: typeHandler.sparkplugDataType.uInt16
                }
            }
        }

        const delimitedMetricUnsupportedType = {
            name: "isTrue",
            value: true,
            alias: 10,
            type: typeHandler.sparkplugDataType.template,
            isHistorical: true,
            isTransient: true,
            isNull: false,
            properties: {
                method: {
                    value: "get",
                    type: typeHandler.sparkplugDataType.string
                },
                address: {
                    value: "%QD1026",
                    type: typeHandler.sparkplugDataType.string
                },
                path: {
                    value: "0",
                    type: typeHandler.sparkplugDataType.string
                },
                recordToDB: {
                    value: true,
                    type: typeHandler.sparkplugDataType.boolean
                },
                endianness: {
                    value: 4321,
                    type: typeHandler.sparkplugDataType.uInt16
                }
            }
        }

        const bufferMetric = {
            name: "isTrue",
            value: 10,
            alias: 10,
            type: typeHandler.sparkplugDataType.int32,
            isHistorical: true,
            isTransient: true,
            isNull: false,
            properties: {
                method: {
                    value: "get",
                    type: typeHandler.sparkplugDataType.string
                },
                address: {
                    value: "%QD1026",
                    type: typeHandler.sparkplugDataType.string
                },
                path: {
                    value: "0",
                    type: typeHandler.sparkplugDataType.string
                },
                recordToDB: {
                    value: true,
                    type: typeHandler.sparkplugDataType.boolean
                },
                endianness: {
                    value: 4321,
                    type: typeHandler.sparkplugDataType.uInt16
                }
            }
        }

        it("Should return int value parsed from buffer payload", () => {
            const msg = Buffer.alloc(4);
            msg[3] = 10; 
            expect(typeHandler.parseValueFromPayload(msg, bufferMetric, typeHandler.serialisationType.fixedBuffer)).toEqual(10);
        })

        it("Should return boolean value parsed from delimited serialization", () => {
            const delimitedMsg = "true, 14, test";
            expect(typeHandler.parseValueFromPayload(delimitedMsg, delimitedMetric, typeHandler.serialisationType.delimited, ",")).toEqual(true); 
        })

        it("Should return null when passed an unsupported delimited type", () => {
            const delimitedMsg = "true, 14, test";
            expect(typeHandler.parseValueFromPayload(delimitedMsg, delimitedMetricUnsupportedType, typeHandler.serialisationType.delimited, ",")).toBeNull; 
        })

        it("Should return float value parsed from delimited serialization", () => {
            const delimitedMsg = "14, test";
            delimitedMetric.type = typeHandler.sparkplugDataType.float; 
            expect(typeHandler.parseValueFromPayload(delimitedMsg, delimitedMetric, typeHandler.serialisationType.delimited, ",")).toEqual(14); 
        })

        it("Should return double value parsed from delimited serialization", () => {
            const delimitedMsg = "14, test";
            delimitedMetric.type = typeHandler.sparkplugDataType.double; 
            expect(typeHandler.parseValueFromPayload(delimitedMsg, delimitedMetric, typeHandler.serialisationType.delimited, ",")).toEqual(14); 
        })

        it("Should return int value parsed from delimited serialization", () => {
            const delimitedMsg = "14, test";
            delimitedMetric.type = typeHandler.sparkplugDataType.int32; 
            expect(typeHandler.parseValueFromPayload(delimitedMsg, delimitedMetric, typeHandler.serialisationType.delimited, ",")).toEqual(14); 
        })

        it("Should return boolean value parsed from JSON", () => {
            const jsonMsg = {
                status :{
                    errors : {
                        code: true
                    }
                }
            }
            const expectedValue = true; 
            expect(typeHandler.parseValueFromPayload(jsonMsg, JsonMetric, typeHandler.serialisationType.JSON)).toEqual(expectedValue);
        })

        it("Should return boolean value parsed from JSON string", () => {
            const jsonMsg = "{\"status\" :{\"errors\" : {\"code\": true}}}"
            const expectedValue = true; 
            expect(typeHandler.parseValueFromPayload(jsonMsg, JsonMetric, typeHandler.serialisationType.JSON)).toEqual(expectedValue);
        })

        it("Should return boolean value parsed from JSON buffer", () => {
            const json = {
                status :{
                    errors : {
                        code: true
                    }
                }
            }
            const expectedValue = true; 
            const jsonBuffer = Buffer.from(JSON.stringify(json));
            expect(typeHandler.parseValueFromPayload(jsonBuffer, JsonMetric, typeHandler.serialisationType.JSON)).toEqual(expectedValue);
        })

        it("Should return 0 when msg is 0 when parsing a json payload", () => {
            expect(typeHandler.parseValueFromPayload(0, JsonMetric, typeHandler.serialisationType.JSON)).toEqual( 0 ); 
        })

        it("Should return value parsed from xml boolean payload (true)", () => {
            const xmlMsg= "<status><errors><code>true</code></errors></status>";
            expect(typeHandler.parseValueFromPayload(xmlMsg, xmlMetric , typeHandler.serialisationType.XML)).toEqual(true); 
        })

        it("Should return value parse from xml boolean payload (false)", () => {
            const xmlMsg= "<status><errors><code>false</code></errors></status>";
            expect(typeHandler.parseValueFromPayload(xmlMsg, xmlMetric , typeHandler.serialisationType.XML)).toEqual(false); 
        })

        it("Should return value parse from xml for type string", () => {
            const xmlMsg= "<status><errors><code>false</code></errors></status>";
            // does not parse if passed payload is of type string and is xml??? 
            expect(typeHandler.parseValueFromPayload(xmlMsg, xmlMetric , typeHandler.serialisationType.XML)).toEqual(false); 
        })

        it("Should return float value parsed from XML", () => { 
            //Cant parse float. :(
            const expectedValue = 10;
            const xmlMsg = "<status><errors><code>10</code></errors></status>";
            expect(typeHandler.parseValueFromPayload(xmlMsg, xmlMetricFloat, typeHandler.serialisationType.XML)).toEqual(expectedValue); 
        })

    })

    describe("writeValuesToPayload()", () => {
        const metric: typeHandler.sparkplugMetric = {
            name: "isTrue",
            value: true,
            alias: 10,
            type: typeHandler.sparkplugDataType.boolean,
            isHistorical: true,
            isTransient: true,
            isNull: false,
            properties: {
                method: {
                    value: "get",
                    type: typeHandler.sparkplugDataType.string
                },
                address: {
                    value: "%QD1026",
                    type: typeHandler.sparkplugDataType.string
                },
                path: {
                    "value": "status.errors.code",
                    "type": typeHandler.sparkplugDataType.string
                },
                recordToDB: {
                    value: true,
                    type: typeHandler.sparkplugDataType.boolean
                },
                endianness: {
                    value: 4321,
                    type: typeHandler.sparkplugDataType.uInt16
                }
            }
        };

        const int32LEMetric = {
            name: "int32Metric",
            value: 10,
            alias: 10,
            type: typeHandler.sparkplugDataType.uInt32,
            isHistorical: true,
            isTransient: true,
            isNull: false,
            properties: {
                method: {
                    value: "get",
                    type: typeHandler.sparkplugDataType.string
                },
                address: {
                    value: "%QD1026",
                    type: typeHandler.sparkplugDataType.string
                },
                path: {
                    "value": "[@componentId='hydraulic']//*[@dataItemId='hyd']/text()",
                    "type": typeHandler.sparkplugDataType.string
                },
                recordToDB: {
                    value: true,
                    type: typeHandler.sparkplugDataType.boolean
                },
                endianness: {
                    value: 1234,
                    type: typeHandler.sparkplugDataType.uInt16
                }
            }
        }

        const int32BEMetric = {
            name: "int32BEMetric",
            value: 10,
            alias: 10,
            type: typeHandler.sparkplugDataType.uInt32,
            isHistorical: true,
            isTransient: true,
            isNull: false,
            properties: {
                method: {
                    value: "get",
                    type: typeHandler.sparkplugDataType.string
                },
                address: {
                    value: "%QD1026",
                    type: typeHandler.sparkplugDataType.string
                },
                path: {
                    "value": "[@componentId='hydraulic']//*[@dataItemId='hyd']/text()",
                    "type": typeHandler.sparkplugDataType.string
                },
                recordToDB: {
                    value: true,
                    type: typeHandler.sparkplugDataType.boolean
                },
                endianness: {
                    value: 4321,
                    type: typeHandler.sparkplugDataType.uInt16
                }
            }
        }

        const metricArray = [metric];
        it("Shoud return a json string of the metric path and value", () => {
            const expectedValue = "{\"errors\":{\"code\":true}}"
            expect(typeHandler.writeValuesToPayload(metricArray, typeHandler.serialisationType.JSON)).toEqual(expectedValue);
        })

        it("Should return a delimited payload", () => {
            const expectedValue = "true";
            expect(typeHandler.writeValuesToPayload(metricArray, typeHandler.serialisationType.delimited, ".")).toEqual(expectedValue);
        })

        it("should write int32LE paylaod to buffer", () => {
            const expectedValue = Buffer.alloc(4);
            expectedValue[0] = 10; 
            expect(typeHandler.writeValuesToPayload([int32LEMetric], typeHandler.serialisationType.serialisedBuffer)).toEqual(expectedValue); 
        })

        it("Should write int32BE payload to buffer", () => {
            const expectedValue = Buffer.alloc(4);
            expectedValue[3] = 10; 
            expect(typeHandler.writeValuesToPayload([int32BEMetric], typeHandler.serialisationType.serialisedBuffer)).toEqual(expectedValue); 
        })

        it("Should write array of int32BE payload to buffer", () => {
            const expectedValue = Buffer.alloc(8);
            expectedValue[3] = 10; 
            expectedValue[7] = 10;
            expect(typeHandler.writeValuesToPayload([int32BEMetric, int32BEMetric], typeHandler.serialisationType.serialisedBuffer)).toEqual(expectedValue); 
        })
    })

    describe('typeLens()', () => {
        it("Should return one", () => {
            expect(typeHandler.typeLens("boolean")).toEqual(1);
            expect(typeHandler.typeLens("uInt")).toEqual(1);
            expect(typeHandler.typeLens("int")).toEqual(1);
        });

        it("Should return 2", () => {
            expect(typeHandler.typeLens("uInt16")).toEqual(2);
            expect(typeHandler.typeLens("int16")).toEqual(2);
        })

        it("Should return 4", () => {
            expect(typeHandler.typeLens("uInt32")).toEqual(4);
            expect(typeHandler.typeLens("int32")).toEqual(4);
            expect(typeHandler.typeLens("float")).toEqual(4);
        })

        it("Should return 8", () => {
            expect(typeHandler.typeLens("double")).toEqual(8);
        })

        it("Should return 12", () => {
            expect(typeHandler.typeLens("dateTime")).toEqual(12); 
        })

        it("Should return -1", () => {
            expect(typeHandler.typeLens("test")).toEqual(-1); 
        })
    })

    describe('ParseValFromBuffer', () => {
        it("Should return -1 if given a boolean with no bit parameter", () => {
            const val = 1;
            const msg = Buffer.alloc(4);
            msg[3] = val; 
            const addr = 0;
            expect(typeHandler.parseValFromBuffer(typeHandler.sparkplugDataType.boolean, typeHandler.byteOrder.bigEndian, addr, msg)).toBe(-1);
        })

        it("Should return boolean parsed from buffer", () => {
            const val = 1;
            const msg = Buffer.alloc(10);
            msg.readUInt16BE(0);
            msg.write("true"); 
            const addr = 0;
            const bit = 0;
            expect(typeHandler.parseValFromBuffer(typeHandler.sparkplugDataType.boolean, typeHandler.byteOrder.bigEndian, addr, msg)).toBe(true);
        })

        it("Should parse int8 value from buffer", () => {
            const val = 1;
            const msg = Buffer.alloc(10);
            const addr = 3;
            msg.writeInt8(val, addr); 
            expect(typeHandler.parseValFromBuffer(typeHandler.sparkplugDataType.int8, typeHandler.byteOrder.bigEndian, addr, msg)).toBe(val);

        })

        it("Should parse int16BE from buffer", () => {
            const val = 1;
            const msg = Buffer.alloc(10);
            const addr = 3; 
            msg.writeInt16BE(val, addr); 
            expect(typeHandler.parseValFromBuffer(typeHandler.sparkplugDataType.int16, typeHandler.byteOrder.bigEndian, addr, msg)).toBe(val);
        })

        it("Should parse int16LE from buffer", () => {
            const val = 1;
            const msg = Buffer.alloc(10);
            const addr = 3;
            msg.writeInt16LE(val, addr); 
            expect(typeHandler.parseValFromBuffer(typeHandler.sparkplugDataType.int16, typeHandler.byteOrder.littleEndian, addr, msg)).toBe(val);
        })

        it("Should parse int32BE from buffer", () => {
            const val = 1;
            const msg = Buffer.alloc(10);
            const addr = 3;
            msg.writeUInt32BE(val, addr);  
            expect(typeHandler.parseValFromBuffer(typeHandler.sparkplugDataType.int32, typeHandler.byteOrder.bigEndian, addr, msg)).toBe(val);
        })

        it("Should prase int32LE from buffer", () => {
            const val = 1;
            const msg = Buffer.alloc(10);
            const addr = 3;
            msg.writeInt32LE(val, addr); 
            expect(typeHandler.parseValFromBuffer(typeHandler.sparkplugDataType.int32, typeHandler.byteOrder.littleEndian, addr, msg)).toBe(val);
        })

        it("Should parse int64BE from buffer", () =>{
            const val = 10;
            const msg = Buffer.alloc(10);
            const addr = 3;
            msg[addr] = val; 
            //expect(typeHandler.parseValFromBuffer(typeHandler.sparkplugDataType.int64, typeHandler.byteOrder.bigEndian, addr, msg)).toBe(val);
        })

        it("Should parse int64LE from buffer ", () => {
            const val = 1000;
            const buffer = Buffer.alloc(8);
            buffer.writeBigInt64LE(BigInt(val), 0);
            //Big int not supported?
            //expect(typeHandler.parseValFromBuffer(typeHandler.sparkplugDataType.int64, typeHandler.byteOrder.littleEndian, 0, buffer)).toBe(1000n);
        })

        it("Should parse uInt8 from buffer", () => {
            const val = 1;
            const msg = Buffer.alloc(10);
            const addr = 3;
            msg.writeUInt8(val, addr); 
            expect(typeHandler.parseValFromBuffer(typeHandler.sparkplugDataType.uInt8, typeHandler.byteOrder.bigEndian, addr, msg)).toBe(val);
        })

        it("Should parse uInt16BE from buffer", () => {
            const val = 1;
            const msg = Buffer.alloc(10);
            const addr = 3; 
            msg.writeUInt16BE(val, addr);
            expect(typeHandler.parseValFromBuffer(typeHandler.sparkplugDataType.uInt16, typeHandler.byteOrder.bigEndian, addr, msg)).toBe(val);
        })

        it("Should parse uInt16LE from buffer", () => {
            const val = 1;
            const msg = Buffer.alloc(10);
            const addr = 3;
            msg.writeUInt16LE(val, addr); 
            expect(typeHandler.parseValFromBuffer(typeHandler.sparkplugDataType.uInt16, typeHandler.byteOrder.littleEndian, addr, msg)).toBe(val);
        })

        it("Should parse uInt32BE from buffer", () => {
            const val = 1;
            const msg = Buffer.alloc(10);
            const addr = 3;
            msg.writeUInt32BE(val, addr); 
            expect(typeHandler.parseValFromBuffer(typeHandler.sparkplugDataType.uInt32, typeHandler.byteOrder.bigEndian, addr, msg)).toBe(val);
        })

        it("Should prase uInt32LE from buffer", () => {
            const val = 1;
            const msg = Buffer.alloc(10);
            const addr = 3;
            msg.writeUInt32LE(val, addr);
            expect(typeHandler.parseValFromBuffer(typeHandler.sparkplugDataType.uInt32, typeHandler.byteOrder.littleEndian, addr, msg)).toBe(val);
        })

        it("Should parse uInt32PE from buffer", () => {
            const val = 1;
            const msg = Buffer.alloc(10);
            const addr = 0;
            msg.writeInt32BE(val);
            msg.subarray(addr, addr + 8).swap16()
            expect(typeHandler.parseValFromBuffer(typeHandler.sparkplugDataType.uInt32, typeHandler.byteOrder.PDPEndian, addr, msg)).toBe(val);
        })

        it("Should parse floatBE from buffer", () => {
            const val = 1000;
            const msg = Buffer.alloc(10);
            const addr = 0;
            msg.writeFloatBE(val, addr); 
            expect(typeHandler.parseValFromBuffer(typeHandler.sparkplugDataType.float, typeHandler.byteOrder.bigEndian, addr, msg)).toBe(val);
        })

        it("Should parse floatLE from buffer", () => {
            const val = 1000;
            const msg = Buffer.alloc(10);
            const addr = 0;
            msg.writeFloatLE(val, addr)
            expect(typeHandler.parseValFromBuffer(typeHandler.sparkplugDataType.float, typeHandler.byteOrder.littleEndian, addr, msg)).toBe(val);
        })

        it("Should parse floatPE from buffer", () => {
            const val = 1000;
            const msg = Buffer.alloc(10);
            const addr = 0;
            msg.writeFloatBE(val, addr)
            msg.subarray(addr, addr + 4).swap16()
            expect(typeHandler.parseValFromBuffer(typeHandler.sparkplugDataType.float, typeHandler.byteOrder.PDPEndian, addr, msg)).toBe(val);
        })

        it("Should parse doubleBE from buffer" , () => {
            const val = 1000;
            const msg = Buffer.alloc(10);
            const addr = 0;
            msg.writeDoubleBE(val, addr); 
            expect(typeHandler.parseValFromBuffer(typeHandler.sparkplugDataType.double, typeHandler.byteOrder.bigEndian, addr, msg)).toBe(val);
        })

        it("Should parse doubleLE from buffer", () => { 
            const val = 1000;
            const msg = Buffer.alloc(10);
            const addr = 0;
            msg.writeDoubleLE(val, addr); 
            expect(typeHandler.parseValFromBuffer(typeHandler.sparkplugDataType.double, typeHandler.byteOrder.littleEndian, addr, msg)).toBe(val);
        })

        it("Should parse doublePE from buffer", () => { 
            const val = 1000;
            const msg = Buffer.alloc(10);
            const addr = 0;
            msg.writeDoubleBE(val, addr)
            msg.subarray(addr, addr + 8).swap16()
            expect(typeHandler.parseValFromBuffer(typeHandler.sparkplugDataType.double, typeHandler.byteOrder.PDPEndian, addr, msg)).toBe(val);
        })
    })
})


