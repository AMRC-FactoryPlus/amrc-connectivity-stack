/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { Client } from 'ads-client';
import { BufferX } from '@amrc-factoryplus/edge-driver';

/**
 * ADS (Automation Device Specification) Handler for Edge Agent
 *
 * This handler implements an asynchronous driver for communicating with ADS devices,
 * primarily Beckhoff TwinCAT PLCs. It uses the ads-client library to establish
 * subscriptions to PLC symbols and pushes data to the Edge Agent when values change.
 *
 * Key Features:
 * - Real-time data subscriptions using ADS notifications
 * - Automatic reconnection on connection failures
 * - Configurable cycle times per symbol
 * - Graceful error handling and cleanup
 *
 * Address Format: "symbol_name[,cycle_time]"
 * Examples:
 *   - "Global_IO.iAnalogue" (default 100ms cycle)
 *   - "MAIN.bStart,500" (500ms cycle)
 *   - "GVL.rTemperature,1000" (1000ms cycle)
 */
export class ADSHandler {
    /**
     * Constructs a new ADS handler instance
     *
     * @param {Object} driver - The Edge Agent driver instance that manages this handler
     * @param {Object} conf - Configuration object containing ADS connection parameters
     * @param {string} conf.targetAmsNetId - AMS NetId of the target PLC (e.g., "172.16.48.37.1.1")
     * @param {string} conf.routerAddress - IP address of the ADS router (usually the PLC)
     * @param {number} [conf.targetAdsPort=851] - ADS port of the target (851 for TwinCAT runtime)
     * @param {number} [conf.routerTcpPort=48898] - TCP port of the ADS router
     * @param {string} [conf.localAmsNetId] - Local AMS NetId (auto-assigned if not specified)
     * @param {number} [conf.localAdsPort] - Local ADS port (auto-assigned if not specified)
     * @param {number} [conf.timeoutDelay=5000] - Connection timeout in milliseconds
     * @param {boolean} [conf.hideConsoleWarnings=true] - Hide ADS client console warnings
     * @param {boolean} [conf.allowHalfOpen=false] - Allow half-open connections
     * @param {boolean} [conf.rawClient=false] - Use raw client mode (no automatic reconnection)
     */
    constructor(driver, conf) {
        this.driver = driver;
        this.conf = conf;
        this.log = driver.debug.bound('ads');

        // ADS client instance - will be created in connect()
        this.client = null;

        // Map to track active subscriptions: symbolName -> subscription object
        // This prevents duplicate subscriptions and enables proper cleanup
        this.subscriptions = new Map();

        // Reconnection management
        this.reconnectTimer = null;
        this.reconnectDelay = 5000; // 5 seconds between reconnection attempts

        // Build client configuration with sensible defaults
        // These defaults match standard TwinCAT/ADS configurations
        const clientConfig = {
            targetAmsNetId: conf.targetAmsNetId,        // Required: Target PLC's AMS NetId
            targetAdsPort: conf.targetAdsPort || 851,   // Default: TwinCAT runtime port
            routerAddress: conf.routerAddress,          // Required: PLC IP address
            routerTcpPort: conf.routerTcpPort || 48898, // Default: ADS router port
            timeoutDelay: conf.timeoutDelay || 5000,    // Default: 5 second timeout
            hideConsoleWarnings: conf.hideConsoleWarnings !== false, // Default: hide warnings
            allowHalfOpen: conf.allowHalfOpen || false,  // Default: don't allow half-open
            rawClient: conf.rawClient || false,  // Default: don't use raw client
        };

        // Add optional local AMS configuration if specified
        // If not specified, the ADS router will auto-assign these values
        if (conf.localAmsNetId) {
            clientConfig.localAmsNetId = conf.localAmsNetId;
        }
        if (conf.localAdsPort) {
            clientConfig.localAdsPort = conf.localAdsPort;
        }

        // Create the ADS client instance with our configuration
        this.client = new Client(clientConfig);

        this.client.setDebugLevel(3);

        // Set up connection event handlers
        // These handlers manage the connection lifecycle and notify the Edge Agent

        this.client.on('connect', () => {
            this.log("Connected to ADS target");
            // Notify Edge Agent that connection is established and ready
            driver.connUp();
        });

        this.client.on('disconnect', () => {
            this.log("Disconnected from ADS target");
            // Notify Edge Agent of connection failure and attempt reconnection
            driver.connFailed();
            this.scheduleReconnect();
        });

        this.client.on('error', (err) => {
            this.log("ADS client error: %o", err);
            // Handle any ADS client errors by failing connection and reconnecting
            driver.connFailed();
            this.scheduleReconnect();
        });
    }

