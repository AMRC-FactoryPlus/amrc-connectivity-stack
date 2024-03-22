/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import {OPCUAConnection, OPCUADevice, opcUaConnDetails} from "../../../lib/devices/OPCUA";
//Auto Mock creates error: Cannot read property 'value' of undefined :(
//jest.mock('node-opcua')
import {OPCUAClient} from "node-opcua"; 

describe('OPCUA', () => {
    const type: string = "opcua";
    const connDetails: opcUaConnDetails = {
        useCredentials: true,
        username: "user",
        password: "password",
        securityMode: 1,
        securityPolicy: "good",
        endpoint: "endpoint"
    } 

    afterEach(() => {
        jest.clearAllMocks(); 
    })

    it("should call opcuaClient connect", async () => {
        const createSpy = jest.spyOn(OPCUAClient, "create"); 
        const OPCUAConn = new OPCUAConnection(type, connDetails);
        await OPCUAConn.open(); 
        expect(createSpy).toBeCalledTimes( 1 ); 
    })

    describe('open()', () => {
        
        it("should call opcua client createSesion", async () => {
            //consider manaual mock in __mocks__g
            const Mockclient = OPCUAClient as jest.Mocked<typeof OPCUAClient>;
            const test = new Mockclient;
            test.connect = jest.fn(); 
            const connectSpy = jest.spyOn(test, "connect");
            const OPCUAConn = new OPCUAConnection(type, connDetails);
            await OPCUAConn.open();
            expect(connectSpy).toBeCalledTimes( 1 ); 
        })

        it("should emit open", () =>{ 

        })

        it("should log error", () => {

        })

    })
    
})
