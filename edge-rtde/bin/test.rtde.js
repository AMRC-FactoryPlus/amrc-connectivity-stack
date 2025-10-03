// Test script for RTDEHandler (ES Module version)
// Usage: node bin/test.rtde.js

import { RTDEHandler } from '../lib/rtde.js';

// Mock driver object with required methods
const driver = {
    debug: { bound: () => console.log },
    connUp: () => console.log('Connection up'),
    connFailed: () => console.log('Connection failed'),
    data: (data) => console.log('Data:', data)
};

// Configuration for RTDE connection
const conf = {
    host: '192.168.2.199', // Set to your URSim/UR robot IP
    port: 30001,          // RTDE port
    samples: 5            // Number of samples to receive before closing
};

// Create handler and connect
const handler = RTDEHandler.create(driver, conf);
if (!handler) {
    console.error('Failed to create RTDEHandler: missing host or port in conf');
    process.exit(1);
}

handler.connect()
    .then(status => {
        console.log('Connect status:', status);
    })
    .catch(err => {
        console.error('Connection error:', err);
    });