    /**
     * Factory method to create and validate an ADS handler instance
     *
     * This static method is called by the Edge Agent driver framework to create
     * a new handler instance. It validates the required configuration parameters
     * before creating the handler.
     *
     * @param {Object} driver - The Edge Agent driver instance
     * @param {Object} conf - Configuration object (see constructor for details)
     * @returns {ADSHandler|undefined} - New handler instance or undefined if config is invalid
     */
    static create(driver, conf) {

        // Validate required configuration parameters
        // These are the minimum required to establish an ADS connection
        if (!conf.targetAmsNetId || !conf.routerAddress) {
            driver.log("Missing required ADS configuration: targetAmsNetId and routerAddress are required");
            return; // Return undefined to indicate configuration rejection
        }

        return new ADSHandler(driver, conf);
    }

    /**
     * Establishes connection to the ADS target device
     *
     * This method creates and configures the ADS client, sets up event handlers,
     * and attempts to connect to the target PLC. It handles both synchronous
     * configuration validation and asynchronous connection establishment.
     *
     * Connection Flow:
     * 1. Build client configuration with defaults
     * 2. Create ADS client instance
     * 3. Set up event handlers (connect, disconnect, error)
     * 4. Attempt connection
     * 5. Return status or schedule reconnection on failure
     *
     * @returns {Promise<string>|string} - Connection status ("UP", "CONN", etc.)
     */
    connect() {

        const conf = this.conf;

        this.log("Connecting to ADS target %s at %s", conf.targetAmsNetId, conf.routerAddress);

        // try {
        //     this.log("Disconnecting before connect...")
        //     this.client.disconnect()
        // } catch (e) {
        //     this.log("Could not disconnect before connect: %o", e);
        // }

        // Attempt connection to the ADS target
        // This returns a Promise that resolves with connection info or rejects with error
        return this.client.connect()
            .then((res) => {
                this.log("Connected to %s, assigned local AmsNetId %s port %d",
                    res.targetAmsNetId, res.localAmsNetId, res.localAdsPort);
                return "UP"; // Return success status to Edge Agent
            })
            .catch((err) => {
                this.log("Connection failed: %o", err);
                this.scheduleReconnect();
                return "CONN"; // Return connection failure status to Edge Agent
            });
    }

    /**
     * Schedules automatic reconnection after connection failure
     *
     * This method implements a simple reconnection strategy with a fixed delay.
     * It clears any existing reconnection timer to prevent multiple concurrent
     * reconnection attempts.
     *
     * The reconnection is non-blocking and runs in the background, allowing
     * the Edge Agent to continue operating while connection recovery is attempted.
     */
    scheduleReconnect() {
        // Clear any existing reconnection timer to prevent duplicates
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        // Schedule reconnection attempt after the configured delay
        this.reconnectTimer = setTimeout(() => {
            this.log("Attempting to reconnect...");
            this.connect();
        }, this.reconnectDelay);
    }

