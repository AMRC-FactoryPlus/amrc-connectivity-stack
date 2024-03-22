/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import {log} from "../../../lib/helpers/log";

describe('log', () => {
    const OLD_ENV = process.env;
    const OLD_DATE = Date;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks(); 
        process.env = { ...OLD_ENV };
        
    })

    afterAll(() => {
        process.env = OLD_ENV; 
        Date = OLD_DATE; 
    })

    describe('log()', () => {
        const consoleSpy = jest.spyOn(console, "log");

        it("Should log the message", () => {
            process.env.DEBUG = "true"; 
            log("test");
            expect(consoleSpy).toBeCalledTimes( 1 ); 
        })

        it("Should format the message to log", () => {
            //Is mocking a stack trace even posible? 
            /*const msg = "test";
            process.env.DEBUG = "true";
            const fixedDate = new Date;
            const fixedDateString = fixedDate.toISOString();
            const mockErrorStack = (new Error).stack; 
            jest.spyOn(Date.prototype, "toISOString").mockImplementation(() => fixedDateString); 
            let caller = (mockErrorStack).split("\n")[2].split('/').pop().replace(')','');
            log(msg);
            expect(consoleSpy).toBeCalledWith(`DEBUG [${(fixedDate).toISOString()}] ${caller} --> ${msg}`); 
            */
        })

        it("Should exit without logging", () => {
            process.env.DEBUG = "false";
            expect(log("test")).toBeUndefined(); 
            expect(consoleSpy).toBeCalledTimes( 0 ); 
        })
    })
})
