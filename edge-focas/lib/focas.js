/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { BufferX } from '@amrc-factoryplus/edge-driver';
import ffi from 'ffi-napi';
import ref from 'ref-napi';
import StructType from 'ref-struct-di';
import ArrayType from 'ref-array-di';

// Initialize ref-struct and ref-array with ref-napi
const Struct = StructType(ref);
const Array = ArrayType(ref);

// FOCAS data types
const short = ref.types.short;
const ushort = ref.types.ushort;
const long = ref.types.long;
const ulong = ref.types.ulong;
const char = ref.types.char;
const uchar = ref.types.uchar;
const double = ref.types.double;

// FOCAS structures
const ODBAXIS = Struct({
    'dummy': short,
    'type': short,
    'data': Array(long, 32)
});

const ODBSPN = Struct({
    'dummy': short,
    'data': long
});

const ODBPRO = Struct({
    'dummy': short,
    'data': long,
    'mdata': long
});

const ODBALM = Struct({
    'dummy': short,
    'data': short
});

/**
 * Fanuc FOCAS Handler for Edge Agent
 * 
 * This handler implements a polled driver for communicating with Fanuc CNC controllers
 * using the FOCAS (FANUC Open CNC API Specification) protocol.
 * 
 * Address Format Examples:
 *   - "axis:1:position" - Get position of axis 1
 *   - "spindle:1:speed" - Get speed of spindle 1
 *   - "program:current" - Get current program number
 *   - "alarm:status" - Get alarm status
 *   - "tool:current" - Get current tool number
 *   - "macro:100" - Get macro variable 100
 */
export class FocasHandler {
    constructor(driver, conf) {
        this.driver = driver;
        this.conf = conf;
        this.log = driver.debug.bound('focas');

        // FOCAS connection parameters
        const {
            host,           // CNC IP address
            port = 8193,    // Default FOCAS port
            timeout = 5000, // Connection timeout in ms
            libraryPath = '/usr/local/lib/libfwlib32.so', // Path to FOCAS library
        } = conf;

        this.host = host;
        this.port = port;
        this.timeout = timeout;
        this.libraryPath = libraryPath;
        this.connected = false;
        this.libHandle = 0;

        // Initialize FOCAS library via FFI
        try {
            this.focasLib = ffi.Library(this.libraryPath, {
                // Connection management
                'cnc_allclibhndl3': [short, ['string', ushort, long, ref.refType(ushort)]],
                'cnc_freelibhndl': [short, [ushort]],

                // Axis data
                'cnc_rdaxisdata': [short, [ushort, short, ref.refType(ODBAXIS), short, ref.refType(short)]],

                // Spindle data
                'cnc_rdspindlespeed': [short, [ushort, short, ref.refType(ODBSPN)]],

                // Program data
                'cnc_rdprgnum': [short, [ushort, ref.refType(ODBPRO)]],

                // Alarm data
                'cnc_rdalmmsg': [short, [ushort, short, ref.refType(short), ref.refType(ODBALM)]],

                // Tool data
                'cnc_rdtool': [short, [ushort, short, short, ref.refType('void')]],

                // Macro variables
                'cnc_rdmacro': [short, [ushort, long, short, ref.refType('void')]],

                // PMC data
                'cnc_rdpmcrng': [short, [ushort, short, short, ushort, ushort, ref.refType('void')]],

                // Modal data
                'cnc_modal': [short, [ushort, short, short, ref.refType('void')]]
            });

            this.log('FOCAS library loaded successfully from %s', this.libraryPath);
        } catch (error) {
            this.log('Failed to load FOCAS library: %s', error.message);
            this.focasLib = null;
        }
    }

    static create(driver, conf) {
        return new FocasHandler(driver, conf);
    }

