/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import {Translator} from "../../lib/translator";

describe("translator", () => {
    let config = {
        sparkplug: {
            clientId: "test",
            publishDeath: true,
            version: "1.0",
            serverUrl: "http://www.test.com",
            groupId: "test group",
            edgeNode: "test node",
            username: "user",
            password: "password",
            asyncPubMode: true,
            compressPayload: true,
            pubInterval: 1
        },
        deviceConnections: [{}]
    }

    afterEach(() => {
        jest.clearAllMocks();
    })

    describe("start()", () => {

        it("should create a sparkplug node", () => {

        });

    });

    describe("restart()", () => {

        it("should call stop()", async () => {
            const translator = new Translator(config);
            const stopSpy = jest.spyOn(translator, "stop");
            await translator.start(config);
            expect(stopSpy).toBeCalledTimes(1);
        });
    });

    describe("pollConfig()", () => {
        //TODO: hard to test because of the timer on the poll config
    });
});