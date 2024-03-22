/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import {RestConnection, RestDevice} from "../../../lib/devices/REST";
import axios, {AxiosResponse} from 'axios'; 
import {SparkplugNode} from "../../../lib/sparkplugNode";
import {
    sparkplugMetric,
    metricAddrPathGroup,
    Metrics,
    parseValueFromPayload,
    writeValuesToPayload,
    sparkplugDataType,
    serialisationType
  } from "../../../lib/helpers/typeHandler";

jest.mock('axios'); 

describe('RestConnection', () => {

    const restConnDetails = {
        baseURL: "testurl",
        authMethod: "auth",
        username: "user",
        password: "pass",
        allowRecursion: true
    }

    const type = "rest"; 

    describe("open()", () => {
        
        it("Should emit open", () =>{ 
            const restConn = new RestConnection(type, restConnDetails);
            let callback = jest.fn();
            restConn.on("open", callback);
            restConn.open();
            expect(callback).toHaveBeenCalledTimes( 1 ); 
        })
    })

    describe("get()", () => {

        const mockedAxios = axios as jest.Mocked<typeof axios>
        let expectedResult : object = {data: "test"}; 
        const feedResponsePromise = Promise.resolve({ data: expectedResult } as AxiosResponse);

        it("should call axios", async () => {
            const restConn = new RestConnection(type, restConnDetails);
            mockedAxios.get.mockReturnValueOnce(feedResponsePromise);
            await restConn.get("address"); 
            expect(mockedAxios.get).toHaveBeenCalledTimes( 1 ); 
        })

        it("should return response", async () => {
            const restConn = new RestConnection(type, restConnDetails);
            mockedAxios.get.mockReturnValueOnce(feedResponsePromise);
            expect(await restConn.get("address")).toMatchObject({data: expectedResult}); 
        })

        it("should catch and return error", async () => {
            let error = {response: "error"}; 
            const restConn = new RestConnection(type, restConnDetails);
            mockedAxios.get.mockRejectedValueOnce(error);
            expect(await restConn.get("address")).toBe(error.response); 
        })
    })

    describe("post()", () => {
        const mockedAxios = axios as jest.Mocked<typeof axios>
        let expectedResult = { data: "test" }; 
        const feedResponsePromise = Promise.resolve(expectedResult as AxiosResponse);

        it("should call axios", async () => {
            mockedAxios.post.mockResolvedValueOnce(feedResponsePromise);
            const restConn = new RestConnection(type, restConnDetails);
            await restConn.post("string", "data", serialisationType.JSON);
            expect(mockedAxios.post).toHaveBeenCalledTimes( 1 ); 
        })

        it("should return post response for JSON serialisation type", async () => {
            mockedAxios.post.mockResolvedValueOnce(feedResponsePromise);
            const restConn = new RestConnection(type, restConnDetails);
            expect(await restConn.post("address", "data", serialisationType.JSON)).toMatchObject(expectedResult); 
        })

        it("should return post response for XML serialisation type ", async () => {
            mockedAxios.post.mockResolvedValueOnce(feedResponsePromise);
            const restConn = new RestConnection(type, restConnDetails);
            expect(await restConn.post("address", "data", serialisationType.XML)).toMatchObject(expectedResult); 
        })

        it("should return post response for fixedBuffer serialisation type" , async () => {
            mockedAxios.post.mockResolvedValueOnce(feedResponsePromise);
            const restConn = new RestConnection(type, restConnDetails);
            expect(await restConn.post("address", "data", serialisationType.fixedBuffer)).toMatchObject(expectedResult); 
        })

        it("should return post response for delimited serialisation type", async () => {
            mockedAxios.post.mockResolvedValueOnce(feedResponsePromise);
            const restConn = new RestConnection(type, restConnDetails);
            expect(await restConn.post("address", "data", serialisationType.delimited)).toMatchObject(expectedResult); 
        })

        it("should catch and return error", async () => {
            const error = {response: "error"};
            mockedAxios.post.mockRejectedValueOnce(error);
            const restConn = new RestConnection(type, restConnDetails);
            expect(await restConn.post("address", "data", serialisationType.JSON)).toBe(error.response); 
        })
    })
})

/*describe("RestDevice", () => {
    const spConfig  = {
        clientId: "test",
        publishDeath: true,
        version: "1.0",
        serverUrl: "url",
        groupId: "test group",
        edgeNode: "test node",
        username: "user",
        password: "password",
        asyncPubMode: true,
        compressPayload: true,
        pubInterval: 1
    }; 

    const restConnDetails = {
        baseURL: "testurl",
        authMethod: "auth",
        username: "user",
        password: "pass",
        allowRecursion: true
    }; 

    const spMetric: sparkplugMetric = {
        value: true,
        type: sparkplugDataType.boolean,
    };

    const deviceOptions = {
        deviceId: "id",
        pollInt: 1,
        templates: [spMetric],
        metrics: [spMetric],
        payloadFormat: "format"
    };  

    it("constructor values should be set", () => {
        jest.mock("../../../lib/sparkplugNode");
        jest.mock("../../../lib/devices/REST");
        let mockedSpClient = new SparkplugNode(spConfig); 
        let MockedRestConn = new RestConnection("type", restConnDetails); 
        
        const restDevice = new RestDevice(mockedSpClient, MockedRestConn, deviceOptions);
        expect(restDevice._metrics).toContain(spMetric);
        expect(restDevice._name).toBe(deviceOptions.deviceId);
    })
})*/