    async connect() {
        try {
            this.log('Connecting to Fanuc CNC at %s:%d', this.host, this.port);

            if (!this.focasLib) {
                this.log('FOCAS library not loaded');
                return 'CONF';
            }

            if (!this.host) {
                this.log('No host specified in configuration');
                return 'CONF';
            }

            // Allocate FOCAS library handle
            const handlePtr = ref.alloc(ushort);
            const connectionString = `${this.host}:${this.port}`;

            const result = this.focasLib.cnc_allclibhndl3(
                connectionString,
                this.timeout,
                0, // Reserved parameter
                handlePtr
            );

            if (result !== 0) {
                this.log('Failed to allocate FOCAS handle, error code: %d', result);
                return this.mapFocasError(result);
            }

            this.libHandle = handlePtr.deref();
            this.connected = true;
            this.log('Connected to Fanuc CNC successfully, handle: %d', this.libHandle);

            return 'UP';
        } catch (error) {
            this.log('Failed to connect to Fanuc CNC: %s', error.message);
            this.connected = false;
            return 'CONN';
        }
    }

    mapFocasError(errorCode) {
        // Map FOCAS error codes to driver status
        switch (errorCode) {
            case -8:  // EW_SOCKET
            case -9:  // EW_NODLL
                return 'CONN';
            case -16: // EW_HANDLE
            case -17: // EW_VERSION
                return 'CONF';
            default:
                return 'ERR';
        }
    }

    parseAddr(spec) {
        // Parse address specification into components
        // Expected format: "type:param:subparam" or "type:param"

        if (spec === 'undefined') {
            // Handle upstream edge agent bug
            return {
                type: null,
                param: null,
                subparam: null,
            };
        }

        const parts = spec.split(':');
        if (parts.length < 2) {
            this.log('Invalid address format: %s', spec);
            return null;
        }

        const type = parts[0];
        const param = parts[1];
        const subparam = parts[2] || null;

        // Validate address types
        const validTypes = [
            'axis',      // Axis data (position, velocity, etc.)
            'spindle',   // Spindle data (speed, load, etc.)
            'program',   // Program information
            'alarm',     // Alarm status
            'tool',      // Tool information
            'macro',     // Macro variables
            'pmc',       // PMC data
            'modal',     // Modal information
        ];

        if (!validTypes.includes(type)) {
            this.log('Invalid address type: %s', type);
            return null;
        }

        return {
            type,
            param,
            subparam,
        };
    }

    async poll(addr) {
        if (!this.connected) {
            this.log('Not connected to CNC, cannot poll address: %o', addr);
            return undefined;
        }

        // Handle upstream edge agent bug
        if (addr.type === null) {
            return undefined;
        }

        try {
            this.log('Polling address: %o', addr);

            // TODO: Implement actual FOCAS data reading based on address type
            // This would involve calling appropriate FOCAS API functions

            let value;

            switch (addr.type) {
                case 'axis':
                    value = await this.readAxisData(addr.param, addr.subparam);
                    break;
                case 'spindle':
                    value = await this.readSpindleData(addr.param, addr.subparam);
                    break;
                case 'program':
                    value = await this.readProgramData(addr.param);
                    break;
                case 'alarm':
                    value = await this.readAlarmData(addr.param);
                    break;
                case 'tool':
                    value = await this.readToolData(addr.param);
                    break;
                case 'macro':
                    value = await this.readMacroVariable(addr.param);
                    break;
                case 'pmc':
                    value = await this.readPmcData(addr.param, addr.subparam);
                    break;
                case 'modal':
                    value = await this.readModalData(addr.param);
                    break;
                default:
                    this.log('Unsupported address type: %s', addr.type);
                    return undefined;
            }

            // Convert value to buffer format expected by Edge Agent
            const buffer = BufferX.fromJSON(value);
            return buffer;

        } catch (error) {
            this.log('Error polling address %o: %s', addr, error.message);
            return undefined;
        }
    }

    // FOCAS API implementation methods

