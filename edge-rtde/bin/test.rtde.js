// Test script for RTDEHandler (ES Module version)
// Usage: node bin/test.rtde.js
// Press Ctrl+C to stop

import { RTDEHandler } from '../lib/rtde.js';


let sampleCount = 5;

// Mock driver object with required methods
const driver = {
    debug: { 
        bound: (name) => (...args) => {
            console.log(`[${name}]`, ...args);
        }
    },
    connUp: () => {
        console.log('✓ Connection established');
        console.log('Streaming data... (Press Ctrl+C to stop)\n');
        // Subscribe to RTDE data after connection is up
        // Pass a dummy spec array - we'll collect all data
        handler.subscribe(['rtde_data']);
    },
    connFailed: () => {
        console.error('✗ Connection failed');
        process.exit(1);
    },
    data: (spec, buffer) => {
        sampleCount++;
        // Convert buffer back to JSON for display
        const data = JSON.parse(buffer.toString());
        console.log(`\n--- Sample ${sampleCount} ---`);
        console.log(JSON.stringify(data, null, 2));
    }
};

// Configuration for RTDE connection
const conf = {
    host: '<robot_ip>', // Set to your URSim/UR robot IP
    port: 30003             // Robot state port (30001=primary, 30002=secondary, 30003=realtime)
};

// Create handler and connect
console.log(`Connecting to RTDE at ${conf.host}:${conf.port}...`);
const handler = RTDEHandler.create(driver, conf);
if (!handler) {
    console.error('Failed to create RTDEHandler: missing host or port in conf');
    process.exit(1);
}

// Handle graceful shutdown on Ctrl+C
process.on('SIGINT', async () => {
    console.log('\n\nShutting down...');
    await handler.close();
    console.log(`Total samples received: ${sampleCount}`);
    process.exit(0);
});

// Connect to the robot
handler.connect();