    /**
     * Parses an address specification into symbol name and cycle time
     *
     * This method converts the Edge Agent address format into the components
     * needed for ADS subscription. It validates both the symbol name and
     * cycle time parameters.
     *
     * Address Format: "symbol_name[,cycle_time]"
     *
     * Examples:
     *   - "Global_IO.iAnalogue" → {symbolName: "Global_IO.iAnalogue", cycleTime: 100}
     *   - "Global_IO.iAnalogue,500" → {symbolName: "Global_IO.iAnalogue", cycleTime: 500}
     *   - "MAIN.bStart,1000" → {symbolName: "MAIN.bStart", cycleTime: 1000}
     *
     * @param {string} spec - Address specification string from Edge Agent
     * @returns {Object|undefined} - Parsed address object or undefined if invalid
     * @returns {string} returns.symbolName - TwinCAT symbol name
     * @returns {number} returns.cycleTime - Subscription cycle time in milliseconds
     */
    parseAddr(spec) {
        // Split the specification on comma to separate symbol name and cycle time
        const parts = spec.split(',');
        const symbolName = parts[0]?.trim();

        // Validate that we have a non-empty symbol name
        if (!symbolName) {
            this.log("Invalid address specification: %s", spec);
            return; // Return undefined to indicate parsing failure
        }

        // Parse cycle time with default fallback
        // Default to 100ms which is a reasonable balance between responsiveness and load
        const cycleTime = parts[1] ? parseInt(parts[1].trim(), 10) : 100;

        // Validate cycle time is a positive integer
        // Minimum 1ms to prevent excessive CPU usage
        if (isNaN(cycleTime) || cycleTime < 1) {
            this.log("Invalid cycle time in address: %s", spec);
            return; // Return undefined to indicate parsing failure
        }

        return {
            symbolName,
            cycleTime
        };
    }

    /**
     * Subscribes to multiple ADS symbols for real-time data updates
     *
     * This method is called by the Edge Agent when address configurations change.
     * It validates the connection state and attempts to subscribe to each
     * specified symbol. All subscriptions must succeed for the method to return true.
     *
     * Subscription Process:
     * 1. Validate ADS client connection
     * 2. Iterate through each address specification
     * 3. Subscribe to each symbol individually
     * 4. Return success/failure status to Edge Agent
     *
     * @param {Array<Object>} specs - Array of parsed address specifications
     * @param {string} specs[].symbolName - TwinCAT symbol name
     * @param {number} specs[].cycleTime - Subscription cycle time in milliseconds
     * @returns {Promise<boolean>} - True if all subscriptions successful, false otherwise
     */
    async subscribe(specs) {
        // Validate that we have an active ADS connection before attempting subscriptions
        if (!this.client || !this.client.connection.connected) {
            this.log("Cannot subscribe: ADS client not connected");
            return false;
        }

        try {
            // Subscribe to each address specification sequentially
            // Sequential processing ensures proper error handling and logging
            for (const spec of specs) {
                await this.subscribeToSymbol(spec);
            }

            this.log("Successfully subscribed to %d symbols", specs.length);
            return true; // All subscriptions successful
        } catch (err) {
            this.log("Subscription failed: %o", err);
            return false; // At least one subscription failed
        }
    }