    async readAxisData(axisNum, dataType) {
        if (!this.connected || !this.focasLib) {
            throw new Error('Not connected to CNC');
        }

        this.log('Reading axis %s data type %s', axisNum, dataType);

        try {
            const axisData = new ODBAXIS();
            const lengthPtr = ref.alloc(short, 32);

            const result = this.focasLib.cnc_rdaxisdata(
                this.libHandle,
                parseInt(axisNum),
                axisData.ref(),
                32,
                lengthPtr
            );

            if (result !== 0) {
                throw new Error(`FOCAS error reading axis data: ${result}`);
            }

            // Extract the requested data type from the axis data
            const axisIndex = parseInt(axisNum) - 1; // FOCAS uses 1-based indexing
            if (axisIndex >= 0 && axisIndex < 32) {
                const value = axisData.data[axisIndex];

                switch (dataType) {
                    case 'position':
                        // Convert to machine units (typically mm or inches)
                        return { type: 'double', value: value / 1000.0 };
                    case 'velocity':
                        return { type: 'double', value: value };
                    default:
                        return { type: 'long', value: value };
                }
            }

            return { type: 'long', value: 0 };
        } catch (error) {
            this.log('Error reading axis data: %s', error.message);
            throw error;
        }
    }

    async readSpindleData(spindleNum, dataType) {
        if (!this.connected || !this.focasLib) {
            throw new Error('Not connected to CNC');
        }

        this.log('Reading spindle %s data type %s', spindleNum, dataType);

        try {
            const spindleData = new ODBSPN();

            const result = this.focasLib.cnc_rdspindlespeed(
                this.libHandle,
                parseInt(spindleNum),
                spindleData.ref()
            );

            if (result !== 0) {
                throw new Error(`FOCAS error reading spindle data: ${result}`);
            }

            switch (dataType) {
                case 'speed':
                    return { type: 'long', value: spindleData.data };
                case 'load':
                    // For load, we'd need a different FOCAS call
                    // This is a placeholder
                    return { type: 'short', value: 75 };
                default:
                    return { type: 'long', value: spindleData.data };
            }
        } catch (error) {
            this.log('Error reading spindle data: %s', error.message);
            throw error;
        }
    }

    async readProgramData(dataType) {
        // TODO: Implement cnc_rdprgnum() or similar
        this.log('Reading program data type %s', dataType);

        switch (dataType) {
            case 'current':
                return { type: 'long', value: 1001 };
            case 'main':
                return { type: 'long', value: 1000 };
            default:
                return { type: 'long', value: 0 };
        }
    }

    async readAlarmData(dataType) {
        // TODO: Implement cnc_rdalmmsg() or similar
        this.log('Reading alarm data type %s', dataType);

        switch (dataType) {
            case 'status':
                return { type: 'short', value: 0 }; // 0 = no alarm
            case 'count':
                return { type: 'short', value: 0 };
            default:
                return { type: 'short', value: 0 };
        }
    }

    async readToolData(dataType) {
        // TODO: Implement cnc_rdtool() or similar
        this.log('Reading tool data type %s', dataType);

        switch (dataType) {
            case 'current':
                return { type: 'long', value: 1 };
            default:
                return { type: 'long', value: 0 };
        }
    }

    async readMacroVariable(varNum) {
        // TODO: Implement cnc_rdmacro() or similar
        this.log('Reading macro variable %s', varNum);

        // Placeholder - would read actual macro variable
        return { type: 'double', value: 0.0 };
    }

    async readPmcData(address, dataType) {
        // TODO: Implement cnc_rdpmcrng() or similar
        this.log('Reading PMC data address %s type %s', address, dataType);

        // Placeholder - would read actual PMC data
        return { type: 'char', value: 0 };
    }

    async readModalData(dataType) {
        // TODO: Implement cnc_modal() or similar
        this.log('Reading modal data type %s', dataType);

        // Placeholder - would read actual modal data
        return { type: 'long', value: 0 };
    }

    async close() {
        try {
            if (this.connected && this.focasLib && this.libHandle) {
                this.log('Disconnecting from Fanuc CNC');

                const result = this.focasLib.cnc_freelibhndl(this.libHandle);
                if (result !== 0) {
                    this.log('Warning: Error freeing FOCAS handle: %d', result);
                }

                this.libHandle = 0;
                this.connected = false;
                this.log('Disconnected from Fanuc CNC');
            }
        } catch (error) {
            this.log('Error during disconnect: %s', error.message);
        }
    }
}
