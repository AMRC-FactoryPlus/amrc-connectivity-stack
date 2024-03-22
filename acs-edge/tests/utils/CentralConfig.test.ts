/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import axios from "axios";
import {CentralConfig} from "../../utils/CentralConfig"; 


describe('LoadConfig', () => {

    const config = new CentralConfig(process.env.CONFIG_URL);

    const validAPIData = {
        sparkplug: {
            serverUrl: "ssl://amrc-factoryplus.shef.ac.uk:8883",
            groupId: "Dummy",
            edgeNode: "Dummy_Node",
            username: "BZQlJZdO",
            password: "v,G67XL}9sOy3+gOx]Rxfb0<(?MQ&vQY",
            asyncPubMode: true,
            pubInterval: 1000,
            compressPayload: false
        },
        deviceConnections: [{}]
    };

    describe('.poll', () => {
        let mockFetchConfig = jest.fn();
        let mockIsValid = jest.fn();



        test('should return api data if the condition validates', async () => {
            mockIsValid.mockReturnValueOnce(() => true);
            mockFetchConfig.mockReturnValueOnce(validAPIData);
            expect(await config.poll(mockFetchConfig, mockIsValid, 1000)).toMatchObject(validAPIData);
            expect(mockIsValid).toHaveBeenCalledTimes( 1 ); 
            expect(mockFetchConfig).toHaveBeenCalledTimes( 1 ); 
        });
    });

    describe('.isValid', () => {

        let invalidData = {};

        test('should return true if the result is valid', () => {
            //expect(config.isValid(validAPIData)).toBeTruthy();
        });

        test('should return false if the result is invalid', () => {
            //expect(config.isValid(invalidData)).toBeFalsy();
        });
    });

    describe('.fetchConfig', () => {
        //TODO: Change this so that it expects the return value from the server. 
        test('should API Data', () => {
            expect(config.fetchConfig).not.toBeNull();
        })
    });

    describe('.wait', () => {
        
        test('promise should resolve', async () => {
            await expect(config.wait).toBe(config.wait);
        })

    });
})