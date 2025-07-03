#!/usr/bin/env node

/*
 * Simple test script for the OPC UA Server
 * This script tests basic functionality without requiring full ACS deployment
 */

import { OPCUAClient, AttributeIds, ClientSubscription, TimestampsToReturn } from "node-opcua";

const endpointUrl = process.env.OPCUA_ENDPOINT || "opc.tcp://localhost:4840/UA/FactoryPlusUNS";

async function testOPCUAServer() {
    console.log("Testing OPC UA Server...");
    console.log(`Connecting to: ${endpointUrl}`);

    const client = OPCUAClient.create({
        endpointMustExist: false,
        connectionStrategy: {
            initialDelay: 1000,
            maxRetry: 3
        }
    });

    try {
        // Connect to the server
        console.log("Connecting to OPC UA server...");
        await client.connect(endpointUrl);
        console.log("✓ Connected successfully");

        // Create a session
        console.log("Creating session...");
        const session = await client.createSession();
        console.log("✓ Session created");

        // Browse the root folder
        console.log("\nBrowsing root folder...");
        const browseResult = await session.browse("RootFolder");
        console.log(`Found ${browseResult.references.length} references in root folder:`);
        
        for (const ref of browseResult.references) {
            console.log(`  - ${ref.browseName.toString()} (${ref.nodeClass})`);
        }

        // Look for our FactoryPlusUNS folder
        const factoryPlusRef = browseResult.references.find(ref => 
            ref.browseName.toString().includes("FactoryPlusUNS")
        );

        if (factoryPlusRef) {
            console.log("\n✓ Found FactoryPlusUNS folder");
            
            // Browse the FactoryPlusUNS folder
            console.log("Browsing FactoryPlusUNS folder...");
            const unsResult = await session.browse(factoryPlusRef.nodeId);
            console.log(`Found ${unsResult.references.length} groups:`);
            
            for (const ref of unsResult.references) {
                console.log(`  - Group: ${ref.browseName.toString()}`);
            }

            // If we have groups, browse the first one
            if (unsResult.references.length > 0) {
                const firstGroup = unsResult.references[0];
                console.log(`\nBrowsing group: ${firstGroup.browseName.toString()}`);
                
                const groupResult = await session.browse(firstGroup.nodeId);
                console.log(`Found ${groupResult.references.length} nodes:`);
                
                for (const ref of groupResult.references) {
                    console.log(`  - Node: ${ref.browseName.toString()}`);
                }

                // Try to find a variable to read
                await browseForVariables(session, firstGroup.nodeId, 0, 3);
            }
        } else {
            console.log("⚠ FactoryPlusUNS folder not found - server may be starting up or no data available");
        }

        // Test server info
        console.log("\nReading server information...");
        try {
            const serverArray = await session.readVariableValue("Server_ServerArray");
            console.log("Server Array:", serverArray.value.value);
        } catch (error) {
            console.log("Could not read server array:", error.message);
        }

        // Close session
        await session.close();
        console.log("✓ Session closed");

    } catch (error) {
        console.error("❌ Test failed:", error.message);
        if (error.message.includes("ECONNREFUSED")) {
            console.log("\nTroubleshooting:");
            console.log("- Make sure the OPC UA server is running");
            console.log("- Check that port 4840 is accessible");
            console.log("- Verify the endpoint URL is correct");
        }
    } finally {
        await client.disconnect();
        console.log("✓ Disconnected");
    }
}

async function browseForVariables(session, nodeId, depth, maxDepth) {
    if (depth >= maxDepth) return;

    try {
        const browseResult = await session.browse(nodeId);
        
        for (const ref of browseResult.references) {
            const indent = "  ".repeat(depth + 1);
            
            if (ref.nodeClass === 2) { // Variable
                console.log(`${indent}📊 Variable: ${ref.browseName.toString()}`);
                
                // Try to read the variable value
                try {
                    const dataValue = await session.readVariableValue(ref.nodeId);
                    console.log(`${indent}   Value: ${dataValue.value.value} (${dataValue.value.dataType})`);
                    console.log(`${indent}   Status: ${dataValue.statusCode.toString()}`);
                    if (dataValue.sourceTimestamp) {
                        console.log(`${indent}   Timestamp: ${dataValue.sourceTimestamp.toISOString()}`);
                    }
                } catch (readError) {
                    console.log(`${indent}   ❌ Could not read value: ${readError.message}`);
                }
            } else if (ref.nodeClass === 1) { // Object/Folder
                console.log(`${indent}📁 Folder: ${ref.browseName.toString()}`);
                
                // Recursively browse folders
                await browseForVariables(session, ref.nodeId, depth + 1, maxDepth);
            }
        }
    } catch (error) {
        console.log(`Error browsing node at depth ${depth}:`, error.message);
    }
}

// Test HTTP endpoints
async function testHttpEndpoints() {
    const baseUrl = process.env.HTTP_BASE_URL || "http://localhost:8080";
    
    console.log("\nTesting HTTP endpoints...");
    
    try {
        // Test ping endpoint
        const pingResponse = await fetch(`${baseUrl}/ping`);
        if (pingResponse.ok) {
            const pingData = await pingResponse.json();
            console.log("✓ Ping endpoint working:", pingData);
        } else {
            console.log("❌ Ping endpoint failed:", pingResponse.status);
        }

        // Test status endpoint
        const statusResponse = await fetch(`${baseUrl}/status`);
        if (statusResponse.ok) {
            const statusData = await statusResponse.json();
            console.log("✓ Status endpoint working:");
            console.log("  Service:", statusData.service);
            console.log("  OPC UA running:", statusData.opcua.running);
            console.log("  InfluxDB connected:", statusData.influx.connected);
        } else {
            console.log("❌ Status endpoint failed:", statusResponse.status);
        }
    } catch (error) {
        console.log("❌ HTTP endpoint test failed:", error.message);
        console.log("Make sure the HTTP server is running on port 8080");
    }
}

// Run tests
async function main() {
    console.log("=".repeat(60));
    console.log("ACS OPC UA Server Test Suite");
    console.log("=".repeat(60));

    await testHttpEndpoints();
    await testOPCUAServer();

    console.log("\n" + "=".repeat(60));
    console.log("Test completed");
    console.log("=".repeat(60));
}

main().catch(console.error);
