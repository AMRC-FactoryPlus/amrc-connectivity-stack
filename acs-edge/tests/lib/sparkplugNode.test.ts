/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

jest.mock("sparkplug-client");
import { SparkplugNode } from "../../lib/sparkplugNode";
const sparkplug = require("sparkplug-client"); 

describe('SparkplugNode', () => {
    const conf = {
        clientId: "string",
        publishDeath: true,
        version: "1.2",
        serverUrl: "url",
        groupId: "group",
        edgeNode: "node",
        username: "user",
        password: "password",
        asyncPubMode: true,
        compressPayload: true,
        pubInterval: 1
    }

})
