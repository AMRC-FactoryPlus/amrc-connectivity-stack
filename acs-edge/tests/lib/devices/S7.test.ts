/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import {S7Connection, S7Device} from "../../../lib/devices/S7";
import S7 from "nodes7"; 

/**
 * Unable to test.
 * The @st-one-io/nodes7 lib does not have TypeScript support
 * The nodes7 has TypeScript support (potential fix but would have to re-write the s7 stuff)
 */
 
describe("S7", () => {
    
    const type = 's7';
    const s7ConnDetails = {
        hostname: "host",
        port: 1,
        rack: 1,
        slot: 1,
        timeout: 1
    }

    describe("open()", () => {


        it("should call S7 connect", async () => {

        })

        it("shouldn't call S7 connect", () => {

        })
    })

    describe('readMetrics()', () => {
        
    })

    describe('writeMetrics', () => {
        
    })

    describe('close()', () => {
        
    })
    
 })