    /**
     * Subscribes to a single ADS symbol with change notifications
     *
     * This method handles the subscription to an individual PLC symbol using
     * the ADS notification mechanism. It sets up a callback that will be
     * triggered whenever the symbol value changes, and forwards that data
     * to the Edge Agent.
     *
     * Subscription Flow:
     * 1. Check for existing subscription (prevent duplicates)
     * 2. Create value change callback
     * 3. Subscribe to symbol with specified cycle time
     * 4. Store subscription reference for cleanup
     *
     * @param {Object} spec - Parsed address specification
     * @param {string} spec.symbolName - TwinCAT symbol name
     * @param {number} spec.cycleTime - Subscription cycle time in milliseconds
     * @throws {Error} - Throws if subscription fails
     */
    async subscribeToSymbol(spec) {
        const { symbolName, cycleTime } = spec;

        // Skip if already subscribed to prevent duplicate subscriptions
        // This can happen during address configuration updates
        if (this.subscriptions.has(symbolName)) {
            this.log("Already subscribed to %s", symbolName);
            return;
        }

        this.log("Subscribing to symbol %s with cycle time %dms", symbolName, cycleTime);

        // Create callback function for value change notifications
        // This callback will be invoked by the ADS client whenever the symbol value changes
        const onValueChanged = (data, subscription) => {
            // Forward the changed value to the Edge Agent
            // Use the original spec as the address identifier for proper routing
            this.data(spec, data.value);
        };

        try {
            // Subscribe to the symbol using the ADS client
            // This establishes an ADS notification subscription on the PLC
            const subscription = await this.client.subscribeValue(
                symbolName,      // Symbol name in TwinCAT
                onValueChanged,  // Callback for value changes
                cycleTime        // How often to check for changes (ms)
            );

            // Store the subscription reference for later cleanup
            this.subscriptions.set(symbolName, subscription);
            this.log("Successfully subscribed to %s", symbolName);
        } catch (err) {
            this.log("Failed to subscribe to %s: %o", symbolName, err);
            throw err; // Re-throw to fail the overall subscription process
        }
    }

    /**
     * Forwards data from ADS to the Edge Agent
     *
     * This method is called whenever an ADS symbol value changes. It converts
     * the JavaScript value from the ADS client into a binary buffer format
     * that the Edge Agent can process and forward to Factory+.
     *
     * Data Flow:
     * 1. Receive value change from ADS subscription callback
     * 2. Convert JavaScript value to JSON, then to binary buffer
     * 3. Forward to Edge Agent with original address specification
     * 4. Edge Agent handles Sparkplug encoding and transmission
     *
     * @param {Object} spec - Original address specification for routing
     * @param {*} value - The changed value from the ADS symbol (any JS type)
     */
    data(spec, value) {
        // Convert the value to a buffer using BufferX utility
        // BufferX.fromJSON handles conversion of JavaScript types to binary format
        const buffer = BufferX.fromJSON(value);

        // Forward the data to the Edge Agent using the AsyncDriver interface
        // The spec is used as the address identifier for proper routing
        this.driver.data(spec, buffer);
    }

    /**
     * Gracefully closes the ADS connection and cleans up resources
     *
     * This method is called when the Edge Agent is shutting down or when
     * the driver configuration changes. It ensures all subscriptions are
     * properly unsubscribed and the ADS connection is cleanly terminated.
     *
     * Cleanup Process:
     * 1. Cancel any pending reconnection attempts
     * 2. Unsubscribe from all active ADS symbol subscriptions
     * 3. Disconnect the ADS client
     * 4. Clear all internal state
     * 5. Call completion callback if provided
     *
     * @param {Function} [done] - Optional callback to signal completion
     */
    async close(done) {
        this.log("Closing ADS connection");

        // Clear reconnect timer to prevent reconnection during shutdown
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        // Unsubscribe from all active symbol subscriptions
        // This prevents further data callbacks and cleans up PLC-side resources
        try {
            for (const [symbolName, subscription] of this.subscriptions) {
                this.log("Unsubscribing from %s", symbolName);
                await this.client.unsubscribe(subscription);
            }
            this.subscriptions.clear(); // Clear the subscription tracking map
        } catch (err) {
            this.log("Error during unsubscribe: %o", err);
            // Continue with cleanup even if unsubscribe fails
        }

        // Disconnect the ADS client
        if (this.client) {
            try {
                await this.client.disconnect();
                this.log("ADS client disconnected");
            } catch (err) {
                this.log("Error disconnecting ADS client: %o", err);
                // Continue with cleanup even if disconnect fails
            }
            this.client = null; // Clear the client reference
        }

        // Signal completion to the Edge Agent if callback provided
        if (done) done();
    }
}
