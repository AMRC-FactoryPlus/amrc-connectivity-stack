/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import {MQTTConnection, MQTTDevice} from "../../../lib/devices/MQTT";
import mqttConnDetails from "../../../lib/devices/MQTT";
jest.mock('mqtt'); 
import * as mqtt from "mqtt";
import { EventEmitter } from "events";
import * as log from '../../../lib/helpers/log'; 
import {Metrics, sparkplugDataType, sparkplugMetric} from "../../../lib/helpers/typeHandler";

class Client extends EventEmitter {}; 

describe("MQTTConnection", () =>{

    let type = "MQTT";
    let connectionDetails = {
        clientId: "id",
        protocol: "MQTT",
        host: "host",
        port: 80,
        cleanSession: true,
        keepAlive: 12
    }

    let connectionString = `${connectionDetails.protocol}://${connectionDetails.host}:${connectionDetails.port}`
    let options = {
        clientId: connectionDetails.clientId
    };

    afterEach(() => {
        jest.clearAllMocks();
      });

    describe('open()', () => {
        it("Should emit open", async () => {
            const logSpy = jest.spyOn(log, 'log'); 
            const mockedClient = new Client();
            //mock mqtt connect function that returns the event emitter that we can call
            const mockConnect = mqtt.connect as jest.Mock;
            mockConnect.mockImplementation(()=> {
                return mockedClient;
            })
            let mqttConnection = new MQTTConnection(type, connectionDetails);
            const callback = jest.fn();
            mqttConnection.on("open", callback);
            mqttConnection.open(); 
            //wait for emitter to emit connect
            mockedClient.emit("connect");
            new Promise(resolve => setTimeout(resolve, 500)); 

            expect(callback).toBeCalledTimes( 1 );
            expect(logSpy).toBeCalledTimes( 1 );
        })


        it('should emit asyncData', async () => {
            //test values to emit
            let topic = "test";
            let msg = Buffer.alloc(10);

            const mockedClient = new Client();
            //mock mqtt connect function that returns the event emitter that we can call
            const mockConnect = mqtt.connect as jest.Mock;
            mockConnect.mockImplementation(()=> {
                return mockedClient;
            });

            //declare emitted values to compair against
            let emittedTopic: string;
            let emittedMsg: Buffer;
            let mqttConnection = new MQTTConnection(type, connectionDetails);

            mqttConnection.on("asyncData", (topic, msg) => {
                emittedTopic = topic;
                emittedMsg = msg; 
            });

            mqttConnection.open();
            mockedClient.emit("message", topic, msg);
            await new Promise(resolve => setTimeout(resolve, 1000));
            expect(emittedTopic).toBe(topic);
            expect(emittedMsg).toBe(msg); 
        })

        it('should log error', async () => {
            const mockedClient = new Client();
            //mock mqtt connect function that returns the event emitter that we can call
            const mockConnect = mqtt.connect as jest.Mock;
            mockConnect.mockImplementation(()=> {
                return mockedClient;
            });

            const consoleSpy = jest.spyOn(console, 'log'); 

            let err = ("test"); 

            let mqttConnection = new MQTTConnection(type, connectionDetails);
            mqttConnection.open();
            mockedClient.emit('error', err);
            await new Promise(resolve => setTimeout(resolve, 500)); 
            expect(consoleSpy).toHaveBeenCalledWith(err); 
        })
    })

    describe('subscribe()', () => {
        
        it('Should call subscribe', async () => { 
            //mock mqtt client for connect to resturn 
            const mockClient = new mqtt.MqttClient(null, {});
            mockClient.subscribe = jest.fn(); 
            const mockConnect = mqtt.connect as jest.Mock;
            mockConnect.mockImplementation(()=> {
                return mockClient;
            });

            const mqttConnection = new MQTTConnection(type, connectionDetails);
            mqttConnection.open(); 
            await mqttConnection.subscribe("test");
            expect(mockClient.subscribe).toBeCalledTimes( 1 );
        })

        it('Should console.log error', async () => {
            //mock mqtt client for connect to resturn
            const err = "test";
            const mockClient = new mqtt.MqttClient(null, {});
            const consoleSpy = jest.spyOn(console, 'log'); 

            //mock implimentation of subscribe function which calls the error callback
            mockClient.subscribe = jest.fn().mockImplementation((topic: string, callback: Function)=>{ callback(err)});

            const mockConnect = mqtt.connect as jest.Mock;
            mockConnect.mockImplementation(()=> {
                return mockClient;
            });

            const mqttConnection = new MQTTConnection(type, connectionDetails);
            //create instance of the mqtt client
            mqttConnection.open(); 
            await mqttConnection.subscribe("test");
            expect(consoleSpy).toBeCalledWith( err );
        })

    })

    describe('writeMetrics()', () => {
        const metricsArray: sparkplugMetric[] = [
            {
                name: "metric",
                value: "value",
                type: sparkplugDataType.string,
                alias: 1,
                isHistorical: true,
                isTransient: true,
                isNull: false,
            }
        ]
        const metrics = new Metrics(metricsArray);

    })

    describe('close()', () => {
        
        it('Should call client.end and null the client', () => {
            const mockClient = new mqtt.MqttClient(null, {});
            mockClient.end =jest.fn();

            const mockConnect = mqtt.connect as jest.Mock;
            mockConnect.mockImplementation(() => {
                return mockClient
            })

            const mqttConnection = new MQTTConnection(type, connectionDetails);
            mqttConnection.open();
            mqttConnection.close();
            expect(mockClient.end).toBeCalledTimes( 1 );
        })

    })
    
})




describe("MQTTDevice", () =>{

    
})
